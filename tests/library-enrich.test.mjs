import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createLibraryStore,downloadPublicHtml,LIBRARY_HTML_LIMIT} from '../server/library-store.mjs';
import {extractProductPage,enrichRecords,enrichmentInput} from '../server/library-enrich.mjs';
import {handleLibrary} from '../server/library.mjs';
const source='https://www.ikea.com/us/en/p/lack-wall-shelf-unit-black-blue-00592870/';
const image='https://www.ikea.com/us/en/images/products/lack-wall-shelf-unit-black-blue__1471847_pe997424_s5.jpg';
const pdf='https://www.ikea.com/us/en/assembly_instructions/lack-wall-shelf-unit-black-blue__AA-2699149-2-100.pdf';
const record={id:'a'.repeat(24),title:'Product page with assembly instructions',manufacturer:'IKEA',product:'LACK Wall shelf unit, black-blue',modelNumber:'005.928.70',sourceUrl:source,pdfUrl:'',discoveredAt:'2026-09-13T00:00:00Z',pdfCached:false};
const lookupImpl=async()=>[{address:'93.184.215.14',family:4}];
// Small authored fixture matching the actual IKEA JSON-LD and document sections.
const html=`<!doctype html><html><head><title>LACK wall shelf unit - IKEA</title><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'LACK Wall shelf unit, black-blue',mpn:'005.928.70',brand:{name:'IKEA'},image:[{'@type':'ImageObject',contentUrl:image}],offers:{url:source}})}</script></head><body><h1>LACK</h1><div><h4>Advice and care instructions</h4><a href="/us/en/manuals/care.pdf">LACK Wall shelf unit</a></div><div><h4>Assembly instructions</h4><a href="${pdf}">LACK Wall shelf unit <span>005.928.70</span></a></div><div><h4>Related products</h4><a href="/us/en/catalog.pdf">Catalogue</a></div></body></html>`;
async function setup(t){const directory=await mkdtemp(join(tmpdir(),'unfold-enrich-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const store=createLibraryStore(directory,{lookupImpl});await store.update(data=>{data.records.push({...record});data.queries['ikea lack']={query:'IKEA LACK',recordIds:[record.id],searchedAt:'2026-09-13T00:00:00Z'};});return {directory,store};}

test('IKEA-style HTML resolves the actual product, image, and assembly PDF, excluding care PDFs',()=>{
 const details=extractProductPage(html,source,record);assert.equal(details.product,record.product);assert.equal(details.title,record.product);assert.equal(details.manufacturer,'IKEA');assert.equal(details.modelNumber,'005.928.70');assert.equal(details.imageUrl,image);assert.deepEqual(details.pdfCandidates,[pdf]);
});
test('metadata parsing handles JSON-LD graphs and relative links without executing page scripts',()=>{
 const page=`<html><head><script>throw new Error('must not execute')</script><script type="application/ld+json">${JSON.stringify({'@graph':[{'@type':'Product',name:'Wrong recommended table',mpn:'99999999'},{'@type':['Thing','Product'],name:'LACK Wall shelf unit',mpn:'005.928.70',image:'/images/lack.jpg'}]})}</script></head><body><h2>Assembly</h2><a href="/assembly.pdf?variant=00592870&amp;lang=en">Assembly manual</a></body></html>`;
 const details=extractProductPage(page,source,record);assert.equal(details.product,'LACK Wall shelf unit');assert.equal(details.imageUrl,'https://www.ikea.com/images/lack.jpg');assert.deepEqual(details.pdfCandidates,['https://www.ikea.com/assembly.pdf?variant=00592870&lang=en']);
});
test('missing pictures stay empty, generic blocked pages do not replace product names, and model mismatches fail closed',()=>{
 const details=extractProductPage('<html><head><meta property="og:title" content="LACK Wall shelf unit - IKEA"></head><body><h1>LACK</h1><a href="javascript:alert(1)">Assembly manual</a></body></html>',source,record);assert.equal(details.imageUrl,'');assert.equal(details.product,'LACK Wall shelf unit');assert.deepEqual(details.pdfCandidates,[]);
 assert.throws(()=>extractProductPage('<html><h1>Just a moment</h1></html>',source,record),/No matching/);
 assert.throws(()=>extractProductPage(html.replace('"mpn":"005.928.70"','"mpn":"999.999.99"'),source,record),/different product/);
});
test('matching cached searches enrich once, reuse after restart, and preserve record IDs and query history',async t=>{
 const {directory,store}=await setup(t);let calls=0;store.fetchHtml=async url=>{calls++;assert.equal(url,source);await new Promise(resolve=>setTimeout(resolve,10));return {html,sourceUrl:source};};
 const env={libraryStore:store,libraryFetch:()=>{throw new Error('Must not call the AI provider');}};
 const request=()=>new Request('http://127.0.0.1:4173/api/library?q=IKEA%20LACK');
 const responses=await Promise.all([handleLibrary(request(),env),handleLibrary(request(),env)]);const data=await responses[0].json();assert.equal(data.records[0].id,record.id);assert.equal(data.records[0].pdfUrl,pdf);assert.equal(data.records[0].imageUrl,image);assert.equal(data.records[0].title,record.product);assert.equal(calls,1);
 const restart=createLibraryStore(directory,{lookupImpl});restart.fetchHtml=()=>{throw new Error('Cached enrichment must not download again');};const repeated=await (await handleLibrary(request(),{libraryStore:restart})).json();assert.equal(repeated.records[0].imageUrl,image);assert.equal(repeated.records[0].pdfUrl,pdf);
 const saved=JSON.parse(await readFile(join(directory,'library.json'),'utf8'));assert.equal(saved.records.length,1);assert.deepEqual(saved.queries['ikea lack'].recordIds,[record.id]);assert.equal(saved.records[0].enrichmentStatus,'resolved');
});
test('an unavailable page remains a source link and unsafe PDF/image URLs are never published',async t=>{
 const {store}=await setup(t);let calls=0;store.fetchHtml=async()=>{calls++;return {html:html.replaceAll(image,'https://127.0.0.1/private.jpg').replaceAll(pdf,'https://127.0.0.1/private.pdf'),sourceUrl:source};};
 const enriched=await enrichRecords([record],store);assert.equal(enriched[0].pdfUrl,'');assert.equal(enriched[0].imageUrl,undefined);assert.equal(enriched[0].enrichmentStatus,'source_only');
 await enrichRecords([record],store);assert.equal(calls,1);
});
test('PDF-only records without a supported article lookup keep their existing download',async t=>{
 const {store}=await setup(t),direct={...record,sourceUrl:'https://manuals.example/assembly.pdf',pdfUrl:'https://manuals.example/assembly.pdf'};store.fetchHtml=()=>{throw new Error('A PDF is not an HTML product page');};assert.deepEqual(await enrichRecords([direct],store),[direct]);
});
function requestMock(routes,seen=[]){return(url,options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=error=>req.emit('error',error);req.end=()=>queueMicrotask(()=>{seen.push(url.href);assert.equal(options.headers.Accept,'text/html,application/xhtml+xml');options.lookup(url.hostname,{all:false},(error,address)=>{assert.equal(error,null);assert.equal(address,'93.184.215.14');});const route=routes[url.href];assert(route);const response=Readable.from(route.body?[Buffer.from(route.body)]:[]);response.statusCode=route.status||200;response.headers=route.headers||{'content-type':'text/html; charset=utf-8'};callback(response);});return req;};}
test('HTML retrieval retains pinned public DNS, checks every redirect, and rejects non-HTML or oversized bodies',async()=>{
 const seen=[],result=await downloadPublicHtml(source,{lookupImpl,requestImpl:requestMock({[source]:{status:302,headers:{location:'/final-product'}},'https://www.ikea.com/final-product':{body:html}},seen)});assert.equal(result.html,html);assert.equal(seen.length,2);
 await assert.rejects(()=>downloadPublicHtml(source,{lookupImpl,requestImpl:requestMock({[source]:{status:302,headers:{location:'https://127.0.0.1/private'}}})}),/public HTTPS/);
 await assert.rejects(()=>downloadPublicHtml(source,{lookupImpl,requestImpl:requestMock({[source]:{body:'%PDF-1.4',headers:{'content-type':'application/pdf'}}})}),/not a product web page/);
 await assert.rejects(()=>downloadPublicHtml(source,{lookupImpl,requestImpl:requestMock({[source]:{headers:{'content-type':'text/html','content-length':LIBRARY_HTML_LIMIT+1}}})}),/too large/);
});


test('temporary page failures are reused for an hour and then can be retried',async t=>{
 const {store}=await setup(t);let calls=0;store.fetchHtml=async()=>{calls++;throw new Error('Temporary timeout');};
 const failed=(await enrichRecords([record],store))[0];assert.equal(failed.enrichmentStatus,'unavailable');await enrichRecords([failed],store);assert.equal(calls,1);
 await store.update(data=>{data.records[0].enrichmentRetryAt='2000-01-01T00:00:00Z';});const retry=(await store.read()).records[0];store.fetchHtml=async()=>{calls++;return {html,sourceUrl:source};};
 const resolved=(await enrichRecords([retry],store))[0];assert.equal(calls,2);assert.equal(resolved.enrichmentStatus,'resolved');assert.equal(resolved.pdfUrl,pdf);
});


test('pasting a saved product or PDF URL reuses existing metadata without paid search',async t=>{
 const {store}=await setup(t);store.fetchHtml=async()=>({html,sourceUrl:source});let calls=0;
 const env={libraryStore:store,OPENAI_API_KEY:'test-only',libraryFetch:()=>{calls++;throw new Error('Pasted saved URL must not call the AI provider');}};
 await enrichRecords([record],store);
 for(const link of [source+'?utm_source=share#documents',pdf]){
  const get=await handleLibrary(new Request(`http://127.0.0.1:4173/api/library?q=${encodeURIComponent(link)}`),env);const data=await get.json();assert.equal(data.records.length,1);assert.equal(data.records[0].id,record.id);
  const post=await handleLibrary(new Request('http://127.0.0.1:4173/api/library/web-search',{method:'POST',headers:{'Content-Type':'application/json','X-Unfold-Library':'1'},body:JSON.stringify({query:link})}),env);assert.equal(post.status,200);assert.equal((await post.json()).records[0].id,record.id);
 }
 assert.equal(calls,0);
});


test('enriching product metadata preserves the selected PDF revision and its cached bytes',async t=>{
 const {store}=await setup(t),previous='https://www.ikea.com/us/en/assembly_instructions/previous-revision.pdf';
 await store.update(data=>Object.assign(data.records[0],{pdfUrl:previous,pdfCached:true}));store.fetchHtml=async()=>({html,sourceUrl:source});
 const result=(await enrichRecords((await store.read()).records,store))[0];assert.equal(result.pdfUrl,previous);assert.equal(result.pdfCached,true);assert.equal(result.imageUrl,image);
});


test('IKEA PDF records use the same-locale article redirect and cache only exactly matching product metadata',async t=>{
 const {directory,store}=await setup(t),original='https://www.ikea.com/us/en/assembly_instructions/lack-side-table-white__AA-2314314-1-100.pdf',canonical='https://www.ikea.com/us/en/p/lack-side-table-white-30514791/',picture='https://www.ikea.com/us/en/images/products/lack-side-table-white__1057250_pe848800_s5.jpg';
 const table={...record,product:'LACK Side table, white',modelNumber:'305.147.91',sourceUrl:original,pdfUrl:original,pdfCached:true};await store.update(data=>{data.records[0]=table;});
 const input=enrichmentInput(table);assert.equal(input.sourceUrl,'https://www.ikea.com/us/en/p/-30514791/');assert.equal(input.articleLookup,true);
 let calls=0;store.fetchHtml=async url=>{calls++;assert.equal(url,input.sourceUrl);return {sourceUrl:canonical,html:html.replaceAll('005.928.70','305.147.91').replaceAll('LACK Wall shelf unit, black-blue','LACK Side table, white').replaceAll(image,picture)};};
 const resolved=(await enrichRecords([table],store))[0];assert.equal(resolved.productPageUrl,canonical);assert.equal(resolved.imageUrl,picture);assert.equal(resolved.product,'LACK Side table, white');assert.equal(resolved.pdfUrl,original);assert.equal(resolved.pdfCached,true);assert.equal(calls,1);
 const restarted=createLibraryStore(directory,{lookupImpl});restarted.fetchHtml=()=>{throw new Error('Already resolved product photo must not be fetched again');};await enrichRecords((await restarted.read()).records,restarted);
 assert.equal(enrichmentInput({...table,modelNumber:''}),null);assert.equal(enrichmentInput({...table,sourceUrl:'https://ikea.com.example/us/en/manuals/manual.pdf'}),null);
});

test('IKEA article lookup rejects missing/mismatched article metadata and cross-manufacturer redirect results',async t=>{
 const {store}=await setup(t),original='https://www.ikea.com/us/en/assembly_instructions/table.pdf',table={...record,modelNumber:'305.147.91',sourceUrl:original,pdfUrl:original};
 for(const page of [
  {sourceUrl:'https://www.ikea.com/us/en/p/lack-side-table-white-30514791/',html},
  {sourceUrl:'https://www.ikea.com/us/en/p/lack-side-table-white-30514791/',html:html.replace('"mpn":"005.928.70",','')},
  {sourceUrl:'https://different.example/product/',html:html.replaceAll('005.928.70','305.147.91')},
 ]){
  await store.update(data=>{data.records[0]={...table};});store.fetchHtml=async()=>page;
  const result=(await enrichRecords([table],store))[0];assert.equal(result.enrichmentStatus,'unavailable');assert.equal(result.pdfUrl,original);assert.equal(result.imageUrl,undefined);assert.equal(result.productPageUrl,undefined);
 }
});
