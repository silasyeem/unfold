import {KNARREVIK} from '../dist/knarrevik.js';
export const LIBRARY_PDF_LIMIT=8*1024*1024;
export const LIBRARY_HTML_LIMIT=4*1024*1024;
export function canonicalSource(value){
 if(typeof value!=='string'||value.length>2048)throw new Error('Invalid source URL.');
 let url;try{url=new URL(value);}catch{throw new Error('Invalid source URL.');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443')||!host.includes('.')||/^[\d.]+$|:/.test(host)||/(^|\.)(localhost|local|internal|lan|home|onion|invalid|test)$/.test(host))throw new Error('Only public HTTPS manufacturer sources are supported.');
 url.hostname=host;url.hash='';for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['gclid','fbclid'].includes(key.toLowerCase()))url.searchParams.delete(key);return url.href;
}
// Restrict server downloads to manufacturer-controlled domains. Other manuals
// can still be uploaded directly; do not permit arbitrary user-owned DNS here.
function trustedSource(value){const url=new URL(canonicalSource(value));if(url.hostname!=='ikea.com'&&!url.hostname.endsWith('.ikea.com'))throw new Error('Hosted manual search currently supports IKEA. Upload other manufacturers’ PDFs directly.');return url.href;}
async function download(value,{html=false,signal}={}){
 let current=trustedSource(value);const limit=html?LIBRARY_HTML_LIMIT:LIBRARY_PDF_LIMIT;
 const combined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]);
 for(let hop=0;hop<=4;hop++){
  const response=await fetch(current,{redirect:'manual',signal:combined,headers:{Accept:html?'text/html,application/xhtml+xml':'application/pdf'}});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();const location=response.headers.get('location');if(!location||hop===4)throw new Error('Too many manufacturer redirects.');current=trustedSource(new URL(location,current).href);continue;}
  if(!response.ok)throw new Error('The manufacturer could not provide this manual. Open its source and upload the PDF.');
  const type=response.headers.get('content-type')?.split(';')[0];
  if(!(html?['text/html','application/xhtml+xml']:['application/pdf','application/octet-stream','binary/octet-stream']).includes(type))throw new Error('The manufacturer returned an unsupported document.');
  if(Number(response.headers.get('content-length'))>limit)throw new Error('The manufacturer document exceeds the size limit.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('The manufacturer document exceeds the size limit.');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(html)return{html:new TextDecoder().decode(bytes),sourceUrl:current};
  if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw new Error('The source did not return a PDF.');return{bytes,sourceUrl:current};
 }
}
const demoId=KNARREVIK.manualSha256.slice(0,24);
const empty=()=>({version:1,records:[{id:demoId,title:'KNARREVIK bedside table',product:'KNARREVIK bedside table black',manufacturer:'IKEA',modelNumber:KNARREVIK.article,sourceUrl:KNARREVIK.manualUrl,pdfUrl:KNARREVIK.manualUrl,productPageUrl:KNARREVIK.productUrl,imageUrl:KNARREVIK.imageUrl,pdfCached:true,pageCount:12,enrichmentVersion:1,enrichmentStatus:'resolved'}],queries:{}});
function validId(id){if(!/^[a-f0-9]{24}$/.test(id))throw new Error('Invalid manual identifier.');return id;}
export function createWorkerLibraryStore(env){
 const bucket=env.BUCKET;
 const snapshot=async()=>{if(!bucket)return{data:empty(),etag:null};const object=await bucket.get('manual-library/index.json');if(!object)return{data:empty(),etag:null};if(object.size>8*1024*1024)throw new Error('The manual library is too large.');return{data:await object.json(),etag:object.etag};};
 return{
  read:async()=>(await snapshot()).data,
  async update(change){if(!bucket)throw new Error('Hosted manual storage is unavailable.');for(let i=0;i<5;i++){const {data,etag}=await snapshot();const result=await change(data),body=JSON.stringify(data);if(body.length>8*1024*1024)throw new Error('The manual library is full.');const saved=await bucket.put('manual-library/index.json',body,{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(saved)return result;}throw new Error('The manual library is busy. Please retry.');},
  async getPdf(id){validId(id);if(id===demoId){const r=await env.ASSETS.fetch(new Request('https://assets.local/reference/knarrevik-manual.pdf'));if(!r.ok)throw new Error('The demo PDF is unavailable.');return new Uint8Array(await r.arrayBuffer());}const object=await bucket?.get(`manual-library/pdfs/${id}.pdf`);if(!object)return null;if(object.size>LIBRARY_PDF_LIMIT)throw new Error('Cached PDF exceeds the size limit.');return new Uint8Array(await object.arrayBuffer());},
  async putPdf(id,bytes){if(!bucket)throw new Error('Hosted manual storage is unavailable.');if(bytes.byteLength>LIBRARY_PDF_LIMIT)throw new Error('PDF exceeds the size limit.');await bucket.put(`manual-library/pdfs/${validId(id)}.pdf`,bytes,{httpMetadata:{contentType:'application/pdf'}});},
  async validateSource(url){return trustedSource(url);},
  fetchPdf:(url,options)=>download(url,options),fetchHtml:(url,options)=>download(url,{...options,html:true}),
 };
}
