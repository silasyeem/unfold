import {steps} from './steps.js';

const define = (name, description, properties = {}, required = Object.keys(properties)) => ({
  type: 'function', name, description,
  parameters: {type: 'object', properties, required, additionalProperties: false},
  strict: true,
});
export const toolDefinitions = [
  define('get_assembly_state', 'Read the current guide, manual compatibility, step, page, view and playback for questions or clarification. Clear navigation requests can call a navigation tool directly.'),
  define('list_assembly_steps', 'Read the currently loaded guide and its ordered instructions. Step 0 is the overview; never reuse another product’s catalog.'),
  define('navigate_assembly_step', 'Immediately select a requested assembly step and its linked manual page; pauses animation. Use only when the user asks to move to that step, not when they merely mention or ask about it. Validates the current guide without a preliminary lookup. Step 0 is the overview.', {step: {type: 'integer', minimum: 0, maximum: 32}}),
  define('navigate_relative_step', 'Immediately move to the next or previous assembly step when the user requests navigation. Resolves the destination from the live current step without a preliminary lookup. Questions about what happens next or references to a previous step do not request navigation. Stops at guide boundaries.', {direction: {type: 'string', enum: ['next', 'previous']}}),
  define('show_manual_page', 'Browse a page in the current document without changing the assembly step or replacing the document.', {page: {type: 'integer', minimum: 1}}),
  define('set_assembly_view', 'Reveal the 3D guide using the requested camera or exploded view.', {mode: {type: 'string', enum: ['guided', 'whole', 'underside', 'exploded']}}),
  define('control_playback', 'Play, pause or replay the currently loaded guide animation.', {action: {type: 'string', enum: ['play', 'pause', 'replay']}}),
];

export const guideCatalog = steps.map((s, step) => ({step, title: s.title, body: s.body, parts: s.parts, page: s.page}));

// Only explicit app callbacks may mutate state. No selectors, URLs or model code.
export function createToolDispatcher(app) {
  return async function dispatch(name, input, {revision, isActive = () => true} = {}) {
    const state = () => app.getState();
    const fail = error => ({ok: false, error, state: state()});
    try {
      if (!isActive()) return fail('Voice session has ended.');
      const definition = toolDefinitions.find(tool => tool.name === name);
      if (!definition) return fail('Unknown tool.');
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('Arguments must be an object.');
      const schema = definition.parameters;
      if (Object.keys(input).some(key => !Object.hasOwn(schema.properties, key)) || schema.required.some(key => !Object.hasOwn(input, key))) return fail('Unexpected or missing arguments.');
      for (const [key, rule] of Object.entries(schema.properties)) {
        const value = input[key];
        if ((rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || (rule.maximum !== undefined && value > rule.maximum))) || (rule.type === 'string' && (!rule.enum.includes(value)))) return fail('Invalid ' + key + '.');
      }
      if (name === 'get_assembly_state') return {ok: true, state: state()};
      const available = current => current.guideAvailable ?? current.preparedGuideApplies;
      const catalog = () => available(state()) ? (app.listSteps?.() ?? guideCatalog) : [];
      if (name === 'list_assembly_steps') {const current=state();return {ok: true, product: current.product ?? (available(current)?'STRANDMON':null), appliesToCurrentManual: Boolean(available(current)), steps: catalog()};}
      if (revision !== undefined && revision !== app.getRevision()) return fail('The user changed the app while this request was pending. Read the fresh state and ask before overriding their selection.');
      const current = state();
      if (name !== 'show_manual_page' && !available(current)) return fail('No assembly guide is currently available. Ask the user to open or return to a guide; do not apply a previous product’s instructions.');
      if (name === 'navigate_assembly_step' && !catalog().some(entry=>entry.step===input.step)) return fail('Step is outside the current guide. Read list_assembly_steps for valid steps.');
      let relativeStep;
      if (name === 'navigate_relative_step') {
        const entries = catalog(), position = entries.findIndex(entry => entry.step === current.step);
        if (position < 0) return fail('The current step is unavailable in this guide. Read the fresh state before retrying.');
        relativeStep = entries[position + (input.direction === 'next' ? 1 : -1)];
        if (!relativeStep) return fail(input.direction === 'next' ? 'You are already at the last step.' : 'You are already at the overview.');
      }
      if (name === 'show_manual_page' && input.page > current.manualPageCount) return fail('Page is outside the current document.');
      if (name === 'set_assembly_view' && !current.viewerAvailable) return fail('The 3D viewer is unavailable in this browser.');
      if (name === 'set_assembly_view' && current.supportedViews && !current.supportedViews.includes(input.mode)) return fail('That view is unavailable for this guide. Choose one of: '+current.supportedViews.join(', ')+'.');
      if (!isActive()) return fail('Voice session has ended.');
      switch (name) {
        case 'navigate_assembly_step': await app.navigateStep(input.step); break;
        case 'navigate_relative_step': await app.navigateStep(relativeStep.step); break;
        case 'show_manual_page': await app.showManualPage(input.page); break;
        case 'set_assembly_view': await app.setView(input.mode); break;
        case 'control_playback': await app.controlPlayback(input.action); break;
      }
      return {ok: true, state: state()};
    } catch {
      return fail('The app could not complete this action. Check the current state before retrying.');
    }
  };
}
