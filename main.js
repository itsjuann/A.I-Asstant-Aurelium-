// AURELIUM - Electron main process
// Owns the window, reads system stats, and talks to the renderer over IPC.
'use strict';

const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { describeOS } = require('./scripts/detect-os');

const ROOT = __dirname;
const TASKS_FILE = path.join(ROOT, 'data', 'tasks.json');
const HEADLESS_TEST = !!process.env.AURELIUM_HEADLESS_TEST;   // used by automated screenshot checks
const WINDOWED = !!process.env.AURELIUM_WINDOWED || HEADLESS_TEST;

let win = null;

// ---------- CPU usage (sampled between calls) ----------
let lastCpu = cpuSnapshot();
function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
function cpuPercent() {
  const now = cpuSnapshot();
  const dIdle = now.idle - lastCpu.idle;
  const dTotal = now.total - lastCpu.total;
  lastCpu = now;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}

function readTasks() {
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch (_) {
    return [];
  }
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
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  if (HEADLESS_TEST) runHeadlessTest();
}

// Automated check: wait, grab a screenshot for each state, write results, exit.
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
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${s}.png`), img.toPNG());
    report[s] = await win.webContents.executeJavaScript('window.__aurelium_stats()');
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
}

// ---------- IPC ----------
ipcMain.handle('system:info', () => describeOS());
ipcMain.handle('system:stats', () => ({
  cpu: cpuPercent(),
  memTotal: os.totalmem(),
  memFree: os.freemem(),
  uptime: os.uptime(),
  loadavg: os.loadavg()
}));
ipcMain.handle('tasks:today', () => readTasks());
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

// Linux containers and some VMs need these to get a GPU-less but smooth canvas.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
}

app.whenReady().then(() => {
  const info = describeOS();
  console.log(`[AURELIUM] Detected ${info.name} ${info.version} (${info.arch}), ${info.cpuModel}, ${info.ramGB} GB RAM`);
  createWindow();

  // Ctrl/Cmd+Q always quits, even frameless.
  globalShortcut.register('CommandOrControl+Q', () => app.quit());

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
