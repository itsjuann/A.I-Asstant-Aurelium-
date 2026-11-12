// AURELIUM renderer entry: boots the particle entity, drives the HUD, and runs the voice loop.
import { Entity } from './entity.js';
import { Mic, SegmentListener, Player } from './voice.js';

// When opened outside Electron (e.g. a browser test) fall back to harmless stubs.
const noop = () => () => {};
const api = window.aurelium || {
  platform: 'browser',
  getSystemInfo: async () => ({ name: 'Browser', version: '' }),
  getSystemStats: async () => ({ cpu: 0, memTotal: 0, memFree: 0, uptime: 0 }),
  getTodayTasks: async () => [],
  quit: () => {}, toggleFullscreen: () => {},
  sendUtterance: () => {}, sendWakeSegment: async () => ({ heard: false }), sendText: () => {}, interrupt: () => {}, resetConversation: () => {},
  onState: noop, onStatus: noop, onReady: noop, onTranscript: noop, onTranscriptStart: noop, onTranscriptDelta: noop, onTranscriptEnd: noop, onAudio: noop, onPipelineDone: noop, onPushToTalk: noop
};

const $ = (id) => document.getElementById(id);
const entity = new Entity($('stage'), { count: 18000 });

// ---------------- State ----------------
const stateEl = $('panel-state');
const stateLabel = $('state-label');
let demoTimer = null;
let fakeLevelPhase = 0;

function setState(name) {
  entity.setState(name);
  stateLabel.textContent = name.toUpperCase();
  stateEl.className = `hud bottom-center state-${name}`;
}
function toggleDemo() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; setState('idle'); return; }
  const order = ['listening', 'thinking', 'speaking', 'idle'];
  let i = 0; setState(order[i]);
  demoTimer = setInterval(() => { i = (i + 1) % order.length; setState(order[i]); }, 4000);
}

// ---------------- HUD: clock / system / tasks ----------------
function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour12: false });
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
function fmtUptime(s) { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : `${h}h ${m}m`; }
async function refreshSystem() {
  try {
    const st = await api.getSystemStats();
    const used = st.memTotal - st.memFree;
    $('sys-cpu').textContent = `${st.cpu}%`; $('bar-cpu').style.width = `${st.cpu}%`;
    $('sys-mem').textContent = st.memTotal ? `${fmtGB(used)} / ${fmtGB(st.memTotal)} GB` : '—';
    $('bar-mem').style.width = `${st.memTotal ? Math.round((used / st.memTotal) * 100) : 0}%`;
    $('sys-up').textContent = fmtUptime(st.uptime || 0);
  } catch (_) {}
}
async function refreshTasks() {
  const list = $('tasks'); let tasks = [];
  try { tasks = await api.getTodayTasks(); } catch (_) {}
  list.innerHTML = '';
  if (!tasks.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No tasks logged for today.'; list.appendChild(li); return; }
  for (const t of tasks.slice(0, 8)) {
    const li = document.createElement('li'); li.className = t.done ? 'done' : '';
    li.innerHTML = `<span class="box"></span><span class="text"></span>`; li.querySelector('.text').textContent = t.text; list.appendChild(li);
  }
}

// ---------------- HUD: transcript ----------------
const transcript = $('transcript');
const openLines = new Map();
function addTranscript(role, text) {
  const line = document.createElement('div');
  line.className = `line ${role}`;
  if (role !== 'system') { const who = document.createElement('span'); who.className = 'who'; who.textContent = role === 'you' ? 'JUAN' : 'AURELIUM'; line.appendChild(who); }
  const body = document.createElement('span'); body.className = 'body'; body.textContent = text; line.appendChild(body);
  transcript.appendChild(line);
  while (transcript.children.length > 14) transcript.removeChild(transcript.firstChild);
  transcript.scrollTop = transcript.scrollHeight;
  return line;
}
api.onTranscript(({ role, text }) => addTranscript(role, text));
api.onTranscriptStart(({ id, role }) => openLines.set(id, addTranscript(role, '')));
api.onTranscriptDelta(({ id, text }) => { const l = openLines.get(id); if (l) { l.querySelector('.body').textContent += text; transcript.scrollTop = transcript.scrollHeight; } });
api.onTranscriptEnd(({ id }) => openLines.delete(id));
api.onStatus(({ text }) => { addTranscript('system', text); setVoiceStatus(text); });

const voiceStatus = $('voice-status');
let statusTimer = null;
function setVoiceStatus(text, sticky = false) {
  voiceStatus.textContent = text;
  if (statusTimer) clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => { voiceStatus.textContent = readyLine; }, 8000);
}
let readyLine = '';
api.onReady((r) => { readyLine = `BRAIN ${r.brain} · VOICE ${r.voice} · EARS ${r.stt} · WAKE ${r.wakeWord}`; setVoiceStatus(readyLine, true); });

// ---------------- Voice loop ----------------
const mic = new Mic();
let recording = false;
let pipelineDone = true;
let currentRun = null;
let audioChunks = 0;
let wakeOn = false;

const player = new Player({
  onStart: () => { window.__aurelium_liveAudio = true; setState('speaking'); },
  onDrain: () => { window.__aurelium_liveAudio = false; if (pipelineDone && !recording) setState(wakeOn ? 'idle' : 'idle'); },
  onLevel: (lvl) => { if (entity.state === 'speaking') entity.setLevel(lvl); }
});
api.onAudio(({ runId, data }) => { audioChunks++; currentRun = runId; pipelineDone = false; player.enqueue(runId, data); });
api.onPipelineDone(({ runId }) => { if (runId === currentRun || currentRun === null) { pipelineDone = true; if (player.idle && !recording) setState('idle'); } });
api.onState(({ name }) => { if (name === 'thinking' && !recording) setState('thinking'); else if (name === 'idle' && player.idle && !recording) setState('idle'); });

async function startRecording() {
  if (recording) return;
  try { await mic.init(); } catch (err) { addTranscript('system', `Microphone unavailable: ${err.message}`); return; }
  if (!player.idle) { player.stop(); api.interrupt(); }   // barge-in
  pipelineDone = true;
  recording = true; mic.start(); setState('listening');
  setVoiceStatus('LISTENING… release to send');
}
function stopRecording() {
  if (!recording) return;
  recording = false;
  const samples = mic.stop();
  if (samples.length < 16000 * 0.3) { setState('idle'); setVoiceStatus('Too short. Hold the key while you speak.'); return; }
  setState('thinking'); setVoiceStatus('Transcribing…');
  api.sendUtterance(samples);
}
function togglePushToTalk() { recording ? stopRecording() : startRecording(); }
api.onPushToTalk(() => togglePushToTalk());

// Wake word: always-on listener that sends quiet-delimited segments to the main process.
const wakeListener = new SegmentListener(mic, {
  onSegment: async (samples) => {
    if (recording || !player.idle) return;
    const res = await api.sendWakeSegment(samples);
    if (res && res.heard) { setVoiceStatus(res.command ? `Heard: "${res.command}"` : 'Yes?'); }
  }
});
async function toggleWake() {
  wakeOn = !wakeOn;
  if (wakeOn) { try { await mic.init(); } catch (err) { wakeOn = false; addTranscript('system', `Microphone unavailable: ${err.message}`); return; } wakeListener.start(); $('wake-indicator').hidden = false; setVoiceStatus('Wake word on. Say "Aurelium" followed by your request.', true); }
  else { wakeListener.stop(); $('wake-indicator').hidden = true; setVoiceStatus('Wake word off.'); }
}

// Typed input (press Enter) for testing without a microphone.
const textBox = $('text-input');
function openTextInput() { textBox.hidden = false; textBox.value = ''; textBox.focus(); }
function closeTextInput() { textBox.hidden = true; textBox.blur(); }
function sendText(text) {
  if (!text.trim()) return;
  if (!player.idle) { player.stop(); api.interrupt(); }
  pipelineDone = false; setState('thinking'); api.sendText(text.trim());
}
textBox.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { const v = textBox.value; closeTextInput(); sendText(v); }
  if (e.key === 'Escape') closeTextInput();
});

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  if (!textBox.hidden) return;
  switch (e.key) {
    case ' ': e.preventDefault(); if (!e.repeat) startRecording(); break;
    case 'Enter': e.preventDefault(); openTextInput(); break;
    case '1': setState('idle'); break;
    case '2': setState('listening'); break;
    case '3': setState('thinking'); break;
    case '4': setState('speaking'); break;
    case 'd': case 'D': toggleDemo(); break;
    case 'w': case 'W': toggleWake(); break;
    case 'r': case 'R': api.resetConversation(); break;
    case 'F11': api.toggleFullscreen(); break;
    case 'Escape': if (!player.idle) { player.stop(); api.interrupt(); setState('idle'); } else api.quit(); break;
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ' && textBox.hidden) stopRecording(); });

// ---------------- Main loop ----------------
let lastFpsText = '';
function frame() {
  if (entity.state === 'speaking' && !window.__aurelium_liveAudio) {
    fakeLevelPhase += 0.08;
    const env = 0.5 + 0.5 * Math.sin(fakeLevelPhase * 1.7) * Math.sin(fakeLevelPhase * 0.6 + 1.0);
    entity.setLevel(Math.pow(env, 1.5) * (0.6 + 0.4 * Math.random()));
  } else if (entity.state === 'speaking') {
    player.tick();
  } else if (entity.state === 'listening') {
    entity.setLevel(Math.min(1, mic.level * 6));
  } else {
    entity.setLevel(0);
  }
  entity.render();
  const txt = `${entity.fps} fps · ${entity.count.toLocaleString()} pts`;
  if (txt !== lastFpsText) { $('sys-fps').textContent = txt; lastFpsText = txt; }
  requestAnimationFrame(frame);
}

// ---------------- Boot ----------------
(async () => {
  tickClock(); setInterval(tickClock, 1000);
  try { const info = await api.getSystemInfo(); $('sys-os').textContent = `${info.name} ${info.version}`.trim(); } catch (_) {}
  refreshSystem(); setInterval(refreshSystem, 2000);
  refreshTasks(); setInterval(refreshTasks, 30000);
  setState('idle');
  requestAnimationFrame(frame);
})();

// Public hooks for later phases and for automated checks.
window.aureliumUI = { setState, addTranscript, entity, sendText };
window.__aurelium_setState = setState;
window.__aurelium_say = sendText;
window.__aurelium_stats = () => ({ fps: entity.fps, state: entity.state, count: entity.count, pixelRatio: entity.pixelRatio });
window.__aurelium_voiceStats = () => ({ audioChunks, pipelineDone, playerIdle: player.idle, state: entity.state, lines: [...transcript.children].map(l => l.textContent) });
