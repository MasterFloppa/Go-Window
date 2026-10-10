import { useState } from 'react';
import type { LimitKey } from '../../shared/types';
import { client, type LimitsView } from '../api';

const ORDER: LimitKey[] = ['maxFeels', 'minFeels', 'pm25', 'humidity', 'rainProb', 'uv', 'gust'];

export function LimitsPanel({ limits, onChange }: { limits: LimitsView; onChange: (l: LimitsView) => void }) {
  const [editing, setEditing] = useState<LimitKey | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async (key: LimitKey) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return setError('Enter a number');
    try {
      // The input shows the effective limit; store it as a base limit.
      onChange(await client.setLimit(key, n - limits.adjustments[key]));
      setEditing(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = async () => {
    if (!confirm('Reset all learned limits to defaults?')) return;
    onChange(await client.resetLimits());
  };

  return (
    <div className="grid-2">
      <section className="card">
        <div className="spread">
          <h2>Your limits</h2>
          <button className="btn danger small" onClick={reset}>
            Reset
          </button>
        </div>
        <div className="muted small">
          Any hour that crosses one of these is skipped. They start at sensible defaults and move every time you check in.
          Activity and "sensitive" adjustments are already applied.
        </div>
        {ORDER.map((key) => {
          const meta = limits.labels[key];
          const eff = limits.effective[key];
          const learned = limits.base[key] - limits.defaults[key];
          return (
            <div key={key} className="limit-row">
              <div>
                <div>{meta.label}</div>
                <div className="muted small">
                  {key === 'minFeels' ? 'below this is too cold' : 'above this is too much'}
                  {learned !== 0 && (
                    <>
                      {' · '}
                      <span className={learned < 0 ? 'delta-down' : 'delta-up'}>
                        learned {learned > 0 ? '+' : ''}
                        {Math.round(learned * 10) / 10}
                      </span>
                    </>
                  )}
                  {limits.adjustments[key] !== 0 && ` · activity ${limits.adjustments[key] > 0 ? '+' : ''}${limits.adjustments[key]}`}
                </div>
              </div>
              {editing === key ? (
                <>
                  <input type="number" step={0.5} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
                  <div className="row">
                    <button className="btn small" onClick={() => save(key)}>
                      Save
                    </button>
                    <button className="btn ghost small" onClick={() => setEditing(null)}>
                      ✕
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="limit-val">
                    {eff}
                    <span className="muted small"> {meta.unit}</span>
                  </div>
                  <button
                    className="btn ghost small"
                    onClick={() => {
                      setEditing(key);
                      setValue(String(eff));
                    }}
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          );
        })}
        {error && <div className="banner error">{error}</div>}
      </section>

      <section className="card">
        <h2>What it learned</h2>
        {limits.log.length === 0 ? (
          <div className="muted small">Nothing yet. After your first window, tell it how it felt.</div>
        ) : (
          <ul className="log">
            {limits.log.map((c, i) => (
              <li key={i}>
                <div className="muted small">{new Date(c.at).toLocaleString()}</div>
                <span className={c.to < c.from ? 'delta-down' : 'delta-up'}>
                  {c.from} → {c.to}
                </span>{' '}
                {c.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
