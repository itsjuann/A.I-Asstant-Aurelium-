// AURELIUM - Electron main process
// Owns the window, reads system stats, runs the voice pipeline, and talks to the renderer over IPC.
'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { describeOS } = require('./scripts/detect-os');
const { config } = require('./src/main/config');
const { Pipeline } = require('./src/main/pipeline');

const ROOT = __dirname;
const TASKS_FILE = path.join(ROOT, 'data', 'tasks.json');
const HEADLESS_TEST = !!process.env.AURELIUM_HEADLESS_TEST;   // used by automated checks
const WINDOWED = !!process.env.AURELIUM_WINDOWED || HEADLESS_TEST;

let win = null;
let pipeline = null;

// ---------- CPU usage (sampled between calls) ----------
let lastCpu = cpuSnapshot();
function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  return { idle, total };
}
function cpuPercent() {
  const now = cpuSnapshot();
  const dIdle = now.idle - lastCpu.idle, dTotal = now.total - lastCpu.total;
  lastCpu = now;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}

function readTasks() {
  try { const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); return Array.isArray(data.tasks) ? data.tasks : []; }
  catch (_) { return []; }
}

async function ensureMicrophone() {
  if (process.platform === 'darwin') {
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status !== 'granted') await systemPreferences.askForMediaAccess('microphone');
    } catch (err) { console.warn('[AURELIUM] microphone permission:', err.message); }
  }
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media' || permission === 'audioCapture'));
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: WINDOWED ? Math.min(1600, width) : width,
    height: WINDOWED ? Math.min(900, height) : height,
    fullscreen: !WINDOWED,
    frame: false,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'AURELIUM',
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  const info = describeOS();
  pipeline = new Pipeline({ win, osName: `${info.name} ${info.version}`.trim() });
  win.webContents.on('did-finish-load', () => pipeline.boot());

  if (HEADLESS_TEST) runHeadlessTest();
}

// Automated check: screenshots of each state, then one full voice turn through the pipeline.
async function runHeadlessTest() {
  const outDir = process.env.AURELIUM_HEADLESS_TEST;
  fs.mkdirSync(outDir, { recursive: true });
  const states = ['idle', 'listening', 'thinking', 'speaking'];
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  await wait(4000);
  const report = {};
  for (const s of states) {
    await win.webContents.executeJavaScript(`window.__aurelium_setState(${JSON.stringify(s)})`);
    await wait(2500);
    fs.writeFileSync(path.join(outDir, `${s}.png`), (await win.webContents.capturePage()).toPNG());
    report[s] = await win.webContents.executeJavaScript('window.__aurelium_stats()');
  }
  if (process.env.AURELIUM_TEST_TEXT) {
    await win.webContents.executeJavaScript(`window.__aurelium_say(${JSON.stringify(process.env.AURELIUM_TEST_TEXT)})`);
    for (let i = 0; i < 60; i++) {
      await wait(1000);
      const v = await win.webContents.executeJavaScript('window.__aurelium_voiceStats()');
      if (v.pipelineDone && v.playerIdle) { report.voice = v; break; }
      report.voice = v;
    }
    fs.writeFileSync(path.join(outDir, 'voice.png'), (await win.webContents.capturePage()).toPNG());
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
}

// ---------- IPC ----------
ipcMain.handle('system:info', () => describeOS());
ipcMain.handle('system:stats', () => ({ cpu: cpuPercent(), memTotal: os.totalmem(), memFree: os.freemem(), uptime: os.uptime(), loadavg: os.loadavg() }));
ipcMain.handle('tasks:today', () => readTasks());
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

const toFloat32 = (buf) => (buf instanceof Float32Array ? buf : new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
ipcMain.on('voice:utterance', (_e, samples) => pipeline && pipeline.handleUtterance(toFloat32(samples)));
ipcMain.handle('voice:wake-check', (_e, samples) => pipeline ? pipeline.handleWakeSegment(toFloat32(samples)) : { heard: false });
ipcMain.on('brain:text', (_e, text) => pipeline && pipeline.handleText(String(text || '').trim()));
ipcMain.on('voice:interrupt', () => pipeline && pipeline.cancel());
ipcMain.on('brain:reset', () => pipeline && pipeline.resetConversation());

app.whenReady().then(async () => {
  const info = describeOS();
  console.log(`[AURELIUM] Detected ${info.name} ${info.version} (${info.arch}), ${info.cpuModel}, ${info.ramGB} GB RAM`);
  await ensureMicrophone();
  createWindow();

  globalShortcut.register('CommandOrControl+Q', () => app.quit());
  // Push-to-talk toggle that works even when another app has focus.
  try {
    const ok = globalShortcut.register(config.pttHotkey, () => { if (win) win.webContents.send('voice:ptt', { action: 'toggle' }); });
    if (!ok) console.warn(`[AURELIUM] Could not register hotkey ${config.pttHotkey}; hold Space inside the app instead.`);
  } catch (err) { console.warn('[AURELIUM] hotkey error:', err.message); }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (pipeline) pipeline.shutdown(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
