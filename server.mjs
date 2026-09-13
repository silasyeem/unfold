import {createServer} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createVoiceHandler} from './server/voice.mjs';
export {VOICE_PROMPT, BACKEND_PROMPT, sessionRequest} from './server/voice-config.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8'};
export function createLocalServer({apiKey = process.env.OPENAI_API_KEY, backendModel = process.env.OPENAI_BACKEND_MODEL || 'gpt-5.6-terra', root = defaultRoot, fetchImpl = fetch, timeoutMs = 20000, bodyLimit = 65536, maxPerMinute = 4, now = Date.now} = {}) {
  const handleVoice = createVoiceHandler({apiKey, backendModel, fetchImpl, timeoutMs, bodyLimit, maxPerMinute, now});
  const reply = (res, status, body) => {
    if (!res.destroyed) res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}).end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    try {
      const rawPath = req.url.split('?')[0];
      const isApi = rawPath.startsWith('/api/');
      if (isApi) {await handleVoice(req, res); return;}
      if (req.method !== 'GET' && req.method !== 'HEAD') {reply(res, 405, {error: 'Method not allowed.'}); return;}
      let decoded;
      try {decoded = decodeURIComponent(rawPath);} catch {reply(res, 400, {error: 'Invalid path.'}); return;}
      if (/^\/(server|client)(\/|$)/.test(decoded)) {reply(res, 404, {error: 'Not found.'}); return;}
      if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.'))) {reply(res, 403, {error: 'Forbidden.'}); return;}
      const base = await realpath(root);
      let path;
      try {path = await realpath(resolve(base, '.' + (decoded === '/' ? '/index.html' : decoded)));} catch {reply(res, 404, {error: 'Not found.'}); return;}
      if (!path.startsWith(base + sep) || path.slice(base.length + 1).split(sep).some(part => part.startsWith('.')) || !(await stat(path)).isFile()) {reply(res, 403, {error: 'Forbidden.'}); return;}
      res.writeHead(200, {'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Permissions-Policy': 'microphone=(self)'});
      res.end(req.method === 'HEAD' ? undefined : await readFile(path));
    } catch {reply(res, 500, {error: 'Request could not be completed.'});}
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  createLocalServer().listen(port, '127.0.0.1', () => console.log(`Unfold: http://127.0.0.1:${port}`));
}
