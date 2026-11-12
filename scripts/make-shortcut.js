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
  const macos = path.join(appDir, 'Contents', 'MacOS');
  const res = path.join(appDir, 'Contents', 'Resources');
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(res, { recursive: true });
  const launcher = path.join(macos, 'AURELIUM');
  fs.writeFileSync(launcher, `#!/bin/bash\n# Opens Terminal-free: run the launcher script in the project folder.\nexport PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"\ncd ${JSON.stringify(ROOT)}\nexec ./start-aurelium.sh\n`);
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
  // Build an .icns from the PNG using the tools that ship with macOS. Non-fatal if it fails.
  try {
    const iconset = path.join(os.tmpdir(), 'aurelium.iconset');
    fs.rmSync(iconset, { recursive: true, force: true });
    fs.mkdirSync(iconset);
    const src = path.join(ROOT, 'assets', 'icon.png');
    for (const s of [16, 32, 64, 128, 256]) {
      execFileSync('sips', ['-z', String(s), String(s), src, '--out', path.join(iconset, `icon_${s}x${s}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(iconset, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(res, 'icon.icns')], { stdio: 'ignore' });
  } catch (_) { /* icon optional */ }
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
