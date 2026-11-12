// Text-to-speech through ElevenLabs. Each sentence is requested as soon as it exists,
// up to two in flight at once, and delivered strictly in order.
'use strict';
const { config } = require('./config');

const API = 'https://api.elevenlabs.io/v1';

async function synthesize(text, { signal } = {}) {
  if (!config.elevenKey) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!config.elevenVoiceId) throw new Error('ELEVENLABS_VOICE_ID is not set');
  const url = `${API}/text-to-speech/${config.elevenVoiceId}/stream?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'xi-api-key': config.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: config.elevenModel,
      voice_settings: { stability: 0.65, similarity_boost: 0.8, style: 0.1, speed: 0.95 }
    })
  });
  if (!res.ok) throw new Error(await explainElevenLabsError(res));
  return Buffer.from(await res.arrayBuffer());
}

// Turn an ElevenLabs error into one plain sentence Juan can act on.
async function explainElevenLabsError(res) {
  let body = '';
  try { body = await res.text(); } catch (_) {}
  let status = '', message = '';
  try { const j = JSON.parse(body); status = (j.detail && j.detail.status) || ''; message = (j.detail && j.detail.message) || ''; } catch (_) {}
  if (status === 'quota_exceeded' || /quota|character limit|credits/i.test(message)) return `ElevenLabs says your plan's credits are used up. Top up or upgrade at elevenlabs.io (Subscription), then try again. (${message.slice(0, 120)})`;
  if (res.status === 401) return `ElevenLabs rejected the API key (${status || 'unauthorized'}). Check ELEVENLABS_API_KEY in .env and the key's permissions.`;
  if (res.status === 404) return 'ElevenLabs could not find that voice. Check ELEVENLABS_VOICE_ID in .env.';
  if (res.status === 429) return 'ElevenLabs is rate limiting us. Wait a few seconds and try again.';
  return `ElevenLabs ${res.status}: ${message || body.slice(0, 160) || res.statusText}`;
}

// Keeps sentence order while allowing overlap in the network requests.
class SpeechQueue {
  constructor({ onAudio, onError, concurrency = 2 }) {
    this.onAudio = onAudio; this.onError = onError; this.concurrency = concurrency;
    this.pending = []; this.inFlight = 0; this.seq = 0; this.nextToDeliver = 0; this.ready = new Map();
    this.controller = new AbortController();
  }
  enqueue(text) {
    const seq = this.seq++;
    this.pending.push({ seq, text });
    this._pump();
    return seq;
  }
  _pump() {
    while (this.inFlight < this.concurrency && this.pending.length) {
      const job = this.pending.shift();
      this.inFlight++;
      synthesize(job.text, { signal: this.controller.signal })
        .then((buf) => { this.ready.set(job.seq, { buf, text: job.text }); })
        .catch((err) => { if (!this.controller.signal.aborted) this.onError(err, job.text); this.ready.set(job.seq, null); })
        .finally(() => { this.inFlight--; this._deliver(); this._pump(); });
    }
  }
  _deliver() {
    while (this.ready.has(this.nextToDeliver)) {
      const item = this.ready.get(this.nextToDeliver);
      this.ready.delete(this.nextToDeliver);
      if (item) this.onAudio(item.buf, item.text, this.nextToDeliver);
      this.nextToDeliver++;
    }
  }
  cancel() { this.controller.abort(); this.pending = []; this.ready.clear(); }
}

async function listVoices() {
  const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': config.elevenKey } });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return (await res.json()).voices || [];
}

module.exports = { synthesize, SpeechQueue, listVoices, explainElevenLabsError };
