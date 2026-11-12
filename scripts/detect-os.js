// Detects the operating system and hardware so AURELIUM can adapt to Juan's machine.
'use strict';
const os = require('os');
const fs = require('fs');

function linuxDistro() {
  try {
    const txt = fs.readFileSync('/etc/os-release', 'utf8');
    const m = txt.match(/^PRETTY_NAME="?(.*?)"?$/m);
    if (m) return m[1];
  } catch (_) {}
  return 'Linux';
}

function describeOS() {
  const platform = process.platform;
  let name = 'Unknown';
  let version = os.release();
  if (platform === 'win32') {
    name = 'Windows';
    const build = parseInt(version.split('.')[2] || '0', 10);
    version = build >= 22000 ? '11' : '10';
  } else if (platform === 'darwin') {
    name = 'macOS';
    const major = parseInt(version.split('.')[0], 10);
    // Darwin kernel -> macOS marketing version (approximate for new releases)
    const map = { 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26' };
    version = map[major] || `Darwin ${version}`;
  } else if (platform === 'linux') {
    name = linuxDistro();
    version = '';   // the distro name already carries its version
  }
  const cpus = os.cpus();
  return {
    platform,
    name,
    version,
    arch: os.arch(),
    cpuModel: cpus[0] ? cpus[0].model.trim() : 'unknown CPU',
    cpuCount: cpus.length,
    ramGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    hostname: os.hostname(),
    user: os.userInfo().username,
    home: os.homedir(),
    desktop: require('path').join(os.homedir(), 'Desktop')
  };
}

module.exports = { describeOS };

if (require.main === module) {
  const i = describeOS();
  console.log(`Operating system : ${i.name} ${i.version} (${i.arch})`);
  console.log(`Processor        : ${i.cpuModel} x${i.cpuCount}`);
  console.log(`Memory           : ${i.ramGB} GB`);
  console.log(`User / home      : ${i.user} / ${i.home}`);
}
