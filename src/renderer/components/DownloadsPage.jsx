
import React, { useState, useEffect } from 'react';

export default function DownloadsPage({ addLog }) {
  const [downloads, setDownloads] = useState([]);

  useEffect(() => {
    const handleQueueEvent = (_event, { ev, data }) => {
      if (ev === 'job-progress') {
        setDownloads(prevDownloads => {
          const existing = prevDownloads.find(d => d.id === data.id);
          if (existing) {
            return prevDownloads.map(d => d.id === data.id ? { ...d, progress: data.progress } : d);
          } else {
            return [...prevDownloads, { id: data.id, ...data, progress: data.progress }];
          }
        });
      }
    };

    const removeListener = window.electron.onQueueEvent(handleQueueEvent);

    return () => {
      removeListener();
    };
  }, []);

  return (
    <div>
      <h2>Downloads</h2>
      <ul>
        {downloads.map(download => (
          <li key={download.id}>
            <div>{download.filename}</div>
            <progress value={download.progress} max="100"></progress>
          </li>
        ))}
      </ul>
    </div>
  );
}
