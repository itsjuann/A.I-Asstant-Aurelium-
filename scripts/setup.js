// One-time setup: detects the OS, installs dependencies, prepares .env, creates the desktop shortcut.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { describeOS } = require('./detect-os');

const ROOT = path.resolve(__dirname, '..');
const info = describeOS();

console.log('');
console.log('AURELIUM setup');
console.log('--------------');
console.log(`Operating system : ${info.name} ${info.version} (${info.arch})`);
console.log(`Processor        : ${info.cpuModel} x${info.cpuCount}`);
console.log(`Memory           : ${info.ramGB} GB`);
console.log('');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error(`Node.js ${process.versions.node} is too old. Install the LTS version from https://nodejs.org and run this again.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron'))) {
  console.log('Installing dependencies (this can take a minute)...');
  execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('Dependencies already installed.');
}

const envFile = path.join(ROOT, '.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), envFile);
  console.log('Created .env from .env.example (API keys go there in Phase 2).');
}

try {
  const { makeShortcut } = require('./make-shortcut');
  const where = makeShortcut();
  console.log(`Desktop shortcut : ${where}`);
} catch (err) {
  console.log(`Desktop shortcut : skipped (${err.message}). Use "npm start" instead.`);
}

console.log('');
console.log('Done. Launch AURELIUM with the desktop shortcut or:  npm start');
console.log('Inside the app: 1-4 preview states, SPACE runs the demo cycle, ESC exits.');
