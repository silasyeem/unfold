// Worker-compatible entry for a server-backed deployment; assets are a separate binding.
import {handleApi} from './api.mjs';
export default{fetch(request,env){if(new URL(request.url).pathname.startsWith('/api/'))return handleApi(request,env);return env.ASSETS.fetch(request);}};
