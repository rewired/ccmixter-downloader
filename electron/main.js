import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDownloadQueue } from '../src/main/services/downloader.js';
import { discoverAllFromSources } from '../src/main/services/discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow;
let queue;

async function createMainWindow() {
  queue = createDownloadQueue();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true
    }
  });

  const devURL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  try {
    await mainWindow.loadURL(devURL);
    mainWindow.webContents.openDevTools();
  } catch {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // IPC handlers
  ipcMain.handle('choose-download-root', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('discover', async (_evt, { sources, query }) => {
    return await discoverAllFromSources(sources, query);
  });

  ipcMain.handle('enqueue', async (_evt, { jobs, settings }) => {
    jobs.forEach(job => queue.enqueue(job, settings));
    return { enqueued: jobs.length };
  });

  ipcMain.on('queue-control', (_evt, cmd) => {
    if (!queue) return;
    if (cmd === 'pause') queue.pause();
    if (cmd === 'resume') queue.resume();
  });

  // Forward queue events
  function forwardProgress(ev, data) {
    if (mainWindow) mainWindow.webContents.send('queue-event', { ev, data });
  }
  queue.on('job-progress', d => forwardProgress('job-progress', d));
  queue.on('job-done', d => forwardProgress('job-done', d));
  queue.on('job-error', d => forwardProgress('job-error', d));
  queue.on('queue-idle', () => forwardProgress('queue-idle', {}));
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createMainWindow();
});
