import {sessionRequest} from './voice-config.mjs';

const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'microphone=(self)'};
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {...headers, 'Content-Type': 'application/json'}});
class InputError extends Error {
  constructor(status, message) {super(message); this.status = status;}
}

async function readInput(request, limit, signal) {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new InputError(413, 'Request too large.');
  if (!request.body) throw new InputError(400, 'Expected JSON.');
  const reader = request.body.getReader();
  const cancel = () => {reader.cancel().catch(() => {});};
  signal.addEventListener('abort', cancel, {once: true});
  let total = 0;
  const chunks = [];
  try {
    if (signal.aborted) throw new InputError(408, 'Request timed out or cancelled.');
    while (true) {
      const {done, value} = await reader.read();
      if (signal.aborted) throw new InputError(408, 'Request timed out or cancelled.');
      if (done) break;
      total += value.byteLength;
      if (total > limit) {cancel(); throw new InputError(413, 'Request too large.');}
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    try {return JSON.parse(new TextDecoder().decode(bytes));}
    catch {throw new InputError(400, 'Invalid JSON.');}
  } finally {signal.removeEventListener('abort', cancel); reader.releaseLock();}
}

// Best-effort per-isolate throttling only. Digests expire; raw keys never enter
// the limiter. Distributed billing limits remain the key owner's responsibility.
export function createHostedHandler({fetchImpl = (...args) => fetch(...args), now = Date.now, timeoutMs = 20000, bodyLimit = 65536, maxPerMinute = 4, maxKeys = 512} = {}) {
  const buckets = new Map();
  async function reserve(key) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))), b => b.toString(16).padStart(2, '0')).join('');
    const time = now();
    for (const [id, bucket] of buckets) {
      bucket.attempts = bucket.attempts.filter(at => time - at < 60000);
      if (!bucket.active && !bucket.attempts.length) buckets.delete(id);
    }
    let bucket = buckets.get(digest);
    if (!bucket) {
      if (buckets.size >= maxKeys) return null;
      bucket = {attempts: [], active: false}; buckets.set(digest, bucket);
    }
    if (bucket.active || bucket.attempts.length >= maxPerMinute) return null;
    bucket.active = true; bucket.attempts.push(time);
    return () => {bucket.active = false;};
  }
  return async function handle(request, env = {}) {
    const url = new URL(request.url);
    let path;
    try {path = decodeURIComponent(url.pathname);}
    catch {return json(400, {error: 'Invalid path.'});}
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.')) || /^\/(server|client)(\/|$)/.test(path)) return json(404, {error: 'Not found.'});
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return json(405, {error: 'Method not allowed.'});
      if (!env.ASSETS?.fetch) return json(503, {error: 'Site assets are unavailable. Publish the complete build.'});
      try {
        const asset = await env.ASSETS.fetch(request);
        const response = new Response(asset.body, asset);
        for (const [name, value] of Object.entries(headers)) if (name !== 'Cache-Control') response.headers.set(name, value);
        return response;
      } catch {return json(503, {error: 'Site assets are unavailable.'});}
    }
    // The request URL is the runtime's destination; never trust forwarded hosts.
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const origin = request.headers.get('origin');
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        (origin !== null && origin !== url.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site' ||
        (request.method === 'POST' && origin !== url.origin)) return json(403, {error: 'Unexpected request origin.'});
    if (path === '/api/voice/readiness' && request.method === 'GET') return json(200, {ready: Boolean(env.OPENAI_API_KEY?.trim()), acceptsClientKey: true, model: 'gpt-live-1'});
    if (path !== '/api/voice/session') return json(404, {error: 'Not found.'});
    if (request.method !== 'POST') return json(405, {error: 'Method not allowed.'});
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, {error: 'Expected JSON.'});

    const abort = new AbortController();
    const cancel = () => abort.abort();
    const timer = setTimeout(cancel, timeoutMs);
    request.signal.addEventListener('abort', cancel, {once: true});
    if (request.signal.aborted) cancel();
    let key = '';
    let release;
    try {
      const input = await readInput(request, bodyLimit, abort.signal);
      if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(name => !['sdp', 'apiKey'].includes(name)) || typeof input.sdp !== 'string' || !input.sdp.trim()) return json(400, {error: 'An SDP offer is required.'});
      key = env.OPENAI_API_KEY?.trim() || '';
      if (Object.hasOwn(input, 'apiKey')) {
        if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 4096 || /[\x00-\x1f\x7f]/.test(input.apiKey) || /\s/.test(input.apiKey.trim())) return json(400, {error: 'Enter a valid API key with no spaces or control characters, up to 4096 characters.'});
        key = input.apiKey.trim(); input.apiKey = undefined;
      }
      if (!key) return json(503, {error: 'Voice is not configured. Add an OpenAI API key in Voice settings or configure the server key.'});
      release = await reserve(key);
      if (!release) return json(429, {error: 'Please wait before starting another voice session.'});
      if (abort.signal.aborted) return json(408, {error: 'Request timed out or cancelled.'});
      const pending = fetchImpl('https://api.openai.com/v1/live/sessions', {
        method: 'POST', redirect: 'manual', signal: abort.signal,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
        body: JSON.stringify(sessionRequest(input.sdp, env.OPENAI_BACKEND_MODEL || 'gpt-5.6-terra')),
      });
      key = '';
      const upstream = await pending;
      if (!upstream.ok) {
        await upstream.body?.cancel();
        const messages = {401: 'OpenAI rejected the API key. Check the key and try again.', 403: 'OpenAI denied voice access. Check the key’s project and model access.', 429: 'OpenAI rate limit or quota reached. Check API billing and try again later.'};
        return json(Object.hasOwn(messages, upstream.status) ? upstream.status : 502, {error: messages[upstream.status] || 'Voice connection failed. Try again.'});
      }
      const result = await upstream.json();
      if (typeof result.session?.id !== 'string' || !result.session.id || typeof result.transport?.sdp !== 'string' || !result.transport.sdp) throw new Error('Invalid upstream response');
      return json(201, {session: {id: result.session.id}, transport: {sdp: result.transport.sdp}});
    } catch (error) {
      if (error instanceof InputError) return json(error.status, {error: error.message});
      return json(502, {error: 'Voice connection failed. Check the key and try again.'});
    } finally {
      key = ''; release?.(); clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }
  };
}

export default {fetch: createHostedHandler()};
