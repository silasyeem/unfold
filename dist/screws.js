import {PRESETS,validateScrew,createScrewMesh,encodeBinarySTL,screwFilename} from './screw-geometry.js';

export function mountScrewLab(document,{makeViewer,search='',save=download}={}) {
  const $=selector=>document.querySelector(selector),form=$('#screw-form');
  const field=name=>form.querySelector(`[name="${name}"]`);
  const numeric=['diameter','pitch','length','clearance','headWidth','headHeight','socketSize'];
  let mesh=null,viewer=null,disposed=false,timer=null,revision=0;
  const status=text=>{$('#screw-status').textContent=text;};
  const read=()=>({...Object.fromEntries(numeric.map(name=>[name,field(name).value.trim()===''?NaN:Number(field(name).value)])),head:field('head').value,hand:field('hand').value});
  function refresh(){
    timer=null;if(disposed)return;
    try {
      const spec=validateScrew(read());mesh=createScrewMesh(spec);
      $('#screw-error').hidden=true;$('#screw-download').disabled=false;
      $('#screw-spec-name').textContent=`M${spec.diameter} × ${spec.pitch} · ${spec.length} mm${spec.hand==='left'?' · LH':''}`;
      $('#screw-actual').textContent=`${Number((spec.diameter-spec.clearance).toFixed(3))} mm`;
      $('#screw-overall').textContent=`${Number((spec.length+spec.headHeight).toFixed(3))} mm`;
      $('#screw-facets').textContent=`${(mesh.indices.length/3).toLocaleString()} faces`;
      $('#print-size-advice').textContent=spec.diameter<6?'Below M6, printed threads are especially difficult. Use this as a dimensional prototype; source the matching metal screw for assembly.':'M6 and larger is a more realistic starting point, not a guarantee of fit or strength. Print one and check the fit gently.';
      status('Binary STL · millimetres · one screw. Import at 100% scale.');
      try{viewer?.load(mesh);}catch{viewer?.dispose();viewer=null;$('#screw-reset-view').disabled=true;$('#preview-fallback').hidden=false;$('#preview-fallback').textContent='3D preview is unavailable. You can still edit dimensions and download the STL.';}
    }catch(error){mesh=null;$('#screw-download').disabled=true;$('#screw-error').textContent=error.message;$('#screw-error').hidden=false;status('Correct the dimensions to generate a new screw. Preview shows the last valid shape.');}
  }
  function changed(event){
    revision++;mesh=null;$('#screw-download').disabled=true;
    if(event?.target?.name&&['diameter','pitch','headWidth','headHeight','socketSize'].includes(event.target.name))$('#screw-preset').value='custom';
    $('#socket-field').hidden=field('head').value!=='socket';
    $('#head-width-label').textContent=field('head').value==='hex'?'Head across flats':field('head').value==='thumb'?'Head base diameter':'Head diameter';
    clearTimeout(timer);status('Updating the screw…');timer=setTimeout(refresh,120);
  }
  $('#screw-preset').onchange=()=>{const preset=PRESETS.find(p=>String(p.diameter)===$('#screw-preset').value);if(preset){for(const [key,value] of Object.entries(preset))field(key).value=String(value);changed();}};
  form.addEventListener('input',changed);
  form.onsubmit=async event=>{
    event.preventDefault();if(!mesh||disposed)return;
    const current=mesh,version=revision;$('#screw-download').disabled=true;status('Preparing your STL…');
    try{await save(new Blob([encodeBinarySTL(current)],{type:'model/stl'}),screwFilename(current.spec));if(version===revision&&!disposed)status('STL downloaded. Import in millimetres at 100% scale; print one to check the fit.');}
    catch{if(version===revision&&!disposed)status('The file could not be saved. Please try downloading again.');}
    finally{if(version===revision&&!disposed)$('#screw-download').disabled=!mesh;}
  };
  const params=new URLSearchParams(search);
  if(params.get('source')==='knarrevik'){
    const context=$('#screw-source');context.hidden=false;
    context.textContent='KNARREVIK assembly screws · 10118490 / 10118469. The manual identifies the part, but does not establish its thread dimensions. The M8 example below is not a matched replacement. Use the correct metal spare for this table. ';
    const link=document.createElement('a');link.href='/reference/knarrevik-manual.pdf#page=6';link.target='_blank';link.rel='noopener';link.textContent='Check manual page 6 ↗';context.append(link);
  }
  refresh();
  Promise.resolve().then(()=>makeViewer?.($('#screw-preview'))).then(result=>{if(disposed){result?.dispose();return;}viewer=result;if(viewer){if(mesh)viewer.load(mesh);$('#screw-reset-view').disabled=false;}}).catch(()=>{if(disposed)return;viewer?.dispose();viewer=null;$('#screw-reset-view').disabled=true;$('#preview-fallback').hidden=false;$('#preview-fallback').textContent='3D preview is unavailable. You can still edit dimensions and download the STL.';});
  $('#screw-reset-view').onclick=()=>viewer?.reset();
  return {getMesh:()=>mesh,refresh,destroy(){disposed=true;clearTimeout(timer);viewer?.dispose();form.removeEventListener('input',changed);}};
}

function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}

if(typeof document!=='undefined') {
  const lab=mountScrewLab(document,{search:location.search,makeViewer:async container=>{const {createScrewViewer}=await import('./screw-viewer.js');return createScrewViewer(container);}});
  addEventListener('pagehide',()=>lab.destroy(),{once:true});
}
