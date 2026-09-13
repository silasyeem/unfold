import voice from './hosted.mjs';
import {handlePartsScan} from './parts-scan.mjs';

// Preserve the existing hosted scanner alongside voice and the saved demos.
// Chromium-backed conversion and filesystem library storage remain local.
export default {async fetch(request,env,ctx){
 const path=new URL(request.url).pathname;
 if(['/api/scan-health','/api/parts-scan'].includes(path))return handlePartsScan(request,env);
 if(path==='/api/health')return Response.json({conversionAvailable:false},{headers:{'Cache-Control':'no-store'}});
 if(['/api/convert','/api/photos','/api/library'].includes(path)||path.startsWith('/api/library/'))return Response.json({error:'Manual conversion and search run in the local workspace. You can open the saved KNARREVIK demo here.',demoAvailable:true},{status:503,headers:{'Cache-Control':'no-store'}});
 return voice.fetch(request,env,ctx);
}};
