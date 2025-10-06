
import React from 'react';

export default function LogView({ logs }) {
  return (
    <div style={{ padding: '10px', background: '#f5f5f5', height: '100%', overflowY: 'auto' }}>
      <h4>Logs</h4>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {logs.map((log, index) => (
          <div key={index}>{log}</div>
        ))}
      </pre>
    </div>
  );
}
