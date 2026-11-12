// The voice pipeline: audio in -> text -> Claude -> sentences -> ElevenLabs -> audio out.
'use strict';
const { config, readiness } = require('./config');
const { Brain, describeError } = require('./brain');
const { SpeechQueue, synthesize } = require('./tts');
const { SpeechToText } = require('./stt');
const { openVault, dateKey } = require('./vault');
const { buildTools } = require('./tools');
const { buildActionTools, WEB_TOOLS } = require('./actions');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(config.root, 'data', 'state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; } };
const writeState = (patch) => { const s = { ...readState(), ...patch }; fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); };

const WAKE_VARIANTS = {
  aurelium: ['aurelium', 'aurelian', 'orelium', 'aurelio', 'aurelia', 'a relium', 'oralium', 'aurillium'],
  motion: ['motion', 'emotion', 'moshun', 'motian']
};

class Pipeline {
  constructor({ win, osName }) {
    this.win = win;
    this.vaultInfo = openVault({ preferred: config.vaultPath, onStatus: (t) => console.log('[AURELIUM]', t) });
    this.vault = this.vaultInfo.vault;
    const vaultTools = buildTools({ vault: this.vault, log: (a, b) => console.log('[AURELIUM]', a, b) });
    const actionTools = buildActionTools({ vault: this.vault, log: (t) => console.log('[AURELIUM] action:', t) });
    this.tools = { schemas: [...vaultTools.schemas, ...actionTools.schemas], handlers: { ...vaultTools.handlers, ...actionTools.handlers } };
    this.brain = new Brain({
      osName, tools: this.tools, vaultRoot: this.vaultInfo.root,
      webTools: config.webSearch ? WEB_TOOLS : [],
      onToolUse: (name) => this.status(this._toolLabel(name)),
      onServerTool: (name, input) => {
        const what = name === 'web_search' ? `Web search: ${input && input.query ? input.query : ''}` : `Read web page: ${input && input.url ? input.url : ''}`;
        this.status(name === 'web_search' ? 'Searching the web…' : 'Reading a web page…');
        try { this.vault.appendDaily('Log', what); } catch (_) {}
      }
    });
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
    this.status(`${config.assistantName} online. Brain: ${r.brain}. Voice: ${r.voice}. Ears: ${r.stt}. Web: ${r.web}. Hotkey: ${r.hotkey}. Wake word: ${r.wakeWord}.`);
    const vi = this.vaultInfo;
    this.status(vi.existed ? `Second brain: ${vi.root}` : `Second brain created at ${vi.root}. In Obsidian choose "Open folder as vault" and pick it.`);
    this.vault.ensureDaily();
    this.stt.warmUp();
    if (!process.env.AURELIUM_HEADLESS_TEST) setTimeout(() => this.briefing(false), 2500);
  }

  _toolLabel(name) {
    return { search_vault: 'Searching the vault…', read_note: 'Reading a note…', list_notes: 'Listing notes…', create_note: 'Filing a note…',
      append_note: 'Adding to a note…', append_daily: 'Updating today\'s daily note…', link_notes: 'Linking notes…', open_tasks: 'Checking open tasks…',
      open_app: 'Opening the app…', open_website: 'Opening the website…', create_task: 'Adding the task…', draft_email: 'Drafting the email…' }[name] || `Using ${name}…`;
  }

  // First launch of the day: spoken briefing from yesterday's note and open tasks.
  async briefing(force) {
    const today = dateKey();
    if (!force && readState().lastBriefing === today) return;
    if (!this.brain.ready) return;
    writeState({ lastBriefing: today });
    const hour = new Date().getHours();
    const greeting = hour < 12 ? `Good morning, ${config.userName}.` : hour < 18 ? `Good afternoon, ${config.userName}.` : `Good evening, ${config.userName}.`;
    const yesterday = this.vault.yesterdayNote();
    const open = this.vault.openTasks(7).filter(t => !t.done);
    const prompt = `[Daily briefing request from the app, not spoken by ${config.userName}.]
Deliver the day's briefing aloud. Open with exactly: "${greeting}" Then, in briefing style and under 120 words: what happened yesterday (from the note below), the open tasks that matter most, and one suggested first move. If there is nothing on file, say so in one line and ask what today is about. Finally call append_daily with section "Briefing" and a two-line written summary.

Yesterday's daily note:
${yesterday || '(none)'}

Open tasks (last 7 days):
${open.length ? open.map(t => `- ${t.text} (${t.date})`).join('\n') : '(none)'}`;
    await this.handleText(prompt, { display: `Daily briefing requested.` });
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
  async handleText(text, { display } = {}) {
    this.cancel();
    const id = ++this.runId;
    const abort = new AbortController();
    const queue = new SpeechQueue({
      onAudio: (buf, sentence, seq) => this.send('tts:audio', { runId: id, seq, data: buf, text: sentence }),
      onError: (err) => this.status(`Voice error: ${err.message}`)
    });
    this.current = { id, abort, queue };
    this.busy = true;
    this.send('transcript', display ? { role: 'system', text: display } : { role: 'you', text });
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
    const variants = [config.wakeWordText, ...(WAKE_VARIANTS[config.wakeWordText] || [])];
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
