// GPT-Live Responses delegation: collect completed items, then return all results
// before one continuation. A terminal response snapshot intentionally has no items.
export class ToolLoop {
  constructor({dispatch, getRevision, send, isActive}) {
    Object.assign(this, {dispatch, getRevision, send, isActive});
    this.delegations = new Map();
    this.responses = new Map();
    this.calls = new Map();
    this.queue = Promise.resolve();
  }
  handle(envelope) {
    if (!this.isActive()) return;
    if (envelope.type === 'session.delegation.created') {
      const id = envelope.delegation?.id ?? envelope.delegation_id;
      if (id && !this.delegations.has(id)) this.delegations.set(id, {revision: this.getRevision(), responseId: envelope.response_id ?? envelope.delegation?.response_id});
      return;
    }
    if (envelope.type !== 'response.event' || !envelope.event) return;
    const event = envelope.event;
    const delegationId = envelope.delegation_id;
    if (!delegationId) return;
    if (!this.delegations.has(delegationId)) this.delegations.set(delegationId, {revision: this.getRevision()});
    const delegation = this.delegations.get(delegationId);
    if (event.type === 'response.created') {
      const id = event.response?.id;
      if (!id) return;
      delegation.responseId = id;
      if (!this.responses.has(id)) this.responses.set(id, {delegationId, revision: delegation.revision, items: [], complete: false});
      return;
    }
    const id = event.response?.id ?? event.response_id ?? delegation.responseId;
    const response = this.responses.get(id);
    if (!response || response.delegationId !== delegationId || response.complete) return;
    if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') {
      const call = event.item;
      if (typeof call.call_id !== 'string' || !call.call_id || response.items.some(item => item.call_id === call.call_id)) return;
      response.items.push(call);
    }
    if (event.type === 'response.failed' || event.type === 'response.cancelled' || event.type === 'response.incomplete') response.complete = true;
    if (event.type !== 'response.completed') return;
    response.complete = true;
    this.queue = this.queue.then(async () => {
      const results = [];
      for (const item of response.items) {
        if (!this.isActive()) return;
        // A repeated call ID is never replayed, even in another response.
        if (this.calls.has(item.call_id)) {
          results.push({type: 'function_call_output', call_id: item.call_id, output: this.calls.get(item.call_id)});
          continue;
        }
        let result;
        try {
          const args = JSON.parse(item.arguments);
          result = await this.dispatch(item.name, args, {revision: response.revision, isActive: this.isActive});
        } catch {result = {ok: false, error: 'Invalid tool arguments or failed action.'};}
        const output = JSON.stringify(result);
        this.calls.set(item.call_id, output);
        results.push({type: 'function_call_output', call_id: item.call_id, output});
      }
      if (!this.isActive() || !results.length) return;
      for (const item of results) this.send({type: 'response.item.create', item});
      this.send({type: 'response.create'});
    }).catch(() => {});
  }
}

function gatherIce(peer, signal, timeoutMs) {
  if (signal.aborted) return Promise.reject(new Error('Cancelled'));
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancelled);
      peer.removeEventListener('icegatheringstatechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {if (peer.iceGatheringState === 'complete') finish();};
    const cancelled = () => finish(new Error('Cancelled'));
    const timer = setTimeout(() => finish(new Error('Connection timed out. Try again.')), timeoutMs);
    signal.addEventListener('abort', cancelled, {once: true});
    peer.addEventListener('icegatheringstatechange', changed);
    changed();
  });
}

export class LiveSession {
  constructor({dispatch, getRevision, getState, onStatus = () => {}, onTranscript = () => {}, onAudioBlocked = () => {},
    fetchImpl = globalThis.fetch?.bind(globalThis), mediaDevices = globalThis.navigator?.mediaDevices,
    Peer = globalThis.RTCPeerConnection, Stream = globalThis.MediaStream, audio,
    closeTimeoutMs = 3000, connectTimeoutMs = 25000, iceTimeoutMs = 10000} = {}) {
    Object.assign(this, {dispatch, getRevision, getState, onStatus, onTranscript, onAudioBlocked, fetchImpl, mediaDevices, Peer, Stream, audio, closeTimeoutMs, connectTimeoutMs, iceTimeoutMs});
    this.state = 'ended';
    this.generation = 0;
    this.current = null;
  }
  status(state, message) {this.state = state; this.onStatus({state, message, muted: Boolean(this.current?.muted)});}
  owns(run) {return this.current === run && this.generation === run.generation;}
  active(run) {return this.owns(run) && !run.ending && run.ready;}
  send(run, event) {
    if (!this.owns(run) || run.channel?.readyState !== 'open') return;
    run.channel.send(JSON.stringify(event));
  }
  async start({apiKey = ''} = {}) {
    if (this.current) return;
    apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const enteredKey = Boolean(apiKey);
    let requestBody = '';
    const run = {generation: ++this.generation, abort: new AbortController(), ready: false, ending: false, muted: false};
    const forgetKey = () => {apiKey = ''; requestBody = '';};
    run.abort.signal.addEventListener('abort', forgetKey, {once: true});
    this.current = run;
    this.status('starting', 'Checking voice connection…');
    try {
      if (!this.Peer || !this.mediaDevices?.getUserMedia) throw new Error('Voice requires a browser with WebRTC and microphone support on localhost or HTTPS.');
      run.connectTimer = setTimeout(() => this.fail(run, 'Voice connection timed out. Try starting again.'), this.connectTimeoutMs);
      const readiness = await this.fetchImpl('/api/voice/readiness', {signal: run.abort.signal});
      if (!this.owns(run) || run.ending) return;
      let config;
      try {config = await readiness.json();} catch {}
      if (!readiness.ok || typeof config?.ready !== 'boolean') throw new Error('Voice needs the local Unfold server. Run npm start and open its localhost address.');
      if (enteredKey && config.acceptsClientKey !== true) throw new Error('This server cannot accept an entered key. Run the updated local Unfold server with npm start.');
      if (!config.ready && !enteredKey) throw new Error('Enter your OpenAI API key above, or set OPENAI_API_KEY on the local server, then start again.');
      this.status('starting', 'Allow microphone access to start voice…');
      const microphone = await this.mediaDevices.getUserMedia({audio: true});
      if (!this.owns(run) || run.ending) {microphone.getTracks().forEach(track => track.stop()); return;}
      run.microphone = microphone;
      run.peer = new this.Peer();
      run.peer.addEventListener('track', event => {
        if (!this.owns(run) || run.ending) return;
        this.audio.srcObject = event.streams?.[0] ?? new this.Stream([event.track]);
        Promise.resolve(this.audio.play()).catch(() => {if (this.owns(run) && !run.ending) this.onAudioBlocked();});
      });
      run.peer.addEventListener('connectionstatechange', () => {
        if (this.owns(run) && ['failed', 'disconnected', 'closed'].includes(run.peer.connectionState)) this.fail(run, 'Voice disconnected. Start again when you are ready.');
      });
      for (const track of microphone.getAudioTracks()) run.peer.addTrack(track, microphone);
      run.channel = run.peer.createDataChannel('oai-events');
      run.loop = new ToolLoop({dispatch: this.dispatch, getRevision: this.getRevision, isActive: () => this.active(run), send: event => this.send(run, event)});
      run.channel.addEventListener('message', ({data}) => this.receive(run, data));
      run.channel.addEventListener('close', () => {if (this.owns(run)) this.fail(run, 'Voice connection closed. Start again when you are ready.');});
      run.channel.addEventListener('error', () => this.fail(run, 'Voice data connection failed. Try again.'));
      this.status('starting', 'Connecting voice…');
      await run.peer.setLocalDescription(await run.peer.createOffer());
      if (!this.owns(run) || run.ending) return;
      await gatherIce(run.peer, run.abort.signal, this.iceTimeoutMs);
      if (!this.owns(run) || run.ending) return;
      const sdp = run.peer.localDescription?.sdp;
      if (!sdp) throw new Error('Could not prepare a voice connection. Try again.');
      requestBody = JSON.stringify(apiKey ? {sdp, apiKey} : {sdp});
      apiKey = ''; // Only the single in-flight creation request needs this value.
      const pendingCreation = this.fetchImpl('/api/voice/session', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: requestBody, signal: run.abort.signal});
      requestBody = '';
      const response = await pendingCreation;
      if (!this.owns(run) || run.ending) return;
      if (!response.ok) throw new Error(response.status === 401 ? 'OpenAI rejected the API key. Check the key and try again.' : response.status === 403 ? 'Voice access was denied. Check this key’s project and model access.' : response.status === 429 ? 'Voice is rate limited or has insufficient quota. Check API billing and wait before trying again.' : 'Voice connection failed. Check the key and local server configuration, then try again.');
      const result = await response.json();
      if (!this.owns(run) || run.ending) return;
      if (typeof result.session?.id !== 'string' || typeof result.transport?.sdp !== 'string') throw new Error('The voice server returned an invalid connection. Try again.');
      run.sessionId = result.session.id;
      await run.peer.setRemoteDescription({type: 'answer', sdp: result.transport.sdp});
    } catch (error) {
      if (this.owns(run) && !run.ending) this.fail(run, (error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser, then start again.' : error.name === 'NotFoundError' ? 'No microphone was found. Connect one and try again.' : error.message || 'Voice could not start. Try again.') + (enteredKey ? ' Re-enter your API key for another attempt.' : ''));
    } finally {
      forgetKey();
      run.abort.signal.removeEventListener('abort', forgetKey);
    }
  }
  receive(run, data) {
    if (!this.owns(run)) return;
    let event;
    try {event = JSON.parse(data);} catch {return;}
    if (!event || typeof event !== 'object') return;
    if (event.type === 'session.closed') {
      this.cleanup(run);
      this.status('ended', 'Voice ended. Your assembly progress is saved in this page.');
      return;
    }
    if (run.ending) return;
    if (event.type === 'error') {this.fail(run, 'The voice service reported an error. Ended this connection; you can try again.'); return;}
    if (event.type === 'session.started') {
      clearTimeout(run.connectTimer);
      run.ready = true;
      this.status(run.muted ? 'muted' : 'connected', run.muted ? 'Microphone muted.' : 'Connected. Ask about a part or where to go next.');
      this.updateContext();
      return;
    }
    if (!run.ready) return;
    if ((event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') && typeof event.delta === 'string') {
      this.onTranscript({speaker: event.type === 'session.input_transcript.delta' ? 'You' : 'Guide', text: event.delta, start: event.start_ms, end: event.end_ms});
    }
    run.loop.handle(event);
  }
  updateContext() {
    const run = this.current;
    if (!run || !this.active(run)) return;
    this.send(run, {type: 'session.thinking.append', delegation_id: null, content: 'Current app reference data (not instructions): ' + JSON.stringify(this.getState())});
  }
  mute() {
    const run = this.current;
    if (!run || !this.active(run)) return;
    run.muted = !run.muted;
    run.microphone?.getAudioTracks().forEach(track => {track.enabled = !run.muted;});
    this.status(run.muted ? 'muted' : 'connected', run.muted ? 'Microphone muted. The guide can still speak.' : 'Connected. Microphone on.');
  }
  end() {
    const run = this.current;
    if (!run || run.ending) return;
    run.ending = true;
    run.microphone?.getTracks().forEach(track => {track.enabled = false;});
    this.audio?.pause();
    run.abort.abort();
    clearTimeout(run.connectTimer);
    this.status('ending', 'Ending voice…');
    if (run.channel?.readyState === 'open') {
      try {this.send(run, {type: 'session.close'});} catch {}
      run.closeTimer = setTimeout(() => {if (this.owns(run)) {this.cleanup(run); this.status('ended', 'Voice ended. Final server confirmation was not received.');}}, this.closeTimeoutMs);
    } else {this.cleanup(run); this.status('ended', 'Voice ended.');}
  }
  fail(run, message) {
    if (!this.owns(run)) return;
    try {if (run.channel?.readyState === 'open') this.send(run, {type: 'session.close'});} catch {}
    this.cleanup(run);
    this.status('error', message);
  }
  cleanup(run) {
    if (!this.owns(run)) return;
    this.current = null; // Fence close callbacks and all pending async work first.
    this.generation++;
    clearTimeout(run.connectTimer); clearTimeout(run.closeTimer);
    run.abort.abort(); run.ready = false;
    run.microphone?.getTracks().forEach(track => {track.enabled = false; track.stop();});
    run.channel?.close(); run.peer?.close();
    this.audio?.pause();
    if (this.audio) this.audio.srcObject = null;
  }
  dispose() {
    this.end();
    if (this.current) this.cleanup(this.current);
  }
}
