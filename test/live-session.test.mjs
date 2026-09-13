import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSession} from '../dist/live-session.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
class Events extends EventTarget {
  emit(type, properties = {}) {const event = new Event(type); Object.assign(event, properties); this.dispatchEvent(event);}
}
class Channel extends Events {
  readyState = 'open'; sent = [];
  send(data) {this.sent.push(JSON.parse(data));}
  close() {this.readyState = 'closed'; this.emit('close');}
  message(value) {this.emit('message', {data: JSON.stringify(value)});}
}
class Peer extends Events {
  iceGatheringState = 'complete'; connectionState = 'new'; tracks = []; closed = false;
  addTrack(track) {this.tracks.push(track);}
  createDataChannel(label) {assert.equal(label, 'oai-events'); this.channel = new Channel(); return this.channel;}
  async createOffer() {assert.ok(this.channel); assert.equal(this.tracks.length, 1); return {type: 'offer', sdp: 'offer-before-ice'};}
  async setLocalDescription(offer) {this.localDescription = {...offer, sdp: 'gathered-offer'};}
  async setRemoteDescription(answer) {this.answer = answer;}
  close() {this.closed = true; this.connectionState = 'closed'; this.emit('connectionstatechange');}
}
function fixture(overrides = {}) {
  let requests = [], status = [], transcripts = [], mutations = 0, micRequests = 0, blocked = 0, revision = 0;
  const track = {enabled: true, stopped: false, stop() {this.stopped = true;}};
  const stream = {getTracks: () => [track], getAudioTracks: () => [track]};
  const audio = {srcObject: null, pauses: 0, pause() {this.pauses++;}, async play() {}};
  const session = new LiveSession({
    dispatch: async () => {mutations++; return {ok: true};}, getRevision: () => revision, getState: () => ({step: 3, manualMode: 'prepared-strandmon'}),
    onStatus: event => status.push(event), onTranscript: event => transcripts.push(event), onAudioBlocked: () => blocked++,
    fetchImpl: async (url, options) => {requests.push({url, options}); return {ok: true, json: async () => url.includes('readiness') ? {ready: true} : {session: {id: 'live_opaque'}, transport: {sdp: 'answer'}}};},
    mediaDevices: {getUserMedia: async () => {micRequests++; return stream;}}, Peer, Stream: class {constructor(tracks) {this.tracks = tracks;}}, audio,
    closeTimeoutMs: 10, connectTimeoutMs: 500, ...overrides,
  });
  return {session, requests, status, transcripts, track, stream, audio, mutations: () => mutations, micRequests: () => micRequests, blocked: () => blocked, human: () => revision++};
}

test('correct WebRTC offer flow, no legacy commands, no actions before session.started; navigation keeps the connection', async () => {
  const f = fixture(); await f.session.start();
  const run = f.session.current;
  assert.equal(f.session.state, 'starting');
  assert.equal(f.requests[1].options.body, JSON.stringify({sdp: 'gathered-offer'}));
  assert.deepEqual(run.peer.answer, {type: 'answer', sdp: 'answer'});
  assert.deepEqual(run.channel.sent, []);
  run.channel.message({type: 'session.output_transcript.delta', delta: 'before start'});
  assert.equal(f.transcripts.length, 0);
  run.channel.message({type: 'session.started', session: {id: 'live_opaque'}});
  assert.equal(f.session.state, 'connected');
  assert.equal(run.channel.sent[0].type, 'session.thinking.append');
  const nested = event => run.channel.message({type: 'response.event', delegation_id: 'd1', event});
  nested({type: 'response.created', response: {id: 'r1'}});
  nested({type: 'response.output_item.done', item: {type: 'function_call', name: 'navigate_assembly_step', arguments: '{"step":7}', call_id: 'c1'}});
  nested({type: 'response.completed', response: {id: 'r1', output: []}});
  await run.loop.queue;
  assert.equal(f.mutations(), 1); assert.equal(f.session.current, run); assert.equal(run.peer.closed, false);
  run.channel.message({type: 'session.input_transcript.delta', delta: '<img onerror=oops>', start_ms: 0, end_ms: 20});
  assert.equal(f.transcripts[0].text, '<img onerror=oops>');
  run.channel.message(null); run.channel.message(3); run.channel.emit('message', {data: 'not json'});
  f.session.dispose();
});

test('double start has one mic/session request; mute and graceful End disable input and block late actions', async () => {
  const f = fixture(); await Promise.all([f.session.start(), f.session.start()]);
  assert.equal(f.micRequests(), 1); assert.equal(f.requests.length, 2);
  const run = f.session.current;
  run.channel.message({type: 'session.started'});
  f.session.mute(); assert.equal(f.track.enabled, false); assert.equal(f.session.state, 'muted');
  f.session.mute(); assert.equal(f.track.enabled, true);
  f.session.end();
  assert.equal(f.session.state, 'ending'); assert.equal(f.track.enabled, false); assert.ok(f.audio.pauses > 0);
  assert.equal(run.peer.closed, false); assert.equal(run.channel.sent.at(-1).type, 'session.close');
  run.channel.message({type: 'session.output_transcript.delta', delta: 'late'});
  assert.equal(f.transcripts.length, 0);
  run.channel.message({type: 'session.closed'});
  assert.equal(f.session.state, 'ended'); assert.equal(f.track.stopped, true); assert.equal(run.peer.closed, true); assert.equal(f.audio.srcObject, null);
});

test('End during pending microphone releases late stream and cannot create a paid session', async () => {
  const mic = deferred(); const f = fixture({mediaDevices: {getUserMedia: () => mic.promise}});
  const starting = f.session.start(); await delay(0);
  f.session.end(); assert.equal(f.session.state, 'ended');
  mic.resolve(f.stream); await starting;
  assert.equal(f.track.stopped, true); assert.equal(f.requests.length, 1); assert.equal(f.session.current, null);
});

test('End aborts pending session fetch and stale completion/events cannot overwrite restarted state', async () => {
  const pending = deferred(); let capturedSignal;
  const f = fixture({fetchImpl: async (url, options) => {
    if (url.includes('readiness')) return {ok: true, json: async () => ({ready: true})};
    capturedSignal = options.signal; return pending.promise;
  }});
  const starting = f.session.start(); await delay(0);
  const old = f.session.current; f.session.end();
  assert.equal(capturedSignal.aborted, true);
  old.channel.message({type: 'session.closed'});
  f.session.fetchImpl = async url => ({ok: true, json: async () => url.includes('readiness') ? {ready: true} : {session: {id: 'new'}, transport: {sdp: 'new-answer'}}});
  await f.session.start(); const current = f.session.current;
  current.channel.message({type: 'session.started'});
  pending.resolve({ok: true, json: async () => ({session: {id: 'old'}, transport: {sdp: 'old-answer'}})});
  await starting;
  old.channel.message({type: 'session.closed'}); old.channel.message({type: 'session.started'});
  assert.equal(f.session.current, current); assert.equal(f.session.state, 'connected'); assert.equal(old.peer.answer, undefined);
  f.session.dispose();
});

test('missing key/static host stop before mic; permission failures are recoverable', async () => {
  for (const fetchImpl of [async () => ({ok: true, json: async () => ({ready: false})}), async () => ({ok: false, json: async () => {throw new Error();}})]) {
    const f = fixture({fetchImpl}); await f.session.start();
    assert.equal(f.session.state, 'error'); assert.equal(f.micRequests(), 0); assert.equal(f.session.current, null);
  }
  const f = fixture({mediaDevices: {getUserMedia: async () => {const e = new Error(); e.name = 'NotAllowedError'; throw e;}}});
  await f.session.start(); assert.match(f.status.at(-1).message, /denied/); assert.equal(f.session.current, null);
  const unsupported = fixture({Peer: null}); await unsupported.session.start(); assert.match(unsupported.status.at(-1).message, /WebRTC/);
});

test('ICE cancellation and timeout release tracks; failed API creation cleans up', async () => {
  class Gathering extends Peer {iceGatheringState = 'gathering';}
  const f = fixture({Peer: Gathering}); const starting = f.session.start(); await delay(0); f.session.end();
  await starting; await delay(15); assert.equal(f.track.stopped, true); assert.equal(f.requests.length, 1);
  const timeout = fixture({Peer: Gathering, iceTimeoutMs: 5}); await timeout.session.start();
  assert.equal(timeout.session.state, 'error'); assert.equal(timeout.track.stopped, true);
  const failure = fixture({fetchImpl: async url => url.includes('readiness') ? {ok: true, json: async () => ({ready: true})} : {ok: false, status: 502}});
  await failure.session.start(); assert.equal(failure.session.state, 'error'); assert.equal(failure.track.stopped, true);
});

test('autoplay fallback, data/peer errors, session errors and close timeout all recover', async () => {
  const f = fixture(); f.audio.play = async () => {throw new Error('autoplay');};
  await f.session.start(); const run = f.session.current;
  run.peer.emit('track', {track: {kind: 'audio'}, streams: []}); await delay(0);
  assert.equal(f.blocked(), 1);
  run.channel.message({type: 'session.started'}); f.session.end(); await delay(20);
  assert.equal(f.session.state, 'ended'); assert.equal(run.peer.closed, true); assert.match(f.status.at(-1).message, /not received/);
  for (const trigger of [r => r.channel.close(), r => r.channel.message({type: 'error', message: 'secret upstream details'}), r => {r.peer.connectionState = 'failed'; r.peer.emit('connectionstatechange');}]) {
    const g = fixture(); await g.session.start(); trigger(g.session.current);
    assert.equal(g.session.state, 'error'); assert.equal(g.track.stopped, true); assert.doesNotMatch(g.status.at(-1).message, /secret/);
  }
});

test('entered key starts without server key; key is sent only in one creation request and not retained for the next start', async () => {
  const requests = [];
  const f = fixture({fetchImpl: async (url, options) => {
    requests.push({url, options});
    return {ok: true, json: async () => url.includes('readiness') ? {ready: false, acceptsClientKey: true} : {session: {id: 'live_client_key'}, transport: {sdp: 'answer'}}};
  }});
  await f.session.start({apiKey: ' client-test-key '});
  assert.equal(requests.length, 2); assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(JSON.parse(requests[1].options.body), {sdp: 'gathered-offer', apiKey: 'client-test-key'});
  const run = f.session.current; run.channel.message({type: 'session.started'});
  assert.doesNotMatch(JSON.stringify(run.channel.sent), /client-test-key/);
  assert.doesNotMatch(JSON.stringify(f.status), /client-test-key/);
  assert.equal(f.session.apiKey, undefined); assert.equal(run.apiKey, undefined);
  f.session.dispose(); await f.session.start();
  assert.equal(f.session.state, 'error'); assert.equal(f.micRequests(), 1);
  assert.equal(requests.length, 3); assert.match(f.status.at(-1).message, /Enter your OpenAI API key/);
});

test('entered keys cannot bypass static/old-server readiness; blank key retains environment fallback', async () => {
  for (const readiness of [{ok: false, json: async () => ({})}, {ok: true, json: async () => ({ready: false})}, {ok: true, json: async () => ({ready: true})}]) {
    const f = fixture({fetchImpl: async () => readiness});
    await f.session.start({apiKey: 'client-test-key'});
    assert.equal(f.session.state, 'error'); assert.equal(f.micRequests(), 0);
    assert.match(f.status.at(-1).message, /local Unfold server/);
    assert.match(f.status.at(-1).message, /Re-enter your API key/);
  }
  const f = fixture(); await f.session.start({apiKey: '   '});
  assert.deepEqual(JSON.parse(f.requests[1].options.body), {sdp: 'gathered-offer'}); f.session.dispose();
});

test('provider rejection never reads upstream detail and asks for key reentry', async () => {
  let reads = 0;
  const f = fixture({fetchImpl: async url => url.includes('readiness') ? {ok: true, json: async () => ({ready: false, acceptsClientKey: true})} : {ok: false, status: 401, json: async () => {reads++; return {error: 'private-test-key'};}}});
  await f.session.start({apiKey: 'private-test-key'});
  assert.equal(f.session.state, 'error'); assert.equal(f.track.stopped, true);
  assert.match(f.status.at(-1).message, /rejected the API key/); assert.match(f.status.at(-1).message, /Re-enter/);
  assert.doesNotMatch(JSON.stringify(f.status), /private-test-key/); assert.equal(reads, 0);
});

test('cancelling a keyed start before mic resolves does not reuse its key on restart', async () => {
  const mic = deferred(), requests = [];
  const f = fixture({mediaDevices: {getUserMedia: () => mic.promise}, fetchImpl: async (url, options) => {
    requests.push({url, options}); return {ok: true, json: async () => ({ready: false, acceptsClientKey: true})};
  }});
  const starting = f.session.start({apiKey: 'cancelled-test-key'}); await delay(0);
  f.session.end(); await f.session.start();
  assert.equal(f.session.state, 'error');
  mic.resolve(f.stream); await starting;
  assert.equal(f.track.stopped, true); assert.equal(requests.length, 2);
  assert.ok(requests.every(({url, options}) => url.includes('readiness') && options.body === undefined));
  assert.doesNotMatch(JSON.stringify(f.status), /cancelled-test-key/);
});
