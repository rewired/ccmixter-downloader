import React, { useEffect, useState } from 'react';

const EMPTY_SETTINGS = {
  downloadRoot: '',
  concurrency: 4,
  unzipEnabled: true,
  structureTemplate: '{artist}/{title}/{kind}',
  sidecarsEnabled: true,
  strictSSL: true
};

export default function SettingsPage({ settings, validation, onSave, onReset, onChooseDownloadRoot }) {
  const [draft, setDraft] = useState(EMPTY_SETTINGS);

  useEffect(() => {
    if (settings) {
      setDraft({
        downloadRoot: settings.downloadRoot || '',
        concurrency: settings.concurrency,
        unzipEnabled: Boolean(settings.unzipEnabled),
        structureTemplate: settings.structureTemplate,
        sidecarsEnabled: settings.sidecarsEnabled ?? true,
        strictSSL: settings.strictSSL ?? true
      });
    }
  }, [settings]);

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target;
    setDraft((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSave = async () => {
    await onSave(draft);
  };

  const handleReset = async () => {
    await onReset();
  };

  const handleChoose = async () => {
    await onChooseDownloadRoot();
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold text-slate-800">Settings</h2>
        <p className="text-sm text-slate-500">Configure how downloads are organised and processed.</p>
      </header>

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-slate-700">Download folder</label>
          <div className="mt-2 flex rounded border border-slate-300 bg-white">
            <input
              type="text"
              name="downloadRoot"
              value={draft.downloadRoot}
              readOnly
              className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleChoose}
              className="border-l border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Choose�
            </button>
          </div>
          {!validation?.valid && (
            <p className="mt-2 text-xs text-rose-600">{validation?.reason}</p>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label htmlFor="concurrency" className="block text-sm font-medium text-slate-700">Parallel downloads</label>
            <input
              id="concurrency"
              name="concurrency"
              type="number"
              min={1}
              value={draft.concurrency}
              onChange={handleChange}
              className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">Number of files downloaded at the same time.</p>
          </div>

          <div>
            <label htmlFor="structureTemplate" className="block text-sm font-medium text-slate-700">Folder template</label>
            <input
              id="structureTemplate"
              name="structureTemplate"
              value={draft.structureTemplate}
              onChange={handleChange}
              className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-500">Tokens: {'{artist}'}, {'{title}'}, {'{kind}'}</p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <label className="inline-flex items-center text-sm text-slate-700">
            <input
              type="checkbox"
              name="unzipEnabled"
              checked={draft.unzipEnabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500"
            />
            <span className="ml-2">Automatically unzip ZIP archives</span>
          </label>
          <label className="inline-flex items-center text-sm text-slate-700">
            <input
              type="checkbox"
              name="sidecarsEnabled"
              checked={draft.sidecarsEnabled}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500"
            />
            <span className="ml-2">Write ATTRIBUTION.txt and LICENSE.txt</span>
          </label>
          <label className="inline-flex items-center text-sm text-slate-700">
            <input
              type="checkbox"
              name="strictSSL"
              checked={draft.strictSSL}
              onChange={handleChange}
              className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-500"
            />
            <span className="ml-2">Strict SSL certificate validation (disable only if you encounter certificate errors)</span>
          </label>
        </div>
      </div>

      <div className="flex space-x-3">
        <button
          type="button"
          onClick={handleSave}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Save settings
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

