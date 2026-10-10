import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { client, type Status } from '../api';
import { ACTIVITIES } from '../format';
import { FreeHoursEditor } from './FreeHours';
import { LocationPicker } from './LocationPicker';

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

function NotifySection({ s, setS, status }: { s: Settings; setS: (s: Settings) => void; status: Status | null }) {
  const [qr, setQr] = useState<{ url: string; svg: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = s.notify;
  const setN = (patch: Partial<Settings['notify']>) => setS({ ...s, notify: { ...n, ...patch } });

  useEffect(() => {
    client.qr().then(setQr).catch(() => setQr(null));
  }, [n.topic, n.server]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section className="card">
      <h2>Phone notifications</h2>
      <div className="muted small">
        Uses <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a>, an open-source push service. Install the ntfy app
        (Android or iOS), tap “+”, and subscribe to your private topic below (or scan the code). Alerts are scheduled on the ntfy
        server, so they still arrive if this laptop is asleep.
      </div>
      <div className="row" style={{ alignItems: 'flex-start', marginTop: 10 }}>
        {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr.svg }} />}
        <div className="stack" style={{ flex: 1, minWidth: 240, gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked={n.enabled} onChange={(e) => setN({ enabled: e.target.checked })} />
            Send notifications to my phone
          </label>
          <label className="field">
            Topic (treat it like a password)
            <input type="text" value={n.topic} onChange={(e) => setN({ topic: e.target.value })} />
          </label>
          <label className="field">
            ntfy server
            <input type="url" value={n.server} onChange={(e) => setN({ server: e.target.value })} />
          </label>
          <div className="row">
            <label className="field" style={{ width: 140 }}>
              Morning digest
              <input type="time" value={n.digestTime} onChange={(e) => setN({ digestTime: e.target.value })} />
            </label>
            <label className="field" style={{ width: 160 }}>
              Nudge before window (min)
              <input type="number" min={0} max={60} value={n.leadMinutes} onChange={(e) => setN({ leadMinutes: Number(e.target.value) })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={n.checkin} onChange={(e) => setN({ checkin: e.target.checked })} />
            Ask “how was it?” after each window
          </label>
          <label className="field">
            Link for check-in buttons (an address your phone can reach)
            <input type="url" placeholder="http://192.168.1.20:8787" value={n.publicUrl} onChange={(e) => setN({ publicUrl: e.target.value })} />
          </label>
          {status?.lanUrls.length ? (
            <div className="small muted">
              On this Wi-Fi:{' '}
              {status.lanUrls.map((u) => (
                <button key={u} className="chip" onClick={() => setN({ publicUrl: u })}>
                  {u}
                </button>
              ))}{' '}
              Start with <code>npm run start:lan</code> so your phone can open it.
            </div>
          ) : null}
          <div className="row">
            <button className="btn ghost small" onClick={() => run(() => client.testNotify(), 'Test sent. Check your phone.')}>
              Send test (saved topic)
            </button>
            <button className="btn ghost small" onClick={() => run(() => client.syncNotify(), 'Schedule synced with ntfy.')}>
              Sync schedule now
            </button>
          </div>
          {status?.notify.lastSync && (
            <div className="muted small">
              Last sync {new Date(status.notify.lastSync.at).toLocaleTimeString()} · {status.notify.scheduled} scheduled
              {status.notify.lastSync.result.errors.length ? ` · ${status.notify.lastSync.result.errors.length} errors` : ''}
            </div>
          )}
          {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
        </div>
      </div>
    </section>
  );
}

export function SettingsPanel({
  settings,
  status,
  onSaved,
}: {
  settings: Settings;
  status: Status | null;
  onSaved: (s: Settings) => void;
}) {
  const [s, setS] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);

  useEffect(() => setS(settings), [settings]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await client.saveSettings(s);
      onSaved(r.settings);
      setMsg({ ok: true, text: 'Saved. Plan and notifications updated.' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="spread" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', padding: '6px 0' }}>
        <span className="muted small">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button className="btn" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      {msg && <div className={`banner ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Your free hours</h2>
          <div className="muted small">
            The only times Go Window will suggest. Be honest: a 7:00–7:45 slot you actually have beats a 2-hour slot you don't.
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
              I'm sensitive to heat or air (asthma, pregnancy, older age)
            </label>
            <label className="check" style={{ marginTop: 6 }}>
              <input type="checkbox" checked={s.darkOk} onChange={(e) => setS({ ...s, darkOk: e.target.checked })} />
              Going out after dark is fine
            </label>
          </section>
          <section className="card">
            <h2>Local model</h2>
            <label className="field">
              Ollama model
              <input type="text" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} />
            </label>
            <div className="muted small" style={{ marginTop: 6 }}>
              {status?.ollama.up
                ? `Ollama is running with ${status.ollama.models.join(', ') || 'no models'}.`
                : 'Ollama is not reachable. Plans still work; text falls back to templates.'}
            </div>
          </section>
        </div>
      </div>

      <NotifySection s={s} setS={setS} status={status} />
    </div>
  );
}
