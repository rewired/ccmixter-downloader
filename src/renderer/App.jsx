import React, { useState } from 'react';
import DiscoverPage from './components/DiscoverPage';
import DownloadsPage from './components/DownloadsPage';
import SettingsPage from './components/SettingsPage';
import LogView from './components/LogView';

const TABS = {
  DISCOVER: 'Discover',
  DOWNLOADS: 'Downloads',
  SETTINGS: 'Settings',
};

export default function App() {
  const [activeTab, setActiveTab] = useState(TABS.DISCOVER);
  const [logs, setLogs] = useState([]);

  const addLog = (message) => {
    setLogs(prevLogs => [...prevLogs, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case TABS.DISCOVER:
        return <DiscoverPage addLog={addLog} />;
      case TABS.DOWNLOADS:
        return <DownloadsPage addLog={addLog} />;
      case TABS.SETTINGS:
        return <SettingsPage addLog={addLog} />;
      default:
        return <DiscoverPage addLog={addLog} />;
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flex: 1 }}>
        <div style={{ width: '200px', background: '#f0f0f0', padding: '10px' }}>
          <h2>ccmIxter DL</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            <li onClick={() => setActiveTab(TABS.DISCOVER)} style={{ cursor: 'pointer', padding: '10px', background: activeTab === TABS.DISCOVER ? '#ddd' : 'transparent' }}>Discover</li>
            <li onClick={() => setActiveTab(TABS.DOWNLOADS)} style={{ cursor: 'pointer', padding: '10px', background: activeTab === TABS.DOWNLOADS ? '#ddd' : 'transparent' }}>Downloads</li>
            <li onClick={() => setActiveTab(TABS.SETTINGS)} style={{ cursor: 'pointer', padding: '10px', background: activeTab === TABS.SETTINGS ? '#ddd' : 'transparent' }}>Settings</li>
          </ul>
        </div>
        <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
          {renderActiveTab()}
        </div>
      </div>
      <div style={{ height: '200px', borderTop: '1px solid #ccc', overflowY: 'auto' }}>
        <LogView logs={logs} />
      </div>
    </div>
  );
}