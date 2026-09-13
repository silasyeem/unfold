import {KNARREVIK} from './knarrevik.js';

// This scanner has a fixed inventory. Offer it only for its verified manual.
export function mountGuideScanner({onOpen}) {
  const section=document.querySelector('#guide-scan');
  const button=document.querySelector('#open-parts-scan');
  const dialog=document.querySelector('#parts-scan-dialog');
  const container=document.querySelector('#parts-scan-content');
  let eligible=false,frame=null;

  button.onclick=()=>{
    if(!eligible||button.disabled||section.hidden)return;
    onOpen();
    if(!frame){
      frame=document.createElement('iframe');
      frame.title='Scan your KNARREVIK parts';
      frame.src='/scan.html?embedded=1';
      container.append(frame);
    }
    dialog.showModal();
  };
  document.querySelector('#close-parts-scan').onclick=()=>dialog.close();

  return {
    sync(result,{busy=false,choosingManual=false}={}) {
      eligible=!!result?.guide&&result.provenance?.sha256===KNARREVIK.manualSha256;
      section.hidden=!eligible||busy||choosingManual;
      button.disabled=!eligible||busy;
      if(!eligible){
        if(dialog.open)dialog.close();
        frame?.remove();frame=null;
      }
    },
    destroy(){if(dialog.open)dialog.close();frame?.remove();frame=null;},
  };
}
