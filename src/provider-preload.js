// window.near for every page. It lives in the isolated world, so a page can call
// it but cannot replace, wrap or read it. Signing happens in the main process.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('near', Object.freeze({
  isAirlock: true,
  getAccountId: () => ipcRenderer.invoke('near:account'),
  // tx: { receiverId, actions: [{ type: 'Transfer' | 'FunctionCall' | 'AddKey' | ..., params }] } (wallet-selector shape)
  signAndSendTransaction: (tx) => ipcRenderer.invoke('near:sign', JSON.parse(JSON.stringify(tx))),
}));
