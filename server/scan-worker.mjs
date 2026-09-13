// Adds recognition to the existing static Site. The full conversion workspace
// remains served by the local Node app, as before this feature.
import {handlePartsScan} from './parts-scan.mjs';
export default {async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(['/api/parts-scan','/api/scan-health'].includes(path))return handlePartsScan(request,env);
  if(path==='/api/health')return Response.json({conversionAvailable:false},{headers:{'Cache-Control':'no-store'}});
  if(path.startsWith('/api/'))return Response.json({error:'Live manual search and conversion are unavailable in this demo. Open KNARREVIK demo to use its saved guide, then scan your parts.',demoAvailable:true},{status:503});
  return env.ASSETS.fetch(request);
}};
