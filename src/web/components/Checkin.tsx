import { useState } from 'react';
import { FEELINGS, SKIP_REASONS, type Feeling, type LimitChange, type SkipReason } from '../../shared/types';
import { client, type Checkin } from '../api';
import { FEELING_LABELS, SKIP_LABELS, shortDate } from '../format';

export function ChangeList({ changes }: { changes: LimitChange[] }) {
  if (!changes.length) return <div className="muted small">No limit changed. Thanks, that still counts toward your receipt.</div>;
  return (
    <ul className="log">
      {changes.map((c, i) => (
        <li key={i}>
          <span className={c.to < c.from ? 'delta-down' : 'delta-up'}>
            {c.from} → {c.to}
          </span>{' '}
          {c.reason}
        </li>
      ))}
    </ul>
  );
}

function CheckinForm({ c, initial, onDone }: { c: Checkin; initial: 'went' | 'skipped' | null; onDone: () => void }) {
  const [went, setWent] = useState<boolean | null>(initial === null ? null : initial === 'went');
  const [feelings, setFeelings] = useState<Feeling[]>([]);
  const [skip, setSkip] = useState<SkipReason | undefined>();
  const [minutes, setMinutes] = useState(c.minutes);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LimitChange[] | null>(null);

  const toggle = (f: Feeling) => setFeelings((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.feedback({
        windowId: c.id,
        went,
        feelings,
        skipReason: went === false ? skip : undefined,
        note: note.trim() || undefined,
        minutes: went ? minutes : undefined,
      });
      setResult(r.changes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="stack">
        <div className="banner ok">Logged. Here is what Go Window learned:</div>
        <ChangeList changes={result} />
        <div>
          <button className="btn small" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  const feelingOptions = went === false ? FEELINGS.filter((f) => f !== 'great') : FEELINGS;
  return (
    <div className="stack">
      <div className="row">
        <button className={`chip ${went === true ? 'on' : ''}`} onClick={() => setWent(true)}>
          🚶 I went
        </button>
        <button className={`chip ${went === false ? 'on' : ''}`} onClick={() => setWent(false)}>
          🛋 Skipped
        </button>
      </div>

      {went === false && (
        <div className="chips">
          {SKIP_REASONS.map((r) => (
            <button key={r} className={`chip ${skip === r ? 'on' : ''}`} onClick={() => setSkip(r)}>
              {SKIP_LABELS[r]}
            </button>
          ))}
        </div>
      )}

      {went !== null && (
        <>
          <div className="small muted">{went ? 'How did it feel?' : 'Anything about the weather?'}</div>
          <div className="chips">
            {feelingOptions.map((f) => (
              <button key={f} className={`chip ${feelings.includes(f) ? 'on' : ''}`} onClick={() => toggle(f)}>
                {FEELING_LABELS[f]}
              </button>
            ))}
          </div>
          {went && (
            <label className="field" style={{ maxWidth: 180 }}>
              Minutes outside
              <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
            </label>
          )}
        </>
      )}

      <label className="field">
        Or just tell Gemma, in your words
        <textarea
          placeholder="e.g. went to the lake, it was muggy and the traffic smoke made me cough"
          value={note}
          maxLength={600}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && <div className="banner error">{error}</div>}
      <div className="row">
        <button className="btn" disabled={busy || (went === null && !note.trim())} onClick={submit}>
          {busy ? (note.trim() ? 'Gemma is reading…' : 'Saving…') : 'Save'}
        </button>
        <span className="muted small">Your answer adjusts your personal limits. Nothing leaves this machine.</span>
      </div>
    </div>
  );
}

export function CheckinCard({
  checkins,
  launch,
  onChanged,
}: {
  checkins: Checkin[];
  launch: { id: string; response: 'great' | 'went' | 'skipped' } | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<string | null>(launch && launch.response !== 'great' ? launch.id : null);
  if (!checkins.length) return null;
  return (
    <section className="card">
      <h2>How did it go?</h2>
      <div className="muted small" style={{ marginBottom: 6 }}>
        One tap per window. This is how Go Window learns your real heat, air and rain limits.
      </div>
      {checkins.map((c) => (
        <div key={c.id} className="window-row" style={{ display: 'block' }}>
          <div className="spread">
            <div>
              <b>
                {shortDate(c.date)} · {c.start}–{c.end}
              </b>
              <div className="muted small">
                feels {c.summary.feelsMin}–{c.summary.feelsMax}°C
                {c.summary.pm25Max === null ? '' : ` · PM2.5 ≤ ${c.summary.pm25Max}`} · humidity {c.summary.humidityMax}%
              </div>
            </div>
            {open !== c.id && (
              <button className="btn small" onClick={() => setOpen(c.id)}>
                Check in
              </button>
            )}
          </div>
          {open === c.id && (
            <div style={{ marginTop: 10 }}>
              <CheckinForm
                c={c}
                initial={launch?.id === c.id ? (launch.response === 'skipped' ? 'skipped' : 'went') : null}
                onDone={() => {
                  setOpen(null);
                  onChanged();
                }}
              />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
