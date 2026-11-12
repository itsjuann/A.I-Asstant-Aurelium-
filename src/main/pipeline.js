// The voice pipeline: audio in -> text -> Claude -> sentences -> ElevenLabs -> audio out.
'use strict';
const { config, readiness } = require('./config');
const { Brain, describeError } = require('./brain');
const { SpeechQueue, synthesize } = require('./tts');
const { SpeechToText } = require('./stt');

const WAKE_VARIANTS = ['aurelium', 'aurelian', 'orelium', 'aurelio', 'aurelia', 'a relium', 'oralium', 'aurillium'];

class Pipeline {
  constructor({ win, osName }) {
    this.win = win;
    this.brain = new Brain({ osName });
    this.stt = new SpeechToText({ onStatus: (t) => this.status(t) });
    this.runId = 0;
    this.current = null;   // { id, abort, queue }
    this.busy = false;
  }

  send(channel, payload) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload); }
  status(text) { console.log('[AURELIUM]', text); this.send('status', { text }); }
  state(name) { this.send('state', { name }); }

  boot() {
    const r = readiness();
    this.send('voice:ready', r);
    this.status(`Brain: ${r.brain}. Voice: ${r.voice}. Ears: ${r.stt}. Hotkey: ${r.hotkey}. Wake word: ${r.wakeWord}.`);
    this.stt.warmUp();
  }

  cancel() {
    if (this.current) {
      this.current.abort.abort();
      this.current.queue.cancel();
      this.current = null;
    }
    this.busy = false;
  }

  // Spoken audio from push-to-talk.
  async handleUtterance(samples) {
    this.cancel();
    this.state('thinking');
    let text = '';
    try { text = await this.stt.transcribe(samples); }
    catch (err) { this.status(`Could not transcribe: ${err.message}`); this.state('idle'); return; }
    if (!text) { this.status('Nothing heard.'); this.state('idle'); return; }
    await this.handleText(text);
  }

  // A full turn from text (typed or transcribed).
  async handleText(text) {
    this.cancel();
    const id = ++this.runId;
    const abort = new AbortController();
    const queue = new SpeechQueue({
      onAudio: (buf, sentence, seq) => this.send('tts:audio', { runId: id, seq, data: buf, text: sentence }),
      onError: (err) => this.status(`Voice error: ${err.message}`)
    });
    this.current = { id, abort, queue };
    this.busy = true;
    this.send('transcript', { role: 'you', text });
    this.state('thinking');
    this.send('transcript:start', { id, role: 'aurelium' });
    try {
      await this.brain.ask(text, {
        signal: abort.signal,
        onDelta: (t) => this.send('transcript:delta', { id, text: t }),
        onSentence: (s) => { if (this.current && this.current.id === id) queue.enqueue(s); }
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      const msg = describeError(err);
      this.status(msg);
      this.send('transcript:delta', { id, text: msg });
      if (this.current && this.current.id === id) queue.enqueue(msg);
    } finally {
      this.send('transcript:end', { id });
    }
    // Tell the renderer no more audio is coming for this run once the queue drains.
    const waitDrain = () => new Promise((resolve) => {
      const tick = () => { if (!this.current || this.current.id !== id || (queue.inFlight === 0 && queue.pending.length === 0)) resolve(); else setTimeout(tick, 50); };
      tick();
    });
    await waitDrain();
    if (this.current && this.current.id === id) { this.send('pipeline:done', { runId: id }); this.current = null; this.busy = false; }
  }

  // Speak a fixed line without involving the brain (acknowledgements, errors).
  async say(text) {
    this.cancel();
    const id = ++this.runId;
    this.send('transcript:start', { id, role: 'aurelium' });
    this.send('transcript:delta', { id, text });
    this.send('transcript:end', { id });
    try { const buf = await synthesize(text); this.send('tts:audio', { runId: id, seq: 0, data: buf, text }); }
    catch (err) { this.status(`Voice error: ${err.message}`); }
    this.send('pipeline:done', { runId: id });
  }

  // A short segment captured by the always-on wake-word listener.
  async handleWakeSegment(samples) {
    if (this.busy) return { heard: false };
    let text = '';
    try { text = (await this.stt.transcribe(samples)).toLowerCase(); } catch (_) { return { heard: false }; }
    if (!text) return { heard: false };
    const variants = [config.wakeWordText, ...WAKE_VARIANTS];
    let idx = -1, hit = '';
    for (const v of variants) { const i = text.indexOf(v); if (i !== -1 && (idx === -1 || i < idx)) { idx = i; hit = v; } }
    if (idx === -1) return { heard: false };
    const command = text.slice(idx + hit.length).replace(/^[\s,.:;!?-]+/, '').trim();
    if (command.length > 3) { this.handleText(command); return { heard: true, command }; }
    await this.say(`Yes, ${config.userName}?`);
    return { heard: true, command: '' };
  }

  resetConversation() { this.cancel(); this.brain.reset(); this.status('Conversation cleared.'); }
  shutdown() { this.cancel(); this.stt.stop(); }
}

module.exports = { Pipeline };
