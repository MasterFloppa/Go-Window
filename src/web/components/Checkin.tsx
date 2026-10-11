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

function CheckinForm({ c, initial, onSaved }: { c: Checkin; initial: 'went' | 'skipped' | null; onSaved: (changes: LimitChange[]) => void }) {
  const [went, setWent] = useState<boolean | null>(initial === null ? null : initial === 'went');
  const [feelings, setFeelings] = useState<Feeling[]>([]);
  const [skip, setSkip] = useState<SkipReason | undefined>();
  const [minutes, setMinutes] = useState(c.minutes);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onSaved(r.changes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
  // Answered windows stay here, with what was learned, until "Done", even if a background refresh
  // has already dropped them from the pending list.
  const [answered, setAnswered] = useState<{ c: Checkin; changes: LimitChange[] }[]>([]);
  const rows = [
    ...answered.map((a) => ({ c: a.c, changes: a.changes as LimitChange[] | null })),
    ...checkins.filter((c) => !answered.some((a) => a.c.id === c.id)).map((c) => ({ c, changes: null })),
  ];
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>How did it go?</h2>
      <div className="muted small" style={{ marginBottom: 6 }}>
        One tap per window. This is how Go Window learns your real heat, air and rain limits.
      </div>
      {rows.map(({ c, changes }) => (
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
            {!changes && open !== c.id && (
              <button className="btn small" onClick={() => setOpen(c.id)}>
                Check in
              </button>
            )}
          </div>
          {changes ? (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="banner ok">Logged. Here is what Go Window learned:</div>
              <ChangeList changes={changes} />
              <div>
                <button
                  className="btn small"
                  onClick={() => {
                    setAnswered((cur) => cur.filter((a) => a.c.id !== c.id));
                    onChanged();
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            open === c.id && (
              <div style={{ marginTop: 10 }}>
                <CheckinForm
                  c={c}
                  initial={launch?.id === c.id ? (launch.response === 'skipped' ? 'skipped' : 'went') : null}
                  onSaved={(learned) => {
                    setOpen(null);
                    setAnswered((cur) => [...cur.filter((a) => a.c.id !== c.id), { c, changes: learned }]);
                  }}
                />
              </div>
            )
          )}
        </div>
      ))}
    </section>
  );
}
