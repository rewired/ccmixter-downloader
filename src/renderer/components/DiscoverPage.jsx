
import React, { useState } from 'react';

export default function DiscoverPage({ addLog }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [tracks, setTracks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = async () => {
    setIsLoading(true);
    const results = await window.electron.discover({ sources: ['ccmixter'], query: searchTerm });
    setTracks(results);
    setIsLoading(false);
  };

  return (
    <div>
      <h2>Discover Music</h2>
      <div style={{ display: 'flex', marginBottom: '10px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search for music..."
          style={{ flex: 1, padding: '8px' }}
        />
        <button onClick={handleSearch} style={{ padding: '8px' }}>Search</button>
      </div>
      {isLoading && <p>Loading...</p>}
      <ul>
        {tracks.map(track => (
          <li key={track.id} style={{ marginBottom: '10px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
            <div><strong>{track.artist}</strong> - {track.title}</div>
            <div>License: {track.license}</div>
            <button onClick={() => window.electron.enqueue({ jobs: [{ url: track.download_url, filename: `${track.artist} - ${track.title}.mp3` }] })}>Download</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
