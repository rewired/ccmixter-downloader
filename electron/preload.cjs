const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ccm', {
  chooseDownloadRoot: () => ipcRenderer.invoke('choose-download-root'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  discover: (payload) => {
    if (Array.isArray(payload) || typeof payload === 'string') {
      return ipcRenderer.invoke('discover', { sources: payload });
    }
    return ipcRenderer.invoke('discover', payload ?? {});
  },
  enqueue: (jobs, settings) => ipcRenderer.invoke('enqueue', { jobs, settings }),
  control: (cmd) => ipcRenderer.send('queue-control', cmd),
  onQueueEvent: (fn) => {
    if (typeof fn !== 'function') return () => {};
    const handler = (_evt, payload) => fn(payload);
    ipcRenderer.on('queue-event', handler);
    return () => ipcRenderer.removeListener('queue-event', handler);
  }
});

