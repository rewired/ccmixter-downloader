import React from 'react';

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function buildStatusLabel(item) {
  switch (item.status) {
    case 'completed':
      return 'Completed';
    case 'error':
      return 'Error';
    case 'in-progress':
      return 'Downloading';
    case 'queued':
    default:
      return 'Queued';
  }
}

export default function DownloadsPage({ downloads, isPaused, onPause, onResume, validation, settings }) {
  const downloadRoot = settings?.downloadRoot || 'Not selected';
  const pauseButtonClasses = [
    'rounded px-4 py-2 text-sm font-medium text-white transition-colors',
    isPaused ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-800'
  ].join(' ');
  const resumeButtonClasses = [
    'rounded px-4 py-2 text-sm font-medium text-white transition-colors',
    !validation?.valid || !isPaused ? 'bg-emerald-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
  ].join(' ');

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800">Downloads</h2>
          <p className="text-sm text-slate-500">
            Destination:{' '}
            <span className="font-mono text-slate-600">{downloadRoot}</span>
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <button onClick={onPause} disabled={isPaused} className={pauseButtonClasses}>
            Pause
          </button>
          <button onClick={onResume} disabled={!validation?.valid || !isPaused} className={resumeButtonClasses}>
            Resume
          </button>
        </div>
      </header>

      {downloads.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No downloads enqueued yet. Start from the Discover tab after selecting items.
        </div>
      ) : (
        <ul className="space-y-3">
          {downloads.map((item) => {
            const statusLabel = buildStatusLabel(item);
            const percent = Math.max(0, Math.min(100, item.progress?.percent ?? 0));
            const received = item.progress?.received;
            const total = item.progress?.total;
            const progressLabel = Number.isFinite(received)
              ? `${formatBytes(received)}${Number.isFinite(total) ? ` / ${formatBytes(total)}` : ''}`
              : '';
            return (
              <li key={item.jobId} className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.filename || item.url}</p>
                    <p className="text-xs text-slate-500">{statusLabel}{item.error ? ` • ${item.error}` : ''}</p>
                  </div>
                  <div className="text-xs text-slate-500">{progressLabel}</div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-700 transition-all"
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!validation?.valid && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Downloads will remain paused until a valid folder is selected in Settings.
        </div>
      )}
    </div>
  );
}

