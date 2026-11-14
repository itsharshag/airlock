const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('approval', {
  get: (id) => ipcRenderer.invoke('approval:get', id),
  decide: (id, yes) => ipcRenderer.invoke('approval:decide', id, yes),
});
