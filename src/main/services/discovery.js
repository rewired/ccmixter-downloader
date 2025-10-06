import { createHash } from 'node:crypto';
import got from 'got';

const USER_AGENT = 'ccMixter Downloader/0.1 (+https://ccmixter.org)';
const DOWNLOAD_EXTENSION_RX = /\.(zip|wav|flac|mp3|ogg)$/i;
const HTML_TEMPLATE_VARIANTS = ['links_by_dl', 'links_dl', 'links', 'links_content'];
const ARTIST_PAGE_SIZE = 20;
const MAX_ARTIST_PAGES = 10;
const MAX_ARTIST_UPLOADS = 50;

function createHttpClient(strictSSL = true) {
  return got.extend({
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
    },
    timeout: { request: 25000 },
    https: { rejectUnauthorized: strictSSL }
  });
}

function normalizeSources(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(/[\r\n\s]+/);
  const seen = new Set();
  const normalized = [];
  for (const raw of list) {
    const value = String(raw || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function classifySource(source) {
  try {
    const url = new URL(source);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'files' && parts.length >= 3) {
      return { kind: 'track', user: parts[1], uploadId: parts[2] };
    }
    if (parts[0] === 'people' && parts.length >= 2) {
      return { kind: 'artist', artist: parts[1] };
    }
  } catch (error) {
    return { kind: 'unknown', error };
  }
  return { kind: 'unknown' };
}

function createJobId(uploadId, url) {
  return `${uploadId}-${createHash('sha1').update(url).digest('hex').slice(0, 8)}`;
}

function filenameFromUrl(url) {
  if (!url) return 'download';
  try {
    const clean = url.split('?')[0];
    const segment = clean.substring(clean.lastIndexOf('/') + 1);
    const decoded = decodeURIComponent(segment || '');
    return decoded.trim() || 'download';
  } catch (error) {
    return 'download';
  }
}

function createJobDescriptor(uploadId, url, overrides = {}) {
  if (!url) return null;
  const filename = overrides.filename || filenameFromUrl(url);
  const isZip = typeof overrides.isZip === 'boolean'
    ? overrides.isZip
    : filename.toLowerCase().endsWith('.zip');
  return {
    id: overrides.id || createJobId(uploadId, url),
    uploadId,
    url,
    filename,
    size: Number.isFinite(overrides.size) ? overrides.size : null,
    isZip,
    stage: overrides.stage || null,
    meta: overrides.meta || {}
  };
}

function dedupeByUrl(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = job.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultPageUrl(user, uploadId) {
  if (!user) return '';
  return `https://ccmixter.org/files/${user}/${uploadId}`;
}

function buildTrackInfo(uploadId, info, fallbackUser) {
  if (!info && !fallbackUser) {
    return {
      uploadId,
      title: `Upload ${uploadId}`,
      artist: '',
      artistSlug: '',
      licenseName: '',
      licenseUrl: '',
      pageUrl: defaultPageUrl('', uploadId)
    };
  }

  const artistSlug = info?.user_name || fallbackUser || '';
  return {
    uploadId,
    title: info?.file_name || info?.upload_name || `Upload ${uploadId}`,
    artist: info?.user_real_name || info?.user_name || fallbackUser || '',
    artistSlug,
    licenseName: info?.license_name || '',
    licenseUrl: info?.license_url || '',
    pageUrl: info?.file_page_url || defaultPageUrl(artistSlug, uploadId)
  };
}

function applyMetadata(job, trackInfo, fallbackUser, uploadId) {
  const pageUrl = job.meta?.pageUrl
    || trackInfo?.pageUrl
    || defaultPageUrl(fallbackUser || trackInfo?.artistSlug || '', uploadId);
  const enrichedMeta = {
    ...job.meta,
    title: job.meta?.title || trackInfo?.title || `Upload ${uploadId}`,
    artist: job.meta?.artist || trackInfo?.artist || fallbackUser || '',
    licenseName: job.meta?.licenseName || trackInfo?.licenseName || '',
    licenseUrl: job.meta?.licenseUrl || trackInfo?.licenseUrl || '',
    pageUrl
  };
  return { ...job, meta: enrichedMeta };
}

async function safeJson(url, http) {
  try {
    const data = await http(url).json();
    return { data };
  } catch (error) {
    return { error };
  }
}

async function safeText(url, http) {
  try {
    const data = await http(url).text();
    return { data };
  } catch (error) {
    return { error };
  }
}

async function discoverViaApi(uploadId, fallbackUser, http) {
  const errors = [];
  const base = 'https://ccmixter.org/api/query?f=json';
  const filesUrl = `${base}&dataview=files&ids=${uploadId}`;
  const infoUrl = `${base}&dataview=info&ids=${uploadId}`;
  const [filesResult, infoResult] = await Promise.allSettled([
    http(filesUrl).json(),
    http(infoUrl).json()
  ]);

  let trackInfo = buildTrackInfo(uploadId, null, fallbackUser);
  if (infoResult.status === 'fulfilled') {
    const info = Array.isArray(infoResult.value) ? infoResult.value[0] : null;
    trackInfo = buildTrackInfo(uploadId, info, fallbackUser);
  } else {
    errors.push(`Official API info failed: ${infoResult.reason?.message || infoResult.reason}`);
  }

  let jobs = [];
  if (filesResult.status === 'fulfilled') {
    const files = Array.isArray(filesResult.value) ? filesResult.value : [];
    jobs = files
      .map((file) => {
        const url = file.download_url || file.file_url || '';
        if (!url) return null;
        return createJobDescriptor(uploadId, url, {
          filename: file.filename || file.file_name || filenameFromUrl(url),
          size: Number.parseInt(file.filesize || file.file_rawsize, 10) || null,
          isZip: typeof file.filename === 'string' && file.filename.toLowerCase().endsWith('.zip'),
          stage: 'api',
          meta: {
            title: file.file_name || file.filename || '',
            artist: trackInfo.artist,
            licenseName: trackInfo.licenseName,
            licenseUrl: trackInfo.licenseUrl,
            pageUrl: trackInfo.pageUrl
          }
        });
      })
      .filter(Boolean);
  } else {
    errors.push(`Official API files failed: ${filesResult.reason?.message || filesResult.reason}`);
  }

  jobs = jobs.map((job) => applyMetadata(job, trackInfo, fallbackUser, uploadId));
  return { trackInfo, jobs, errors };
}

function parseM3u(text) {
  if (!text) return [];
  const urls = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    urls.push(line);
  }
  return urls;
}

async function discoverViaLegacyM3u(uploadId, http) {
  const url = `https://ccmixter.org/api/query?f=m3u&ids=${uploadId}`;
  const { data, error } = await safeText(url, http);
  if (error) {
    return { jobs: [], errors: [`Legacy M3U failed: ${error.message || error}`] };
  }
  const jobs = parseM3u(data)
    .map((m3uUrl) => createJobDescriptor(uploadId, m3uUrl, { stage: 'legacy-m3u' }))
    .filter(Boolean);
  return { jobs, errors: [] };
}

function normalizeUrl(url) {
  if (!url) return '';
  let value = url.replace(/&amp;/g, '&').trim();
  if (value.startsWith('//')) value = `https:${value}`;
  if (value.startsWith('/')) value = `https://ccmixter.org${value}`;
  return value;
}

function extractDownloadUrls(html) {
  if (!html) return [];
  const urls = new Set();

  const attrRx = /\b(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attrRx.exec(html)) !== null) {
    const candidate = normalizeUrl(match[1]);
    if (DOWNLOAD_EXTENSION_RX.test(candidate)) urls.add(candidate);
  }

  const onclickRx = /onclick\s*=\s*["'][^"']*?\bwindow\.open\s*\(\s*['"]([^'"]+)['"]/gi;
  while ((match = onclickRx.exec(html)) !== null) {
    const candidate = normalizeUrl(match[1]);
    if (DOWNLOAD_EXTENSION_RX.test(candidate)) urls.add(candidate);
  }

  const quotedRx = /["'](\/[^"']+\.(?:zip|wav|flac|mp3|ogg)(?:\?[^"']*)?)["']/gi;
  while ((match = quotedRx.exec(html)) !== null) {
    const candidate = normalizeUrl(match[1]);
    if (DOWNLOAD_EXTENSION_RX.test(candidate)) urls.add(candidate);
  }

  const absoluteRx = /https?:\/\/[\w\-./%?=&+#]+?\.(?:zip|wav|flac|mp3|ogg)(?:\?[\w\-./%?=&+#]*)?/gi;
  while ((match = absoluteRx.exec(html)) !== null) {
    urls.add(match[0]);
  }

  return Array.from(urls);
}

async function discoverViaHtmlTemplates(uploadId, http) {
  const collected = new Set();
  const errors = [];
  for (const variant of HTML_TEMPLATE_VARIANTS) {
    const endpoint = `https://ccmixter.org/api/query?f=html&t=${variant}&ids=${uploadId}`;
    const { data, error } = await safeText(endpoint, http);
    if (error) {
      errors.push(`HTML template ${variant} failed: ${error.message || error}`);
      continue;
    }
    extractDownloadUrls(data).forEach((url) => collected.add(url));
  }
  const jobs = Array.from(collected)
    .map((url) => createJobDescriptor(uploadId, url, { stage: 'html-template' }))
    .filter(Boolean);
  return { jobs, errors };
}

async function discoverViaTrackPage(user, uploadId, http) {
  if (!user) {
    return { jobs: [], errors: ['Track page lookup skipped: missing artist slug'] };
  }
  const endpoint = `https://ccmixter.org/files/${user}/${uploadId}`;
  const { data, error } = await safeText(endpoint, http);
  if (error) {
    return { jobs: [], errors: [`Track page scrape failed: ${error.message || error}`] };
  }
  const jobs = extractDownloadUrls(data)
    .map((url) => createJobDescriptor(uploadId, url, { stage: 'track-page' }))
    .filter(Boolean);
  return { jobs, errors: [] };
}

async function extractUploadTargetsFromArtistPages(artist, http) {
  const targets = [];
  const errors = [];
  const seenUploadIds = new Set();

  for (let page = 0; page < MAX_ARTIST_PAGES && targets.length < MAX_ARTIST_UPLOADS; page++) {
    const offset = page * ARTIST_PAGE_SIZE;
    const endpoint = `https://ccmixter.org/people/${artist}?offset=${offset}`;
    const { data, error } = await safeText(endpoint, http);
    if (error) {
      errors.push(`Artist page ${page + 1} failed: ${error.message || error}`);
      break;
    }
    const rx = /\/files\/([^/]+)\/(\d+)/gi;
    let match;
    let foundOnPage = 0;
    while ((match = rx.exec(data)) !== null && targets.length < MAX_ARTIST_UPLOADS) {
      const [, userSlug, uploadId] = match;
      if (seenUploadIds.has(uploadId)) continue;
      seenUploadIds.add(uploadId);
      targets.push({
        source: `https://ccmixter.org/files/${userSlug}/${uploadId}`,
        uploadId,
        user: userSlug
      });
      foundOnPage += 1;
    }
    if (foundOnPage === 0) break;
  }

  return { targets, errors };
}

async function discoverTrack({ origin, source, uploadId, user }, http) {
  const errors = [];
  const apiResult = await discoverViaApi(uploadId, user, http);
  errors.push(...apiResult.errors);
  let trackInfo = apiResult.trackInfo;
  let jobs = apiResult.jobs;
  let stageUsed = jobs.length ? 'api' : null;

  if (!jobs.length) {
    const legacyResult = await discoverViaLegacyM3u(uploadId, http);
    errors.push(...legacyResult.errors);
    if (legacyResult.jobs.length) {
      jobs = legacyResult.jobs;
      stageUsed = 'legacy-m3u';
    }
  }

  if (!jobs.length) {
    const htmlResult = await discoverViaHtmlTemplates(uploadId, http);
    errors.push(...htmlResult.errors);
    if (htmlResult.jobs.length) {
      jobs = htmlResult.jobs;
      stageUsed = 'html-template';
    }
  }

  const resolvedUser = trackInfo?.artistSlug || user || null;
  if (!jobs.length) {
    const trackPageResult = await discoverViaTrackPage(resolvedUser, uploadId, http);
    errors.push(...trackPageResult.errors);
    if (trackPageResult.jobs.length) {
      jobs = trackPageResult.jobs;
      stageUsed = 'track-page';
    }
  }

  const finalTrackInfo = trackInfo || buildTrackInfo(uploadId, null, resolvedUser);
  const finalJobs = dedupeByUrl(jobs).map((job) => applyMetadata(job, finalTrackInfo, resolvedUser, uploadId));

  return {
    origin,
    source,
    uploadId,
    stage: finalJobs.length ? stageUsed : null,
    trackInfo: finalTrackInfo,
    jobs: finalJobs,
    errors
  };
}

async function searchByQuery(query, http) {
  const trimmed = query?.trim();
  if (!trimmed) return [];
  const url = `https://ccmixter.org/api/query?f=json&search=${encodeURIComponent(trimmed)}`;
  const { data, error } = await safeJson(url, http);
  if (error) {
    return [];
  }
  const results = Array.isArray(data) ? data : [];
  return results.map((entry, index) => ({
    origin: query,
    source: entry.file_page_url || `https://ccmixter.org/files/${entry.user_name}/${entry.upload_id}`,
    uploadId: String(entry.upload_id || ''),
    stage: 'search',
    trackInfo: buildTrackInfo(String(entry.upload_id || ''), entry, entry?.user_name),
    jobs: [],
    errors: [],
    index
  }));
}

export async function discoverAllFromSources(sourcesInput = [], query = '', options = {}) {
  const { strictSSL = true } = options;
  const http = createHttpClient(strictSSL);
  if (query && query.trim()) {
    return await searchByQuery(query, http);
  }

  const sources = normalizeSources(sourcesInput);
  if (!sources.length) return [];

  const results = [];
  const processedUploads = new Set();

  for (const source of sources) {
    const classification = classifySource(source);
    if (classification.kind === 'track') {
      if (processedUploads.has(classification.uploadId)) continue;
      processedUploads.add(classification.uploadId);
      results.push(await discoverTrack({
        origin: source,
        source,
        uploadId: classification.uploadId,
        user: classification.user
      }, http));
      continue;
    }

    if (classification.kind === 'artist') {
      const expansion = await extractUploadTargetsFromArtistPages(classification.artist, http);
      if (!expansion.targets.length) {
        results.push({
          origin: source,
          source,
          uploadId: null,
          stage: null,
          trackInfo: null,
          jobs: [],
          errors: expansion.errors.length ? expansion.errors : ['No uploads discovered for artist']
        });
        continue;
      }
      for (const target of expansion.targets) {
        if (processedUploads.has(target.uploadId)) continue;
        processedUploads.add(target.uploadId);
        results.push(await discoverTrack({
          origin: source,
          source: target.source,
          uploadId: target.uploadId,
          user: target.user
        }, http));
      }
      continue;
    }

    results.push({
      origin: source,
      source,
      uploadId: null,
      stage: null,
      trackInfo: null,
      jobs: [],
      errors: ['Unsupported source. Provide a ccMixter track or artist URL.']
    });
  }

  return results;
}