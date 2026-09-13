import {parseHTML} from 'linkedom';
import {canonicalSource} from './library-store.mjs';

export const ENRICHMENT_VERSION=1;
const clean=value=>typeof value==='string'?value.replace(/\\"/g,'"').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,240):'';
const digits=value=>clean(value).replace(/\D/g,'');
const plain=value=>clean(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const urlFrom=(value,base)=>{if(typeof value!=='string'||!value.trim())return '';try{return canonicalSource(new URL(value,base).href);}catch{return '';}};
const imageFrom=value=>typeof value==='string'?value:Array.isArray(value)?imageFrom(value[0]):value?.contentUrl||value?.url||'';
const hasType=(node,type)=>[node?.['@type']].flat().some(value=>typeof value==='string'&&value.split(/[\/#]/).at(-1)===type);
function jsonProducts(value,result=[]){
 if(!value||typeof value!=='object')return result;
 if(Array.isArray(value)){for(const item of value)jsonProducts(item,result);return result;}
 if(hasType(value,'Product'))result.push(value);
 // Do not treat recommended products, reviews or breadcrumb names as this item.
 if(value['@graph'])jsonProducts(value['@graph'],result);
 if(value.mainEntity)jsonProducts(value.mainEntity,result);
 return result;
}
function assemblyScore(value){const text=plain(value);if(/\b(care|warranty|advice|safety data|brochure|certificate|specification|spare parts)\b/.test(text))return -1;return /\b(assembly|assemble|installation|install|mounting|montage|montaje|montaggio)\b/.test(text)?2:0;}

// All URLs returned here occur literally in the fetched manufacturer document.
// Scripts are parsed as JSON only; no page code is executed.
export function extractProductPage(html,pageUrl,record={}){
 const {document}=parseHTML(html),products=[];
 for(const script of document.querySelectorAll('script[type="application/ld+json"]')){try{jsonProducts(JSON.parse(script.textContent),products);}catch{}}
 const expected=digits(record.modelNumber),page=new URL(pageUrl);
 const product=products.find(item=>expected&&[item.sku,item.mpn,item.productID].some(value=>digits(value)===expected))||products.find(item=>urlFrom(item.url||item.offers?.url,pageUrl)===page.href)||(products.length===1?products[0]:null);
 const modelNumber=clean(product?.mpn||product?.sku||product?.productID);
 if(expected&&modelNumber&&digits(modelNumber)!==expected)throw new Error('This page describes a different product model.');
 let productName=clean(product?.name);
 if(!productName){
  const candidates=[document.querySelector('meta[property="og:title"]')?.getAttribute('content'),document.querySelector('h1')?.innerText,document.querySelector('title')?.textContent];
  const word=plain(record.product).split(' ')[0];
  productName=candidates.map(clean).find(name=>word&&plain(name).split(' ').includes(word))||'';
 }
 productName=productName.replace(/\s+[-|]\s+IKEA\s*$/i,'');
 if(!productName)throw new Error('No matching product information was found on this page.');
 const imageUrl=urlFrom(imageFrom(product?.image)||document.querySelector('meta[property="og:image"]')?.getAttribute('content')||'',pageUrl);
 const manufacturer=clean(typeof product?.brand==='string'?product.brand:product?.brand?.name);
 const links=[];let heading='';
 for(const node of document.querySelectorAll('h1,h2,h3,h4,h5,h6,a[href]')){
  if(node.tagName!=='A'){heading=clean(node.textContent);continue;}
  const href=urlFrom(node.getAttribute('href'),pageUrl);if(!href||!new URL(href).pathname.toLowerCase().endsWith('.pdf'))continue;
  const label=clean(node.textContent),localHeading=clean(node.parentElement?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent)||heading;
  const labelScore=assemblyScore(label),headingScore=assemblyScore(localHeading),pathScore=assemblyScore(new URL(href).pathname);
  if(labelScore<0||headingScore<0||pathScore<0)continue;
  const score=labelScore*3+headingScore*2+pathScore;
  if(score>0&&!links.some(link=>link.url===href))links.push({url:href,label,score});
 }
 links.sort((a,b)=>b.score-a.score);
 return {product:productName,title:productName,manufacturer,modelNumber,imageUrl,pdfCandidates:links.slice(0,4).map(link=>link.url)};
}

const states=new WeakMap();
function stateFor(store){if(!states.has(store))states.set(store,{pending:new Map(),queue:[],active:0});return states.get(store);}
function limited(state,operation){return new Promise((resolve,reject)=>{state.queue.push({operation,resolve,reject});drain(state);});}
function drain(state){while(state.active<3&&state.queue.length){const job=state.queue.shift();state.active++;Promise.resolve().then(job.operation).then(job.resolve,job.reject).finally(()=>{state.active--;drain(state);});}}
export function enrichmentInput(record){
 const source=record.productPageUrl||record.sourceUrl;
 try{
  const url=new URL(canonicalSource(source));
  if(!url.pathname.toLowerCase().endsWith('.pdf'))return {sourceUrl:url.href,articleLookup:false};
  // IKEA's manufacturer-owned article route redirects to its canonical product
  // page. It is a lookup input, never a guessed product, picture or manual URL.
  const article=clean(record.modelNumber).replace(/[.\s]/g,'');
  const locale=url.pathname.match(/^\/([a-z]{2})\/([a-z]{2}(?:-[a-z]{2})?)\/(?:assembly_instructions|manuals)\//i);
  if(['www.ikea.com','ikea.com'].includes(url.hostname)&&locale&&/^\d{8}$/.test(article)){
   const prefix=`/${locale[1]}/${locale[2]}/p/`;
   return {sourceUrl:`${url.origin}${prefix}-${article}/`,articleLookup:true,article,prefix};
  }
 }catch{}
 return null;
}
export function needsEnrichment(record){const retryDue=record.enrichmentStatus==='unavailable'&&Date.now()>=Date.parse(record.enrichmentRetryAt||new Date(Date.parse(record.enrichedAt||'1970-01-01')+3600000).toISOString());return !!enrichmentInput(record)&&(record.enrichmentVersion!==ENRICHMENT_VERSION||retryDue);}

export async function enrichRecord(record,store){
 if(!needsEnrichment(record)||!store.fetchHtml)return record;
 const state=stateFor(store);
 if(state.pending.has(record.id))return state.pending.get(record.id);
 const pending=limited(state,async()=>{
  // A concurrent request may have persisted this record before its queue slot ran.
  const latest=(await store.read()).records.find(item=>item.id===record.id)||record;if(!needsEnrichment(latest))return latest;
  let patch={enrichmentVersion:ENRICHMENT_VERSION,enrichedAt:new Date().toISOString(),enrichmentStatus:'unavailable',enrichmentRetryAt:new Date(Date.now()+3600000).toISOString()};
  try{
   const input=enrichmentInput(latest),page=await store.fetchHtml(input.sourceUrl),details=extractProductPage(page.html,page.sourceUrl,latest);
   if(input.articleLookup){const final=new URL(canonicalSource(page.sourceUrl));if(!['www.ikea.com','ikea.com'].includes(final.hostname)||!final.pathname.startsWith(input.prefix)||digits(details.modelNumber)!==input.article)throw new Error('The article lookup did not identify the exact IKEA product.');}
   patch={...patch,title:details.title,product:details.product,manufacturer:details.manufacturer||latest.manufacturer,modelNumber:details.modelNumber||latest.modelNumber,productPageUrl:page.sourceUrl,enrichmentStatus:'resolved',enrichmentRetryAt:''};
   if(details.imageUrl){try{patch.imageUrl=await store.validateSource(details.imageUrl);}catch{}}
   // Existing PDF URLs identify an already selected manual revision. Enrich its
   // product metadata without switching the cached bytes to a different revision.
   if(!latest.pdfUrl)for(const pdf of details.pdfCandidates){try{patch.pdfUrl=await store.validateSource(pdf);break;}catch{}}
   if(!patch.pdfUrl&&!latest.pdfUrl)patch.enrichmentStatus='source_only';
  }catch{/* Keep the original source as an honest fallback, and avoid repeated work. */}
  let saved={...latest,...patch};
  await store.update(data=>{const target=data.records.find(item=>item.id===record.id);if(target){Object.assign(target,patch);saved={...target};}});
  return saved;
 });
 state.pending.set(record.id,pending);try{return await pending;}finally{state.pending.delete(record.id);}
}
export async function enrichRecords(records,store){return Promise.all(records.map(record=>enrichRecord(record,store)));}
