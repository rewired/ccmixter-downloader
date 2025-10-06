import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ccm', {
  chooseDownloadRoot: () => ipcRenderer.invoke('choose-download-root'),
  discover: (sources) => ipcRenderer.invoke('discover', { sources }),
  enqueue: (jobs, settings) => ipcRenderer.invoke('enqueue', { jobs, settings }),
  control: (cmd) => ipcRenderer.send('queue-control', cmd),
  onQueueEvent: (fn) => ipcRenderer.on('queue-event', (_e, payload) => fn(payload))
});
