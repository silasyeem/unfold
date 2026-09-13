import {readFile,writeFile,mkdir,rename,unlink,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {randomUUID} from 'node:crypto';

export const LIBRARY_PDF_LIMIT=8*1024*1024;
const queues=new Map();
const empty=()=>({version:1,records:[],queries:{}});

export function canonicalSource(value){
 if(typeof value!=='string'||value.length>2048)throw new Error('Invalid source URL.');
 let url;try{url=new URL(value);}catch{throw new Error('Invalid source URL.');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||isIP(host.replace(/^\[|\]$/g,''))||/(^|\.)(localhost|local|internal|lan|home|onion|invalid|test)$/.test(host))throw new Error('Only public HTTPS manufacturer sources are supported.');
 url.hostname=host;url.hash='';
 for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['gclid','fbclid'].includes(key.toLowerCase()))url.searchParams.delete(key);
 return url.href;
}
export function isPublicAddress(address){
 if(isIP(address)===4){
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||(b===0&&c===2)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
 }
 if(isIP(address)===6){
  // Only global-unicast space; exclude embedded IPv4, documentation and transition ranges.
  const normalized=new URL(`http://[${address}]/`).hostname.slice(1,-1);
  const [first,second]=normalized.split(':').map(part=>parseInt(part||'0',16));
  return /^[23][0-9a-f]{3}:/.test(normalized)&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002&&first!==0x3fff;
 }
 return false;
}
export async function resolvePublicSource(value,{lookupImpl=lookup,signal}={}){
 const url=new URL(canonicalSource(value));
 if(signal?.aborted)throw new Error('Source request cancelled.');
 let timer,addresses;
 try{addresses=await Promise.race([
  lookupImpl(url.hostname,{all:true,verbatim:true}),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Source lookup timed out.')),5000);timer.unref?.();}),
 ]);}finally{clearTimeout(timer);}
 if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw new Error('The source does not resolve to a public address.');
 return {url,addresses};
}

// Connect to the checked address, retaining the original hostname for TLS. A second
// DNS lookup during connection would permit a DNS-rebinding race.
async function requestPublic(value,{lookupImpl,requestImpl,signal,accept='application/pdf'}){
 const {url,addresses}=await resolvePublicSource(value,{lookupImpl,signal});
 return new Promise((resolveResponse,reject)=>{
  const req=requestImpl(url,{method:'GET',signal,agent:false,headers:{Accept:accept,'Accept-Encoding':'identity','User-Agent':'Unfold-Manual-Library/1.0'},lookup(_hostname,options,callback){
   if(options?.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);
  }},response=>resolveResponse({response,url}));
  req.on('error',()=>reject(new Error(signal?.aborted?'Source request timed out or was cancelled.':'The source could not be downloaded.')));
  req.setTimeout(15000,()=>req.destroy(new Error('Source request timed out.')));req.end();
 });
}
export async function downloadPublicPdf(value,{lookupImpl=lookup,requestImpl=httpsRequest,signal}={}){
 const timeout=AbortSignal.timeout(30000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let current=canonicalSource(value);
 for(let hop=0;hop<=4;hop++){
  const {response,url}=await requestPublic(current,{lookupImpl,requestImpl,signal:combined});
  if([301,302,303,307,308].includes(response.statusCode)){
   const location=response.headers.location;response.destroy();
   if(!location||hop===4)throw new Error('The source redirects too many times.');
   current=canonicalSource(new URL(location,url).href);continue;
  }
  if(response.statusCode!==200){response.destroy();throw new Error('The manufacturer did not provide a downloadable manual. Open the source instead.');}
  const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(!['application/pdf','application/octet-stream','binary/octet-stream'].includes(type)){response.destroy();throw new Error('This source is a web page, not a PDF. Open the source and upload its manual.');}
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new Error('The source uses an unsupported download encoding.');}
  if(Number(response.headers['content-length'])>LIBRARY_PDF_LIMIT){response.destroy();throw new Error('This manual is larger than the 8 MB conversion limit.');}
  const chunks=[];let size=0;
  try{for await(const chunk of response){size+=chunk.length;if(size>LIBRARY_PDF_LIMIT)throw new Error('This manual is larger than the 8 MB conversion limit.');chunks.push(chunk);}}
  catch(error){response.destroy();throw new Error(error.message.includes('8 MB')?error.message:'The manual download was interrupted.');}
  const bytes=Buffer.concat(chunks,size);
  if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('This source did not return a valid PDF.');
  return {bytes,sourceUrl:current};
 }
 throw new Error('The source could not be downloaded.');
}


export const LIBRARY_HTML_LIMIT=4*1024*1024;
export async function downloadPublicHtml(value,{lookupImpl=lookup,requestImpl=httpsRequest,signal}={}){
 const timeout=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 let current=canonicalSource(value);
 for(let hop=0;hop<=4;hop++){
  const {response,url}=await requestPublic(current,{lookupImpl,requestImpl,signal:combined,accept:'text/html,application/xhtml+xml'});
  if([301,302,303,307,308].includes(response.statusCode)){
   const location=response.headers.location;response.destroy();
   if(!location||hop===4)throw new Error('The product page redirects too many times.');
   current=canonicalSource(new URL(location,url).href);continue;
  }
  if(response.statusCode!==200){response.destroy();throw new Error('The manufacturer product page is unavailable.');}
  const type=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(!['text/html','application/xhtml+xml'].includes(type)){response.destroy();throw new Error('The source is not a product web page.');}
  if(response.headers['content-encoding']&&response.headers['content-encoding']!=='identity'){response.destroy();throw new Error('The product page uses an unsupported encoding.');}
  if(Number(response.headers['content-length'])>LIBRARY_HTML_LIMIT){response.destroy();throw new Error('The product page is too large to inspect.');}
  const chunks=[];let size=0;
  try{for await(const chunk of response){size+=chunk.length;if(size>LIBRARY_HTML_LIMIT)throw new Error('The product page is too large to inspect.');chunks.push(chunk);}}
  catch(error){response.destroy();throw new Error(error.message.includes('too large')?error.message:'The product page download was interrupted.');}
  return {html:Buffer.concat(chunks,size).toString('utf8'),sourceUrl:current};
 }
 throw new Error('The product page could not be downloaded.');
}

function serialize(directory,operation){
 const previous=queues.get(directory)||Promise.resolve();
 const result=previous.catch(()=>{}).then(operation),tail=result.then(()=>{},()=>{});queues.set(directory,tail);
 tail.finally(()=>{if(queues.get(directory)===tail)queues.delete(directory);});return result;
}
async function atomicWrite(filename,contents){
 const temporary=`${filename}.${randomUUID()}.tmp`;
 try{await writeFile(temporary,contents,{mode:0o600,flag:'wx'});await rename(temporary,filename);}
 finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function validId(id){if(!/^[a-f0-9]{24}$/.test(id))throw new Error('Invalid manual identifier.');return id;}
export function createLibraryStore(directory,{lookupImpl=lookup,requestImpl=httpsRequest}={}){
 const root=resolve(directory),filename=join(root,'library.json'),pdfRoot=join(root,'pdfs');
 const read=async()=>{
  try{if((await stat(filename)).size>8*1024*1024)throw new Error('The manual library is too large to read.');const data=JSON.parse(await readFile(filename,'utf8'));if(data.version!==1||!Array.isArray(data.records)||!data.queries||typeof data.queries!=='object'||Array.isArray(data.queries))throw new Error('Invalid library data.');return data;}
  catch(error){if(error.code==='ENOENT')return empty();throw new Error('The saved manual library could not be read. Its existing files were preserved.');}
 };
 return {
  read,
  async update(change){return serialize(root,async()=>{const data=await read(),result=await change(data),serialized=JSON.stringify(data,null,2);if(Buffer.byteLength(serialized)>8*1024*1024)throw new Error('The manual library has reached its storage limit. Existing manuals were preserved.');await mkdir(root,{recursive:true,mode:0o700});await atomicWrite(filename,serialized);return result;});},
  async getPdf(id){try{const path=join(pdfRoot,validId(id)+'.pdf');if((await stat(path)).size>LIBRARY_PDF_LIMIT)throw new Error('Cached manual exceeds the size limit.');return new Uint8Array(await readFile(path));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
  async putPdf(id,bytes){if(bytes.byteLength>LIBRARY_PDF_LIMIT)throw new Error('Manual exceeds the size limit.');await mkdir(pdfRoot,{recursive:true,mode:0o700});await atomicWrite(join(pdfRoot,validId(id)+'.pdf'),bytes);},
  async validateSource(url){return (await resolvePublicSource(url,{lookupImpl})).url.href;},
  fetchPdf(url,options={}){return downloadPublicPdf(url,{lookupImpl,requestImpl,...options});},
  fetchHtml(url,options={}){return downloadPublicHtml(url,{lookupImpl,requestImpl,...options});},
 };
}
