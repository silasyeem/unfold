import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedHandler} from '../server/hosted.mjs';
import {sessionRequest} from '../server/voice-config.mjs';

const origin = 'https://unfold.example';
const success = () => Response.json({session: {id: 'live_test', secret: 'hidden'}, transport: {sdp: 'answer'}, hidden: 'private'});
function post(body = {sdp: 'offer', apiKey: 'test-key'}, headers = {}, options = {}) {
  return new Request(origin + '/api/voice/session', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, ...headers}, body: JSON.stringify(body), ...options});
}
test('hosted readiness reports the server key without exposing it or calling OpenAI', async () => {
  let calls = 0;
  const handle = createHostedHandler({fetchImpl: async () => {calls++; return success();}});
  for (const apiKey of [undefined, '', '  ', 'server-test-secret']) {
    const ready = await handle(new Request(origin + '/api/voice/readiness'), {OPENAI_API_KEY: apiKey});
    assert.deepEqual(await ready.json(), {ready: Boolean(apiKey?.trim()), acceptsClientKey: true, model: 'gpt-live-1'});
    assert.equal(ready.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await handle(post({sdp: 'offer'}))).status, 503);
  assert.equal(calls, 0);
});
test('hosted voice uses the server key by default and isolates optional overrides from later sessions', async () => {
  const captures = [];
  const handle = createHostedHandler({fetchImpl: async (...args) => {captures.push(args); return success();}});
  const env = {OPENAI_API_KEY: 'server-secret', OPENAI_BACKEND_MODEL: 'configured-model'};
  const response = await handle(post({sdp: 'offer', apiKey: ' key-one '}), env);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {session: {id: 'live_test'}, transport: {sdp: 'answer'}});
  await handle(post({sdp: 'offer', apiKey: 'key-two'}), env);
  assert.equal((await handle(post({sdp: 'offer'}), env)).status, 201);
  assert.equal(captures.length, 3);
  for (const [i, [url, options]] of captures.entries()) {
    assert.equal(url, 'https://api.openai.com/v1/live/sessions');
    assert.equal(options.headers.Authorization, 'Bearer ' + ['key-one', 'key-two', 'server-secret'][i]);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), sessionRequest('offer', 'configured-model'));
    assert.doesNotMatch(options.body, /key-one|key-two|server-secret/);
  }
});
test('hosted rejects origins, insecure production, methods and invalid JSON/keys before billing', async () => {
  let calls = 0;
  const handle = createHostedHandler({fetchImpl: async () => {calls++; return success();}});
  for (const bad of ['https://evil.example', 'null', 'https://unfold.example.evil.test']) assert.equal((await handle(post(undefined, {Origin: bad}))).status, 403);
  const noOrigin = post(); noOrigin.headers.delete('origin');
  assert.equal((await handle(noOrigin)).status, 403);
  assert.equal((await handle(post(undefined, {'Sec-Fetch-Site': 'cross-site'}))).status, 403);
  assert.equal((await handle(new Request('http://unfold.example/api/voice/readiness'))).status, 403);
  assert.equal((await handle(new Request('http://localhost:4191/api/voice/readiness'))).status, 200);
  assert.equal((await handle(new Request(origin + '/api/voice/session'))).status, 405);
  assert.equal((await handle(new Request(origin + '/api/unknown'))).status, 404);
  assert.equal((await handle(post(undefined, {'Content-Type': 'text/plain'}))).status, 415);
  assert.equal((await handle(post(undefined, {}, {body: '{oops'}))).status, 400);
  for (const body of [null, [], 4, 'text', {sdp: ''}, {sdp: 'offer', apiKey: 'key', model: 'other'}]) assert.equal((await handle(post(body))).status, 400);
  for (const apiKey of ['', ' ', null, false, 42, {}, [], 'bad key', 'bad\nkey', 'bad\tkey', '\nkey', 'bad\x00key', 'bad\x7fkey', 'x'.repeat(4097)]) assert.equal((await handle(post({sdp: 'offer', apiKey}), {OPENAI_API_KEY: 'secret'})).status, 400);
  assert.equal(calls, 0);
});
test('body cap applies to declared and streamed bytes, and a stalled body times out', async () => {
  let calls = 0;
  const handle = createHostedHandler({bodyLimit: 100, timeoutMs: 30, fetchImpl: async () => {calls++; return success();}});
  assert.equal((await handle(post(undefined, {'Content-Length': '101'}))).status, 413);
  const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(70)); controller.enqueue(new Uint8Array(70)); controller.close();}});
  assert.equal((await handle(post(undefined, {}, {body, duplex: 'half'}))).status, 413);
  let cancelled = false;
  const stalled = new ReadableStream({cancel() {cancelled = true;}});
  assert.equal((await handle(post(undefined, {}, {body: stalled, duplex: 'half'}))).status, 408);
  assert.equal(cancelled, true); assert.equal(calls, 0);
});
test('per-key concurrency and throttling isolate visitors, expire, and bound limiter memory', async () => {
  let now = 0;
  let complete;
  let started;
  const pending = new Promise(resolve => started = resolve);
  let calls = 0;
  const handle = createHostedHandler({now: () => now, maxPerMinute: 2, maxKeys: 2, fetchImpl: async () => {
    calls++;
    if (calls === 1) {started(); return new Promise(resolve => complete = () => resolve(success()));}
    return success();
  }});
  const first = handle(post()); await pending;
  assert.equal((await handle(post())).status, 429);
  assert.equal((await handle(post({sdp: 'offer', apiKey: 'visitor-two'}))).status, 201);
  assert.equal((await handle(post({sdp: 'offer', apiKey: 'visitor-three'}))).status, 429);
  complete(); assert.equal((await first).status, 201);
  assert.equal((await handle(post())).status, 201);
  assert.equal((await handle(post())).status, 429);
  now = 60001;
  assert.equal((await handle(post({sdp: 'offer', apiKey: 'visitor-three'}))).status, 201);
});
test('server-funded voice starts share the existing rate limit', async () => {
  let calls = 0;
  const handle = createHostedHandler({maxPerMinute: 1, fetchImpl: async () => {calls++; return success();}});
  const env = {OPENAI_API_KEY: 'shared-test-key'};
  assert.equal((await handle(post({sdp: 'offer'}), env)).status, 201);
  assert.equal((await handle(post({sdp: 'another-offer'}), env)).status, 429);
  assert.equal(calls, 1);
});
test('timeouts/client cancellation abort upstream, release slots, and never retry', async () => {
  let calls = 0;
  let started;
  const pending = new Promise(resolve => started = resolve);
  const handle = createHostedHandler({timeoutMs: 30, fetchImpl: async (_url, {signal}) => {
    calls++; started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('secret-error')), {once: true}));
  }});
  const abort = new AbortController();
  const first = handle(post(undefined, {}, {signal: abort.signal})); await pending; abort.abort();
  assert.equal((await first).status, 502);
  const timed = await handle(post()); assert.equal(timed.status, 502);
  assert.doesNotMatch(await timed.text(), /secret-error/); assert.equal(calls, 2);
  const preAborted = new AbortController(); preAborted.abort();
  assert.equal((await handle(post(undefined, {}, {signal: preAborted.signal}))).status, 408);
  assert.equal(calls, 2);
});
test('provider errors and malformed successes cannot expose keys/provider payloads', async () => {
  for (const status of [401, 403, 429, 302, 500]) {
    let calls = 0;
    const handle = createHostedHandler({fetchImpl: async () => {calls++; return new Response('private-provider-secret', {status});}});
    const response = await handle(post());
    assert.equal(response.status, [401, 403, 429].includes(status) ? status : 502);
    assert.doesNotMatch(await response.text(), /private-provider-secret/); assert.equal(calls, 1);
  }
  for (const result of [{}, {session: {id: ''}, transport: {sdp: 'answer'}}, {session: {id: 'id'}, transport: {sdp: 42}}]) {
    const handle = createHostedHandler({fetchImpl: async () => Response.json(result)});
    assert.equal((await handle(post())).status, 502);
  }
});
test('worker serves assets with microphone headers, blocks private paths and never falls back for APIs', async () => {
  const paths = [];
  const env = {ASSETS: {fetch: async request => {paths.push(new URL(request.url).pathname); return new Response('page', {headers: {'Content-Type': 'text/html'}});}}};
  const handle = createHostedHandler();
  const response = await handle(new Request(origin + '/'), env);
  assert.equal(await response.text(), 'page');
  assert.equal(response.headers.get('permissions-policy'), 'microphone=(self)');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  for (const path of ['/server/index.js', '/client/index.html', '/.env', '/.openai/hosting.json', '/%2esensitive', '/%5cserver']) assert.equal((await handle(new Request(origin + path), env)).status, 404);
  assert.equal((await handle(new Request(origin + '/api/unknown'), env)).status, 404);
  assert.deepEqual(paths, ['/']);
  assert.equal((await handle(new Request(origin + '/'))).status, 503);
});
