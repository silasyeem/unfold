export function convertInBrowser(file,{pageCount,signal,onStage=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const url=new URL('/api/convert-socket',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const socket=new WebSocket(url);let renderer,done=false,rendering=false;
  const timer=setTimeout(()=>finish(new Error('Conversion took too long. Try a shorter manual.')),20*60*1000);
  function finish(error,result){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);renderer?.remove();socket.close();error?reject(error):resolve(result);}
  function cancel(){finish(new DOMException('Conversion cancelled.','AbortError'));}
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  socket.onopen=()=>{socket.send(JSON.stringify({type:'init',pageCount,filename:file.name}));socket.send(file);};
  socket.onerror=()=>finish(new Error('The live engine could not connect. Please reload and try again.'));
  socket.onclose=()=>{if(!done)finish(new Error('The engine connection closed. Keep this page open during conversion and retry.'));};
  socket.onmessage=async event=>{
   try{
    const data=JSON.parse(event.data);
    if(data.type==='stage')onStage(data.message);
    if(data.type==='error')throw new Error(data.message);
    if(data.type==='result'){finish(null,data.result);return;}
    if(data.type==='render'){
     if(rendering)throw new Error('The engine sent overlapping render requests.');rendering=true;
     renderer?.remove();renderer=document.createElement('iframe');renderer.title='Checking generated assembly stages';
     Object.assign(renderer.style,{position:'fixed',left:'-1100px',top:'0',width:'1024px',height:'768px',border:'0',pointerEvents:'none'});
     renderer.src='/render.html';const loaded=new Promise((res,rej)=>{renderer.onload=res;renderer.onerror=()=>rej(new Error('The 3D checker could not load.'));});document.body.append(renderer);await loaded;
     const api=renderer.contentWindow.unfoldCapture;if(!api)throw new Error('The 3D checker could not start.');await api.load(data.guide);
     for(const [i,stage] of data.stages.entries()){
      if(done)return;onStage(`Checking 3D view ${i+1} of ${data.stages.length}…`);
      await api.frame(stage);const imageDataUrl=api.capture();
      socket.send(JSON.stringify({type:'capture',requestId:data.requestId,capture:{...stage,imageDataUrl}}));
     }
     socket.send(JSON.stringify({type:'rendered',requestId:data.requestId}));renderer.remove();renderer=null;rendering=false;
    }
   }catch(error){finish(error);}
  };
 });
}
