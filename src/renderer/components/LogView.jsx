import React from 'react';

export default function LogView({ logs }) {
  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs uppercase tracking-wide text-slate-400">
        <span>Activity Log</span>
        <span>{logs.length} entries</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-xs font-mono">
        {logs.length === 0 ? (
          <p className="text-slate-500">Logs will appear here as you discover and download files.</p>
        ) : (
          logs.map((entry, index) => <div key={index} className="py-0.5">{entry}</div>)
        )}
      </div>
    </div>
  );
}

