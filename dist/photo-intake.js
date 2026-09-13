const LIMITS={pages:20,fileBytes:12*1024*1024,pixels:16_000_000,dimension:8000,outputSide:2000};
let instance=0;
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const button=(text,className='button')=>{const element=node('button',className,text);element.type='button';return element;};

async function preparePhoto(file){
 if(!file||file.size===0||file.size>LIMITS.fileBytes)throw new Error('Each photo must be between 1 byte and 12 MB.');
 if(!['image/jpeg','image/png'].includes(file.type)&&!(/\.(jpe?g|png)$/i).test(file.name))throw new Error('Choose JPEG or PNG photos. Save HEIC photos as JPEG first.');
 const signature=new Uint8Array(await file.slice(0,12).arrayBuffer());
 if(!(signature[0]===255&&signature[1]===216)&&![137,80,78,71,13,10,26,10].every((value,i)=>signature[i]===value))throw new Error('This file is not a JPEG or PNG photo.');
 let image;
 try{image=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw new Error(`${file.name||'This photo'} could not be read. Choose a JPEG or PNG image.`);}
 try{
  if(!image.width||!image.height||image.width>LIMITS.dimension||image.height>LIMITS.dimension||image.width*image.height>LIMITS.pixels)throw new Error('A photo is too large. Use images under 16 megapixels and 8,000 pixels per side.');
  const scale=Math.min(1,LIMITS.outputSide/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
  const context=canvas.getContext('2d');if(!context)throw new Error('Photo preparation is unavailable in this browser.');
  context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
  if(!blob)throw new Error('This photo could not be prepared. Try saving it as JPEG.');
  return new File([blob],file.name.replace(/\.[^.]*$/,'')+'.jpg',{type:'image/jpeg'});
 }finally{image.close();}
}

/** Photo pages use the same PDF conversion and source viewer as uploaded manuals. */
export function mountPhotoIntake(container,{onPdfReady,onError=()=>{},onBusy=()=>{}}={}){
 if(!container||typeof onPdfReady!=='function')throw new Error('Photo intake needs a container and onPdfReady callback.');
 const id=`photo-intake-${++instance}`;
 let pages=[],busy=false,externalDisabled=false,disposed=false,request=null,pdfUrl=null,pdfFile=null;
 const launcher=button('Add photos');launcher.classList.add('photo-launcher');launcher.setAttribute('aria-haspopup','dialog');
 const dialog=node('dialog','photo-dialog');dialog.id=id;launcher.setAttribute('aria-controls',id);
 const heading=node('div','photo-dialog-heading'),title=node('h2',null,'Photograph your manual'),close=button('×','icon-button');title.id=`${id}-title`;dialog.setAttribute('aria-labelledby',title.id);close.setAttribute('aria-label','Close photo pages');heading.append(title,close);
 const description=node('p','photo-help','Add one clear photo per manual page. Include the full diagram, then put the pages in reading order.');
 const actions=node('div','photo-add-actions');
 function picker(text,camera=false){const label=node('label','button file-button',text),input=node('input');input.type='file';input.accept='image/jpeg,image/png,.jpg,.jpeg,.png';input.multiple=!camera;if(camera)input.setAttribute('capture','environment');input.setAttribute('aria-label',text);label.append(input);actions.append(label);input.addEventListener('change',()=>{addFiles([...input.files]);input.value='';});return input;}
 const filesInput=picker('Choose photos'),cameraInput=picker('Take a photo',true);
 const status=node('p','photo-status','JPEG or PNG · up to 20 pages. Photos are reduced to 2,000 pixels for upload.');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const list=node('ol','photo-pages');list.setAttribute('aria-label','Manual photo pages');
 const note=node('p','photo-help','Preparing pages sends the photos to this server. Generating a guide afterward sends the prepared manual to OpenAI. Check the source diagrams and generated steps.');
 const footer=node('div','photo-footer'),download=node('a','button photo-download','Download pages PDF'),cancel=button('Cancel preparation'),submit=button('Use these pages','button primary');download.hidden=true;cancel.hidden=true;footer.append(download,cancel,submit);
 dialog.append(heading,description,actions,status,list,note,footer);container.append(launcher,dialog);
 const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('photo-error',error);};
 const invalidatePdf=()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl=null;pdfFile=null;download.hidden=true;download.removeAttribute('href');};
 function sync(){
  const disabled=busy||externalDisabled;launcher.disabled=disabled;filesInput.disabled=disabled;cameraInput.disabled=disabled;submit.disabled=disabled||!pages.length;close.disabled=busy;cancel.hidden=!request;
  for(const control of list.querySelectorAll('button'))control.disabled=disabled||control.dataset.edge==='true';
  launcher.textContent=pages.length?`Photos · ${pages.length}`:'Add photos';
  submit.textContent=busy?'Preparing pages…':`Use ${pages.length||'these'} ${pages.length===1?'page':'pages'}`;
 }
 function setBusy(value){busy=value;sync();onBusy(value);}
 function render(focus){
  list.replaceChildren();
  pages.forEach((page,index)=>{
   const item=node('li','photo-page'),preview=node('div','photo-preview'),img=node('img');img.src=page.url;img.alt=`Manual page ${index+1}`;img.style.transform=`rotate(${page.rotation}deg)`;preview.append(img);
   const info=node('div','photo-page-info'),label=node('strong',null,`Page ${index+1}`),name=node('span','photo-name',page.file.name),controls=node('div','photo-page-controls');
   const earlier=button('↑'),later=button('↓'),rotate=button('↻'),remove=button('Remove');
   for(const [control,action,description] of [[earlier,'earlier',`Move page ${index+1} earlier`],[later,'later',`Move page ${index+1} later`],[rotate,'rotate',`Rotate page ${index+1} clockwise`],[remove,'remove',`Remove page ${index+1}`]]){control.setAttribute('aria-label',description);control.dataset.photo=page.id;control.dataset.action=action;}
   earlier.dataset.edge=String(index===0);later.dataset.edge=String(index===pages.length-1);
   earlier.onclick=()=>move(index,-1,'earlier');later.onclick=()=>move(index,1,'later');
   rotate.onclick=()=>{page.rotation=(page.rotation+90)%360;invalidatePdf();render({id:page.id,action:'rotate'});message(`Page ${index+1} rotated clockwise.`);};
   remove.onclick=()=>{pages.splice(index,1);URL.revokeObjectURL(page.url);invalidatePdf();render();message(`Page ${index+1} removed. ${pages.length} pages remaining.`);};
   controls.append(earlier,later,rotate,remove);info.append(label,name,controls);item.append(preview,info);list.append(item);
  });
  sync();if(focus)list.querySelector(`[data-photo="${focus.id}"][data-action="${focus.action}"]`)?.focus();
 }
 function move(index,direction,action){
  const next=index+direction;if(next<0||next>=pages.length)return;
  const [page]=pages.splice(index,1);pages.splice(next,0,page);invalidatePdf();render({id:page.id,action});message(`Moved to page ${next+1}.`);
 }
 async function addFiles(files){
  if(busy||externalDisabled||disposed||!files.length)return;
  if(pages.length+files.length>LIMITS.pages){message('Choose no more than 20 manual pages.',true);return;}
  setBusy(true);const added=[];
  try{
   for(let i=0;i<files.length;i++){
    message(`Preparing photo ${i+1} of ${files.length}…`);const file=await preparePhoto(files[i]);
    if(disposed)return;added.push({id:crypto.randomUUID(),file,url:URL.createObjectURL(file),rotation:0});
   }
   pages.push(...added);invalidatePdf();render();message(`${pages.length} ${pages.length===1?'page':'pages'} ready. Check the reading order and orientation.`);
  }catch(error){for(const page of added)URL.revokeObjectURL(page.url);message(error.message,true);onError(error);}
  finally{if(disposed){for(const page of added)URL.revokeObjectURL(page.url);}else setBusy(false);}
 }
 async function prepare(){
  if(busy||externalDisabled||disposed||!pages.length)return;
  request=new AbortController();setBusy(true);message('Preparing your manual pages…');
  try{
   const form=new FormData();for(const page of pages)form.append('photos',page.file);form.append('rotations',JSON.stringify(pages.map(page=>page.rotation)));
   const response=await fetch('/api/photos',{method:'POST',headers:{'X-Unfold-Convert':'1'},body:form,signal:request.signal});
   if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'Photos could not be prepared. Open Unfold through its server and try again.');}
   if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('This preview does not have a photo preparation server.');
   const blob=await response.blob();if(disposed)return;if(blob.size>8*1024*1024)throw new Error('The prepared pages exceed 8 MB. Use fewer photos.');
   invalidatePdf();pdfFile=new File([blob],'photos-manual.pdf',{type:'application/pdf'});pdfUrl=URL.createObjectURL(pdfFile);download.href=pdfUrl;download.download=pdfFile.name;download.hidden=false;
   await onPdfReady(pdfFile);if(disposed)return;
   message('Your photo pages are ready. Download this PDF to keep the source with a saved guide.');dialog.close();
  }catch(error){if(disposed)return;if(request?.signal.aborted)message('Preparation cancelled. Your photo pages are still here.');else{message(error.message,true);onError(error);}}
  finally{request=null;if(!disposed)setBusy(false);}
 }
 launcher.onclick=()=>{if(!dialog.open)dialog.showModal();};close.onclick=()=>dialog.close();submit.onclick=prepare;cancel.onclick=()=>request?.abort();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 sync();
 return {
  setDisabled(value){externalDisabled=!!value;sync();},
  destroy(){disposed=true;request?.abort();for(const page of pages)URL.revokeObjectURL(page.url);invalidatePdf();if(dialog.open)dialog.close();launcher.remove();dialog.remove();if(busy){busy=false;onBusy(false);}},
 };
}
