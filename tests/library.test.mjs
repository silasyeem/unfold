import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {PDFDocument} from 'pdf-lib';
import {parseHTML} from 'linkedom';
import {handleLibrary,normalizeQuery} from '../server/library.mjs';
import {createLibraryStore,canonicalSource,isPublicAddress,resolvePublicSource,downloadPublicPdf,LIBRARY_PDF_LIMIT} from '../server/library-store.mjs';
import {mountManualLibrary} from '../dist/manual-library.js';

const source='https://www.ikea.com/manuals/strandmon.pdf';
const candidate={title:'STRANDMON wing chair assembly instructions',manufacturer:'IKEA',product:'STRANDMON',modelNumber:'104.569.60',sourceUrl:source,pdfUrl:source};
const publicLookup=async()=>[{address:'93.184.215.14',family:4}];
function providerResponse(manuals=[candidate],sources=manuals.flatMap(item=>[item.sourceUrl,item.pdfUrl].filter(Boolean))){return Response.json({status:'completed',output:[{type:'web_search_call',action:{sources:sources.map(url=>({type:'url',url}))}},{type:'message',content:[{type:'output_text',text:JSON.stringify({manuals})}]}]});}
const get=query=>new Request(`http://127.0.0.1:4173/api/library?q=${encodeURIComponent(query)}`);
const search=query=>new Request('http://127.0.0.1:4173/api/library/web-search',{method:'POST',headers:{'Content-Type':'application/json','X-Unfold-Library':'1'},body:JSON.stringify({query})});
const load=id=>new Request(`http://127.0.0.1:4173/api/library/${id}/pdf`,{method:'POST',headers:{'X-Unfold-Library':'1'}});
async function withStore(t){const directory=await mkdtemp(join(tmpdir(),'unfold-library-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createLibraryStore(directory,{lookupImpl:publicLookup});store.fetchHtml=async()=>{throw new Error('No HTML fixture');};return {directory,store};}
async function pdf(pages=2){const document=await PDFDocument.create();for(let i=0;i<pages;i++)document.addPage([100,100]);return document.save();}

test('saved library lookup never calls a provider; explicit searches persist and normalize repeated queries',async t=>{
 const {directory,store}=await withStore(t);let calls=0;
 const env={libraryStore:store,OPENAI_API_KEY:'test-secret-only',libraryFetch:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.tools[0].type,'web_search');assert.equal(body.tool_choice,'required');assert.deepEqual(body.include,['web_search_call.action.sources']);return providerResponse();}};
 const initial=await (await handleLibrary(get('IKEA STRANDMON'),env)).json();assert.deepEqual(initial.records,[]);assert.equal(calls,0);
 const found=await (await handleLibrary(search('IKEA STRANDMON'),env)).json();assert.equal(found.records.length,1);assert.equal(found.cached,false);assert.equal(found.records[0].pdfCached,false);assert.equal(calls,1);
 const restarted={...env,libraryStore:createLibraryStore(directory,{lookupImpl:publicLookup})};
 const repeat=await (await handleLibrary(search('  strandmon, IKEA assembly instructions  '),restarted)).json();assert.equal(repeat.cached,true);assert.equal(repeat.records.length,1);assert.equal(calls,1);
 const partial=await (await handleLibrary(get('STRANDMON'),restarted)).json();assert.equal(partial.records[0].sourceUrl,source);assert.equal(calls,1);
 const data=await readFile(join(directory,'library.json'),'utf8');assert(!data.includes('test-secret-only'));assert(!data.includes('Bearer'));assert.equal(normalizeQuery('  IKEÁ, strandmon! '),'ikea strandmon');
});

test('parallel identical searches share one request and negative queries are cached, including prototype property names',async t=>{
 const {store}=await withStore(t);let calls=0;
 const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,15));return providerResponse([]);}};
 const results=await Promise.all([1,2,3].map(()=>handleLibrary(search('constructor'),env)));assert(results.every(response=>response.status===200));assert.equal(calls,1);
 const empty=await (await handleLibrary(get('constructor'),env)).json();assert.equal(empty.webSearched,true);assert.deepEqual(empty.records,[]);
 await handleLibrary(search('constructor'),env);assert.equal(calls,1);
 await handleLibrary(search('toString'),env);assert.equal(calls,2);
});

test('only grounded public instruction sources are saved; landing pages remain source links',async t=>{
 const {store}=await withStore(t);
 const landing={...candidate,sourceUrl:'https://www.ikea.com/support/strandmon',pdfUrl:'https://www.ikea.com/guessed.pdf'};
 const unsafe={...candidate,sourceUrl:'https://127.0.0.1/secret.pdf',pdfUrl:''};
 const fabricated={...candidate,sourceUrl:'https://www.ikea.com/fabricated.pdf',pdfUrl:''};
 const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:async()=>providerResponse([landing,unsafe,fabricated],[landing.sourceUrl,unsafe.sourceUrl])};
 const data=await (await handleLibrary(search('strandmon'),env)).json();assert.equal(data.records.length,1);assert.equal(data.records[0].pdfUrl,'');
 const result=await handleLibrary(load(data.records[0].id),env);assert.equal(result.status,422);assert.equal((await result.json()).sourceUrl,landing.sourceUrl);
});

test('a manual PDF downloads once, survives a restarted store, and remains tied to its saved record',async t=>{
 const {directory,store}=await withStore(t),bytes=await pdf();let downloads=0;
 store.fetchPdf=async url=>{downloads++;assert.equal(url,source);await new Promise(resolve=>setTimeout(resolve,10));return {bytes,sourceUrl:source};};
 const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:async()=>providerResponse()};
 const {records}=await (await handleLibrary(search('strandmon'),env)).json();const id=records[0].id;
 const responses=await Promise.all([handleLibrary(load(id),env),handleLibrary(load(id),env)]);assert(responses.every(response=>response.status===200));assert.equal(downloads,1);assert.deepEqual(new Uint8Array(await responses[0].arrayBuffer()),bytes);
 const restarted=createLibraryStore(directory,{lookupImpl:publicLookup});restarted.fetchPdf=()=>{throw new Error('Should not fetch a cached file');};
 const cached=await handleLibrary(load(id),{libraryStore:restarted});assert.equal(cached.status,200);assert.equal(cached.headers.get('X-Unfold-Library-Cache'),'hit');
 const saved=(await restarted.read()).records[0];assert.equal(saved.pdfCached,true);assert.equal(saved.pageCount,2);
 assert.equal((await handleLibrary(load('a'.repeat(24)),env)).status,404);
});

test('oversized, malformed, or overlong manuals are rejected without caching',async t=>{
 const {store}=await withStore(t);const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:async()=>providerResponse()};
 const {records}=await (await handleLibrary(search('strandmon'),env)).json();
 for(const bytes of [new Uint8Array(LIBRARY_PDF_LIMIT+1),new TextEncoder().encode('not a PDF'),await pdf(41)]){
  store.fetchPdf=async()=>({bytes,sourceUrl:source});assert.equal((await handleLibrary(load(records[0].id),env)).status,502);assert.equal(await store.getPdf(records[0].id),null);
 }
});

test('atomic updates preserve parallel changes from separate store instances and never erase a corrupt file',async t=>{
 const {directory,store}=await withStore(t),second=createLibraryStore(directory,{lookupImpl:publicLookup});
 await Promise.all(Array.from({length:12},(_,i)=>(i%2?store:second).update(data=>{data.queries[`product ${i}`]={recordIds:[],searchedAt:'now'};})));
 assert.equal(Object.keys((await store.read()).queries).length,12);
 await writeFile(join(directory,'library.json'),'{ corrupt');await assert.rejects(()=>store.update(()=>{}),/preserved/);assert.equal(await readFile(join(directory,'library.json'),'utf8'),'{ corrupt');
});

test('source validation rejects private addresses, URL credentials, unsafe schemes, and DNS changes',async()=>{
 for(const url of ['http://www.ikea.com/manual.pdf','https://user:pass@www.ikea.com/manual.pdf','https://127.0.0.1/a','https://[::1]/a','https://2130706433/a','https://metadata.google.internal/a','https://www.ikea.com:444/a','https://localhost/a'])assert.throws(()=>canonicalSource(url));
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','172.16.0.1','198.18.1.1','203.0.113.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::1','3fff::1'])assert.equal(isPublicAddress(address),false,address);
 assert.equal(isPublicAddress('93.184.215.14'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(()=>resolvePublicSource(source,{lookupImpl:async()=>[{address:'10.0.0.1',family:4}]}),/public address/);
 assert.equal(canonicalSource(source+'?utm_source=search#page=1'),source);
});

function requestMock(routes,seen=[]){return (url,options,callback)=>{
 const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=error=>req.emit('error',error);req.end=()=>queueMicrotask(()=>{
  seen.push(url.href);options.lookup(url.hostname,{all:false},(error,address)=>{assert.equal(error,null);assert.equal(address,'93.184.215.14');});
  const route=routes[url.href];assert(route,`Unexpected URL ${url.href}`);const response=Readable.from(route.body?[Buffer.from(route.body)]:[]);response.statusCode=route.status||200;response.headers=route.headers||{'content-type':'application/pdf'};callback(response);
 });return req;
};}
test('PDF downloads pin validated DNS and check every redirect, response type, and size',async()=>{
 const bytes=await pdf(),seen=[];
 const result=await downloadPublicPdf(source,{lookupImpl:publicLookup,requestImpl:requestMock({[source]:{status:302,headers:{location:'/actual.pdf'}},'https://www.ikea.com/actual.pdf':{body:bytes}},seen)});assert.equal(seen.length,2);assert.deepEqual(result.bytes,Buffer.from(bytes));
 await assert.rejects(()=>downloadPublicPdf(source,{lookupImpl:publicLookup,requestImpl:requestMock({[source]:{status:302,headers:{location:'https://127.0.0.1/secret'}}})}),/public HTTPS/);
 await assert.rejects(()=>downloadPublicPdf(source,{lookupImpl:publicLookup,requestImpl:requestMock({[source]:{headers:{'content-type':'text/html'},body:'<html>login</html>'}})}),/web page/);
 await assert.rejects(()=>downloadPublicPdf(source,{lookupImpl:publicLookup,requestImpl:requestMock({[source]:{headers:{'content-type':'application/pdf','content-length':LIBRARY_PDF_LIMIT+1}}})}),/8 MB/);
 await assert.rejects(()=>downloadPublicPdf(source,{lookupImpl:publicLookup,requestImpl:requestMock({[source]:{body:'not a PDF'}})}),/valid PDF/);
});

test('search and download endpoints require explicit same-origin requests',async t=>{
 const {store}=await withStore(t);let calls=0;const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:()=>{calls++;throw new Error('Unexpected provider request');}};
 const denied=new Request(search('strandmon'),{headers:{Origin:'https://other.example','Content-Type':'application/json','X-Unfold-Library':'1'}});assert.equal((await handleLibrary(denied,env)).status,403);
 assert.equal((await handleLibrary(new Request('http://127.0.0.1:4173/api/library/web-search'),env)).status,405);
 assert.equal((await handleLibrary(new Request('http://127.0.0.1:4173/api/library/web-search',{method:'POST',body:'{}'}),env)).status,400);
 assert.equal((await handleLibrary(search('x'),env)).status,400);
 assert.equal((await handleLibrary(new Request('http://127.0.0.1:4173/api/library/a'),env)).status,404);assert.equal(calls,0);
});

test('manual dialog searches local library first and calls web search only after its explicit action',async()=>{
 const old={document:globalThis.document,fetch:globalThis.fetch};const {document,Event}=parseHTML('<html><body><div id="mount"></div></body></html>');globalThis.document=document;
 const calls=[];globalThis.fetch=async(url,options={})=>{calls.push({url,options});return Response.json({records:[],webSearched:false,webSearchAvailable:true});};
 let controller;
 try{
  controller=mountManualLibrary(document.querySelector('#mount'));const dialog=document.querySelector('dialog');dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
  controller.open();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/library?q=');
  const input=document.querySelector('input');input.value='IKEA STRANDMON';document.querySelector('form').onsubmit({preventDefault(){}});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/library?q=IKEA%20STRANDMON');assert.equal(document.querySelector('.library-web').hidden,false);
  document.querySelector('.library-web button').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls.length,3);assert.equal(calls[2].url,'/api/library/web-search');assert.equal(calls[2].options.method,'POST');assert.equal(calls[2].options.headers['X-Unfold-Library'],'1');
  input.value='another product';input.dispatchEvent(new Event('input'));assert.equal(document.querySelector('.library-web').hidden,true);
 }finally{controller?.destroy();globalThis.document=old.document;globalThis.fetch=old.fetch;}
});


test('manual result shows product metadata and downloads without starting conversion, then passes its PDF to intake',async()=>{
 const old={document:globalThis.document,fetch:globalThis.fetch};const {document,Event}=parseHTML('<html><body><div id="mount"></div></body></html>');globalThis.document=document;
 const bytes=await pdf(),record={...candidate,id:'a'.repeat(24),pdfCached:false,imageUrl:'https://www.ikea.com/product.jpg'},calls=[],received=[],busy=[],downloads=[];
 const create=document.createElement.bind(document);document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>downloads.push({name:node.download,url:node.href});return node;};
 globalThis.fetch=async(url,options={})=>{calls.push({url,options});return url.endsWith('/pdf')?new Response(bytes,{headers:{'Content-Type':'application/pdf'}}):Response.json({records:[record],webSearched:true,webSearchAvailable:true});};
 let controller;
 try{
  controller=mountManualLibrary(document.querySelector('#mount'),{onPdfReady:async(file,metadata)=>{received.push({file,metadata});},onBusy:value=>busy.push(value)});const dialog=document.querySelector('dialog');dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>{dialog.removeAttribute('open');dialog.dispatchEvent(new Event('close'));};
  controller.open();await new Promise(resolve=>setTimeout(resolve,0));assert(document.querySelector('.library-source').getAttribute('aria-label').includes(candidate.title));assert.equal(document.querySelector('.library-source').getAttribute('href'),source);assert.equal(document.querySelector('.library-card h3').textContent,candidate.product);assert.equal(document.querySelector('.library-product-image').src,record.imageUrl);
  await document.querySelector('.library-card button').onclick();assert.equal(calls[1].options.method,'POST');assert.equal(received.length,0);assert.equal(dialog.hasAttribute('open'),true);assert.equal(downloads[0].name,'STRANDMON.pdf');assert.deepEqual(new Uint8Array(await (await old.fetch(downloads[0].url)).arrayBuffer()),bytes);
  await document.querySelector('.library-card .primary').onclick();assert.equal(received.length,1);assert.equal(received[0].file.name,'STRANDMON.pdf');assert.equal(received[0].file.type,'application/pdf');assert.equal(received[0].metadata.productName,candidate.product);assert.deepEqual(new Uint8Array(await received[0].file.arrayBuffer()),bytes);assert.equal(dialog.hasAttribute('open'),false);assert.equal(busy.at(-1),false);
 }finally{controller?.destroy();globalThis.document=old.document;globalThis.fetch=old.fetch;}
});


test('saved search matches product word prefixes without confusing LACK with black',async t=>{
 const {store}=await withStore(t);
 await store.update(data=>{data.records.push({...candidate,id:'a'.repeat(24),title:'LACK side table',product:'LACK side table white',modelNumber:'',discoveredAt:'2026-09-13'}, {...candidate,id:'b'.repeat(24),title:'KNARREVIK bedside table',product:'KNARREVIK bedside table black',modelNumber:'',discoveredAt:'2026-09-13'});});
 for(const query of ['LACK table','lac tab']){const result=await (await handleLibrary(get(query),{libraryStore:store})).json();assert.equal(result.records.length,1);assert.equal(result.records[0].id,'a'.repeat(24));}
});
