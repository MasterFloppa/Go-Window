import { useCallback, useEffect, useRef, useState } from 'react';
import type { Receipt, Settings } from '../shared/types';
import { ApiError, client, launchCheckin, type Checkin, type LimitsView, type PlanResponse, type Status } from './api';
import { ChangeList, CheckinCard } from './components/Checkin';
import { DayCard } from './components/DayCard';
import { NextWindowHero } from './components/Hero';
import { LimitsPanel } from './components/Limits';
import { ReceiptCard } from './components/Receipt';
import { SettingsPanel } from './components/Settings';
import { Setup } from './components/Setup';
import { Legend } from './components/Timeline';
import type { LimitChange } from '../shared/types';

type Tab = 'plan' | 'limits' | 'settings';

const PLAN_REFRESH_MS = 10 * 60 * 1000;

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [minMinutes, setMinMinutes] = useState<Record<Settings['activity'], number>>({ walk: 30, run: 30, cycle: 45, kids: 45 });
  const [planRes, setPlanRes] = useState<PlanResponse | null>(null);
  const [writing, setWriting] = useState(false);
  const [narrateError, setNarrateError] = useState<string | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [limits, setLimits] = useState<LimitsView | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tab, setTab] = useState<Tab>('plan');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [quickResult, setQuickResult] = useState<LimitChange[] | null>(null);
  const launchHandled = useRef(false);

  const loadSide = useCallback(async () => {
    const [c, l, r] = await Promise.all([client.checkins(), client.limits(), client.receipt()]);
    setCheckins(c);
    setLimits(l);
    setReceipt(r);
  }, []);

  const narrate = useCallback(async () => {
    setWriting(true);
    setNarrateError(null);
    try {
      const r = await client.narrate();
      setPlanRes((cur) => (cur && cur.plan.hash === r.narrative.hash ? { ...cur, narrative: r.narrative, narrativePending: false } : cur));
    } catch (e) {
      setNarrateError(e instanceof ApiError ? e.message : 'Gemma is unavailable; showing template text.');
    } finally {
      setWriting(false);
    }
  }, []);

  const loadPlan = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const r = await client.plan(force);
        setPlanRes(r);
        if (r.narrativePending) void narrate();
        await loadSide();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [loadSide, narrate],
  );

  useEffect(() => {
    (async () => {
      try {
        const [st, s] = await Promise.all([client.status(), client.settings()]);
        setStatus(st);
        setSettings(s.settings);
        setMinMinutes(s.minMinutes);
        if (s.settings.location) await loadPlan();
      } catch (e) {
        setError(
          e instanceof ApiError && e.status === 401
            ? 'This device needs the access link. Open the link printed by `npm run start:lan`, or tap a Go Window notification.'
            : (e as Error).message,
        );
      }
    })();
  }, [loadPlan]);

  // One-tap "Went - great" from a phone notification.
  useEffect(() => {
    if (launchHandled.current || !launchCheckin || !settings?.location) return;
    launchHandled.current = true;
    if (launchCheckin.response !== 'great') return;
    client
      .feedback({ windowId: launchCheckin.id, went: true, feelings: ['great'] })
      .then((r) => {
        setQuickResult(r.changes);
        return loadSide();
      })
      .catch((e) => setError((e as Error).message));
  }, [settings, loadSide]);

  useEffect(() => {
    if (!settings?.location) return;
    const id = setInterval(() => void loadPlan(), PLAN_REFRESH_MS);
    const st = setInterval(() => client.status().then(setStatus).catch(() => undefined), 60000);
    return () => {
      clearInterval(id);
      clearInterval(st);
    };
  }, [settings?.location, loadPlan]);

  if (!settings) {
    return (
      <div className="app">
        <div className="empty">{error ? <div className="banner error">{error}</div> : 'Loading Go Window…'}</div>
      </div>
    );
  }

  if (!settings.location) {
    return (
      <div className="app">
        <Setup
          settings={settings}
          onDone={(s) => {
            setSettings(s);
            void loadPlan();
          }}
        />
      </div>
    );
  }

  const plan = planRes?.plan;
  const narrative = planRes?.narrative;
  const ollama = status?.ollama;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">🌿</div>
          <div>
            <h1>Go Window</h1>
            <small>The best time to go outside, inside the hours you are free.</small>
          </div>
        </div>
        <nav className="tabs">
          {(['plan', 'limits', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'plan' ? 'Plan' : t === 'limits' ? 'My limits' : 'Settings'}
            </button>
          ))}
        </nav>
      </header>

      <div className="status-row">
        <span className="pill">📍 {settings.location.name}</span>
        <span className="pill" title={ollama?.error ?? ollama?.models.join(', ')}>
          <span className={`dot ${ollama?.hasModel ? 'ok' : ollama?.up ? 'warn' : 'bad'}`} />
          {ollama?.hasModel ? `${settings.model} on this machine` : ollama?.up ? `${settings.model} not pulled` : 'Ollama offline'}
        </span>
        <span className="pill">
          <span className={`dot ${settings.notify.enabled ? 'ok' : ''}`} />
          {settings.notify.enabled ? 'Phone alerts on' : 'Phone alerts off'}
        </span>
        <button className="btn ghost small" onClick={() => loadPlan(true)} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
        {plan && <span>Updated {new Date(plan.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
      </div>

      {error && (
        <div className="banner error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {tab === 'plan' && (
        <div className="grid-2">
          <div className="stack">
            {quickResult && (
              <section className="card">
                <div className="banner ok" style={{ marginBottom: 8 }}>
                  Logged: you went and it felt great. 🌿
                </div>
                <ChangeList changes={quickResult} />
              </section>
            )}
            {plan && narrative ? (
              <>
                <NextWindowHero plan={plan} narrative={narrative} />
                {!plan.airAvailable && (
                  <div className="banner">Air-quality forecast is unavailable right now, so this plan uses weather only. It will retry shortly.</div>
                )}
                {narrateError && <div className="banner">{narrateError}</div>}
                <div className="days">
                  {plan.days.map((d) => (
                    <DayCard
                      key={d.date}
                      day={d}
                      story={narrative.days.find((s) => s.date === d.date)}
                      writing={writing}
                      timezone={plan.location.timezone}
                      activity={plan.activity}
                    />
                  ))}
                </div>
                <Legend />
              </>
            ) : (
              <div className="card empty">{loading ? 'Reading the sky…' : 'No plan yet.'}</div>
            )}
          </div>

          <div className="stack">
            <CheckinCard checkins={checkins} launch={launchCheckin} onChanged={() => void loadPlan()} />
            {receipt && <ReceiptCard receipt={receipt} />}
            <details className="card">
              <summary>
                <b>How this works</b>
              </summary>
              <ul className="small" style={{ paddingLeft: 18, margin: '10px 0 0' }}>
                <li>Weather and air quality come from Open-Meteo (open data), using your location rounded to about 1 km.</li>
                <li>Parks come from OpenStreetMap.</li>
                <li>Plain code scores every hour against <b>your</b> limits and keeps only your free hours.</li>
                <li>
                  {settings.model} runs on this machine through Ollama and only writes the words. If it invents a number, that line is
                  replaced.
                </li>
                <li>Check-ins move your limits: quickly when something felt bad, slowly when it felt great.</li>
              </ul>
              {plan && !plan.parksAvailable && (
                <div className="muted small" style={{ marginTop: 6 }}>
                  Park suggestions are still loading from OpenStreetMap.
                </div>
              )}
            </details>
          </div>
        </div>
      )}

      {tab === 'limits' && limits && (
        <LimitsPanel
          limits={limits}
          onChange={(l) => {
            setLimits(l);
            void loadPlan();
          }}
        />
      )}

      {tab === 'settings' && (
        <SettingsPanel
          settings={settings}
          status={status}
          minMinutes={minMinutes}
          onSaved={(s) => {
            setSettings(s);
            void loadPlan();
            client.status().then(setStatus).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
