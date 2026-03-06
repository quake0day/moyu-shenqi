const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kmbox', {
  connect: (ip, port, uuid) => ipcRenderer.invoke('kmbox:connect', ip, port, uuid),
  move: (x, y) => ipcRenderer.invoke('kmbox:move', x, y),
  moveAuto: (x, y, ms) => ipcRenderer.invoke('kmbox:moveAuto', x, y, ms),
  moveBeizer: (x, y, ms, x1, y1, x2, y2) => ipcRenderer.invoke('kmbox:moveBeizer', x, y, ms, x1, y1, x2, y2),
  keydown: (code) => ipcRenderer.invoke('kmbox:keydown', code),
  keyup: (code) => ipcRenderer.invoke('kmbox:keyup', code),
});

contextBridge.exposeInMainWorld('ollama', {
  listModels: (url) => ipcRenderer.invoke('ollama:listModels', url),
  generate: (url, model, prompt, system) => ipcRenderer.invoke('ollama:generate', url, model, prompt, system),
});
