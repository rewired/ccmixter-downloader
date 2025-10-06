import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDownloadQueue, validateDownloadRoot } from '../src/main/services/downloader.js';
import { discoverAllFromSources } from '../src/main/services/discovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');

const SETTINGS_DEFAULTS = {
  downloadRoot: null,
  concurrency: 4,
  unzipEnabled: true,
  structureTemplate: '{artist}/{title}/{kind}',
  sidecarsEnabled: true,
  strictSSL: true
};

const SETTINGS_FILE = 'preferences.json';
let settingsPath;
let settingsCache = null;

function ensureSettingsLoaded() {
  if (settingsCache !== null) {
    return;
  }
  settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    settingsCache = JSON.parse(raw);
  } catch (error) {
    settingsCache = {};
    if (error && error.code !== 'ENOENT') {
      console.warn('Failed to read preferences file:', error);
    }
    persistSettings();
  }
}

function persistSettings() {
  if (!settingsPath) {
    settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settingsCache, null, 2), 'utf8');
}

function readSettings() {
  ensureSettingsLoaded();
  const data = settingsCache || {};
  return {
    downloadRoot: data.downloadRoot ?? SETTINGS_DEFAULTS.downloadRoot,
    concurrency: data.concurrency ?? SETTINGS_DEFAULTS.concurrency,
    unzipEnabled: data.unzipEnabled ?? SETTINGS_DEFAULTS.unzipEnabled,
    structureTemplate: data.structureTemplate ?? SETTINGS_DEFAULTS.structureTemplate,
    sidecarsEnabled: data.sidecarsEnabled ?? SETTINGS_DEFAULTS.sidecarsEnabled,
    strictSSL: data.strictSSL ?? SETTINGS_DEFAULTS.strictSSL
  };
}

function writeSettings(next) {
  ensureSettingsLoaded();
  settingsCache = { ...next };
  persistSettings();
  return readSettings();
}

function resetSettingsToDefaults() {
  ensureSettingsLoaded();
  settingsCache = { ...SETTINGS_DEFAULTS };
  persistSettings();
  return readSettings();
}

function normalizeSettings(patch = {}) {
  const merged = {
    ...readSettings(),
    ...patch
  };
  merged.concurrency = Math.max(1, Number.parseInt(merged.concurrency ?? SETTINGS_DEFAULTS.concurrency, 10) || 1);
  merged.unzipEnabled = Boolean(merged.unzipEnabled);
  merged.sidecarsEnabled = merged.sidecarsEnabled ?? SETTINGS_DEFAULTS.sidecarsEnabled;
  merged.strictSSL = merged.strictSSL ?? SETTINGS_DEFAULTS.strictSSL;
  merged.strictSSL = Boolean(merged.strictSSL);
  merged.structureTemplate = String(merged.structureTemplate || SETTINGS_DEFAULTS.structureTemplate);
  merged.downloadRoot = merged.downloadRoot || null;
  return merged;
}

let mainWindow;
let queue;

function wireQueueEvents() {
  if (!queue) return;
  const forward = (ev, data = {}) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('queue-event', { ev, data });
    }
  };
  queue.on('job-progress', (data) => forward('job-progress', data));
  queue.on('job-done', (data) => forward('job-done', data));
  queue.on('job-error', (data) => forward('job-error', data));
  queue.on('queue-idle', () => forward('queue-idle'));
  queue.on('queue-paused', () => forward('queue-paused'));
  queue.on('queue-resumed', () => forward('queue-resumed'));
  queue.on('queue-root-invalid', (data) => forward('queue-root-invalid', data));
}

async function createMainWindow() {
  if (!queue) {
    queue = createDownloadQueue(readSettings());
    wireQueueEvents();
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true
    }
  });

  if (isDev) {
    const devURL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    await mainWindow.loadURL(devURL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

ipcMain.handle('choose-download-root', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-settings', async () => {
  const settings = readSettings();
  const validation = await validateDownloadRoot(settings.downloadRoot);
  return { ...settings, validation };
});

ipcMain.handle('save-settings', async (_evt, patch) => {
  const next = normalizeSettings(patch);
  const persisted = writeSettings(next);
  queue?.configure(persisted);
  const validation = await validateDownloadRoot(persisted.downloadRoot);
  return { ...persisted, validation };
});

ipcMain.handle('reset-settings', async () => {
  const defaults = resetSettingsToDefaults();
  queue?.configure(defaults);
  const validation = await validateDownloadRoot(defaults.downloadRoot);
  return { ...defaults, validation };
});

ipcMain.handle('discover', async (_evt, payload) => {
  const { sources = [], query = '' } = payload || {};
  const settings = readSettings();
  try {
    return await discoverAllFromSources(sources, query, { strictSSL: settings.strictSSL });
  } catch (error) {
    return [{
      origin: Array.isArray(sources) ? sources.join(', ') : String(sources || ''),
      source: null,
      uploadId: null,
      stage: null,
      trackInfo: null,
      jobs: [],
      errors: [error instanceof Error ? error.message : String(error)]
    }];
  }
});

ipcMain.handle('enqueue', async (_evt, payload) => {
  if (!queue) {
    throw new Error('Queue not ready');
  }
  const { jobs = [], settings: patch = {} } = payload || {};
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { enqueued: 0 };
  }
  const nextSettings = normalizeSettings(patch);
  const validation = await validateDownloadRoot(nextSettings.downloadRoot);
  if (!validation.valid) {
    queue.pause();
    throw new Error(validation.reason || 'Invalid download folder');
  }
  writeSettings(nextSettings);
  queue.configure(nextSettings);
  return queue.enqueue(jobs, nextSettings);
});

ipcMain.on('queue-control', (_evt, command) => {
  if (!queue) return;
  if (command === 'pause') queue.pause();
  if (command === 'resume') queue.resume();
});

app.whenReady().then(async () => {
  ensureSettingsLoaded();
  await createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

