# ccMixter Downloader

Ein Desktop-Tool (Electron + Node + React + Vite), das für ccMixter-Uploads alle verfügbaren Dateien (MP3/FLAC/ZIP-Stems) entdeckt, in eine Warteschlange legt, parallel herunterlädt, **403-Schutz** umgeht (browserähnliche Header + Referer), ZIPs optional **automatisch entpackt** und **Lizenz/Attribution** als Sidecar-Dateien mitschreibt.

## Inhaltsverzeichnis

- [ccMixter Downloader](#ccmixter-downloader)
  - [Inhaltsverzeichnis](#inhaltsverzeichnis)
  - [Features](#features)
  - [Schnellstart](#schnellstart)
  - [Ordnerstruktur](#ordnerstruktur)
  - [Technischer Überblick](#technischer-überblick)
    - [Electron Main \& Preload](#electron-main--preload)
    - [Discovery-Pipeline](#discovery-pipeline)
    - [Downloader-Engine](#downloader-engine)
    - [Renderer-UI](#renderer-ui)
  - [Konfiguration \& Verhalten](#konfiguration--verhalten)
  - [Artist-/Batch-Discovery](#artist-batch-discovery)
  - [Lizenz \& Attribution](#lizenz--attribution)
  - [Build \& Packaging](#build--packaging)
  - [Troubleshooting (White Screen, 403, usw.)](#troubleshooting-white-screen-403-usw)
    - [Weißer Screen im Dev](#weißer-screen-im-dev)
    - [403 Forbidden beim Download](#403-forbidden-beim-download)
    - [„Cannot use import statement outside a module“ im Preload](#cannot-use-import-statement-outside-a-module-im-preload)
    - [„Unexpected token catch“](#unexpected-token-catch)
    - [Dev lädt nicht, aber Build funktioniert](#dev-lädt-nicht-aber-build-funktioniert)
  - [Erweiterungen / Roadmap](#erweiterungen--roadmap)
  - [FAQ](#faq)

---

## Features

* **URL-Eingabe**: einzelne Upload-URL(s) `https://ccmixter.org/files/<user>/<id>` oder **Artist-Seite** `https://ccmixter.org/people/<user>`.
* **Discovery (mehrstufig & robust)**:

  1. Offizielle Query-API (`dataview=files` & `dataview=info`)
  2. **Legacy-M3U-API** (liefert vollständige `files[]`, inkl. FLAC + Stems)
  3. HTML-Templates (`t=links_by_dl`, `t=links_dl`, …)
  4. Scrape der öffentlichen Trackseite (fängt `.zip/.flac/.wav/.mp3/.ogg`, auch aus `href`, `data-*`, `onclick`, usw.)
* **Downloader**:

  * Parallele Downloads (konfigurierbar), Rate-Limiting vorbereitbar
  * **403-Bypass**: Browser-User-Agent, **Referer** (Trackseite), optionaler HTTPS→HTTP-Retry
  * **Resume** (einfach, via Range), Retry/Fehler-Events
  * **ZIP Auto-Unzip** + **Sidecars** (`ATTRIBUTION.txt`, `LICENSE.txt`)
* **UI**:

  * Eingabe mehrerer Quellen (Zeilen/Leerzeichen getrennt)
  * Discover → Queue → Start/Status im Log
  * Settings: Download-Root, Concurrency, Unzip, Struktur-Template

---

## Schnellstart

Voraussetzungen: **Node 18+**, npm.

```bash
npm i
npm run dev
```

Dev-Modus:

* Vite startet auf `http://localhost:5173`
* Electron lädt automatisch den Dev-Server (fällt bei Fehler auf `dist/index.html` zurück)
* DevTools öffnen sich automatisch

**Schnelltest**
Track: `https://ccmixter.org/files/7OOP3D/69671` → **Discover** → **Enqueue**
Artist: `https://ccmixter.org/people/7OOP3D` → **Discover** → (es erscheinen viele Uploads; du kannst alle oder selektiv enqueuen)

> **Hinweis:** Falls im Dev-Modus nur eine weiße Seite erscheint, siehe [Troubleshooting](#troubleshooting-white-screen-403-usw).

---

## Ordnerstruktur

```
ccmixter-downloader/
├─ electron/
│  ├─ main.js            # Electron Main-Prozess: Fenster, IPC, Queue-Events
│  └─ preload.cjs        # Preload (CommonJS) → window.ccm-Bridge für Renderer
├─ src/
│  ├─ main/
│  │  └─ services/
│  │     ├─ discovery.js # Discovery-Pipeline (API + Legacy + HTML + Scrape + Artist)
│  │     └─ downloader.js# Download-Engine (Headers, Resume, Unzip, Sidecars)
│  └─ renderer/
│     ├─ main.jsx        # React-Bootstrap
│     └─ App.jsx         # UI (Inputs, Settings, Queue-Status/Log)
├─ index.html            # Vite-Entry für Renderer
├─ package.json          # Scripts + Deps (Electron ^38, Vite ^7, React ^18 usw.)
├─ vite.config.js        # Vite-Config mit @vitejs/plugin-react
└─ .gitignore            # Node/Electron/Vite-typische Artefakte + downloads/
```

---

## Technischer Überblick

### Electron Main & Preload

* **`electron/main.js`**

  * Startet `BrowserWindow`, lädt **Dev-URL** (`http://localhost:5173`) und öffnet DevTools.
  * Fallback: `dist/index.html`.
  * Richtet **IPC-Handler** ein:

    * `choose-download-root` (Dialog)
    * `discover` (ruft Discovery an)
    * `enqueue` (legt Jobs in die Downloader-Queue)
    * `queue-control` (pause/resume)
  * Leitet **Queue-Events** (`job-progress`, `job-done`, `job-error`, `queue-idle`) an Renderer weiter.

* **`electron/preload.cjs`** (CommonJS, wichtig!)

  * Exponiert `window.ccm` API in der Renderer-Sandbox (Context Isolation), z. B. `onQueueEvent`, `discover`, `enqueue`, …

### Discovery-Pipeline

Ablauf pro Upload-URL:

1. **API JSON**

   * `.../api/query?f=json&dataview=files&ids=<id>` → listet Dateien (nicht immer vorhanden)
   * `.../api/query?f=json&dataview=info&ids=<id>` → Titel, Artist, Lizenz

2. **Legacy-M3U-API** (deckt sehr viele Fälle ab – inkl. FLAC/Stems)

   ```
   GET https://ccmixter.org/api/query/api
       ?ids=https://ccmixter.org/api/query?f=m3u&ids=<id>
       &f=json
   ```

   * Antwort: `response[0].files[*]` mit `download_url`, `file_name`, `file_rawsize` etc.
   * Wird genutzt, wenn Schritt 1 keine Dateien liefert

3. **HTML-Templates**

   * `f=html&t=links_by_dl|links_dl|links|links_content` + Parsen aller `<a>`/`data-*`/`onclick`

4. **Trackseiten-Scrape**

   * `https://ccmixter.org/files/<user>/<id>` → sammelt `.zip/.flac/.wav/.mp3/.ogg` (auch mit Querystrings)

Für **Artist-URLs** (`/people/<artist>`):

* Es werden **bis zu 10 Seiten** gecrawlt (`?offset=0,20,40,…`), daraus **bis zu 50 Upload-IDs** gesammelt und dann die Pipeline oben pro Upload ausgeführt.

### Downloader-Engine

* **Headers & Anti-Leech**

  * Setzt **User-Agent** (Browser-ähnlich) + `Accept`, `Connection`
  * Setzt **Referer** = Trackseite (`meta.pageUrl`)
  * Bei **403**: einmaliger **HTTP-Retry** (manche Hosts verlangen `http://` für Content)
* **Resume/Range** (einfach, `.part`-Datei)
* **ZIP-Auto-Unzip** (optional, Standard: **an**)
* **Sidecars**: `ATTRIBUTION.txt` & `LICENSE.txt` in Zielordner
* **Events**: Fortschritt, Fehler, Abschluss → an Renderer

### Renderer-UI

* **App.jsx**

  * Eingabe: eine oder mehrere Quellen (Tracks/Artist)
  * Buttons: **Discover**, **Choose Download Folder**, **Enqueue**
  * Settings: **Concurrency** (Default 4), **Unzip**, **Struktur-Template**
  * **Log** zeigt Entdeckergebnisse, Fortschritt, Fehler

---

## Konfiguration & Verhalten

* **Download-Root**: per Button wählen.
* **Concurrency**: Standard 4 parallele Downloads.
* **Unzip**: aktiviert → ZIPs werden nach Download entpackt; `.part` wird entfernt.
* **Struktur-Template**: aktuell einfach gehalten – Ordnerstruktur:

  ```
  {artist}/{title}/{kind}
  ```

  wobei `{kind}` = `Stems` (bei ZIP) oder `Files` (sonst).
* **Sidecars**: standardmäßig **aktiv**, basieren auf Discovery-Metadaten (Lizenz, Artist, Titel, URL).

---

## Artist-/Batch-Discovery

* Quelle `https://ccmixter.org/people/<artist>` → Tool crawlt bis zu **10 Seiten** und expandiert **max. 50 Uploads** (anpassbar).
* Nach Discover erscheinen viele Upload-Karten. Enqueue lädt alles in die Queue.
* Weitere Quellen (Tracks anderer Artists) können gleichzeitig eingegeben werden (jeweils durch Leerzeichen/Zeilenumbrüche getrennt).

---

## Lizenz & Attribution

* ccMixter verwendet i. d. R. Creative-Commons-Lizenzen.
* Das Tool erstellt **ATTRIBUTION.txt** & **LICENSE.txt** pro Track-Ordner mit:

  * Titel, Artist, Track-URL
  * Lizenzname & -URL
  * Hinweis, dass der Download mit ccmIxter Downloader erfolgt ist
* **Bitte** prüfe Lizenzbedingungen vor der Weiterverwendung (z. B. BY-NC ≠ kommerziell).

---

## Build & Packaging

Dev (Hot-Reload):

```bash
npm run dev
```

Statischer Build & Start:

```bash
npm run build    # baut Renderer -> dist/
npm start        # startet Electron mit dist/index.html
```

Packen (Installer):

> **Hinweis:** `electron-builder` ist installiert, aber die `build`-Konfiguration (App-Icons, App-ID, Artefakt-Ziele) musst du nach Wunsch ergänzen. Beispiel (in `package.json`):

```json
"build": {
  "appId": "org.example.ccmixter.downloader",
  "productName": "ccmIxter Downloader",
  "files": [
    "dist/**",
    "electron/**",
    "src/**",
    "package.json"
  ],
  "directories": {
    "buildResources": "build"
  },
  "win": { "target": ["nsis"] },
  "mac": { "target": ["dmg"] },
  "linux": { "target": ["AppImage"] }
}
```

Und dann:

```bash
npm run build:renderer
npx electron-builder
```

---

## Troubleshooting (White Screen, 403, usw.)

### Weißer Screen im Dev

* **Port checken**: Läuft Vite wirklich auf `http://localhost:5173`?
  → Terminal prüfen, ggf. anderen Port nutzen:

  ```bash
  # package.json -> "dev": concurrently -k "vite --host --port 5174" "wait-on tcp:5174 && electron ."
  ```
* **Main-Fehler**: Syntax/Import in `electron/main.js` oder `src/main/services/*.js`.
  → Im Terminal erscheint ein Stacktrace.
* **Renderer-Konsole**: `Ctrl+Shift+I` → **Console**.
* **Statischer Test**:

  ```bash
  npm run build
  npm start
  ```

  Wenn das geht, lag’s am Dev-Server/Port.

### 403 Forbidden beim Download

* Der Downloader sendet bereits **User-Agent** + **Referer (Track-URL)** und **fällt auf HTTP** zurück.
* Wenn weiterhin 403:

  * Firewall/Proxy prüfen (manche blocken `Range`/Streaming).
  * Teste im Log die **konkrete URL** → Wenn nur bestimmte Hosts betroffen sind, kann man zusätzlich Header setzen (z. B. `Accept-Language`, `Sec-Fetch-Site`).

### „Cannot use import statement outside a module“ im Preload

* Preload ist **CommonJS** (`electron/preload.cjs`).
* In `main.js`: `preload: path.join(__dirname, 'preload.cjs')` (bereits so verdrahtet).

### „Unexpected token catch“

* In `discovery.js` werden **alle** `catch` mit `(err)` verwendet (kein nacktes `catch {}`).

### Dev lädt nicht, aber Build funktioniert

* Oft ein **Port-/Firewall-Thema**.
* Entweder Port wechseln (s. o.) oder im Dev temporär `await mainWindow.loadFile(.../dist/index.html)` nutzen.

---

## Erweiterungen / Roadmap

* **Filter** (Dateitypen: nur ZIP/FLAC/WAV) & **Profile** (z. B. nur Stems).
* **Bandbreitenlimit** / **globale Rate-Limiter**.
* **Stabileres Resume** (Range + ETag/If-Range).
* **Mehr Metadaten** (ID3/Vorbis schreiben, optional).
* **Fortgeschrittene Ordner-Templates** (z. B. `{artist}/{year}-{title}/{kind}`).
* **Konfigurierbare Artist-Crawl-Grenzen** (Seiten/Uploads, Datum/Tag-Filter).

---

## FAQ

**Q: Warum finde ich manche Dateien nur über die Legacy-M3U-API?**
A: `dataview=files` ist nicht bei jedem Upload vollständig/gefüllt. Die Legacy-M3U-Route liefert oft das volle Set.

**Q: Wieso braucht der Downloader den Referer?**
A: ccMixter schützt `content/` teilweise gegen Hotlinking. Ohne **Referer** + browserähnlichen Headern gibt’s **403**.

**Q: Kann ich ZIPs nicht entpacken lassen?**
A: Ja – Schalter **Unzip** deaktivieren.

**Q: “White Screen” trotz allem?**
A: Konsole & Terminal-Logs posten. Meist ist es: Dev-Port nicht erreichbar, Syntaxfehler in Main/Services oder ein blockender Proxy.

---

> **Hinweis zu Versionen**
> Dieses Projekt nutzt (Stand jetzt) deine gewünschten Versionen:
>
> * Electron **^38.2.0**, Vite **^7.1.7**, `@vitejs/plugin-react` **^4.3.1**
> * React **^18.3.1**, got **^14.2.0**, unzipper **^0.12.3**, zod **^3.23.8**
