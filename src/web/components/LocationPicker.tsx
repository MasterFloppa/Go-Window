import { useState } from 'react';
import type { Location } from '../../shared/types';
import { client } from '../api';

export function LocationPicker({ value, onChange }: { value: Location | null; onChange: (l: Location) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Location[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await client.geocode(q.trim());
      setResults(r);
      if (!r.length) setError('No places found');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useDevice = () => {
    if (!navigator.geolocation) return setError('Location is not available in this browser');
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          onChange(await client.locate(pos.coords.latitude, pos.coords.longitude));
          setResults([]);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setError(err.message);
        setBusy(false);
      },
      { maximumAge: 600000, timeout: 15000 },
    );
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {value && (
        <div className="small">
          📍 <b>{value.name}</b> <span className="muted">({value.timezone})</span>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          type="text"
          placeholder="Search your city or neighbourhood"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className="btn" onClick={search} disabled={busy}>
          Search
        </button>
      </div>
      <div>
        <button className="btn ghost small" onClick={useDevice} disabled={busy}>
          Use my location
        </button>{' '}
        <span className="muted small">Rounded to about 1 km before anything leaves this machine.</span>
      </div>
      {results.length > 0 && (
        <div className="results">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon},${r.name}`}
              onClick={() => {
                onChange(r);
                setResults([]);
                setQ('');
              }}
            >
              {r.name} <span className="muted small">{r.timezone}</span>
            </button>
          ))}
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
