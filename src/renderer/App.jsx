import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DiscoverPage from './components/DiscoverPage';
import DownloadsPage from './components/DownloadsPage';
import SettingsPage from './components/SettingsPage';
import LogView from './components/LogView';

const TABS = {
  DISCOVER: 'Discover',
  DOWNLOADS: 'Downloads',
  SETTINGS: 'Settings',
};

const DEFAULT_VALIDATION = {
  valid: false,
  reason: 'Choose a download folder before starting. Downloads cannot proceed until a valid folder is selected.'
};

function extractSettings(payload = {}) {
  return {
    downloadRoot: payload.downloadRoot ?? null,
    concurrency: Number.parseInt(payload.concurrency ?? 4, 10) || 4,
    unzipEnabled: payload.unzipEnabled ?? true,
    structureTemplate: payload.structureTemplate ?? '{artist}/{title}/{kind}',
    sidecarsEnabled: payload.sidecarsEnabled ?? true,
    strictSSL: payload.strictSSL ?? true
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState(TABS.DISCOVER);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [validation, setValidation] = useState(DEFAULT_VALIDATION);
  const [downloads, setDownloads] = useState({});
  const [queuePaused, setQueuePaused] = useState(false);
  const [initializing, setInitializing] = useState(true);

  const addLog = useCallback((message) => {
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${stamp}] ${message}`]);
  }, []);

  const updateDownload = useCallback((jobId, updater) => {
    setDownloads((prev) => {
      const current = prev[jobId] || {};
      const next = { ...current, jobId, ...updater };
      return { ...prev, [jobId]: next };
    });
  }, []);

  const handleQueueEvent = useCallback(({ ev, data = {} }) => {
    switch (ev) {
      case 'job-progress': {
        updateDownload(data.jobId || data.url, {
          filename: data.filename,
          url: data.url,
          uploadId: data.uploadId,
          status: 'in-progress',
          progress: data.progress ?? null
        });
        break;
      }
      case 'job-done': {
        updateDownload(data.jobId || data.url, {
          filename: data.filename,
          url: data.url,
          uploadId: data.uploadId,
          status: 'completed',
          progress: { percent: 100, received: null, total: null }
        });
        addLog(`Download finished: ${data.filename || data.url}`);
        break;
      }
      case 'job-error': {
        updateDownload(data.jobId || data.url, {
          filename: data.filename,
          url: data.url,
          uploadId: data.uploadId,
          status: 'error',
          error: data.error,
          progress: null
        });
        addLog(`Download error: ${data.error || "Unknown error"}`);
        break;
      }
      case 'queue-idle': {
        addLog('Download queue is idle.');
        break;
      }
      case 'queue-paused': {
        setQueuePaused(true);
        addLog('Download queue paused.');
        break;
      }
      case 'queue-resumed': {
        setQueuePaused(false);
        addLog('Download queue resumed.');
        break;
      }
      case 'queue-root-invalid': {
        setQueuePaused(true);
        const reason = data.reason || DEFAULT_VALIDATION.reason;
        setValidation({ valid: false, reason });
        addLog(`Download folder is invalid: ${reason}`);
        setActiveTab(TABS.SETTINGS);
        break;
      }
      default:
        break;
    }
  }, [addLog, updateDownload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await window.ccm.getSettings();
        if (cancelled) return;
        setSettings(extractSettings(result));
        setValidation(result.validation ?? DEFAULT_VALIDATION);
      } catch (error) {
        if (!cancelled) {
          addLog(`Failed to load settings: ${error?.message || String(error)}`);
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    const unsubscribe = window.ccm.onQueueEvent(handleQueueEvent);
    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [addLog, handleQueueEvent]);

  const downloadsList = useMemo(() => Object.values(downloads).sort((a, b) => {
    const nameA = a.filename || a.url || '';
    const nameB = b.filename || b.url || '';
    return nameA.localeCompare(nameB);
  }), [downloads]);

  const bannerVisible = !validation?.valid;

  const handleSaveSettings = async (nextSettings) => {
    try {
      const result = await window.ccm.saveSettings(nextSettings);
      setSettings(extractSettings(result));
      setValidation(result.validation ?? DEFAULT_VALIDATION);
      addLog('Settings saved.');
    } catch (error) {
      addLog(`Failed to save settings: ${error?.message || String(error)}`);
    }
  };

  const handleResetSettings = async () => {
    const result = await window.ccm.resetSettings();
    setSettings(extractSettings(result));
    setValidation(result.validation ?? DEFAULT_VALIDATION);
    addLog('Settings reset to defaults.');
  };

  const handleChooseDownloadRoot = async () => {
    const chosen = await window.ccm.chooseDownloadRoot();
    if (!chosen) return;
    const next = { ...settings, downloadRoot: chosen };
    await handleSaveSettings(next);
  };

  const handleEnqueue = async (jobs) => {
    if (!jobs?.length) return;
    if (!settings) {
      addLog('Settings are still loading.');
      return;
    }
    if (!validation?.valid) {
      addLog('Cannot enqueue downloads until a valid download folder is selected.');
      setActiveTab(TABS.SETTINGS);
      return;
    }
    try {
      const result = await window.ccm.enqueue(jobs, settings);
      addLog(`Enqueued ${result.enqueued} file(s).`);
      setDownloads((prev) => {
        const next = { ...prev };
        for (const job of jobs) {
          const jobId = job.id || job.url;
          next[jobId] = {
            jobId,
            filename: job.filename,
            url: job.url,
            uploadId: job.uploadId,
            status: 'queued',
            progress: { percent: 0, received: 0, total: null }
          };
        }
        return next;
      });
    } catch (error) {
      const message = error?.message || String(error);
      addLog(`Enqueue failed: ${message}`);
      setValidation({ valid: false, reason: message });
      setActiveTab(TABS.SETTINGS);
    }
  };

  const handlePause = () => {
    window.ccm.control('pause');
  };

  const handleResume = () => {
    window.ccm.control('resume');
  };

  const renderActiveTab = () => {
    if (!settings && initializing) {
      return <div className="text-sm text-gray-500">Loading settings…</div>;
    }
    switch (activeTab) {
      case TABS.DISCOVER:
        return (
          <DiscoverPage
            addLog={addLog}
            onEnqueue={handleEnqueue}
            downloadRootValid={validation?.valid}
          />
        );
      case TABS.DOWNLOADS:
        return (
          <DownloadsPage
            downloads={downloadsList}
            isPaused={queuePaused}
            onPause={handlePause}
            onResume={handleResume}
            validation={validation}
            settings={settings}
          />
        );
      case TABS.SETTINGS:
        return (
          <SettingsPage
            settings={settings}
            validation={validation}
            onSave={handleSaveSettings}
            onReset={handleResetSettings}
            onChooseDownloadRoot={handleChooseDownloadRoot}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900">
      {bannerVisible && (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-900">{validation?.reason || DEFAULT_VALIDATION.reason}</p>
            <p className="text-xs text-amber-700">Downloads cannot proceed until a valid folder is selected and writable.</p>
          </div>
          <button
            onClick={() => setActiveTab(TABS.SETTINGS)}
            className="ml-4 rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
          >
            Choose folder
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <nav className="w-64 border-r border-slate-200 bg-white">
          <div className="px-4 py-6">
            <h1 className="text-lg font-semibold text-slate-800">ccMixter Downloader</h1>
            <ul className="mt-6 space-y-1 text-sm">
              {Object.values(TABS).map((tab) => (
                <li key={tab}>
                  <button
                    onClick={() => setActiveTab(tab)}
                    className={`w-full rounded px-3 py-2 text-left transition ${activeTab === tab ? 'bg-slate-900 text-white shadow' : 'hover:bg-slate-100'}`}
                  >
                    {tab}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <main className="flex-1 overflow-y-auto p-6">
          {renderActiveTab()}
        </main>
      </div>

      <footer className="h-52 border-t border-slate-200 bg-white">
        <LogView logs={logs} />
      </footer>
    </div>
  );
}




















































