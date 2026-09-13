import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCopilot} from '../dist/copilot-ui.js';

class Element extends EventTarget {
  constructor() {super(); this.children = []; this.attributes = {}; this.hidden = false; this.dataset = {}; this.classes = new Set(); this.classList = {toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name)};}
  textContent = '';
  value = '';
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children = children;}
  setAttribute(key, value) {this.attributes[key] = value;}
  scrollIntoView() {this.scrolled = true;}
  focus() {this.focused = true;}
  click() {this.dispatchEvent(new Event('click'));}
}
test('nonmodal UI retains active indicator/End while collapsed and bounds safe text transcript', t => {
  const originalDocument = globalThis.document, originalAdd = globalThis.addEventListener;
  const elements = new Map();
  const element = selector => {if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector);};
  globalThis.document = {querySelector: element, createElement: () => new Element(), body: new Element()};
  const listeners = new Map();
  globalThis.addEventListener = (name, listener) => listeners.set(name, listener);
  t.after(() => {globalThis.document = originalDocument; globalThis.addEventListener = originalAdd;});
  element('#copilot-panel').hidden = true;
  const session = mountCopilot({dispatch: async () => ({ok: true}), getRevision: () => 0, getState: () => ({step: 3})});
  assert.equal(session.current, null);
  const starts = []; session.start = input => starts.push(input);
  element('#copilot-api-key').value = '  private-test-key  ';
  element('#copilot-start').click();
  assert.equal(element('#copilot-api-key').value, '');
  assert.deepEqual(starts, [{apiKey: 'private-test-key'}]);
  element('#copilot-start').click(); assert.deepEqual(starts[1], {apiKey: ''});
  element('#copilot-toggle').click(); assert.equal(element('#copilot-panel').hidden, false); assert.equal(element('#copilot-panel').scrolled, true);
  session.onStatus({state: 'connected', message: 'Connected', muted: false});
  assert.equal(element('#copilot-indicator').textContent, '● Live'); assert.equal(element('#copilot-quick-end').hidden, false);
  assert.equal(document.body.classes.has('has-active-voice'), true);
  assert.equal(element('#copilot-api-key').disabled, true);
  assert.doesNotMatch(element('#copilot-status').textContent, /private-test-key/);
  element('#copilot-collapse').click(); assert.equal(element('#copilot-panel').hidden, true); assert.equal(element('#copilot-toggle').focused, true);
  assert.equal(element('#copilot-quick-end').hidden, false);
  let ended = 0; session.end = () => ended++;
  element('#copilot-quick-end').click(); assert.equal(ended, 1);
  session.onTranscript({speaker: 'Guide', text: '<script>bad</script>', start: 0, end: 5});
  assert.equal(element('#copilot-transcript').children[0].children[1].textContent, '<script>bad</script>');
  for (let i = 0; i < 100; i++) session.onTranscript({speaker: i % 2 ? 'Guide' : 'You', text: 'x'.repeat(1000), start: 100 + i * 100, end: 101 + i * 100});
  const rows = element('#copilot-transcript').children;
  assert.ok(rows.length <= 24); assert.ok(rows.reduce((sum, row) => sum + row.children[1].textContent.length, 0) <= 12000);
  session.onStatus({state: 'ended', message: 'Ended', muted: false});
  assert.equal(document.body.classes.has('has-active-voice'), false); assert.equal(element('#copilot-quick-end').hidden, true);
  assert.equal(element('#copilot-api-key').disabled, false);
  element('#copilot-api-key').value = 'another-test-key';
  listeners.get('pagehide')(); assert.equal(element('#copilot-api-key').value, '');
});
