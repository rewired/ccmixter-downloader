import React, { useState, useEffect } from 'react';

export default function SettingsPage({ addLog }) {
  const [downloadRoot, setDownloadRoot] = useState('');
  const [concurrency, setConcurrency] = useState(4);
  const [unzip, setUnzip] = useState(true);
  const [structureTemplate, setStructureTemplate] = useState('{artist}/{title}/{kind}');

  useEffect(() => {
    // In a real app, you would fetch the initial settings from the main process
  }, []);

  const handleChooseDownloadRoot = async () => {
    const root = await window.electron.chooseDownloadRoot();
    if (root) {
      setDownloadRoot(root);
      addLog(`Download folder set to: ${root}`);
    }
  };

  return (
    <div>
      <h2>Settings</h2>
      <div>
        <label>Download Folder:</label>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '10px' }}>
          <input type="text" value={downloadRoot} readOnly style={{ flex: 1, padding: '8px' }} />
          <button onClick={handleChooseDownloadRoot} style={{ padding: '8px' }}>Choose</button>
        </div>
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label>Concurrency:</label>
        <input
          type="number"
          value={concurrency}
          onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
          style={{ padding: '8px', width: '100px' }}
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label>
          <input
            type="checkbox"
            checked={unzip}
            onChange={(e) => setUnzip(e.target.checked)}
          />
          Automatically unzip archives
        </label>
      </div>
      <div>
        <label>Folder Structure Template:</label>
        <input
          type="text"
          value={structureTemplate}
          onChange={(e) => setStructureTemplate(e.target.value)}
          style={{ padding: '8px', width: '100%' }}
        />
      </div>
    </div>
  );
}