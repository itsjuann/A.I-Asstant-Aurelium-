// Bridge between the renderer (web page) and the main process. Only these functions are exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aurelium', {
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  getSystemStats: () => ipcRenderer.invoke('system:stats'),
  getTodayTasks: () => ipcRenderer.invoke('tasks:today'),
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.send('app:toggle-fullscreen'),
  platform: process.platform
});
