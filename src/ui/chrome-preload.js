const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('airlock', {
  navigate: (u) => ipcRenderer.invoke('ui:navigate', u),
  reload: () => ipcRenderer.invoke('ui:reload'),
  back: () => ipcRenderer.invoke('ui:back'),
  pin: () => ipcRenderer.invoke('ui:pin'),
  onState: (f) => ipcRenderer.on('state', (_e, s) => f(s)),
  onCaption: (f) => ipcRenderer.on('caption', (_e, t) => f(t)),
  onEvent: (f) => ipcRenderer.on('event', (_e, ev) => f(ev)),
});
