let libraryCount=0;
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

export function mountManualLibrary(container,{onPdfReady=()=>{},onError=()=>{},onBusy=()=>{}}={}){
 const id=`manual-library-${++libraryCount}`;
 const launcher=element('button','button library-launch','Search for your manual online');launcher.type='button';launcher.setAttribute('aria-haspopup','dialog');
 launcher.append(element('span','source-choice-description','Search by product name or paste a link.'));
 const dialog=element('dialog','library-dialog');dialog.setAttribute('aria-labelledby',`${id}-title`);
 const heading=element('div','library-heading');const title=element('h2','','Search for your manual');title.id=`${id}-title`;
 const close=element('button','library-close','×');close.type='button';close.setAttribute('aria-label','Close manual search');heading.append(title,close);
 const intro=element('p','library-intro','Find your product, then download its manual or turn it into an animated guide.');
 const form=element('form','library-form');const label=element('label','library-label','Product name or link');label.htmlFor=`${id}-query`;
 const row=element('div','library-search-row');const input=element('input');input.id=`${id}-query`;input.type='search';input.maxLength=160;input.placeholder='e.g. IKEA STRANDMON or a product link';input.autocomplete='off';
 const submit=element('button','button primary','Search');submit.type='submit';row.append(input,submit);form.append(label,row);
 const status=element('p','library-status','Enter a product name to get started.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const results=element('div','library-results');results.setAttribute('aria-label','Saved assembly manuals');
 const webArea=element('div','library-web');webArea.hidden=true;const webText=element('p','','No match yet. Look for instructions on manufacturer websites.');
 const web=element('button','button','Search the web');web.type='button';const webNote=element('small','','This sends your product search to OpenAI. Saved results are reused next time.');webArea.append(webText,web,webNote);
 dialog.append(heading,intro,form,status,results,webArea);container.append(launcher,dialog);
 let controller=null,serial=0,busy=false,externalDisabled=false,lastQuery='',lastData=null;
 const report=message=>{status.textContent=message;status.classList.add('error');onError(message);};
 function setBusy(value){busy=value;submit.disabled=value;input.disabled=value;web.disabled=value||lastData?.webSearchAvailable===false;launcher.disabled=externalDisabled||value;results.querySelectorAll('button').forEach(button=>{button.disabled=value;});dialog.setAttribute('aria-busy',String(value));onBusy(value);}
 const api=async(url,options={})=>{const response=await fetch(url,options);if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The manual library is unavailable. Start the Unfold server and try again.');}return response;};
 function render(data){
  lastData=data;results.replaceChildren();status.classList.remove('error');
  if(data.records.length){status.textContent=`${data.records.length} ${data.records.length===1?'manual':'manuals'} found. Check the product and version before loading.`;}
  else if(data.webSearched){status.textContent='No matching manuals were found in the previous web search. Try adding the brand or an exact model number.';}
  else status.textContent=lastQuery?'No matching manuals saved yet.':'Search for a product to get started.';
  for(const record of data.records){
   const card=element('article','library-card');const name=element('h3','',record.product||record.title);const meta=element('p','library-meta',[record.manufacturer,record.modelNumber,record.pageCount?`${record.pageCount} ${record.pageCount===1?'page':'pages'}`:null,record.pdfCached?'PDF saved':null].filter(Boolean).join(' · '));
   const header=element('div','library-product'),details=element('div','library-product-details');details.append(name,meta);
   if(record.imageUrl){const image=element('img','library-product-image');image.src=record.imageUrl;image.alt=record.product||record.title;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();header.append(image);}header.append(details);
   const source=element('a','library-source');source.href=record.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';source.textContent=`${new URL(record.sourceUrl).hostname.replace(/^www\./,'')} ↗`;source.setAttribute('aria-label',`Open source for ${record.title}`);
   const actions=element('div','library-card-actions');actions.append(source);
   if(record.pdfUrl){const download=element('button','button','Download manual');download.type='button';download.onclick=()=>loadManual(record,{download:true});const load=element('button','button primary','Use this manual');load.type='button';load.onclick=()=>loadManual(record);actions.append(download,load);}
   else{const note=element('small','','A direct assembly PDF was not available. Check the manufacturer’s instructions.');card.append(header,note,actions);results.append(card);continue;}
   card.append(header,actions);results.append(card);
  }
  webArea.hidden=!!data.records.length||!lastQuery||lastQuery.length<2||data.webSearched;
  web.disabled=busy||data.webSearchAvailable===false;
  webNote.textContent=data.webSearchAvailable===false?'Web search is not configured on this server.':'This sends your product search to OpenAI. Saved results are reused next time.';
 }
 async function search(online=false){
  const query=input.value.trim();if(online&&query.length<2){report('Enter a product name first.');return;}
  const current=++serial;controller?.abort();controller=new AbortController();lastQuery=query;setBusy(true);status.classList.remove('error');status.textContent=online?'Searching manufacturer instructions…':'Looking for matching manuals…';
  try{
   const response=await api(online?'/api/library/web-search':`/api/library?q=${encodeURIComponent(query)}`,online?{method:'POST',headers:{'Content-Type':'application/json','X-Unfold-Library':'1'},body:JSON.stringify({query}),signal:controller.signal}:{signal:controller.signal});
   const data=await response.json();if(current!==serial)return;render(data);
  }catch(error){if(current===serial&&error.name!=='AbortError')report(error.message);}
  finally{if(current===serial){controller=null;setBusy(false);}}
 }
 async function loadManual(record,{download=false}={}){
  const current=++serial;controller?.abort();controller=new AbortController();setBusy(true);status.classList.remove('error');status.textContent=record.pdfCached?'Opening the saved PDF…':'Downloading and saving the manual…';
  try{
   const response=await api(`/api/library/${encodeURIComponent(record.id)}/pdf`,{method:'POST',headers:{'X-Unfold-Library':'1'},signal:controller.signal});
   if(!response.headers.get('content-type')?.startsWith('application/pdf'))throw new Error('This source did not return a PDF. Open its source link instead.');
   const blob=await response.blob();if(current!==serial)return;if(blob.size>8*1024*1024)throw new Error('This manual exceeds the 8 MB conversion limit.');
   const filename=(record.product||record.title).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90)+'.pdf';
   const file=new File([blob],filename,{type:'application/pdf'});
   if(download){const url=URL.createObjectURL(file),link=element('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);record.pdfCached=true;status.textContent=`${record.product||record.title} manual download started. You can also use it to create an animated guide.`;}
   else{await onPdfReady(file,{productName:record.product||record.title});if(current===serial){record.pdfCached=true;dialog.close();}}
  }catch(error){if(current===serial&&error.name!=='AbortError')report(error.message);}
  finally{if(current===serial){controller=null;setBusy(false);}}
 }
 launcher.onclick=()=>{dialog.showModal();input.focus();search();};
 close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{++serial;controller?.abort();controller=null;if(busy)setBusy(false);});
 form.onsubmit=event=>{event.preventDefault();search();};web.onclick=()=>search(true);
 // Changing a query invalidates the old search choice; web search always follows
 // an explicit saved-library lookup for the current input.
 input.addEventListener('input',()=>{webArea.hidden=true;});
 return {
  open(){launcher.click();},
  setDisabled(value){externalDisabled=!!value;launcher.disabled=externalDisabled||busy;},
  destroy(){++serial;controller?.abort();if(busy)onBusy(false);launcher.remove();dialog.remove();},
 };
}
