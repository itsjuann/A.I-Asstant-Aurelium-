// Launches AURELIUM. On macOS it starts Electron.app through "open" so that macOS attributes the
// microphone permission to the app itself (not to Terminal or the desktop shortcut).
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEV = process.argv.includes('--dev') || !!process.env.AURELIUM_HEADLESS_TEST;

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => process.exit(code || 0));
  child.on('error', (err) => { console.error(`Could not start AURELIUM: ${err.message}`); process.exit(1); });
}

let macApp = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
if (process.platform === 'darwin') {
  // Prefer the AURELIUM.app bundle made by `npm run shortcut`, if it points at this project.
  const bundle = path.join(require('os').homedir(), 'Desktop', 'AURELIUM.app');
  const shim = path.join(bundle, 'Contents', 'Resources', 'app', 'index.js');
  try { if (fs.readFileSync(shim, 'utf8').includes(path.join(ROOT, 'main.js'))) macApp = bundle; } catch (_) {}
}
if (process.platform === 'darwin' && !DEV && fs.existsSync(macApp)) {
  console.log(`Launching AURELIUM (${path.basename(macApp)}). If macOS asks about the microphone, click Allow.`);
  console.log(`Log file: ${path.join(ROOT, 'data', 'aurelium.log')}`);
  console.log('You can close this Terminal window; Motion keeps running on her own.');
  run('open', ['-n', '-a', macApp, '--args', ROOT]);   // no -W: hand off and return
} else {
  const electron = require('electron');   // resolves to the binary path
  run(electron, [ROOT, ...process.argv.slice(2).filter(a => a !== '--dev')]);
}
