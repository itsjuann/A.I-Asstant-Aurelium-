// Creates a desktop shortcut for AURELIUM, adapted to the operating system.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { describeOS } = require('./detect-os');

const ROOT = path.resolve(__dirname, '..');
const info = describeOS();

function desktopDir() {
  const d = path.join(os.homedir(), 'Desktop');
  if (fs.existsSync(d)) return d;
  // Some Linux desktops localise the folder name; fall back to xdg-user-dir.
  if (process.platform === 'linux') {
    try { const x = execFileSync('xdg-user-dir', ['DESKTOP']).toString().trim(); if (x && fs.existsSync(x)) return x; } catch (_) {}
  }
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function windows() {
  const desktop = desktopDir();
  const lnk = path.join(desktop, 'AURELIUM.lnk');
  const target = path.join(ROOT, 'start-aurelium.cmd');
  const icon = path.join(ROOT, 'assets', 'icon.ico');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + JSON.stringify(lnk) + ');',
    '$s.TargetPath = ' + JSON.stringify(target) + ';',
    '$s.WorkingDirectory = ' + JSON.stringify(ROOT) + ';',
    '$s.IconLocation = ' + JSON.stringify(icon) + ';',
    '$s.Description = "AURELIUM - personal AI chief of staff";',
    '$s.Save()'
  ].join(' ');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'inherit' });
  return lnk;
}

function macos() {
  const desktop = desktopDir();
  const appDir = path.join(desktop, 'AURELIUM.app');
  const electronApp = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
  if (fs.existsSync(electronApp)) {
    try { return macosRealBundle(appDir, electronApp); }
    catch (err) { console.warn(`Could not build the full app bundle (${err.message}); making a simple launcher instead.`); }
  }
  return macosLauncherBundle(appDir);
}

// A real app: a copy of Electron.app renamed to AURELIUM, with our icon, that loads this project.
// The Dock, the menu bar and the microphone prompt then all say AURELIUM.
function macosRealBundle(appDir, electronApp) {
  const plistBuddy = '/usr/libexec/PlistBuddy';
  fs.rmSync(appDir, { recursive: true, force: true });
  execFileSync('ditto', [electronApp, appDir], { stdio: 'ignore' });
  const contents = path.join(appDir, 'Contents');
  const res = path.join(contents, 'Resources');
  const plist = path.join(contents, 'Info.plist');
  // Icon
  let iconName = 'electron.icns';
  try {
    const iconset = path.join(os.tmpdir(), 'aurelium.iconset');
    fs.rmSync(iconset, { recursive: true, force: true }); fs.mkdirSync(iconset);
    const src = path.join(ROOT, 'assets', 'icon.png');
    for (const s of [16, 32, 64, 128, 256]) {
      execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(res, 'aurelium.icns')], { stdio: 'ignore' });
    iconName = 'aurelium.icns';
  } catch (_) { /* keep Electron's icon */ }
  // Names and identity
  const set = (key, value) => {
    try { execFileSync(plistBuddy, ['-c', `Set :${key} ${value}`, plist], { stdio: 'ignore' }); }
    catch (_) { execFileSync(plistBuddy, ['-c', `Add :${key} string ${value}`, plist], { stdio: 'ignore' }); }
  };
  set('CFBundleName', 'AURELIUM');
  set('CFBundleDisplayName', 'AURELIUM');
  set('CFBundleIdentifier', 'com.aureliummotion.aurelium');
  set('CFBundleIconFile', iconName);
  set('NSMicrophoneUsageDescription', 'AURELIUM needs the microphone so Motion can hear you.');
  // The app Electron loads: a two-line shim pointing at this project folder.
  const appFolder = path.join(res, 'app');
  fs.mkdirSync(appFolder, { recursive: true });
  fs.writeFileSync(path.join(appFolder, 'package.json'), JSON.stringify({ name: 'aurelium', productName: 'AURELIUM', version: '1.0.0', main: 'index.js' }, null, 2));
  fs.writeFileSync(path.join(appFolder, 'index.js'), `// AURELIUM launcher shim: runs the project at the path below.\nrequire(${JSON.stringify(path.join(ROOT, 'main.js'))});\n`);
  // Re-sign locally so macOS (Apple Silicon in particular) accepts the modified bundle.
  try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' }); } catch (_) {}
  try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', appDir], { stdio: 'ignore' }); } catch (_) {}
  return appDir;
}

// Fallback: a tiny launcher bundle that opens Electron.app with this project.
function macosLauncherBundle(appDir) {
  const macos = path.join(appDir, 'Contents', 'MacOS');
  const res = path.join(appDir, 'Contents', 'Resources');
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(res, { recursive: true });
  const launcher = path.join(macos, 'AURELIUM');
  fs.writeFileSync(launcher, `#!/bin/bash
ROOT=${JSON.stringify(ROOT)}
APP="$ROOT/node_modules/electron/dist/Electron.app"
if [ -d "$APP" ]; then
  exec open -n -a "$APP" --args "$ROOT"
fi
exec open -a Terminal "$ROOT/start-aurelium.sh"
`);
  fs.chmodSync(launcher, 0o755);
  fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AURELIUM</string>
  <key>CFBundleDisplayName</key><string>AURELIUM</string>
  <key>CFBundleIdentifier</key><string>com.aureliummotion.aurelium.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>AURELIUM</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>\n`);
  try {
    const iconset = path.join(os.tmpdir(), 'aurelium.iconset');
    fs.rmSync(iconset, { recursive: true, force: true }); fs.mkdirSync(iconset);
    const src = path.join(ROOT, 'assets', 'icon.png');
    for (const s of [16, 32, 64, 128, 256]) {
      execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(res, 'icon.icns')], { stdio: 'ignore' });
  } catch (_) {}
  return appDir;
}

function linux() {
  const desktop = desktopDir();
  const content = `[Desktop Entry]
Type=Application
Name=AURELIUM
Comment=Personal AI chief of staff
Exec=${path.join(ROOT, 'start-aurelium.sh')}
Path=${ROOT}
Icon=${path.join(ROOT, 'assets', 'icon.png')}
Terminal=false
Categories=Utility;
`;
  const file = path.join(desktop, 'aurelium.desktop');
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
  const appsDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(appsDir, { recursive: true });
  fs.writeFileSync(path.join(appsDir, 'aurelium.desktop'), content);
  try { execFileSync('gio', ['set', file, 'metadata::trusted', 'true'], { stdio: 'ignore' }); } catch (_) {}
  return file;
}

function makeShortcut() {
  if (process.platform === 'win32') return windows();
  if (process.platform === 'darwin') return macos();
  return linux();
}

module.exports = { makeShortcut };

if (require.main === module) {
  try {
    const where = makeShortcut();
    console.log(`Desktop shortcut created for ${info.name}: ${where}`);
  } catch (err) {
    console.error('Could not create the desktop shortcut:', err.message);
    console.error('You can still launch AURELIUM with: npm start');
    process.exit(1);
  }
}
