import got from 'got';

function extractUserAndId(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex(p => p === 'files');
    if (idx >= 0 && parts.length >= idx + 3) {
      return { user: parts[idx + 1], id: parts[idx + 2] };
    }
  } catch (err) {}
  return { user: null, id: null };
}

async function fetchJson(url) {
  return await got(url, { timeout: { request: 25000 }, headers: { 'user-agent': 'ccmIxter-Downloader/0.1' } }).json();
}
async function fetchText(url) {
  return await got(url, { timeout: { request: 25000 }, headers: { 'user-agent': 'ccmIxter-Downloader/0.1' } }).text();
}

function normalizeUrl(u) { if (u.startsWith('//')) return 'https:' + u; if (u.startsWith('/')) return 'https://ccmixter.org' + u; return u; }
function pickName(url, fallbackText='') { const clean = url.split('?')[0]; const base = decodeURIComponent(clean.split('/').pop() || '').trim(); if (/\.(zip|wav|flac|mp3|ogg)$/i.test(fallbackText)) return fallbackText.trim(); return base || fallbackText.trim() || 'download'; }

function extractDownloadUrls(html) {
  const urls = new Set();
  try { const rx = /\b(?:href|data-href|data-url)\s*=\s*["']([^"']+)["']/gi; let m; while ((m = rx.exec(html)) !== null) { const u = normalizeUrl(m[1]); if (/\.(zip|wav|flac|mp3|ogg)(\?.*)?$/i.test(u)) urls.add(u); } } catch (err) {}
  try { const rx = /onclick\s*=\s*["'][^"']*?\bwindow\.open\s*\(\s*['"]([^'"]+)['"]/gi; let m; while ((m = rx.exec(html)) !== null) { const u = normalizeUrl(m[1]); if (/\.(zip|wav|flac|mp3|ogg)(\?.*)?$/i.test(u)) urls.add(u); } } catch (err) {}
  try { const rx = /["'](\/[^"']+\.(?:zip|wav|flac|mp3|ogg)(?:\?[^"']*)?)["']/gi; let m; while ((m = rx.exec(html)) !== null) { const u = normalizeUrl(m[1]); urls.add(u); } } catch (err) {}
  try { const rx = /https?:\/\/[\w\-./%?=&+#]+?\.(?:zip|wav|flac|mp3|ogg)(?:\?[\w\-./%?=&+#]*)?/gi; let m; while ((m = rx.exec(html)) !== null) { urls.add(m[0]); } } catch (err) {}
  return Array.from(urls);
}

function mapUrlsToJobs(urls) {
  const uniq = Array.from(new Set(urls));
  return uniq.map(u => ({ type: 'file', url: u, name: pickName(u), size: null, isZip: /\.zip$/i.test(u), meta: {} }));
}

async function discoverViaApi(uploadId) {
  const base = 'https://ccmixter.org/api/query?f=json';
  const filesUrl = `${base}&dataview=files&ids=${uploadId}`;
  const infoUrl = `${base}&dataview=info&ids=${uploadId}`;
  let files=[], info=[];
  try { files = await fetchJson(filesUrl); } catch (e) {}
  try { info = await fetchJson(infoUrl); } catch (e) {}
  const trackInfo = (info && info[0]) ? info[0] : {};
  let jobs = [];
  try { jobs = (files || []).map(f => ({ type: f.filetype || 'file', url: f.download_url || f.file_url, name: f.filename, size: f.filesize, isZip: /\.zip$/i.test(f.filename || ''), meta: { title: trackInfo.file_name, artist: trackInfo.user_name, licenseName: trackInfo.license_name, licenseUrl: trackInfo.license_url, pageUrl: trackInfo.file_page_url || `https://ccmixter.org/files/${trackInfo.user_name || 'unknown'}/${uploadId}` } })).filter(j => j.url); } catch (e) {}
  const pageUrl = trackInfo.file_page_url || '';
  return { uploadId, trackInfo, jobs, pageUrl };
}

async function discoverViaLegacyM3U(uploadId) {
  const inner = `https://ccmixter.org/api/query?f=m3u&ids=${uploadId}`;
  const url = `https://ccmixter.org/api/query/api?ids=${encodeURIComponent(inner)}&f=json`;
  let data=[]; try { data = await fetchJson(url); } catch (e) { return []; }
  const res = Array.isArray(data) ? data[0] : null; if (!res) return [];
  const files = Array.isArray(res.files) ? res.files : [];
  return files.map(f => ({ type: 'file', url: f.download_url || f.file_url, name: f.file_name || f.filename || f.file_nicname || 'download', size: f.file_rawsize || f.filesize || null, isZip: /\.zip$/i.test((f.file_name || f.filename || '')), meta: { title: res.upload_name || '', artist: res.user_name || '', licenseName: res.license_name || '', licenseUrl: res.license_url || '', pageUrl: `https://ccmixter.org/files/${res.user_name || 'unknown'}/${uploadId}`, bpm: res.upload_extra && res.upload_extra.bpm } })).filter(j => j.url);
}

async function discoverViaHtmlTemplates(uploadId) {
  const tmpls = ['links_by_dl','links_dl','links','links_content'];
  const urls = new Set();
  for (const t of tmpls) { try { const html = await fetchText(`https://ccmixter.org/api/query?f=html&t=${t}&ids=${uploadId}`); extractDownloadUrls(html).forEach(u=>urls.add(u)); } catch(e){} }
  return Array.from(urls);
}

async function discoverViaTrackPage(user, uploadId) {
  if (!user || !uploadId) return [];
  let html=''; try { html = await fetchText(`https://ccmixter.org/files/${user}/${uploadId}`); } catch(e){ return []; }
  return extractDownloadUrls(html);
}

async function extractUploadIdsFromArtistPages(artist, maxPages = 10) {
  const ids = new Set();
  for (let i = 0; i < maxPages; i++) {
    const offset = i * 20;
    let html = '';
    try { html = await fetchText(`https://ccmixter.org/people/${artist}?offset=${offset}`); } catch (err) { break; }
    const rx = /\/files\/[^/]+\/(\d+)/gi;
    let m; let foundOnPage = 0;
    while ((m = rx.exec(html)) !== null) { if (!ids.has(m[1])) { ids.add(m[1]); foundOnPage++; } }
    if (foundOnPage === 0) break;
  }
  return Array.from(ids);
}

function extractArtistFromPeopleUrl(url) {
  try { const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean); const idx = parts.findIndex(p => p === 'people'); if (idx >= 0 && parts.length >= idx + 2) return parts[idx + 1]; } catch(e) {}
  return null;
}


async function searchByQuery(query) {
  const url = `https://ccmixter.org/api/query?search=${encodeURIComponent(query)}&f=json`;
  const results = await fetchJson(url);
  return results.map(track => ({
    id: track.upload_id,
    title: track.upload_name,
    artist: track.user_name,
    license: track.license_name,
    download_url: track.download_url,
  }));
}

export async function discoverAllFromSources(sources, query) {
  if (query) {
    return await searchByQuery(query);
  }

  // Expand artist pages into per-upload file URLs
  const expanded = [];
  for (const s of sources) {
    const artist = extractArtistFromPeopleUrl(s);
    if (artist) {
      const ids = await extractUploadIdsFromArtistPages(artist, 10);
      ids.slice(0,50).forEach(id => expanded.push(`https://ccmixter.org/files/${artist}/${id}`));
    } else {
      expanded.push(s);
    }
  }
  sources = expanded;

  const results = [];
  for (const src of sources) {
    const { user, id } = extractUserAndId(src);
    if (!id) { results.push({ source: src, error: 'No upload id found' }); continue; }
    try {
      const primary = await discoverViaApi(id);
      let jobs = primary.jobs;

      if (!jobs.length) {
        const viaLegacy = await discoverViaLegacyM3U(id);
        if (viaLegacy.length) jobs = viaLegacy;
      }
      if (!jobs.length) {
        const urls = [ ...await discoverViaHtmlTemplates(id), ...await discoverViaTrackPage(user, id) ];
        jobs = mapUrlsToJobs(urls);
      }
      if (jobs.length) {
        jobs = jobs.map(j => ({ ...j, meta: { title: primary.trackInfo?.file_name || j.meta?.title || '', artist: primary.trackInfo?.user_name || j.meta?.artist || '', licenseName: primary.trackInfo?.license_name || j.meta?.licenseName || '', licenseUrl: primary.trackInfo?.license_url || j.meta?.licenseUrl || '', pageUrl: primary.pageUrl || j.meta?.pageUrl || `https://ccmixter.org/files/${user}/${id}` } }));
      }
      results.push({ uploadId: id, trackInfo: primary.trackInfo, jobs });
    } catch (err) {
      results.push({ uploadId: id, error: String(err) });
    }
  }
  return results;
}
