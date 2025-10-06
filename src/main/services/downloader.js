import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import got from 'got';
import unzipper from 'unzipper';

export function createDownloadQueue() {
  const ee = new EventEmitter();
  let running = 0;
  let paused = false;
  const q = [];
  let concurrency = 4;

  async function processNext() {
    if (paused) return;
    if (running >= concurrency) return;
    const item = q.shift();
    if (!item) {
      if (running === 0) ee.emit('queue-idle');
      return;
    }
    running++;
    try {
      await downloadOne(item.job, item.settings, (prog) => ee.emit('job-progress', { id: item.job.url, ...prog }));
      ee.emit('job-done', { id: item.job.url });
    } catch (err) {
      ee.emit('job-error', { id: item.job.url, error: String(err) });
    } finally {
      running--;
      processNext();
    }
  }

  function enqueue(job, settings) {
    if (settings?.concurrency) concurrency = settings.concurrency;
    q.push({ job, settings });
    processNext();
  }

  function pause() { paused = true; }
  function resume() { paused = false; processNext(); }

  return Object.assign(ee, { enqueue, pause, resume });
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim();
}


async function streamToFile(url, tmpPath, onProgress, referer = '') {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';
  const flags = fs.existsSync(tmpPath) ? 'a' : 'w';
  const out = fs.createWriteStream(tmpPath, { flags });
  const stat = fs.existsSync(tmpPath) ? fs.statSync(tmpPath) : { size: 0 };
  const baseHeaders = {
    'User-Agent': ua,
    'Accept': '*/*',
    'Connection': 'keep-alive'
  };
  if (referer) baseHeaders['Referer'] = referer;

  async function tryOnce(u) {
    const headers = { ...baseHeaders };
    if (stat.size > 0) headers['Range'] = `bytes=${stat.size}-`;
    const stream = got.stream(u, { headers });
    stream.on('downloadProgress', (p) => onProgress && onProgress({ received: p.transferred }));
    return new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.pipe(out, { end: false });
      stream.on('end', resolve);
    });
  }

  try {
    await tryOnce(url);
  } catch (err) {
    // If forbidden, retry once with http:// (some hosts anti-leech on https)
    const status = err?.response?.statusCode;
    if (status === 403 && url.startsWith('https://')) {
      const httpUrl = 'http://' + url.slice('https://'.length);
      await tryOnce(httpUrl);
    } else {
      throw err;
    }
  } finally {
    out.end();
  }
}
async function unzipTo(targetZip, toDir) {
  await ensureDir(toDir);
  await fs.createReadStream(targetZip).pipe(unzipper.Extract({ path: toDir })).promise();
}

async function writeSidecars(dir, meta) {
  const attribution = [
    `Title: ${meta.title || ''}`,
    `Artist: ${meta.artist || ''}`,
    `URL: ${meta.pageUrl || ''}`,
    `License: ${meta.licenseName || ''} (${meta.licenseUrl || ''})`,
    `Downloaded via ccmIxter Downloader`
  ].join('\n');
  await fsp.writeFile(path.join(dir, 'ATTRIBUTION.txt'), attribution, 'utf-8');
  await fsp.writeFile(path.join(dir, 'LICENSE.txt'), `${meta.licenseName || ''} - ${meta.licenseUrl || ''}`, 'utf-8');
}

async function downloadOne(job, settings = {}, onProgress) {
  const root = settings.downloadRoot || path.resolve(process.cwd(), 'downloads');
  const kind = job.isZip ? 'Stems' : 'Files';
  const folderTemplate = settings.structureTemplate || '{artist}/{title}/{kind}';
  const dir = path.join(
    root,
    sanitize((job.meta?.artist) || 'Unknown'),
    sanitize((job.meta?.title) || 'Untitled'),
    sanitize(folderTemplate.replace('{kind}', kind).split('/').pop())
  );
  await ensureDir(dir);

  const finalPath = path.join(dir, sanitize(job.name));
  const tmpPath = finalPath + '.part';

  await streamToFile(job.url, tmpPath, onProgress, job.meta?.pageUrl || '');

  if (job.isZip && settings.unzip !== false) {
    await unzipTo(tmpPath, dir);
    await fsp.rm(tmpPath, { force: true });
  } else {
    await fsp.rename(tmpPath, finalPath);
  }

  if (settings.sidecars?.license !== false || settings.sidecars?.attribution !== false) {
    await writeSidecars(dir, job.meta || {});
  }
}
