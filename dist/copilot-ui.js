import {LiveSession} from './live-session.js';

export function mountCopilot({dispatch, getRevision, getState}) {
  const $ = selector => document.querySelector(selector);
  const panel = $('#copilot-panel');
  const toggle = $('#copilot-toggle');
  const transcript = $('#copilot-transcript');
  const audio = $('#copilot-audio');
  let entries = [];
  function renderTranscript(delta) {
    const last = entries.at(-1);
    if (last && last.speaker === delta.speaker && (!Number.isFinite(delta.start) || !Number.isFinite(last.end) || delta.start - last.end < 2500)) {
      last.text = (last.text + delta.text).slice(-3000); last.end = delta.end;
    } else entries.push({...delta, text: delta.text.slice(-3000)});
    entries = entries.slice(-24);
    let size = entries.reduce((sum, entry) => sum + entry.text.length, 0);
    while (size > 12000 && entries.length > 1) size -= entries.shift().text.length;
    transcript.replaceChildren(...entries.map(entry => {
      const p = document.createElement('p');
      const who = document.createElement('strong'); who.textContent = entry.speaker + ': ';
      const text = document.createElement('span'); text.textContent = entry.text;
      p.append(who, text); return p;
    }));
    transcript.scrollTop = transcript.scrollHeight;
  }
  const session = new LiveSession({dispatch, getRevision, getState, audio,
    onTranscript: renderTranscript,
    onAudioBlocked: () => {audio.hidden = false; $('#copilot-audio-note').hidden = false;},
    onStatus: ({state, message, muted}) => {
      $('#copilot-status').textContent = message;
      const active = ['connected', 'muted'].includes(state);
      const busy = active || ['starting', 'ending'].includes(state);
      $('#copilot-start').disabled = busy;
      $('#copilot-api-key').disabled = busy;
      $('#copilot-mute').disabled = !active;
      $('#copilot-mute').textContent = muted ? 'Unmute' : 'Mute';
      $('#copilot-mute').setAttribute('aria-pressed', String(muted));
      $('#copilot-end').disabled = !busy || state === 'ending';
      $('#copilot-indicator').textContent = state === 'connected' ? '● Live' : state === 'muted' ? '● Muted' : state === 'starting' ? 'Connecting' : state === 'ending' ? 'Ending' : '';
      toggle.classList.toggle('voice-active', busy);
      document.body.classList.toggle('has-active-voice', busy);
      $('#copilot-quick-end').hidden = !busy;
      $('#copilot-quick-end').disabled = state === 'ending';
      panel.dataset.state = state;
    },
  });
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) panel.scrollIntoView({block: 'start', behavior: 'auto'});
  });
  $('#copilot-collapse').addEventListener('click', () => {panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus();});
  $('#copilot-start').addEventListener('click', () => {
    entries = []; transcript.replaceChildren(); audio.hidden = true; $('#copilot-audio-note').hidden = true;
    const apiKey = $('#copilot-api-key').value.trim();
    $('#copilot-api-key').value = '';
    session.start({apiKey});
  });
  $('#copilot-mute').addEventListener('click', () => session.mute());
  $('#copilot-end').addEventListener('click', () => session.end());
  $('#copilot-quick-end').addEventListener('click', () => session.end());
  addEventListener('pagehide', () => {$('#copilot-api-key').value = ''; session.dispose();});
  return session;
}
