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

const macApp = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
if (process.platform === 'darwin' && !DEV && fs.existsSync(macApp)) {
  console.log('Launching AURELIUM. If macOS asks whether "Electron" may use the microphone, click Allow.');
  console.log(`Log file: ${path.join(ROOT, 'data', 'aurelium.log')}`);
  run('open', ['-W', '-n', '-a', macApp, '--args', ROOT]);
} else {
  const electron = require('electron');   // resolves to the binary path
  run(electron, [ROOT, ...process.argv.slice(2).filter(a => a !== '--dev')]);
}
