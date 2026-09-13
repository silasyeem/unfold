import {sessionRequest} from './voice-config.mjs';

export function createVoiceHandler({apiKey = process.env.OPENAI_API_KEY, backendModel = process.env.OPENAI_BACKEND_MODEL || 'gpt-5.6-terra', fetchImpl = fetch, timeoutMs = 20000, bodyLimit = 65536, maxPerMinute = 4, now = Date.now} = {}) {
  let active = 0;
  let attempts = [];
  const reply = (res, status, body) => {
    if (!res.destroyed) res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}).end(JSON.stringify(body));
  };
  return async function handleVoice(req, res) {
    try {
      const rawPath = req.url.split('?')[0];
        const port = req.socket.localPort;
        const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
        const origins = hosts.map(host => 'http://' + host);
        if (!hosts.includes(req.headers.host) || (req.headers.origin !== undefined && !origins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site' || (req.method === 'POST' && !origins.includes(req.headers.origin))) {
          reply(res, 403, {error: 'Unexpected request origin.'}); return;
        }
        if (rawPath === '/api/voice/readiness' && req.method === 'GET') {
          reply(res, 200, {ready: Boolean(apiKey?.trim()), acceptsClientKey: true, model: 'gpt-live-1'}); return;
        }
        if (rawPath !== '/api/voice/session' || req.method !== 'POST') {reply(res, 404, {error: 'Not found.'}); return;}
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {reply(res, 415, {error: 'Expected JSON.'}); return;}
        if (Number(req.headers['content-length']) > bodyLimit) {reply(res, 413, {error: 'Request too large.'}); req.resume(); return;}
        let length = 0;
        const chunks = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > bodyLimit) {reply(res, 413, {error: 'Request too large.'}); return;}
          chunks.push(chunk);
        }
        let input;
        try {input = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {reply(res, 400, {error: 'Invalid JSON.'}); return;}
        if (!input || Object.keys(input).some(key => !['sdp', 'apiKey'].includes(key)) || typeof input.sdp !== 'string' || !input.sdp.trim()) {reply(res, 400, {error: 'An SDP offer is required.'}); return;}
        let requestKey = apiKey?.trim() || '';
        if (Object.hasOwn(input, 'apiKey')) {
          if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(input.apiKey) || /\s/.test(input.apiKey.trim())) {
            reply(res, 400, {error: 'Enter a valid API key with no spaces or control characters, up to 4096 characters.'}); return;
          }
          requestKey = input.apiKey.trim();
          input.apiKey = undefined;
        }
        if (!requestKey) {reply(res, 503, {error: 'Enter an OpenAI API key in the app, or configure OPENAI_API_KEY on the local server.'}); return;}
        attempts = attempts.filter(time => now() - time < 60000);
        if (active >= 1 || attempts.length >= maxPerMinute) {reply(res, 429, {error: 'Please wait before starting another voice session.'}); return;}
        attempts.push(now()); active++;
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        const onClose = () => {if (!res.writableEnded) abort.abort();};
        res.on('close', onClose);
        try {
          const pending = fetchImpl('https://api.openai.com/v1/live/sessions', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + requestKey}, body: JSON.stringify(sessionRequest(input.sdp, backendModel)), signal: abort.signal});
          requestKey = '';
          const upstream = await pending;
          if (!upstream.ok) {
            const messages = {401: 'OpenAI rejected the API key. Check the key and try again.', 403: 'OpenAI denied voice access. Check the key’s project and model access.', 429: 'OpenAI rate limit or quota reached. Check API billing and try again later.'};
            reply(res, Object.hasOwn(messages, upstream.status) ? upstream.status : 502, {error: messages[upstream.status] || 'Voice connection failed. Check server access and try again.'}); return;
          }
          const result = await upstream.json();
          if (typeof result.session?.id !== 'string' || !result.session.id || typeof result.transport?.sdp !== 'string' || !result.transport.sdp) throw new Error('shape');
          reply(res, 201, {session: {id: result.session.id}, transport: {sdp: result.transport.sdp}});
        } catch {reply(res, 502, {error: 'Voice connection failed. Check server access and try again.'});}
        finally {requestKey = ''; clearTimeout(timer); res.off('close', onClose); active--;}
        return;
    } catch {reply(res, 500, {error: 'Request could not be completed.'});}
  };
}
