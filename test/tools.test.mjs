import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolDispatcher, guideCatalog} from '../dist/copilot-tools.js';
import {ToolLoop} from '../dist/live-session.js';

function fixture() {
  let revision = 0;
  const state = {step: 0, manualPage: 1, manualPageCount: 20, linked: true, preparedGuideApplies: true, viewerAvailable: true, view: 'guided', playing: false};
  const mutations = [];
  const app = {getState: () => ({...state}), getRevision: () => revision,
    navigateStep: async step => {mutations.push('step'); Object.assign(state, {step, manualPage: guideCatalog[step].page, linked: true, playing: false});},
    showManualPage: async manualPage => {mutations.push('page'); Object.assign(state, {manualPage, linked: false});},
    setView: async view => {mutations.push('view'); state.view = view;},
    controlPlayback: async action => {mutations.push('playback'); state.playing = action !== 'pause';},
  };
  return {state, mutations, app, dispatch: createToolDispatcher(app), human: () => revision++};
}

test('guide actions report actual state, manual browsing stays independent and step navigation relinks', async () => {
  const f = fixture();
  let r = await f.dispatch('navigate_assembly_step', {step: 3});
  assert.equal(r.state.manualPage, 7); assert.equal(r.state.playing, false);
  r = await f.dispatch('show_manual_page', {page: 12});
  assert.equal(r.state.step, 3); assert.equal(r.state.manualPage, 12); assert.equal(r.state.linked, false);
  r = await f.dispatch('navigate_assembly_step', {step: 11});
  assert.equal(r.state.manualPage, 15); assert.equal(r.state.linked, true);
  assert.equal((await f.dispatch('set_assembly_view', {mode: 'underside'})).state.view, 'underside');
  assert.equal((await f.dispatch('control_playback', {action: 'replay'})).state.playing, true);
  assert.equal((await f.dispatch('list_assembly_steps', {})).steps.length, 17);
});

test('invalid, unknown, stale and inactive calls never mutate', async () => {
  const f = fixture();
  for (const [name, args] of [['navigate_assembly_step', {step: -1}], ['navigate_assembly_step', {step: 17}], ['navigate_assembly_step', {step: 3.2}], ['navigate_assembly_step', {step: '3'}], ['navigate_assembly_step', {step: 2, url: 'https://bad'}], ['show_manual_page', {page: 21}], ['set_assembly_view', {mode: 'camera'}], ['control_playback', {action: 'seek'}], ['get_assembly_state', []], ['get_assembly_state', null], ['get_assembly_state', {x: 1}], ['no_such_tool', {}]]) {
    assert.equal((await f.dispatch(name, args)).ok, false, JSON.stringify([name, args]));
  }
  f.human();
  const stale = await f.dispatch('navigate_assembly_step', {step: 3}, {revision: 0});
  assert.match(stale.error, /user changed/); assert.equal(stale.state.step, 0);
  assert.equal((await f.dispatch('get_assembly_state', {}, {revision: 0})).ok, true);
  assert.equal((await f.dispatch('navigate_assembly_step', {step: 3}, {isActive: () => false})).ok, false);
  assert.deepEqual(f.mutations, []);
});

test('unsupported upload stays local and unrelated; only document browsing is permitted', async () => {
  const f = fixture(); Object.assign(f.state, {preparedGuideApplies: false, manualPageCount: 4, manualPage: 2, linked: false});
  for (const [name, args] of [['navigate_assembly_step', {step: 3}], ['set_assembly_view', {mode: 'whole'}], ['control_playback', {action: 'play'}]]) assert.equal((await f.dispatch(name, args)).ok, false);
  assert.equal((await f.dispatch('list_assembly_steps', {})).appliesToCurrentManual, false);
  assert.equal((await f.dispatch('show_manual_page', {page: 3})).state.manualPage, 3);
  assert.equal(f.state.preparedGuideApplies, false); assert.equal(f.state.step, 0);
  Object.assign(f.state, {preparedGuideApplies: true, viewerAvailable: false});
  assert.match((await f.dispatch('set_assembly_view', {mode: 'whole'})).error, /unavailable/);
});

function envelope(type, data = {}, delegation_id = 'd1') {return {type: 'response.event', delegation_id, event: {type, ...data}};}
function call(id, name = 'navigate_assembly_step', args = '{"step":3}') {return {item: {type: 'function_call', call_id: id, name, arguments: args}};}
test('nested lifecycle collects items despite empty terminal output; all results precede one continuation; duplicates never replay', async () => {
  const f = fixture(), sent = [];
  const loop = new ToolLoop({dispatch: f.dispatch, getRevision: f.app.getRevision, send: e => sent.push(e), isActive: () => true});
  loop.handle({type: 'session.delegation.created', delegation: {id: 'd1', target: 'responses'}, response_id: 'r1'});
  loop.handle(envelope('response.created', {response: {id: 'r1', output: []}}));
  loop.handle(envelope('response.function_call_arguments.done', {arguments: '{"step":9}'}));
  loop.handle(envelope('response.output_item.done', call('c1')));
  loop.handle(envelope('response.output_item.done', call('c1')));
  loop.handle(envelope('response.output_item.done', call('c2', 'show_manual_page', '{"page":8}')));
  assert.deepEqual(f.mutations, []);
  loop.handle(envelope('response.completed', {response: {id: 'r1', output: []}}));
  loop.handle(envelope('response.completed', {response: {id: 'r1', output: []}}));
  await loop.queue;
  assert.deepEqual(f.mutations, ['step', 'page']);
  assert.deepEqual(sent.map(e => e.type), ['response.item.create', 'response.item.create', 'response.create']);
  assert.equal(JSON.parse(sent[1].item.output).state.manualPage, 8);
  assert.deepEqual(sent[2], {type: 'response.create'});
  loop.handle(envelope('response.created', {response: {id: 'r2'}}));
  loop.handle(envelope('response.output_item.done', call('c1')));
  loop.handle(envelope('response.completed', {response: {id: 'r2', output: []}}));
  await loop.queue;
  assert.deepEqual(f.mutations, ['step', 'page']);
  assert.equal(sent[3].item.output, sent[0].item.output);
});

test('delegation revision protects human navigation even before response.created; invalid JSON returns a result', async () => {
  const f = fixture(), sent = [];
  let active = true;
  const loop = new ToolLoop({dispatch: f.dispatch, getRevision: f.app.getRevision, send: e => sent.push(e), isActive: () => active});
  loop.handle({type: 'session.delegation.created', delegation: {id: 'd1'}});
  f.human(); f.state.step = 7;
  loop.handle(envelope('response.created', {response: {id: 'r1'}}));
  loop.handle(envelope('response.output_item.done', call('c1')));
  loop.handle(envelope('response.output_item.done', call('c2', 'get_assembly_state', 'oops')));
  loop.handle(envelope('response.completed', {response: {id: 'r1', output: []}}));
  await loop.queue;
  assert.equal(f.state.step, 7); assert.deepEqual(f.mutations, []);
  assert.match(JSON.parse(sent[0].item.output).error, /user changed/);
  assert.equal(JSON.parse(sent[1].item.output).ok, false);
  active = false;
  loop.handle(envelope('response.created', {response: {id: 'r2'}}));
  loop.handle(envelope('response.output_item.done', call('c3')));
  loop.handle(envelope('response.completed', {response: {id: 'r2'}}));
  await loop.queue; assert.equal(sent.length, 3);
});
