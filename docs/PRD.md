# ccMixter Downloader — Product Requirements Document (PRD)

> Consolidation of `README.md` and `TECHNICAL.md` into a single PRD for full implementation by a coding agent, **plus integrated configuration‑persistence and download‑folder preconditions** (formerly addendum). No unrelated features have been added or removed. **Tech constraints:** **Node 22 (LTS)**, **React**, **Vite**, **TailwindCSS with components**, **pnpm**.

---

## 1. Product Summary

**ccMixter Downloader** is a desktop tool (Electron + Node + React + Vite) that discovers all available files for a given ccMixter upload (MP3/FLAC/ZIP stems), enqueues them, downloads them in parallel with anti‑leech behavior, optionally auto‑unzips ZIP archives, and writes license/attribution sidecars. It supports single upload URLs and artist pages for batch discovery.

---

## 2. Objectives & Non‑Goals

### 2.1 Objectives

* Robust multi‑stage **discovery** even when the official API is incomplete.
* **Parallel downloads** with conservative anti‑leech behavior and simple resume.
* **Optional auto‑unzip** for ZIP archives and **sidecar** generation for attribution/license.
* **Usable desktop UI** covering input, discovery, queuing, settings, and progress logs.

### 2.2 Non‑Goals

* Any capability beyond the source documents is out of scope for MVP (e.g., advanced rate limiter, ETag/If‑Range correctness, extended metadata writing).

---

## 3. Target Platforms & Tech Stack

* **Desktop** via **Electron**.
* **Frontend**: **React** + **Vite**.
* **Styling**: **TailwindCSS** with components.
* **Runtime**: **Node 22 (LTS)**.
* **Package manager**: **pnpm**.

---

## 4. Core Features

1. **URL Input**: Accept one or many sources (whitespace‑separated):

   * Upload: `https://ccmixter.org/files/<user>/<id>`
   * Artist: `https://ccmixter.org/people/<user>`
2. **Discovery (Multi‑Stage)**

   * Official Query API (`dataview=files` & `dataview=info`).
   * Legacy **M3U API → JSON** (often includes FLAC + stems).
   * HTML templates (`t=links_by_dl`, `t=links_dl`, …).
   * Track page scraping (collect `.zip/.flac/.wav/.mp3/.ogg`).
3. **Downloader**

   * Parallel downloads (configurable concurrency), simple resume (`Range` + `.part`).
   * Anti‑leech: browser‑like headers + **Referer** to track page; HTTPS→HTTP single retry on 403.
   * **Auto‑Unzip** for ZIPs (toggle; default on).
   * **Sidecars**: `ATTRIBUTION.txt`, `LICENSE.txt`.
4. **UI**

   * Input → **Discover** → results list → **Enqueue/Start** with live log and progress.
   * **Settings**: download root, concurrency, unzip toggle, structure template.

---

## 5. User Flows

1. **Single Track Flow**: Paste `/files/<user>/<id>` → Discover → Jobs → Enqueue → Download with live log → Files saved (unzip if enabled) + sidecars.
2. **Artist Batch Flow**: Paste `/people/<user>` → Crawl pages → Multiple uploads → Select or Enqueue all → Download as above.

---

## 6. Discovery (Search) Requirements

### 6.1 Input Normalization

* Trim/normalize scheme; deduplicate inputs; classify as `track` or `artist`.

### 6.2 Artist Expansion

* Paginate `/people/<user>?offset=0,20,40,...` up to **10 pages** or until no new IDs.
* Extract `/files/<any>/<id>` with regex; dedupe IDs globally.
* Cap at **50 uploads** per artist (configurable safeguard).

### 6.3 Per‑Track Discovery Pipeline (short‑circuit on first success)

1. **Official JSON API**

   * Info: `api/query?f=json&dataview=info&ids=<id>` (title, artist, license, pageUrl).
   * Files: `api/query?f=json&dataview=files&ids=<id>` (may be empty).
2. **Legacy M3U → JSON**

   * Convert M3U to JSON; map to job entries with URL, type, size (if available).
3. **HTML Templates**

   * `api/query?f=html&t=links_by_dl|links_dl|links|links_content&ids=<id>`; parse absolute links.
4. **Track Page Scrape**

   * `GET /files/<user>/<id>`; extract links from `href`, `data-*`, `onclick`, quoted strings.

### 6.4 Metadata Enrichment

* If stages 2–4 supply files, backfill `title`, `artist`, `licenseName`, `licenseUrl`, `pageUrl` using the Info response when available.

### 6.5 Discovery Output Schema

* Per track: `{ uploadId, trackInfo, jobs[] }`; each job includes URL, filename, size (optional), `isZip`, metadata.

---

## 7. Download Requirements

### 7.1 Queue & Concurrency

* FIFO queue; EventEmitter events: `job-progress`, `job-done`, `job-error`, `queue-idle`.
* Configurable concurrency; `pause()` / `resume()`.

### 7.2 Paths & Structure

* **Download Root** chosen by user.
* **Template**: `"{artist}/{title}/{kind}"` with `kind ∈ { 'Stems' (ZIP), 'Files' (others) }`.
* Sanitize filesystem‑illegal characters to `_`.

### 7.3 HTTP Download Behavior

* Headers: realistic `User-Agent`, `Accept`, `Connection`, and **`Referer = job.meta.pageUrl`**.
* **Resume** with `Range` when `.part` exists; stream to `file.part`.
* On HTTPS **403**, retry exactly once with HTTP.

### 7.4 Completion

* If ZIP and unzip enabled: extract to destination; then remove temp/`.part`.
* Else: rename `.part` → final name.
* Create sidecars `ATTRIBUTION.txt`, `LICENSE.txt` using discovered metadata.

---

## 8. UI Requirements

* Views: inputs, discovery results (per upload), queue actions, live log (progress/errors/done events).
* Settings: download root chooser, concurrency (default 4), unzip toggle, structure template.

---

## 9. Electron Architecture

* **Main process**

  * Create `BrowserWindow`; in dev load Vite server; in prod load `dist/index.html`.
  * IPC: `choose-download-root`, `discover`, `enqueue`, `queue-control`.
  * Forward queue events to renderer: `job-progress`, `job-done`, `job-error`, `queue-idle`.
* **Preload (CommonJS)**

  * Expose `window.ccm` bridge (contextIsolation‑safe) for discovery/queue/chooser.

---

## 10. Project Structure (Reference)

```
ccmixter-downloader/
├─ electron/
│  ├─ main.js            # Electron Main: window, IPC, queue events
│  └─ preload.cjs        # Preload (CJS): window.ccm bridge
├─ src/
│  ├─ main/
│  │  └─ services/
│  │     ├─ discovery.js # API + Legacy + HTML + scrape + artist expansion
│  │     └─ downloader.js# Download engine
│  └─ renderer/
│     ├─ main.jsx        # React bootstrap
│     └─ App.jsx         # UI (inputs, settings, queue/log)
├─ index.html            # Vite entry
├─ package.json          # Scripts & deps (Electron, Vite, React, etc.)
├─ vite.config.js        # Vite with @vitejs/plugin-react
└─ .gitignore            # Typical artifacts + downloads/
```

---

## 11. Configuration & Behavior (with Persistence)

* **Defaults**

  * `concurrency = 4`
  * `unzipEnabled = true`
  * `structureTemplate = "{artist}/{title}/{kind}"`
  * **No implicit default for `downloadRoot`** (must be chosen by the user on first run).

* **Persistence** (non‑volatile):

  * Persist **`downloadRoot`**, **`concurrency`**, **`unzipEnabled`**, **`structureTemplate`** across sessions.
  * Store in OS‑appropriate app data directory, structured as JSON.
  * Write‑temp‑then‑rename to avoid partial writes.
  * Provide **Reset to defaults** action that clears persisted values and reapplies the defaults above.

* **Preconditions for Download**:

  * No **enqueue** or **start** is allowed unless `downloadRoot` is **set**, **exists**, and is **writable**.
  * Validation timing: on **app start**, when the **folder is selected**, and **pre‑enqueue/start**.
  * If invalid: block action and show a persistent notice with a **primary CTA “Choose folder”** and guidance: *“Choose a download folder before starting. Downloads cannot proceed until a valid folder is selected and exists.”*
  * If a previously valid folder becomes unavailable mid‑session: pause queue, mark the active job with a descriptive error, surface the same notice, allow resume after a valid folder is selected.

---

## 12. Artist / Batch Discovery

* Crawl up to **10 pages** per artist, collect up to **50 uploads** (configurable).
* Enqueue all or selected uploads.
* Accept multiple sources at once.

---

## 13. Licensing & Attribution

* Create `ATTRIBUTION.txt` and `LICENSE.txt` per track folder with title, artist, track URL, license name & URL, and a note that the download was made with this tool.
* Users remain responsible for respecting Creative Commons license terms.

---

## 14. Build & Packaging

* **Dev**: `pnpm i` → `pnpm dev` (Vite dev server, Electron loads it, DevTools open in dev).
* **Build/Start**: `pnpm build` → `pnpm start` (Electron loads `dist/index.html`).
* **Packaging**: electron‑builder configuration to produce platform installers (targets as in package config).

---

## 15. Troubleshooting

* **White screen**: verify Vite port, check Main/Renderer logs, try `pnpm build` + `pnpm start`.
* **403 Forbidden**: headers + Referer are set; single HTTP retry; verify firewall/proxy; inspect URL.
* **Module type issues**: Preload uses CommonJS; ensure proper preload path.
* **Dev loads fail but prod works**: port/firewall; optionally load `dist/index.html` during dev to isolate.

---

## 16. Performance & Robustness Notes

* Run Info + Files in parallel; fall back progressively; dedupe per upload and globally.
* Concurrency is user‑controlled; per‑host rate limiting can be added later.

---

## 17. Events & Telemetry

* Queue events forwarded via IPC: `job-progress`, `job-done`, `job-error`, `queue-idle` for live UI logs.

---

## 18. Future Extensions (Roadmap)

* File‑type filters/profiles, bandwidth limits, stronger resume with ETag/If‑Range, richer metadata writing, advanced folder templates, configurable artist crawl limits.

---

## 19. Acceptance Criteria

* Discovery pipeline operates with the specified stages and short‑circuits on success; artist expansion respects limits and deduplicates IDs.
* Downloads run concurrently with headers (UA + Referer), simple resume via `Range` & `.part`, single HTTP retry on HTTPS 403, optional unzip for ZIPs.
* Sidecars are generated with required fields.
* UI exposes inputs, discovery, enqueue/start, settings, and live logs.
* **Configuration persists** (`downloadRoot`, `concurrency`, `unzipEnabled`, `structureTemplate`).
* **Download preconditions enforced**: no enqueue/start without a valid, existing, writable `downloadRoot`; validation at app start, on selection, and pre‑enqueue/start; graceful handling if the folder disappears mid‑session with pause, error, and recovery on new selection.
* Build, packaging, and troubleshooting behaviors function as described.
