import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createEngineCopilotAdapter} from '../dist/engine-copilot.js';
import {createToolDispatcher} from '../dist/copilot-tools.js';
import {ToolLoop} from '../dist/live-session.js';
import {sessionRequest} from '../server/voice-config.mjs';

const knarrevik = JSON.parse(await readFile(new URL('../dist/examples/knarrevik.unfold.json', import.meta.url), 'utf8'));
function fixture() {
  const current = {output: structuredClone(knarrevik), index: -1, page: 1, pdfPageCount: 12, pdfLinked: true, progress: 0, playing: false, currentView: 'guided', viewerAvailable: true, available: true, revision: 0, speed: 1};
  const mutations = [];
  const actions = {
    navigateStep: async index => {mutations.push(['step', index]); Object.assign(current, {index, progress: 0, playing: false, currentView: 'guided'}); if (current.pdfPageCount) Object.assign(current, {page: index < 0 ? 1 : current.output.guide.steps[index].sourcePage, pdfLinked: true});},
    showManualPage: async page => {mutations.push(['page', page]); Object.assign(current, {page, pdfLinked: false});},
    setView: async mode => {mutations.push(['view', mode]); current.currentView = mode;},
    controlPlayback: async action => {mutations.push(['playback', action]); current.playing = action !== 'pause';},
  };
  const app = createEngineCopilotAdapter(() => current, actions);
  return {current, mutations, app, dispatch: createToolDispatcher(app)};
}
function replacement() {
  const output = structuredClone(knarrevik);
  output.guide.productName = 'Replacement table';
  output.guide.summary = 'A different generated table.';
  output.guide.steps = Array.from({length: 18}, (_, i) => ({...structuredClone(output.guide.steps[0]), title: `Replacement step ${i + 1}`, sourcePage: 2}));
  return output;
}
function assertNoPreparedChair(value) {assert.doesNotMatch(JSON.stringify(value), /STRANDMON/i);}

test('engine voice lists the loaded KNARREVIK catalog and reports its actual step context', async () => {
  const f = fixture(), result = await f.dispatch('list_assembly_steps', {});
  assert.equal(result.ok, true); assert.equal(result.product, 'KNARREVIK'); assert.equal(result.appliesToCurrentManual, true);
  assert.deepEqual(result.steps.map(step => step.step), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.steps.slice(1).map(step => [step.title, step.page]), knarrevik.guide.steps.map(step => [step.title, step.sourcePage]));
  assertNoPreparedChair(result);
  let state = f.app.getState();
  assert.equal(state.product, 'KNARREVIK'); assert.equal(state.step, 0); assert.equal(state.guideAvailable, true); assert.equal(state.preparedGuide, false);
  f.current.index = 5; f.current.page = 12; f.current.progress = .65; f.current.playing = true;
  state = (await f.dispatch('get_assembly_state', {})).state;
  assert.equal(state.step, 6); assert.equal(state.title, knarrevik.guide.steps[5].title); assert.equal(state.body, knarrevik.guide.steps[5].instruction);
  assert.equal(state.preparedGuidePage, 12); assert.equal(state.manualPage, 12); assert.equal(state.progress, .65); assert.equal(state.playing, true);
  assertNoPreparedChair(state);
});

test('voice step zero maps to engine overview and step six relinks source page twelve', async () => {
  const f = fixture();
  let result = await f.dispatch('navigate_assembly_step', {step: 6});
  assert.equal(result.ok, true); assert.equal(f.current.index, 5); assert.equal(result.state.step, 6); assert.equal(result.state.manualPage, 12); assert.equal(result.state.linked, true);
  result = await f.dispatch('show_manual_page', {page: 3});
  assert.equal(result.ok, true); assert.equal(f.current.index, 5); assert.equal(result.state.manualPage, 3); assert.equal(result.state.linked, false);
  result = await f.dispatch('navigate_assembly_step', {step: 6});
  assert.equal(result.state.manualPage, 12); assert.equal(result.state.linked, true);
  result = await f.dispatch('navigate_assembly_step', {step: 0});
  assert.equal(result.ok, true); assert.equal(f.current.index, -1); assert.equal(result.state.step, 0); assert.equal(result.state.manualPage, 1);
  const before = f.mutations.length;
  for (const step of [-1, 7, 6.5, '6']) assert.equal((await f.dispatch('navigate_assembly_step', {step})).ok, false);
  assert.equal(f.mutations.length, before);
});

test('engine view capabilities reject underside without mutating while supported views work', async () => {
  const f = fixture();
  assert.deepEqual(f.app.getState().supportedViews, ['guided', 'whole', 'exploded']);
  const rejected = await f.dispatch('set_assembly_view', {mode: 'underside'});
  assert.equal(rejected.ok, false); assert.deepEqual(f.mutations, []); assertNoPreparedChair(rejected);
  for (const mode of ['whole', 'exploded', 'guided']) {
    const result = await f.dispatch('set_assembly_view', {mode});
    assert.equal(result.ok, true); assert.equal(result.state.view, mode);
  }
  f.current.viewerAvailable = false;
  const before = f.mutations.length;
  assert.equal((await f.dispatch('set_assembly_view', {mode: 'whole'})).ok, false);
  assert.equal(f.mutations.length, before);
});

test('catalog and bounds follow guide replacement including generated guides beyond legacy step sixteen', async () => {
  const f = fixture(); await f.dispatch('list_assembly_steps', {});
  f.current.output = replacement(); f.current.revision++;
  const listed = await f.dispatch('list_assembly_steps', {});
  assert.equal(listed.product, 'Replacement table'); assert.equal(listed.steps.length, 19); assert.equal(listed.steps[18].title, 'Replacement step 18');
  const result = await f.dispatch('navigate_assembly_step', {step: 18});
  assert.equal(result.ok, true); assert.equal(f.current.index, 17); assert.equal(result.state.title, 'Replacement step 18');
  assert.equal((await f.dispatch('navigate_assembly_step', {step: 19})).ok, false);
  assertNoPreparedChair(listed);
});

test('unavailable or removed guides expose no stale catalog and never accept assembly actions', async () => {
  const f = fixture();
  for (const hide of [() => {f.current.available = false;}, () => {f.current.available = true; f.current.output = null;}]) {
    hide();
    const listed = await f.dispatch('list_assembly_steps', {}), state = f.app.getState();
    assert.deepEqual(listed.steps, []); assert.equal(listed.product, null); assert.equal(listed.appliesToCurrentManual, false);
    assert.equal(state.product, null); assert.equal(state.guideAvailable, false);
    for (const [tool, input] of [['navigate_assembly_step', {step: 1}], ['set_assembly_view', {mode: 'whole'}], ['control_playback', {action: 'play'}]]) {
      const result = await f.dispatch(tool, input); assert.equal(result.ok, false); assertNoPreparedChair(result);
    }
  }
  assert.deepEqual(f.mutations, []);
  const page = await f.dispatch('show_manual_page', {page: 2});
  assert.equal(page.ok, true); assert.equal(page.state.manualPage, 2);
});

test('a saved guide without its PDF cannot claim a displayed source page or browse it', async () => {
  const f = fixture(); f.current.pdfPageCount = 0; f.current.pdfLinked = false;
  const state = f.app.getState(); assert.equal(state.manualPageCount, 0); assert.equal(state.linked, false);
  assert.equal((await f.dispatch('show_manual_page', {page: 1})).ok, false); assert.deepEqual(f.mutations, []);
  const result = await f.dispatch('navigate_assembly_step', {step: 6});
  assert.equal(result.ok, true); assert.equal(result.state.step, 6); assert.equal(result.state.preparedGuidePage, 12); assert.equal(result.state.linked, false);
});

test('human navigation invalidates pending voice writes while fresh reads remain available', async () => {
  const f = fixture(), revision = f.app.getRevision();
  f.current.index = 2; f.current.page = 9; f.current.revision++;
  const stale = await f.dispatch('navigate_assembly_step', {step: 6}, {revision});
  assert.equal(stale.ok, false); assert.match(stale.error, /user changed/i); assert.equal(stale.state.step, 3); assert.deepEqual(f.mutations, []);
  const read = await f.dispatch('get_assembly_state', {}, {revision});
  assert.equal(read.ok, true); assert.equal(read.state.step, 3);
});

function envelope(type, data = {}) {return {type: 'response.event', delegation_id: 'd1', event: {type, ...data}};}
test('a guide change invalidates already queued voice actions before they execute', async () => {
  for (const nextOutput of [replacement(), null]) {
    const f = fixture(), sent = [];
    const loop = new ToolLoop({dispatch: f.dispatch, getRevision: f.app.getRevision, send: event => sent.push(event), isActive: () => true});
    let release; loop.queue = new Promise(resolve => {release = resolve;});
    loop.handle({type: 'session.delegation.created', delegation: {id: 'd1'}, response_id: 'r1'});
    loop.handle(envelope('response.created', {response: {id: 'r1'}}));
    loop.handle(envelope('response.output_item.done', {item: {type: 'function_call', call_id: 'c1', name: 'navigate_assembly_step', arguments: '{"step":6}'}}));
    loop.handle(envelope('response.completed', {response: {id: 'r1', output: []}}));
    f.current.output = nextOutput; f.current.index = -1; f.current.revision++;
    release(); await loop.queue;
    assert.deepEqual(f.mutations, []); assert.equal(sent.length, 2);
    const result = JSON.parse(sent[0].item.output);
    assert.equal(result.ok, false); assert.match(result.error, /user changed/i);
    assert.equal(result.state.product, nextOutput?.guide.productName ?? null); assertNoPreparedChair(result);
    assert.equal(sent[1].type, 'response.create');
  }
});

test('voice session instructions obtain the active guide through tools without embedding STRANDMON facts', () => {
  const request = sessionRequest('v=0\r\nfixture');
  assertNoPreparedChair(request.session.instructions);
  assertNoPreparedChair(request.session.delegation.responses.instructions);
  assert.match(request.session.delegation.responses.instructions, /list_assembly_steps/);
});
