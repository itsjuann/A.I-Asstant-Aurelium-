// Bridge between the renderer (web page) and the main process. Only these functions are exposed.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, cb) => { const h = (_e, payload) => cb(payload); ipcRenderer.on(channel, h); return () => ipcRenderer.removeListener(channel, h); };

contextBridge.exposeInMainWorld('aurelium', {
  platform: process.platform,
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  getTodayTasks: () => ipcRenderer.invoke('tasks:today'),
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.send('app:toggle-fullscreen'),

  // Voice + brain
  sendUtterance: (samples) => ipcRenderer.send('voice:utterance', samples),
  sendWakeSegment: (samples) => ipcRenderer.invoke('voice:wake-check', samples),
  sendText: (text) => ipcRenderer.send('brain:text', text),
  interrupt: () => ipcRenderer.send('voice:interrupt'),
  resetConversation: () => ipcRenderer.send('brain:reset'),
  voiceTest: () => ipcRenderer.send('voice:test'),
  briefing: () => ipcRenderer.send('brain:briefing'),
  openCrm: () => ipcRenderer.send('crm:open'),
  onState: (cb) => listen('state', cb),
  onStatus: (cb) => listen('status', cb),
  onReady: (cb) => listen('voice:ready', cb),
  onTranscript: (cb) => listen('transcript', cb),
  onTranscriptStart: (cb) => listen('transcript:start', cb),
  onTranscriptDelta: (cb) => listen('transcript:delta', cb),
  onTranscriptEnd: (cb) => listen('transcript:end', cb),
  onAudio: (cb) => listen('tts:audio', cb),
  onPipelineDone: (cb) => listen('pipeline:done', cb),
  onPushToTalk: (cb) => listen('voice:ptt', cb)
});
