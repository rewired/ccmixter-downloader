# Übersicht

Dieses Dokument beschreibt die **Such-/Discovery-Algorithmen** und den **Download-Algorithmus** des ccmIxter Downloaders – Schritt für Schritt, inkl. Pseudocode, Heuristiken, Fallbacks und Fehlerbehandlung.

---

## Begriffe

* **Upload**: Ein ccMixter-Track (Seite: `/files/<user>/<id>`)
* **Artist-Seite**: Übersicht eines Users (Seite: `/people/<user>`)
* **Job**: Eine einzelne, konkret herunterzuladende Datei (mp3/flac/zip/wav/ogg)

---

# Discovery / Suche

Ziel: Aus Eingabe-Quellen (Track-URLs oder Artist-URLs) eine **Liste von Jobs** generieren. Der Prozess ist konservativ, nutzt **mehrere Stufen** und bricht ab, sobald eine Stufe genügend Dateien liefert.

## 0) Vorverarbeitung & Normalisierung

**Eingaben**: eine oder mehrere Quellen-Strings (Whitespace-getrennt).

**Schritte**

1. **Trim / Filter**: Entferne leere Einträge, normalisiere HTTP/HTTPS-Schema.
2. **Klassifizieren** je Quelle:

   * `isTrackUrl`: `/files/<user>/<id>`
   * `isArtistUrl`: `/people/<user>`
3. **Duplikate** entfernen (Set auf die Normalform der URL).

**Datenstruktur**

```ts
Source = { type: 'track'|'artist', url: string, user?: string, id?: string }
```

---

## 1) Artist-Expansion (nur für `/people/<user>`)

**Ziel**: Eine Artist-URL in eine Liste konkreter **Track-URLs** expandieren.

**Strategie**

* **Paginierte HTML-Suche** über `/people/<user>?offset=0,20,40,...` (bis z. B. 10 Seiten oder bis keine neuen IDs mehr gefunden werden).
* **Regex** extrahiert alle Vorkommen von `/files/<irgendwer>/<id>`.
* **Unique-Set** der gefundenen `<id>` (unabhängig vom `<irgendwer>` in der URL, da Reposts möglich sind).
* **Limitierung** (z. B. max. 50 Uploads) zum Schutz vor Überlast.

**Pseudocode**

```pseudo
function expandArtist(user, maxPages=10, limit=50):
  ids := {}
  for page in 0..maxPages-1:
    html := GET /people/{user}?offset=page*20
    newIds := regexFindAll(html, /\/files\/[^/]+\/(\d+)/)
    ids += newIds
    if newIds is empty: break
  return takeFirst(limit, map(ids, id => trackUrl(user, id)))
```

**Ausgabe**: Liste erweiterter Track-URLs → weiter mit Schritt 2.

---

## 2) Per-Track Discovery-Pipeline

Für jede Track-URL `/files/<user>/<id>` wird die Pipeline ausgeführt. Sobald **eine Stufe** ausreichend Dateien liefert (≥ 1), werden die weiteren Fallbacks übersprungen.

### 2.1) Offizielle JSON-API (schnellster Pfad)

* **Info**: `api/query?f=json&dataview=info&ids=<id>` → Metadaten (Titel, Artist, Lizenz, Page-URL)
* **Files**: `api/query?f=json&dataview=files&ids=<id>` → Datei-Liste (nicht immer gefüllt)

**Mapping**

```pseudo
jobs := files[]
  .filter(has download_url)
  .map(f => Job(
    url = f.download_url || f.file_url,
    name = f.filename,
    isZip = name.endsWith('.zip'),
    meta = { title, artist, licenseName, licenseUrl, pageUrl }
  ))
if jobs.nonEmpty(): return jobs
```

### 2.2) Legacy M3U → JSON (sehr robust)

**Warum**: Deckt Fälle ab, in denen `dataview=files` leer ist; liefert oft MP3, FLAC und **alle Stems**.

* Anfrage:
  `GET api/query/api?ids=https://ccmixter.org/api/query?f=m3u&ids=<id>&f=json`
* Antwort-Struktur: `response[0].files[*]` (mit `download_url`, `file_name`, `file_rawsize`, …)

**Mapping**

```pseudo
legacy := response[0]
jobs := legacy.files
  .filter(has download_url)
  .map(f => Job(
    url = f.download_url,
    name = f.file_name || f.filename || f.file_nicname,
    isZip = name.endsWith('.zip'),
    size = f.file_rawsize || f.filesize,
    meta = { title = legacy.upload_name, artist = legacy.user_name,
             licenseName = legacy.license_name, licenseUrl = legacy.license_url,
             bpm = legacy.upload_extra?.bpm, pageUrl = trackPageUrl(artist,id) }
  ))
if jobs.nonEmpty(): return jobs
```

### 2.3) HTML-Templates (Links-Views)

**Templates**: `t=links_by_dl`, `t=links_dl`, `t=links`, `t=links_content`

* **Abruf**: `api/query?f=html&t=<tmpl>&ids=<id>`
* **Extraktion**: Sammle Links mit Endungen `.(zip|flac|wav|mp3|ogg)`

  * aus `href`, `data-href`, `data-url`
  * aus `onclick="window.open('…')"`
  * aus beliebigen **quoted Strings** oder **absoluten URLs** im HTML
* **Normalisierung**: relative → absolute URLs (`/…` → `https://ccmixter.org/...`, `//…` → `https:…`)
* **Deduplizierung** per URL

**Mapping** wie oben → **Jobs**. Falls vorhanden: **stop**, sonst weiter.

### 2.4) Trackseiten-Scrape (letzte Instanz)

* **Abruf**: `GET /files/<user>/<id>`
* **Extraktion**: identisch wie bei Templates (breite Heuristik)
* **Mapping**: wie oben → **Jobs**.

> **Hinweis**: In Stufe 2.3/2.4 können Dateinamen aus Anker-Text gezogen werden, falls die URL keine sprechenden Namen enthält.

---

## 3) Metadaten-Anreicherung

Wenn Jobs aus Stufe 2.2–2.4 stammen (und die Info-API 2.1 vorher schon geholt wurde), werden Felder wie Titel, Artist, Lizenzname/-URL, **pageUrl** nachgetragen:

```pseudo
for job in jobs:
  job.meta.title        ||= info.file_name
  job.meta.artist       ||= info.user_name
  job.meta.licenseName  ||= info.license_name
  job.meta.licenseUrl   ||= info.license_url
  job.meta.pageUrl      ||= info.file_page_url || trackPageUrl(user,id)
```

---

## 4) Ausgabe der Discovery

* **Pro Track**: `{ uploadId, trackInfo, jobs[] }`
* **jobs[]** listet konkrete Downloads (URL, Name, Größe optional, isZip, Metadaten)

---

# Download-Algorithmus

Ziel: **robuster, paralleler Download** mit Anti-Leech-Headern, einfachem Resume, optionalem Unzip & Sidecars.

## 1) Queue & Concurrency

* **Queue**: FIFO mit EventEmitter (Events: `job-progress`, `job-done`, `job-error`, `queue-idle`)
* **Concurrency**: konfigurierbar (z. B. 4). Es laufen höchstens `concurrency` Jobs gleichzeitig.
* **Steuerung**: `pause()` / `resume()`

**Pseudocode**

```pseudo
enqueue(job):
  Q.push(job)
  tick()

tick():
  if paused or running >= concurrency: return
  job := Q.shift()
  if not job: if running==0 emit(queue-idle); return
  running++
  try:
    downloadOne(job)
    emit(job-done, job.id)
  catch err:
    emit(job-error, job.id, err)
  finally:
    running--
    tick()
```

## 2) Zielpfad & Struktur

* **Root**: vom User gewählt
* **Template**: `"{artist}/{title}/{kind}"` mit `kind = 'Stems'` (ZIP) oder `kind = 'Files'` (sonst)
* **Sanitizing**: unerlaubte FS-Zeichen → `_`

Ergebnis: z. B. `DownloadRoot/Artist/Title/Stems/*.zip`

## 3) HTTP-Download (robust)

**Headers**

* `User-Agent`: Browser-ähnlich
* `Referer`: `job.meta.pageUrl` (wichtig für Hotlink-Schutz)
* `Accept`, `Connection`
* **Resume** via `Range` (wenn `.part` existiert)

**403-Strategie**

* Wenn `403 Forbidden` bei `https://…`, **einmal** Retry mit `http://…`

**Aufzeichnung**

* Stream → `file.part` (append, falls Resume)
* **Progress**: Weiterleiten von `downloadProgress.transferred`

**Pseudocode**

```pseudo
function streamToFile(url, tmpPath, referer):
  headers := { UA, Accept, Connection, Referer }
  if tmp exists: headers.Range := 'bytes=<size>-'
  try GET stream(url, headers) → write to tmp
  catch err:
    if err.status==403 and url.startsWith('https://'):
      try GET stream('http://'+url[8:], headers)
      else throw
```

## 4) Abschluss: Unzip & Sidecars

* **Wenn ZIP & Unzip aktiv**: entpacke in Zielordner, lösche `.part`
* **Sonst**: `.part` → finaler Dateiname
* **Sidecars** (falls aktiv): `ATTRIBUTION.txt` und `LICENSE.txt` mit Metadaten

---

# Fehlerbehandlung & Edge Cases

* **Leere API-Ergebnisse** → Fallback-Kaskade bis HTML/Scrape
* **403** → Header + Referer + HTTPS→HTTP
* **Netzwerk-Timeouts** → Retry (konfigurierbar; aktuell konservativ)
* **Namenskonflikte** → Sanitizing, ggf. Overwrite-Strategie (später: Hash-/Existenz-Check)
* **Artist mit vielen Uploads** → Paging + Limit (konfigurierbar)

---

# Performance & Robustheit

* **Minimierte Requests**: Info+Files parallel; Fallbacks nur bei Bedarf
* **Deduplizierung**: Links pro Track & global (Set auf URL)
* **Concurrency**: kontrolliert pro Prozess; für Host-spezifische Limits später Rate-Limiter möglich

---

# Erweiterungs-Ideen

* **Filter** vor Enqueue (nur Stems, nur FLAC/WAV, etc.)
* **Globale Rate Limits** & **Retry-Backoff**
* **Checksum/ETag** für sauberes Resume
* **Fortgeschrittene Ordner-Templates** (`{year}`, `{bpm}`, `{license}` …)
* **CI Packaging** (electron-builder Targets)

---

# TL;DR – Sequenzdiagramm (vereinfacht)

```
User Input ──► Normalize ──► [Artist?] ──► Expand Artist (pages)
                                │
                                ▼
                         For each Track
                                │
                 ┌────────► API: info+files ── non-empty? ──────┐
                 │                                               │ yes
                 │ no                                            ▼
                 │       Legacy M3U JSON ── non-empty? ─────────►Jobs
                 │                                               │ yes
                 │ no                                            ▼
                 │       HTML templates ── any links? ──────────►Jobs
                 │                                               │ yes
                 │ no                                            ▼
                 └─────── Track page scrape ── any links? ──────►Jobs
                                                                │
                                                                ▼
                                                  Enqueue ► Download
```
