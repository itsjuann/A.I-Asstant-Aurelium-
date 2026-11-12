// AURELIUM renderer entry: boots the particle entity and drives the HUD.
import { Entity } from './entity.js';

// When opened outside Electron (e.g. a browser test) fall back to harmless stubs.
const api = window.aurelium || {
  platform: 'browser',
  getSystemInfo: async () => ({ name: 'Browser', version: '', arch: '', cpuCount: navigator.hardwareConcurrency || 0, ramGB: 0 }),
  getSystemStats: async () => ({ cpu: 0, memTotal: 0, memFree: 0, uptime: 0 }),
  getTodayTasks: async () => [],
  quit: () => {}, toggleFullscreen: () => {}
};

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const entity = new Entity(canvas, { count: 18000 });

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

// Cycle through all four states so Juan can preview them without the voice stack.
function toggleDemo() {
  if (demoTimer) { clearInterval(demoTimer); demoTimer = null; setState('idle'); return; }
  const order = ['listening', 'thinking', 'speaking', 'idle'];
  let i = 0;
  setState(order[i]);
  demoTimer = setInterval(() => { i = (i + 1) % order.length; setState(order[i]); }, 4000);
}

// ---------------- HUD: clock ----------------
function tickClock() {
  const now = new Date();
  $('clock').textContent = now.toLocaleTimeString([], { hour12: false });
  $('date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------------- HUD: system ----------------
const fmtGB = (b) => (b / 1024 / 1024 / 1024).toFixed(1);
function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}
async function refreshSystem() {
  try {
    const st = await api.getSystemStats();
    const used = st.memTotal - st.memFree;
    const memPct = st.memTotal ? Math.round((used / st.memTotal) * 100) : 0;
    $('sys-cpu').textContent = `${st.cpu}%`;
    $('bar-cpu').style.width = `${st.cpu}%`;
    $('sys-mem').textContent = st.memTotal ? `${fmtGB(used)} / ${fmtGB(st.memTotal)} GB` : '—';
    $('bar-mem').style.width = `${memPct}%`;
    $('sys-up').textContent = fmtUptime(st.uptime || 0);
  } catch (_) { /* keep last values */ }
}

// ---------------- HUD: tasks ----------------
async function refreshTasks() {
  const list = $('tasks');
  let tasks = [];
  try { tasks = await api.getTodayTasks(); } catch (_) {}
  list.innerHTML = '';
  if (!tasks.length) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No tasks logged for today.'; list.appendChild(li); return;
  }
  for (const t of tasks.slice(0, 8)) {
    const li = document.createElement('li');
    li.className = t.done ? 'done' : '';
    li.innerHTML = `<span class="box"></span><span class="text"></span>`;
    li.querySelector('.text').textContent = t.text;
    list.appendChild(li);
  }
}

// ---------------- HUD: transcript ----------------
const transcript = $('transcript');
function addTranscript(role, text) {
  const line = document.createElement('div');
  line.className = `line ${role}`;
  if (role !== 'system') {
    const who = document.createElement('span'); who.className = 'who';
    who.textContent = role === 'you' ? 'JUAN' : 'AURELIUM';
    line.appendChild(who);
  }
  line.appendChild(document.createTextNode(text));
  transcript.appendChild(line);
  while (transcript.children.length > 12) transcript.removeChild(transcript.firstChild);
  transcript.scrollTop = transcript.scrollHeight;
  return line;
}

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case '1': setState('idle'); break;
    case '2': setState('listening'); break;
    case '3': setState('thinking'); break;
    case '4': setState('speaking'); break;
    case ' ': e.preventDefault(); toggleDemo(); break;
    case 'F11': api.toggleFullscreen(); break;
    case 'Escape': api.quit(); break;
  }
});

// ---------------- Main loop ----------------
let lastFpsText = '';
function frame() {
  // Until the voice stack exists, synthesise a speech envelope so the pulse is visible.
  if (entity.state === 'speaking' && !window.__aurelium_liveAudio) {
    fakeLevelPhase += 0.08;
    const env = 0.5 + 0.5 * Math.sin(fakeLevelPhase * 1.7) * Math.sin(fakeLevelPhase * 0.6 + 1.0);
    entity.setLevel(Math.pow(env, 1.5) * (0.6 + 0.4 * Math.random()));
  } else if (entity.state !== 'speaking') {
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
  try {
    const info = await api.getSystemInfo();
    $('sys-os').textContent = `${info.name} ${info.version}`.trim();
  } catch (_) {}
  refreshSystem(); setInterval(refreshSystem, 2000);
  refreshTasks(); setInterval(refreshTasks, 30000);
  setState('idle');
  requestAnimationFrame(frame);
})();

// Public hooks for later phases and for automated checks.
window.aureliumUI = { setState, addTranscript, entity };
window.__aurelium_setState = setState;
window.__aurelium_stats = () => ({ fps: entity.fps, state: entity.state, count: entity.count, pixelRatio: entity.pixelRatio });
