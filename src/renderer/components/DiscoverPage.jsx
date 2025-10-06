import React, { useMemo, useState } from 'react';

function normalizeSources(input) {
  return (input || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export default function DiscoverPage({ addLog, onEnqueue, downloadRootValid }) {
  const [sources, setSources] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const totalJobs = useMemo(
    () => results.reduce((sum, track) => sum + (track.jobs?.length || 0), 0),
    [results]
  );

  const handleDiscover = async () => {
    const parsedSources = normalizeSources(sources);
    if (parsedSources.length === 0) {
      addLog('Enter at least one ccMixter track or artist URL.');
      return;
    }

    setLoading(true);
    addLog(`Starting discovery for ${parsedSources.length} source(s).`);

    try {
      const discoveryResults = await window.ccm.discover({ sources: parsedSources });
      setResults(discoveryResults);
      const totalFiles = discoveryResults.reduce(
        (sum, track) => sum + (track.jobs?.length || 0),
        0
      );
      addLog(
        `Discovery finished. Found ${discoveryResults.length} upload(s) with ${totalFiles} file(s).`
      );
    } catch (error) {
      addLog(`Discovery failed: ${error?.message || String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEnqueueTrack = (jobs) => {
    if (!jobs || jobs.length === 0) return;
    onEnqueue(jobs);
  };

  const discoverButtonClasses = [
    'rounded px-4 py-2 text-sm font-medium text-white transition-colors',
    loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-700 hover:bg-slate-800'
  ].join(' ');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-slate-800">Discover</h2>
        <p className="text-sm text-slate-500">
          Paste ccMixter track URLs (for example
          <code className="mx-1 rounded bg-slate-100 px-1">https://ccmixter.org/files/user/id</code>)
          or artist URLs
          <code className="ml-1 rounded bg-slate-100 px-1">https://ccmixter.org/people/user</code>.
        </p>
      </header>

      <div className="flex flex-col space-y-3">
        <textarea
          value={sources}
          onChange={(event) => setSources(event.target.value)}
          placeholder="Enter one or more ccMixter URLs, separated by spaces or newlines."
          className="min-h-[120px] w-full rounded border border-slate-300 bg-white p-3 text-sm text-slate-800 focus:border-slate-500 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">Discovered files: {totalJobs}</div>
          <button
            onClick={handleDiscover}
            disabled={loading}
            className={discoverButtonClasses}
          >
            {loading ? 'Discovering...' : 'Discover'}
          </button>
        </div>
      </div>

      <section className="space-y-4">
        {results.length === 0 ? (
          <div className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            Results appear here after discovery. Artist inputs may produce multiple uploads.
          </div>
        ) : (
          results.map((track, index) => {
            const jobs = track.jobs || [];
            const hasJobs = jobs.length > 0;
            const trackTitle = track.trackInfo?.title || `Upload ${track.uploadId || ''}`;
            const trackArtist = track.trackInfo?.artist || 'Unknown artist';
            const trackKey = `${track.uploadId || track.source}-${index}`;
            const enqueueTrackClasses = [
              'rounded px-3 py-1 text-sm font-medium text-white transition-colors',
              !hasJobs || !downloadRootValid
                ? 'bg-emerald-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700'
            ].join(' ');

            return (
              <article key={trackKey} className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                <header className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">{trackTitle}</h3>
                    <p className="text-sm text-slate-500">by {trackArtist}</p>
                    {track.stage && (
                      <p className="text-xs text-slate-400">Source stage: {track.stage}</p>
                    )}
                    {track.trackInfo?.licenseName && (
                      <p className="text-xs text-slate-500">License: {track.trackInfo.licenseName}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end space-y-2">
                    <button
                      onClick={() => handleEnqueueTrack(jobs)}
                      disabled={!hasJobs || !downloadRootValid}
                      className={enqueueTrackClasses}
                    >
                      Enqueue All ({jobs.length})
                    </button>
                    <a
                      href={track.trackInfo?.pageUrl || track.source}
                      className="text-xs text-slate-500 hover:text-slate-600"
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on ccMixter
                    </a>
                  </div>
                </header>

                {track.errors?.length > 0 && (
                  <ul className="mt-3 space-y-1 text-xs text-rose-600">
                    {track.errors.map((error, errorIndex) => (
                      <li key={`${trackKey}-error-${errorIndex}`}>! {error}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-4 space-y-2">
                  {hasJobs ? (
                    jobs.map((job) => {
                      const jobButtonClasses = [
                        'rounded px-3 py-1 text-xs font-medium text-white transition-colors',
                        downloadRootValid
                          ? 'bg-slate-700 hover:bg-slate-800'
                          : 'bg-slate-300 cursor-not-allowed'
                      ].join(' ');

                      return (
                        <div
                          key={job.id || job.url}
                          className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800">{job.filename}</p>
                            <p className="text-xs text-slate-500">
                              {job.isZip ? 'ZIP archive' : 'Audio file'} - {job.meta?.licenseName || 'License N/A'}
                            </p>
                          </div>
                          <button
                            onClick={() => handleEnqueueTrack([job])}
                            disabled={!downloadRootValid}
                            className={jobButtonClasses}
                          >
                            Enqueue
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                      No downloadable files discovered for this upload.
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
















