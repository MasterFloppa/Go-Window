import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { client, type Status } from '../api';
import { ACTIVITIES } from '../format';
import { FreeHoursEditor } from './FreeHours';
import { LocationPicker } from './LocationPicker';

const MIN_OPTIONS = [15, 20, 30, 45, 60, 90];

const TOLERANCES: { id: Settings['tolerance']; label: string; hint: string }[] = [
  { id: 'strict', label: 'Show nothing', hint: 'Strict: only suggest times inside every limit, even if that means no window.' },
  { id: 'balanced', label: 'Best available (a little over)', hint: 'Balanced: suggest the closest slot, up to about 2°C or 40% PM2.5 over your limits, clearly marked.' },
  { id: 'relaxed', label: 'Best available (more flexible)', hint: 'Relaxed: up to about 4°C or double your PM2.5 limit. Thunderstorms always block.' },
];

export function ActivityPicker({ value, onChange }: { value: Settings['activity']; onChange: (a: Settings['activity']) => void }) {
  return (
    <div className="chips">
      {ACTIVITIES.map((a) => (
        <button key={a.id} className={`chip ${value === a.id ? 'on' : ''}`} onClick={() => onChange(a.id)} title={a.hint}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

type Msg = { ok: boolean; text: string } | null;

function PhoneAlerts({ s, setS, saved, dirty }: { s: Settings; setS: (s: Settings) => void; saved: Settings; dirty: boolean }) {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const n = s.notify;
  const setN = (patch: Partial<Settings['notify']>) => setS({ ...s, notify: { ...n, ...patch } });

  useEffect(() => {
    client.qr().then(setQr).catch(() => setQr(null));
  }, [saved.notify.topic, saved.notify.server]);

  const test = async () => {
    setMsg(null);
    try {
      await client.testNotify();
      setMsg({ ok: true, text: 'Sent. It should pop up on your phone in a few seconds.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section className="card">
      <div className="spread">
        <h2>Phone alerts</h2>
        <label className="check">
          <input type="checkbox" checked={n.enabled} onChange={(e) => setN({ enabled: e.target.checked })} />
          On
        </label>
      </div>
      <div className="muted small">A morning digest, a nudge when your window opens, and a one-tap “how was it?” afterwards.</div>
      {n.enabled && (
        <div className="row" style={{ alignItems: 'flex-start', marginTop: 10, gap: 16 }}>
          {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />}
          <ol className="small" style={{ margin: 0, paddingLeft: 18, flex: 1, minWidth: 220 }}>
            <li>
              Install the free, open-source{' '}
              <a href="https://ntfy.sh" target="_blank" rel="noreferrer">
                ntfy
              </a>{' '}
              app.
            </li>
            <li>
              Tap + and subscribe to <code>{saved.notify.topic}</code> (or scan the code). Keep it private.
            </li>
            <li>Save settings, then send a test.</li>
            <li style={{ listStyle: 'none', marginTop: 8 }}>
              <div className="row">
                <label className="field" style={{ width: 150 }}>
                  Morning digest at
                  <input type="time" value={n.digestTime} onChange={(e) => setN({ digestTime: e.target.value })} />
                </label>
                <button className="btn ghost small" onClick={test} disabled={dirty} title={dirty ? 'Save first' : ''}>
                  Send test
                </button>
              </div>
            </li>
          </ol>
        </div>
      )}
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </section>
  );
}

function Advanced({ s, setS, status, minDefault }: { s: Settings; setS: (s: Settings) => void; status: Status | null; minDefault: number }) {
  const [msg, setMsg] = useState<Msg>(null);
  const n = s.notify;
  const setN = (patch: Partial<Settings['notify']>) => setS({ ...s, notify: { ...n, ...patch } });

  const sync = async () => {
    setMsg(null);
    try {
      const r = await client.syncNotify();
      setMsg({ ok: !r.errors.length, text: r.errors.length ? r.errors.join('; ') : `Synced: ${r.published.length} scheduled, ${r.cancelled.length} cancelled.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <details className="card advanced">
      <summary>
        <b>Advanced</b> <span className="muted small">window length, alert timing, phone link, ntfy server, local model</span>
      </summary>
      <div className="adv-grid">
        <label className="field">
          Shortest window worth going
          <select
            value={s.minMinutes ?? ''}
            onChange={(e) => setS({ ...s, minMinutes: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">Auto for activity ({minDefault} min)</option>
            {MIN_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Nudge before a window opens (min)
          <input type="number" min={0} max={60} value={n.leadMinutes} onChange={(e) => setN({ leadMinutes: Number(e.target.value) })} />
        </label>
        <label className="check" style={{ alignSelf: 'end' }}>
          <input type="checkbox" checked={n.checkin} onChange={(e) => setN({ checkin: e.target.checked })} />
          Ask “how was it?” after each window
        </label>
        <label className="field">
          Ollama model
          <input type="text" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
          <span className="small">
            {status?.ollama.up ? `Available: ${status.ollama.models.join(', ') || 'none'}` : 'Ollama not reachable; plans still work with template text.'}
          </span>
        </label>
        <label className="field wide">
          Link for phone check-in buttons
          <input type="url" placeholder="http://192.168.1.20:8787" value={n.publicUrl} onChange={(e) => setN({ publicUrl: e.target.value })} />
          <span className="small">
            Lets the notification buttons open this app on your phone (same Wi-Fi). Run <code>npm run start:lan</code>.
            {status?.lanUrls.map((u) => (
              <button key={u} className="chip" style={{ marginLeft: 6 }} onClick={() => setN({ publicUrl: u })}>
                use {u}
              </button>
            ))}
          </span>
        </label>
        <label className="field">
          ntfy server
          <input type="url" value={n.server} onChange={(e) => setN({ server: e.target.value })} />
        </label>
        <label className="field">
          ntfy topic (acts like a password)
          <input type="text" value={n.topic} onChange={(e) => setN({ topic: e.target.value })} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost small" onClick={sync}>
          Sync alert schedule now
        </button>
        {status?.notify.lastSync && (
          <span className="muted small">
            Last sync {new Date(status.notify.lastSync.at).toLocaleTimeString()} · {status.notify.scheduled} scheduled
          </span>
        )}
      </div>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`} style={{ marginTop: 8 }}>{msg.text}</div>}
    </details>
  );
}

export function SettingsPanel({
  settings,
  status,
  minMinutes,
  onSaved,
}: {
  settings: Settings;
  status: Status | null;
  minMinutes: Record<Settings['activity'], number>;
  onSaved: (s: Settings) => void;
}) {
  const [s, setS] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  useEffect(() => setS(settings), [settings]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await client.saveSettings(s);
      onSaved(r.settings);
      setMsg({ ok: true, text: 'Saved. Your plan and alerts are updated.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="savebar">
        <span className="muted small">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button className="btn" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>When are you free?</h2>
          <div className="muted small" style={{ marginBottom: 6 }}>
            Go Window only suggests times inside these slots.
          </div>
          <FreeHoursEditor value={s.freeHours} onChange={(freeHours) => setS({ ...s, freeHours })} />
        </section>

        <div className="stack">
          <section className="card">
            <h2>Where</h2>
            <LocationPicker value={s.location} onChange={(location) => setS({ ...s, location })} />
          </section>
          <section className="card">
            <h2>What</h2>
            <ActivityPicker value={s.activity} onChange={(activity) => setS({ ...s, activity })} />
            <label className="check">
              <input type="checkbox" checked={s.sensitive} onChange={(e) => setS({ ...s, sensitive: e.target.checked })} />
              Sensitive to heat or air (asthma, pregnancy, older age)
            </label>
            <label className="check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={s.darkOk} onChange={(e) => setS({ ...s, darkOk: e.target.checked })} />
              Going out after dark is fine
            </label>
            <div className="small muted" style={{ marginTop: 10 }}>
              When nothing fits all your limits
            </div>
            <div className="chips">
              {TOLERANCES.map((t) => (
                <button key={t.id} className={`chip ${s.tolerance === t.id ? 'on' : ''}`} onClick={() => setS({ ...s, tolerance: t.id })} title={t.hint}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="muted small">{TOLERANCES.find((t) => t.id === s.tolerance)?.hint}</div>
          </section>
        </div>
      </div>

      <PhoneAlerts s={s} setS={setS} saved={settings} dirty={dirty} />
      <Advanced s={s} setS={setS} status={status} minDefault={minMinutes[s.activity]} />
      <details className="card">
        <summary>
          <b>About & privacy</b>
        </summary>
        <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 0' }}>
          <li>Weather and air quality come from Open-Meteo (open data), using your location rounded to about 1 km. Parks come from OpenStreetMap.</li>
          <li>Plain code scores every hour against your limits and keeps only your free hours.</li>
          <li>
            {settings.model} runs on this machine through Ollama and only writes the words. If it invents a number, that line is replaced
            {status?.ollama.up ? '' : ' (Ollama is not reachable right now, so you see plain text)'}.
          </li>
          <li>Check-ins move your limits: quickly when something felt bad, slowly when it felt great.</li>
          <li>Your free hours, check-ins and limits are stored only in this app's data folder.</li>
        </ul>
      </details>
    </div>
  );
}
