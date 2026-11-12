// Microphone capture, voice-activity detection, and audio playback for the renderer.

const TARGET_RATE = 16000;

function downsample(chunks, fromRate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let o = 0; for (const c of chunks) { input.set(c, o); o += c.length; }
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(total, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

const rms = (buf) => { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };

// One microphone, shared by push-to-talk and the wake-word listener.
export class Mic {
  constructor() { this.ctx = null; this.stream = null; this.level = 0; this.capturing = false; this.chunks = []; this.onChunk = null; }
  async init() {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.proc.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.level = rms(data);
      const copy = new Float32Array(data);
      if (this.capturing) this.chunks.push(copy);
      if (this.onChunk) this.onChunk(copy, this.level);
    };
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination);   // required for onaudioprocess to fire; output is silent (input only)
    await this.ctx.resume();
  }
  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
  start() { this.chunks = []; this.capturing = true; }
  stop() { this.capturing = false; const out = downsample(this.chunks, this.sampleRate); this.chunks = []; return out; }
}

// Listens for speech, returns a segment when the speaker goes quiet.
export class SegmentListener {
  constructor(mic, { onSegment, onSpeechStart, maxSeconds = 15, silenceMs = 900, minSpeechMs = 250 } = {}) {
    this.mic = mic; this.onSegment = onSegment; this.onSpeechStart = onSpeechStart || (() => {});
    this.maxSeconds = maxSeconds; this.silenceMs = silenceMs; this.minSpeechMs = minSpeechMs;
    this.noise = 0.004; this.active = false; this.reset();
  }
  reset() { this.inSpeech = false; this.speechMs = 0; this.silence = 0; this.buf = []; this.preroll = []; this.totalMs = 0; }
  start() { this.active = true; this.reset(); this.mic.onChunk = (c, lvl) => this._chunk(c, lvl); }
  stop() { this.active = false; this.mic.onChunk = null; this.reset(); }
  _chunk(chunk, level) {
    if (!this.active) return;
    const ms = (chunk.length / this.mic.sampleRate) * 1000;
    const threshold = Math.max(0.012, this.noise * 3.5);
    const speaking = level > threshold;
    if (!speaking) this.noise = this.noise * 0.97 + level * 0.03;
    if (!this.inSpeech) {
      this.preroll.push(chunk); if (this.preroll.length > 8) this.preroll.shift();
      if (speaking) { this.speechMs += ms; if (this.speechMs >= 120) { this.inSpeech = true; this.buf = [...this.preroll]; this.silence = 0; this.totalMs = 0; this.onSpeechStart(); } }
      else this.speechMs = 0;
      return;
    }
    this.buf.push(chunk); this.totalMs += ms;
    if (speaking) { this.silence = 0; this.speechMs += ms; } else this.silence += ms;
    if (this.silence >= this.silenceMs || this.totalMs >= this.maxSeconds * 1000) {
      const segment = this.buf; const spoke = this.speechMs;
      this.reset();
      if (spoke >= this.minSpeechMs) this.onSegment(downsample(segment, this.mic.sampleRate));
    }
  }
}

// Plays MP3 chunks back to back and reports loudness for the entity.
export class Player {
  constructor({ onStart, onDrain, onLevel, onError }) {
    this.onStart = onStart || (() => {}); this.onDrain = onDrain || (() => {}); this.onLevel = onLevel || (() => {}); this.onError = onError || (() => {});
    this.ctx = null; this.analyser = null; this.nextTime = 0; this.playing = 0; this.decoding = 0; this.runId = null; this.started = false;
    this.data = null; this.sources = new Set();
  }
  _ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512;
    this.analyser.connect(this.ctx.destination);
    this.data = new Uint8Array(this.analyser.fftSize);
  }
  get idle() { return this.playing === 0 && this.decoding === 0; }
  // Call every frame: pushes current loudness (0..1) to the entity.
  tick() {
    if (!this.analyser || this.playing === 0) { this.onLevel(0); return; }
    this.analyser.getByteTimeDomainData(this.data);
    let s = 0; for (let i = 0; i < this.data.length; i++) { const v = (this.data[i] - 128) / 128; s += v * v; }
    const level = Math.min(1, Math.sqrt(s / this.data.length) * 3.2);
    this.onLevel(level);
  }
  async enqueue(runId, bytes) {
    this._ensure();
    if (this.runId !== runId) { this.stop(); this.runId = runId; }
    this.decoding++;
    let audio;
    try {
      const copy = bytes.slice(0).buffer ? bytes.slice(0).buffer : bytes;
      audio = await this.ctx.decodeAudioData(copy);
    } catch (err) { this.decoding--; this.onError(`Could not decode audio (${err.message}). Trying the simple player.`); this._fallbackPlay(runId, bytes); return; }
    this.decoding--;
    if (this.runId !== runId) return;
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (err) { this.onError(`Audio output blocked: ${err.message}`); } }
    if (this.ctx.state !== 'running') this.onError(`Audio context is "${this.ctx.state}", not running. Output device may be missing.`);
    const src = this.ctx.createBufferSource();
    src.buffer = audio; src.connect(this.analyser);
    const now = this.ctx.currentTime;
    const at = Math.max(now + 0.02, this.nextTime);
    src.start(at); this.nextTime = at + audio.duration;
    this.playing++; this.sources.add(src);
    if (!this.started) { this.started = true; this.onStart(); }
    src.onended = () => { this.sources.delete(src); this.playing--; if (this.idle) { this.started = false; this.onDrain(); } };
  }
  // Last-resort playback with a plain <audio> element (no level metering).
  _fallbackPlay(runId, bytes) {
    try {
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const el = new Audio(URL.createObjectURL(blob));
      this.playing++;
      if (!this.started) { this.started = true; this.onStart(); }
      el.onended = () => { this.playing--; URL.revokeObjectURL(el.src); if (this.idle) { this.started = false; this.onDrain(); } };
      el.onerror = () => { this.playing--; this.onError('Simple player failed too. Check System Settings > Sound > Output.'); if (this.idle) { this.started = false; this.onDrain(); } };
      el.play().catch((err) => this.onError(`Playback refused: ${err.message}`));
    } catch (err) { this.onError(`Fallback player error: ${err.message}`); }
  }
  stop() {
    for (const s of this.sources) { try { s.onended = null; s.stop(); } catch (_) {} }
    this.sources.clear(); this.playing = 0; this.nextTime = 0; this.started = false;
  }
}
