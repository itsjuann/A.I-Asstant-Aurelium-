// Speech-to-text. Local Whisper on capable machines, with cloud fallbacks.
// Input is always mono Float32 samples at 16 kHz.
'use strict';
const path = require('path');
const { config } = require('./config');

function floatTo16BitWav(samples, sampleRate = 16000) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, 44 + i * 2);
  }
  return buf;
}

// ---------- Local Whisper in a separate process so the UI never stutters ----------
class LocalWhisper {
  constructor({ onStatus }) {
    this.onStatus = onStatus || (() => {});
    this.child = null; this.readyPromise = null; this.pendingId = 0; this.callbacks = new Map();
  }
  start() {
    if (this.readyPromise) return this.readyPromise;
    const { utilityProcess } = require('electron');
    this.readyPromise = new Promise((resolve, reject) => {
      this.child = utilityProcess.fork(path.join(__dirname, 'whisper-worker.js'), [], {
        env: { ...process.env, AURELIUM_WHISPER_MODEL: config.whisperModel, AURELIUM_MODEL_CACHE: config.modelCacheDir },
        serviceName: 'aurelium-whisper'
      });
      const timer = setTimeout(() => reject(new Error('Local Whisper took too long to load')), 10 * 60 * 1000);
      this.child.on('message', (msg) => {
        if (msg.type === 'status') this.onStatus(msg.text);
        else if (msg.type === 'ready') { clearTimeout(timer); resolve(); }
        else if (msg.type === 'fatal') { clearTimeout(timer); reject(new Error(msg.error)); }
        else if (msg.type === 'result') {
          const cb = this.callbacks.get(msg.id); this.callbacks.delete(msg.id);
          if (cb) msg.error ? cb.reject(new Error(msg.error)) : cb.resolve(msg.text);
        }
      });
      this.child.on('exit', (code) => {
        this.readyPromise = null; this.child = null;
        for (const cb of this.callbacks.values()) cb.reject(new Error('Whisper worker exited'));
        this.callbacks.clear();
        if (code !== 0) reject(new Error(`Whisper worker exited with code ${code}`));
      });
    });
    return this.readyPromise;
  }
  async transcribe(samples) {
    await this.start();
    const id = ++this.pendingId;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.child.postMessage({ type: 'transcribe', id, samples: Array.from(samples) });
    });
  }
  stop() { if (this.child) { this.child.kill(); this.child = null; this.readyPromise = null; } }
}

// ---------- Cloud backends ----------
async function transcribeElevenLabs(samples) {
  if (!config.elevenKey) throw new Error('ELEVENLABS_API_KEY is not set');
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'en');
  form.append('file', new Blob([floatTo16BitWav(samples)], { type: 'audio/wav' }), 'speech.wav');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': config.elevenKey }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).text || '').trim();
}

async function transcribeOpenAI(samples) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set');
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('file', new Blob([floatTo16BitWav(samples)], { type: 'audio/wav' }), 'speech.wav');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}` }, body: form });
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()).text || '').trim();
}

// ---------- Orchestrator with fallback chain ----------
class SpeechToText {
  constructor({ onStatus }) {
    this.onStatus = onStatus || (() => {});
    this.mode = config.sttResolved;
    this.local = this.mode === 'local' ? new LocalWhisper({ onStatus: this.onStatus }) : null;
    this.activeBackend = this.mode;
  }
  // Begin loading the local model in the background right at launch.
  warmUp() {
    if (this.local) this.local.start().catch((err) => this._demote(`Local Whisper unavailable (${err.message}).`));
  }
  _demote(reason) {
    if (this.local) { this.local.stop(); this.local = null; }
    this.activeBackend = config.elevenKey ? 'elevenlabs' : (config.openaiKey ? 'openai' : 'none');
    this.onStatus(`${reason} Falling back to ${this.activeBackend === 'none' ? 'nothing: no cloud key set' : this.activeBackend}.`);
  }
  async transcribe(samples) {
    if (!samples || samples.length < 16000 * 0.3) return '';
    if (this.activeBackend === 'local' && this.local) {
      try { return await this.local.transcribe(samples); }
      catch (err) { this._demote(`Local Whisper failed (${err.message}).`); }
    }
    if (this.activeBackend === 'elevenlabs') return transcribeElevenLabs(samples);
    if (this.activeBackend === 'openai') return transcribeOpenAI(samples);
    throw new Error('No speech-to-text available. Set ELEVENLABS_API_KEY or OPENAI_API_KEY, or fix local Whisper.');
  }
  stop() { if (this.local) this.local.stop(); }
}

module.exports = { SpeechToText, floatTo16BitWav, transcribeElevenLabs, transcribeOpenAI };
