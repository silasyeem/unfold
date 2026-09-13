import {steps} from './steps.js';

const define = (name, description, properties = {}, required = Object.keys(properties)) => ({
  type: 'function', name, description,
  parameters: {type: 'object', properties, required, additionalProperties: false},
  strict: true,
});
export const toolDefinitions = [
  define('get_assembly_state', 'Read current guide, manual compatibility, step, page, view and playback before interpreting a request.'),
  define('list_assembly_steps', 'List the ordered prepared STRANDMON guide; this guide does not apply to unrelated uploaded PDFs.'),
  define('navigate_assembly_step', 'Select a prepared guide step and its matching manual page; pauses animation. Requires a compatible manual.', {step: {type: 'integer', minimum: 0, maximum: 16}}),
  define('show_manual_page', 'Browse a page in the current document without changing the assembly step or replacing the document.', {page: {type: 'integer', minimum: 1}}),
  define('set_assembly_view', 'Reveal the 3D guide using the requested camera or exploded view.', {mode: {type: 'string', enum: ['guided', 'whole', 'underside', 'exploded']}}),
  define('control_playback', 'Play, pause or replay the current prepared guide animation.', {action: {type: 'string', enum: ['play', 'pause', 'replay']}}),
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
      if (name === 'list_assembly_steps') return {ok: true, product: 'STRANDMON', appliesToCurrentManual: state().preparedGuideApplies, steps: guideCatalog};
      if (revision !== undefined && revision !== app.getRevision()) return fail('The user changed the app while this request was pending. Read the fresh state and ask before overriding their selection.');
      const current = state();
      if (name !== 'show_manual_page' && !current.preparedGuideApplies) return fail('This uploaded PDF has no prepared guide. STRANDMON instructions do not apply. The user must explicitly restore the example using the app.');
      if (name === 'show_manual_page' && input.page > current.manualPageCount) return fail('Page is outside the current document.');
      if (name === 'set_assembly_view' && !current.viewerAvailable) return fail('The 3D viewer is unavailable in this browser.');
      if (!isActive()) return fail('Voice session has ended.');
      switch (name) {
        case 'navigate_assembly_step': await app.navigateStep(input.step); break;
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
