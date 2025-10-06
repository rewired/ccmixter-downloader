import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import got from 'got';
import unzipper from 'unzipper';

const DEFAULT_SETTINGS = {
  downloadRoot: '',
  concurrency: 4,
  unzipEnabled: true,
  structureTemplate: '{artist}/{title}/{kind}',
  sidecarsEnabled: true
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
  Accept: 'application/octet-stream,video/*;q=0.9,audio/*;q=0.8,*/*;q=0.7',
  Connection: 'keep-alive'
};

class DownloadRootError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DownloadRootError';
    this.code = 'DOWNLOAD_ROOT_INVALID';
  }
}

function sanitizeSegment(value, fallback) {
  const str = String(value ?? '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return str || fallback;
}

function sanitizeFilename(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'download';
  const lastDot = raw.lastIndexOf('.');
  if (lastDot <= 0) return sanitizeSegment(raw, 'download');
  const base = raw.slice(0, lastDot);
  const ext = raw.slice(lastDot + 1);
  const sanitizedBase = sanitizeSegment(base, 'download');
  const sanitizedExt = ext.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  return sanitizedExt ? `${sanitizedBase}.${sanitizedExt}` : sanitizedBase;
}

function resolveStructureSegments(template, job) {
  const kindLabel = job.isZip ? 'Stems' : 'Files';
  const tokens = {
    artist: sanitizeSegment(job.meta?.artist || 'Unknown Artist', 'Unknown Artist'),
    title: sanitizeSegment(job.meta?.title || `Upload ${job.uploadId || ''}`, 'Untitled'),
    kind: sanitizeSegment(kindLabel, kindLabel)
  };

  const segments = [];
  const trackSegments = [];
  const parts = (template || DEFAULT_SETTINGS.structureTemplate).split('/');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const containsKind = trimmed.includes('{kind}');
    const replaced = trimmed.replace(/\{(artist|title|kind)\}/g, (_, key) => tokens[key] || '');
    const sanitized = sanitizeSegment(replaced, containsKind ? tokens.kind : tokens.title);
    if (!sanitized) continue;
    segments.push(sanitized);
    if (!containsKind) {
      trackSegments.push(sanitized);
    }
  }
  if (!trackSegments.length) {
    trackSegments.push(...segments);
  }
  return { segments, trackSegments };
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function getFileSize(file) {
  try {
    const stats = await fsp.stat(file);
    return stats.size;
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
}

async function assertRootAvailable(root) {
  if (!root) {
    throw new DownloadRootError('Download folder is not configured');
  }
  try {
    await fsp.access(root, fs.constants.W_OK);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new DownloadRootError('Download folder does not exist');
    }
    throw new DownloadRootError('Download folder is not writable');
  }
}

function isDownloadRootError(error) {
  return Boolean(error && (error.code === 'DOWNLOAD_ROOT_INVALID' || error instanceof DownloadRootError));
}

async function streamWithResume(url, tmpPath, referer, onProgress) {
  let attemptUrl = url;
  let attempt = 0;
  let existingBytes = await getFileSize(tmpPath);

  while (attempt < 2) {
    attempt += 1;
    const headers = { ...BROWSER_HEADERS };
    if (referer) headers.Referer = referer;
    if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;

    const writeStream = fs.createWriteStream(tmpPath, { flags: existingBytes > 0 ? 'a' : 'w' });
    try {
      await new Promise((resolve, reject) => {
        const stream = got.stream(attemptUrl, {
          headers,
          timeout: { request: 60000 }
        });
        stream.on('downloadProgress', (progress) => {
          const received = existingBytes + progress.transferred;
          const total = progress.total ? existingBytes + progress.total : undefined;
          if (typeof onProgress === 'function') {
            const percent = total ? Math.min(100, Math.round((received / total) * 100)) : undefined;
            onProgress({ received, total, percent });
          }
        });
        stream.on('error', (err) => writeStream.destroy(err));
        writeStream.on('error', reject);
        writeStream.on('finish', resolve);
        stream.pipe(writeStream);
      });
      break;
    } catch (error) {
      if (attempt === 1 && error?.response?.statusCode === 403 && attemptUrl.startsWith('https://')) {
        attemptUrl = `http://${attemptUrl.slice('https://'.length)}`;
        existingBytes = await getFileSize(tmpPath);
        continue;
      }
      throw error;
    }
  }

  if (typeof onProgress === 'function') {
    const finalSize = await getFileSize(tmpPath);
    onProgress({ received: finalSize, total: finalSize, percent: 100 });
  }

  return { finalUrl: attemptUrl };
}

async function unzipTo(zipPath, targetDir) {
  await ensureDir(targetDir);
  await pipeline(
    fs.createReadStream(zipPath),
    unzipper.Extract({ path: targetDir })
  );
}

async function writeSidecars(trackDir, meta) {
  await ensureDir(trackDir);
  const attribution = [
    `Title: ${meta.title || ''}`,
    `Artist: ${meta.artist || ''}`,
    `URL: ${meta.pageUrl || ''}`,
    `License: ${meta.licenseName || ''}`,
    `License URL: ${meta.licenseUrl || ''}`,
    'Downloaded via ccMixter Downloader'
  ].join('\n') + '\n';

  const licenseContent = [meta.licenseName || '', meta.licenseUrl || ''].filter(Boolean).join(' - ') + '\n';

  await Promise.all([
    fsp.writeFile(path.join(trackDir, 'ATTRIBUTION.txt'), attribution, 'utf-8'),
    fsp.writeFile(path.join(trackDir, 'LICENSE.txt'), licenseContent, 'utf-8')
  ]);
}

async function preparePaths(job, settings) {
  const root = settings.downloadRoot || '';
  await assertRootAvailable(root);

  const { segments, trackSegments } = resolveStructureSegments(settings.structureTemplate, job);
  const jobDir = segments.length ? path.join(root, ...segments) : root;
  const trackDir = trackSegments.length ? path.join(root, ...trackSegments) : jobDir;
  const finalPath = path.join(jobDir, sanitizeFilename(job.filename));
  const tmpPath = `${finalPath}.part`;
  return { jobDir, trackDir, finalPath, tmpPath };
}

async function downloadJob(job, settings, onProgress) {
  const paths = await preparePaths(job, settings);
  await ensureDir(paths.jobDir);

  const referer = job.meta?.pageUrl || '';
  await streamWithResume(job.url, paths.tmpPath, referer, onProgress);

  await fsp.rm(paths.finalPath, { force: true });
  await fsp.rename(paths.tmpPath, paths.finalPath);

  if (job.isZip && settings.unzipEnabled) {
    await unzipTo(paths.finalPath, paths.jobDir);
  }

  if (settings.sidecarsEnabled !== false) {
    await writeSidecars(paths.trackDir, job.meta || {});
  }

  return { finalPath: paths.finalPath };
}

export async function validateDownloadRoot(dir) {
  if (!dir) {
    return { valid: false, reason: 'Choose a download folder before starting.' };
  }
  try {
    const stats = await fsp.stat(dir);
    if (!stats.isDirectory()) {
      return { valid: false, reason: 'Download folder is not a directory.' };
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { valid: false, reason: 'Download folder does not exist.' };
    }
    return { valid: false, reason: error.message };
  }

  const probe = path.join(dir, `.ccmixter-probe-${Date.now()}`);
  try {
    await fsp.writeFile(probe, 'probe');
    await fsp.rm(probe, { force: true });
  } catch (error) {
    return { valid: false, reason: 'Download folder is not writable.' };
  }

  return { valid: true, reason: null };
}

export function createDownloadQueue(initialSettings = {}) {
  const emitter = new EventEmitter();
  const pending = [];
  let active = 0;
  let paused = false;
  let settings = { ...DEFAULT_SETTINGS, ...initialSettings };

  function setSettings(next) {
    if (!next) return;
    settings = {
      ...settings,
      ...next,
      concurrency: Math.max(1, Number.parseInt(next.concurrency ?? settings.concurrency, 10) || 1),
      unzipEnabled: next.unzipEnabled ?? settings.unzipEnabled,
      structureTemplate: next.structureTemplate ?? settings.structureTemplate,
      sidecarsEnabled: next.sidecarsEnabled ?? settings.sidecarsEnabled,
      downloadRoot: next.downloadRoot ?? settings.downloadRoot
    };
  }

  async function runJob(entry) {
    const { job, snapshot } = entry;
    try {
      await downloadJob(job, snapshot, (progress) => {
        emitter.emit('job-progress', {
          jobId: job.id,
          uploadId: job.uploadId,
          url: job.url,
          filename: job.filename,
          progress
        });
      });
      emitter.emit('job-done', {
        jobId: job.id,
        uploadId: job.uploadId,
        url: job.url,
        filename: job.filename
      });
    } catch (error) {
      if (isDownloadRootError(error)) {
        paused = true;
        emitter.emit('queue-root-invalid', {
          reason: error.message,
          jobId: job.id,
          uploadId: job.uploadId,
          url: job.url
        });
      }
      emitter.emit('job-error', {
        jobId: job.id,
        uploadId: job.uploadId,
        url: job.url,
        filename: job.filename,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      active -= 1;
      schedule();
    }
  }

  function schedule() {
    if (paused) return;
    while (active < settings.concurrency && pending.length) {
      const next = pending.shift();
      active += 1;
      runJob(next);
    }
    if (!pending.length && active === 0) {
      emitter.emit('queue-idle');
    }
  }

  function enqueue(jobs, enqueueSettings = {}) {
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { enqueued: 0 };
    }
    setSettings(enqueueSettings);
    const snapshot = { ...settings, ...enqueueSettings };
    for (const job of jobs) {
      pending.push({ job, snapshot });
    }
    schedule();
    return { enqueued: jobs.length };
  }

  function pause() {
    paused = true;
    emitter.emit('queue-paused');
  }

  function resume() {
    if (!paused) return;
    paused = false;
    emitter.emit('queue-resumed');
    schedule();
  }

  function configure(next) {
    setSettings(next);
    schedule();
  }

  return Object.assign(emitter, {
    enqueue,
    pause,
    resume,
    configure,
    pendingCount: () => pending.length
  });
}

