import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, symlink, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createLocalServer, sessionRequest} from '../server.mjs';

async function serve(t, options = {}) {
  const server = createLocalServer({apiKey: '', ...options});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (body = {sdp: 'offer'}, headers = {}) => fetch(url + '/api/voice/session', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: url, ...headers}, body: JSON.stringify(body)});
  return {server, url, post};
}
test('readiness is boolean/model only; startup and missing key never call upstream', async t => {
  let calls = 0; const s = await serve(t, {fetchImpl: () => {calls++; throw new Error();}});
  assert.deepEqual(await (await fetch(s.url + '/api/voice/readiness')).json(), {ready: false, acceptsClientKey: true, model: 'gpt-live-1'});
  assert.equal((await s.post()).status, 503); assert.equal(calls, 0);
  const staticPage = await fetch(s.url + '/'); assert.equal(staticPage.status, 200); assert.match(await staticPage.text(), /copilot-panel/);
});
test('GPT-Live upstream wire shape and sanitized response; current catalog via tools, key server only', async t => {
  const captures = [];
  const s = await serve(t, {apiKey: 'test-secret', backendModel: 'configured-backend', fetchImpl: async (...args) => {
    captures.push(args); return {ok: true, json: async () => ({session: {id: 'live_opaque-id', key: 'hidden'}, transport: {type: 'webrtc', sdp: 'answer'}, secret: 'hidden'})};
  }});
  const response = await s.post(); assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {session: {id: 'live_opaque-id'}, transport: {sdp: 'answer'}});
  const [url, options] = captures[0]; assert.equal(url, 'https://api.openai.com/v1/live/sessions'); assert.equal(options.headers.Authorization, 'Bearer test-secret');
  const body = JSON.parse(options.body); assert.deepEqual(body, sessionRequest('offer', 'configured-backend'));
  assert.equal(body.session.model, 'gpt-live-1'); assert.equal(body.session.delegation.type, 'responses'); assert.equal(body.session.delegation.responses.parallel_tool_calls, false);
  assert.equal(body.transport.type, 'webrtc'); assert.equal(body.transport.sdp, 'offer');
  assert.match(body.session.delegation.responses.instructions, /get_assembly_state/);
  assert.match(body.session.delegation.responses.instructions, /list_assembly_steps/);
  assert.doesNotMatch(body.session.delegation.responses.instructions, /STRANDMON|Fit the seat cushion/);
  assert.equal(body.session.delegation.responses.tools.length, 6);
  assert.doesNotMatch(JSON.stringify(body), /test-secret/);
});
test('API boundaries reject wrong origins/hosts, malformed inputs, body limits and unsupported methods', async t => {
  let calls = 0; const s = await serve(t, {apiKey: 'test', fetchImpl: () => {calls++; throw new Error();}, bodyLimit: 100});
  assert.equal((await s.post({}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await s.post({}, {Origin: 'null'})).status, 403);
  const wrongHost = await new Promise((resolve, reject) => request(s.url + '/api/voice/readiness', {headers: {Host: 'evil.example'}}, res => {res.resume(); resolve(res.statusCode);}).on('error', reject).end());
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(s.url + '/api/voice/readiness', {headers: {Origin: 'http://localhost:1'}})).status, 403);
  assert.equal((await fetch(s.url + '/api/voice/readiness', {headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  assert.equal((await fetch(s.url + '/api/voice/session', {method: 'POST', body: '{}'})).status, 403);
  assert.equal((await s.post({sdp: ''})).status, 400);
  assert.equal((await s.post({sdp: 'offer', session: {model: 'other'}})).status, 400);
  assert.equal((await s.post({sdp: 'x'.repeat(101)})).status, 413);
  assert.equal((await s.post({}, {'Content-Type': 'text/plain'})).status, 415);
  assert.equal((await fetch(s.url + '/api/voice/session', {method: 'POST', headers: {Origin: s.url, 'Content-Type': 'application/json'}, body: '{bad'})).status, 400);
  assert.equal((await fetch(s.url + '/server.mjs')).status, 404);
  assert.equal((await fetch(s.url + '/server/index.js')).status, 404);
  assert.equal((await fetch(s.url + '/client/index.html')).status, 404); assert.equal(calls, 0);
});
test('static serving rejects traversal, dotfiles and symlink escapes without exposing source secrets', async t => {
  // Preserve temporary fixtures; this repository's global rules prohibit deletion.
  const dir = await mkdtemp(join(tmpdir(), 'unfold-static-test-')); const root = join(dir, 'dist'); await mkdir(root);
  await writeFile(join(root, 'index.html'), 'test app'); await writeFile(join(root, '.private'), 'secret'); await writeFile(join(dir, 'outside'), 'secret');
  await symlink(join(dir, 'outside'), join(root, 'escape')); await symlink(join(root, '.private'), join(root, 'alias'));
  const s = await serve(t, {root});
  for (const path of ['/.env', '/%2eprivate', '/escape', '/alias', '/vendor/../../outside', '/%2e%2e/outside', '/%5coutside']) {
    const result = await new Promise((resolve, reject) => {
      request(s.url, {path}, res => {let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({status: res.statusCode, body}));}).on('error', reject).end();
    });
    assert.ok(result.status >= 400, path); assert.doesNotMatch(result.body, /secret/);
  }
});
test('upstream errors are sanitized and never retried; attempts are rate limited', async t => {
  let calls = 0; const s = await serve(t, {apiKey: 'test', maxPerMinute: 2, fetchImpl: async () => {calls++; return {ok: false, json: async () => ({error: 'private upstream'})};}});
  for (let i = 0; i < 2; i++) {const r = await s.post(); assert.equal(r.status, 502); assert.doesNotMatch(await r.text(), /private/);}
  assert.equal((await s.post()).status, 429); assert.equal(calls, 2);
});
test('only one upstream creation in flight; timeouts abort and free the slot', async t => {
  let upstreamStarted; const started = new Promise(resolve => upstreamStarted = resolve); let calls = 0;
  const s = await serve(t, {apiKey: 'test', timeoutMs: 80, fetchImpl: async (_url, {signal}) => {
    calls++; upstreamStarted(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}));
  }});
  const first = s.post(); await started;
  assert.equal((await s.post()).status, 429); assert.equal((await first).status, 502);
  assert.equal((await s.post()).status, 502); assert.equal(calls, 2);
});

test('request key overrides environment only for its request, and blank-field omission uses the environment', async t => {
  const auth = [];
  const s = await serve(t, {apiKey: 'server-test-key', fetchImpl: async (_url, options) => {
    auth.push(options.headers.Authorization);
    assert.doesNotMatch(options.body, /server-test-key|client-test-key/);
    return {ok: true, json: async () => ({session: {id: 'live_test'}, transport: {sdp: 'answer'}})};
  }});
  const supplied = await s.post({sdp: 'offer', apiKey: ' client-test-key '});
  assert.equal(supplied.status, 201); assert.doesNotMatch(await supplied.text(), /client-test-key/);
  assert.equal((await s.post()).status, 201);
  assert.deepEqual(auth, ['Bearer client-test-key', 'Bearer server-test-key']);
  assert.deepEqual(await (await fetch(s.url + '/api/voice/readiness')).json(), {ready: true, acceptsClientKey: true, model: 'gpt-live-1'});
});

test('no-env supplied key works once, is never reused, and invalid supplied values cannot bill environment key', async t => {
  let calls = 0;
  const fetchImpl = async () => {calls++; return {ok: true, json: async () => ({session: {id: 'live_test'}, transport: {sdp: 'answer'}})};};
  const s = await serve(t, {fetchImpl});
  assert.equal((await s.post({sdp: 'offer', apiKey: 'temporary-test-key'})).status, 201);
  assert.equal((await s.post()).status, 503); assert.equal(calls, 1);
  const configured = await serve(t, {apiKey: 'server-test-key', fetchImpl});
  for (const apiKey of ['', '   ', null, false, 42, {}, [], 'bad key', 'bad\nkey', 'bad\tkey', '\nkey', 'bad\x00key', 'bad\x7fkey', 'x'.repeat(4097)]) {
    const response = await configured.post({sdp: 'offer', apiKey});
    assert.equal(response.status, 400, JSON.stringify(apiKey));
    assert.doesNotMatch(await response.text(), /server-test-key/);
  }
  assert.equal(calls, 1);
});

test('provider authentication, access, quota and other rejections have safe fixed responses', async t => {
  for (const status of [401, 403, 429, 500]) {
    let reads = 0;
    const s = await serve(t, {fetchImpl: async () => ({ok: false, status, json: async () => {reads++; return {error: 'secret-key-and-provider-body'};}})});
    const response = await s.post({sdp: 'offer', apiKey: 'secret-key-and-provider-body'});
    assert.equal(response.status, status === 500 ? 502 : status);
    const body = await response.text(); assert.doesNotMatch(body, /secret-key-and-provider-body/); assert.equal(reads, 0);
  }
});
