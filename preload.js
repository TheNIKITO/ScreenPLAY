const { contextBridge, ipcRenderer } = require('electron');

// Só o mínimo que as páginas precisam: telas/janelas, manter o monitor ligado e atualizações.
contextBridge.exposeInMainWorld('tav', {
  sources: () => ipcRenderer.invoke('tav:sources'),
  select: (id, withAudio) => ipcRenderer.invoke('tav:select', id, withAudio),
  keepAwake: (on) => ipcRenderer.send('tav:awake', !!on),
  version: () => ipcRenderer.invoke('tav:version'),
  onSplash: (cb) => ipcRenderer.on('tav:splash', (_e, state) => cb(state)),
  onUpdateReady: (cb) => ipcRenderer.on('tav:update-ready', (_e, version) => cb(version)),
  restartToUpdate: () => ipcRenderer.send('tav:restart-update'),
});
