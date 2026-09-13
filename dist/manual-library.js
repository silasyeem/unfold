let libraryCount=0;
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};

export function mountManualLibrary(container,{onPdfReady=()=>{},onError=()=>{},onBusy=()=>{}}={}){
 const id=`manual-library-${++libraryCount}`;
 const launcher=element('button','button library-launch','Find a manual');launcher.type='button';
 const dialog=element('dialog','library-dialog');dialog.setAttribute('aria-labelledby',`${id}-title`);
 const heading=element('div','library-heading');const title=element('h2','','Find a manual');title.id=`${id}-title`;
 const close=element('button','library-close','×');close.type='button';close.setAttribute('aria-label','Close manual library');heading.append(title,close);
 const intro=element('p','library-intro','Search saved assembly manuals by product, brand, or model.');
 const form=element('form','library-form');const label=element('label','library-label','Product name');label.htmlFor=`${id}-query`;
 const row=element('div','library-search-row');const input=element('input');input.id=`${id}-query`;input.type='search';input.maxLength=160;input.placeholder='e.g. IKEA STRANDMON';input.autocomplete='off';
 const submit=element('button','button primary','Search library');submit.type='submit';row.append(input,submit);form.append(label,row);
 const status=element('p','library-status','Saved manuals are searched without using AI.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const results=element('div','library-results');results.setAttribute('aria-label','Saved assembly manuals');
 const webArea=element('div','library-web');webArea.hidden=true;const webText=element('p','','No saved match. Search manufacturer websites and save what is found.');
 const web=element('button','button','Search the web');web.type='button';const webNote=element('small','','This sends your product search to OpenAI. Saved results are reused next time.');webArea.append(webText,web,webNote);
 dialog.append(heading,intro,form,status,results,webArea);container.append(launcher,dialog);
 let controller=null,serial=0,busy=false,externalDisabled=false,lastQuery='',lastData=null;
 const report=message=>{status.textContent=message;status.classList.add('error');onError(message);};
 function setBusy(value){busy=value;submit.disabled=value;input.disabled=value;web.disabled=value||lastData?.webSearchAvailable===false;launcher.disabled=externalDisabled||value;results.querySelectorAll('button').forEach(button=>{button.disabled=value;});dialog.setAttribute('aria-busy',String(value));onBusy(value);}
 const api=async(url,options={})=>{const response=await fetch(url,options);if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'The manual library is unavailable. Start the Unfold server and try again.');}return response;};
 function render(data){
  lastData=data;results.replaceChildren();status.classList.remove('error');
  if(data.records.length){status.textContent=`${data.records.length} ${data.records.length===1?'manual':'manuals'} ${data.fromWeb?'found and saved':'in your library'}. Check the product and version before loading.`;}
  else if(data.webSearched){status.textContent='No matching manuals were found in the previous web search. Try adding the brand or an exact model number.';}
  else status.textContent=lastQuery?'No saved manuals match this product.':'Your saved manuals will appear here. Search for a product to start.';
  for(const record of data.records){
   const card=element('article','library-card');const name=element('h3','',record.title);const meta=element('p','library-meta',[record.manufacturer,record.modelNumber,record.pageCount?`${record.pageCount} pages`:null,record.pdfCached?'PDF saved':null].filter(Boolean).join(' · '));
   const source=element('a','library-source');source.href=record.sourceUrl;source.target='_blank';source.rel='noopener noreferrer';source.textContent=`Source: ${record.title} · ${new URL(record.sourceUrl).hostname} ↗`;source.setAttribute('aria-label',`Open source for ${record.title}`);
   const actions=element('div','library-card-actions');actions.append(source);
   if(record.pdfUrl){const load=element('button','button','Load manual');load.type='button';load.onclick=()=>loadManual(record);actions.append(load);}
   else{const note=element('small','','Open the manufacturer page to download its manual, then upload the PDF.');card.append(name,meta,note,actions);results.append(card);continue;}
   card.append(name,meta,actions);results.append(card);
  }
  webArea.hidden=!!data.records.length||!lastQuery||lastQuery.length<2||data.webSearched;
  web.disabled=busy||data.webSearchAvailable===false;
  webNote.textContent=data.webSearchAvailable===false?'Web search is not configured on this server.':'This sends your product search to OpenAI. Saved results are reused next time.';
 }
 async function search(online=false){
  const query=input.value.trim();if(online&&query.length<2){report('Enter a product name first.');return;}
  const current=++serial;controller?.abort();controller=new AbortController();lastQuery=query;setBusy(true);status.classList.remove('error');status.textContent=online?'Searching manufacturer instructions… Results will be saved.':'Searching your saved manuals…';
  try{
   const response=await api(online?'/api/library/web-search':`/api/library?q=${encodeURIComponent(query)}`,online?{method:'POST',headers:{'Content-Type':'application/json','X-Unfold-Library':'1'},body:JSON.stringify({query}),signal:controller.signal}:{signal:controller.signal});
   const data=await response.json();if(current!==serial)return;render(data);
  }catch(error){if(current===serial&&error.name!=='AbortError')report(error.message);}
  finally{if(current===serial){controller=null;setBusy(false);}}
 }
 async function loadManual(record){
  const current=++serial;controller?.abort();controller=new AbortController();setBusy(true);status.classList.remove('error');status.textContent=record.pdfCached?'Opening the saved PDF…':'Downloading and saving the manual…';
  try{
   const response=await api(`/api/library/${encodeURIComponent(record.id)}/pdf`,{method:'POST',headers:{'X-Unfold-Library':'1'},signal:controller.signal});
   if(!response.headers.get('content-type')?.startsWith('application/pdf'))throw new Error('This source did not return a PDF. Open its source link instead.');
   const blob=await response.blob();if(current!==serial)return;if(blob.size>8*1024*1024)throw new Error('This manual exceeds the 8 MB conversion limit.');
   const filename=(record.product||record.title).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90)+'.pdf';
   await onPdfReady(new File([blob],filename,{type:'application/pdf'}));if(current===serial){record.pdfCached=true;dialog.close();}
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
