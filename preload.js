const { contextBridge, ipcRenderer } = require('electron');

// Liga um ouvinte e devolve a função que desliga.
function listen(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// Só o mínimo que as páginas precisam: telas/janelas, som por app, monitor ligado e atualizações.
contextBridge.exposeInMainWorld('tav', {
  sources: () => ipcRenderer.invoke('tav:sources'),
  select: (id, withAudio) => ipcRenderer.invoke('tav:select', id, withAudio),
  keepAwake: (on) => ipcRenderer.send('tav:awake', !!on),
  audioStart: (opts) => ipcRenderer.invoke('tav:audio-start', opts),
  audioStop: () => ipcRenderer.invoke('tav:audio-stop'),
  onPcm: (cb) => listen('tav:pcm', cb),
  onAudioEnded: (cb) => listen('tav:audio-ended', cb),
  version: () => ipcRenderer.invoke('tav:version'),
  onSplash: (cb) => listen('tav:splash', cb),
  onUpdateReady: (cb) => listen('tav:update-ready', cb),
  restartToUpdate: () => ipcRenderer.send('tav:restart-update'),
});
