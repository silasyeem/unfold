// Verify the built runtime without a key, microphone, or paid session.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:4191').origin;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Use the local Worker preview for this check.');
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
let checked = 0;
async function compare(directory = '') {
  for (const entry of await readdir(join(dist, directory), {withFileTypes: true})) {
    if (entry.name.startsWith('.') || (!directory && ['client', 'server'].includes(entry.name))) continue;
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) await compare(relative);
    else {
      assert.deepEqual(await readFile(join(dist, relative)), await readFile(join(dist, 'client', relative)), relative);
      checked++;
    }
  }
}
await compare();
const manifest = JSON.parse(await readFile(join(dist, '.openai/hosting.json'), 'utf8'));
assert.deepEqual(manifest, JSON.parse(await readFile(join(root, '.openai/hosting.json'), 'utf8')));
assert.equal(manifest.static, undefined);
const bundle = await readFile(join(dist, 'server/index.js'), 'utf8');
assert.doesNotMatch(bundle, /from\s+["']node:|process\.env|createServer\(/);
const worker = (await import(new URL('../dist/server/index.js', import.meta.url))).default;
assert.equal(typeof worker.fetch, 'function');
const ready = await fetch(origin + '/api/voice/readiness');
assert.equal(ready.status, 200);
assert.deepEqual(await ready.json(), {ready: false, acceptsClientKey: true, model: 'gpt-live-1'});
for (const path of ['/', '/app.js', '/live-session.js', '/style.css', '/viewer.js', '/steps.js']) {
  const response = await fetch(origin + path);
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('permissions-policy'), 'microphone=(self)');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(dist, 'client', path === '/' ? 'index.html' : path)), path);
}
// Check every manual/vendor resource too, including binary asset integrity.
async function checkResources(directory) {
  for (const entry of await readdir(join(dist, 'client', directory), {withFileTypes: true})) {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) await checkResources(relative);
    else {
      const response = await fetch(origin + '/' + relative);
      assert.equal(response.status, 200, relative);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(dist, 'client', relative)), relative);
    }
  }
}
await checkResources('assets'); await checkResources('vendor');
for (const path of ['/server/index.js', '/server/hosted.mjs', '/.env', '/.openai/hosting.json', '/client/index.html', '/api/unknown']) assert.equal((await fetch(origin + path)).status, 404, path);
const body = JSON.stringify({sdp: 'not-a-real-offer'});
const create = headers => fetch(origin + '/api/voice/session', {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body});
assert.equal((await create({Origin: origin})).status, 503);
assert.equal((await create({Origin: 'https://different.example'})).status, 403);
assert.equal((await create({})).status, 403);
console.log(`Verified ${checked} unchanged public files, built Worker export/manifest, runtime page and all manual/vendor assets, private-path denials, readiness, no-key and origin rejection. No OpenAI calls made.`);
