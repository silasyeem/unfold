const stages=['Send manual','Read pages','Identify parts','Build guide','Check 3D'];
export function conversionStage(message){
 if(/Checking source|Checking 3D|Rendering|Comparing rendered|Correcting/i.test(message))return 4;
 if(/Constructing 3D|Planning shared|Building 3D parts/i.test(message))return 3;
 if(/Cross-checking|Independently verifying/i.test(message))return 2;
 if(/Reading source/i.test(message))return 1;
 return 0;
}
const duration=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
export function mountConversionProgress(root,{now=()=>Date.now(),schedule=setInterval,unschedule=clearInterval}={}){
 root.innerHTML='<div class="conversion-progress-meta"><span class="conversion-stage" role="status"></span><span class="conversion-elapsed"></span></div><progress max="5" value="0" aria-label="Guide creation stages completed"></progress><ol class="conversion-stages">'+stages.map(label=>`<li>${label}</li>`).join('')+'</ol><p class="conversion-wait"></p><p class="conversion-contact"></p>';
 const $=selector=>root.querySelector(selector),items=[...root.querySelectorAll('li')];
 let timer=null,started=0,changed=0,contact=0,stage=0,lastMessage='';
 function tick(){const time=now();$('.conversion-elapsed').textContent=`${duration(time-started)} elapsed`;
  $('.conversion-wait').textContent=time-changed>=60000?'This stage is taking a while. Keep this tab open; you can cancel below.':'Some stages take several minutes. The bar tracks stages, not time remaining.';
  $('.conversion-contact').textContent=contact?`Server last reached ${Math.floor((time-contact)/1000)}s ago.`:'Waiting for the server to respond…';
 }
 function render(){const text=`Step ${stage+1} of ${stages.length} · ${stages[stage]}`;$('.conversion-stage').textContent=text;$('progress').value=stage;$('progress').setAttribute('aria-valuetext',text);
  items.forEach((item,index)=>{item.dataset.state=index<stage?'done':index===stage?'active':'waiting';if(index===stage)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});tick();
 }
 return{
  start(){if(timer!==null)unschedule(timer);started=changed=now();contact=0;stage=0;lastMessage='';root.hidden=false;render();timer=schedule(tick,1000);},
  update(message){if(root.hidden)return;if(message!==lastMessage){lastMessage=message;changed=now();}stage=Math.max(stage,conversionStage(message));render();},
  contact(){if(root.hidden)return;contact=now();tick();},
  stop(){if(timer!==null)unschedule(timer);timer=null;root.hidden=true;},
 };
}
