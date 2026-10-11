import { useCallback, useEffect, useRef, useState } from 'react';
import type { Receipt, Settings } from '../shared/types';
import { ApiError, client, launchCheckin, type Checkin, type LimitsView, type PlanResponse, type Status } from './api';
import { ChangeList, CheckinCard } from './components/Checkin';
import { DayRow } from './components/DayCard';
import { NextWindowHero } from './components/Hero';
import { LimitsPanel } from './components/Limits';
import { ReceiptLine } from './components/Receipt';
import { SettingsPanel } from './components/Settings';
import { Setup } from './components/Setup';
import type { LimitChange } from '../shared/types';

type Tab = 'plan' | 'limits' | 'settings';

const PLAN_REFRESH_MS = 10 * 60 * 1000;
const TIP_KEY = 'go-window-tip-dismissed';

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [minMinutes, setMinMinutes] = useState<Record<Settings['activity'], number>>({ walk: 30, run: 30, cycle: 45, kids: 45 });
  const [planRes, setPlanRes] = useState<PlanResponse | null>(null);
  const [writing, setWriting] = useState(false);
  // Narration failures fall back to template text silently; the subline flags an offline model.
  const [, setNarrateError] = useState<string | null>(null);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [limits, setLimits] = useState<LimitsView | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [tab, setTab] = useState<Tab>('plan');
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [tipDismissed, setTipDismissed] = useState(() => localStorage.getItem(TIP_KEY) === '1');
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
        if (s.settings.location) {
          // Limits and receipt do not depend on the forecast; load them even if the plan request fails.
          void loadSide().catch(() => undefined);
          await loadPlan();
        }
      } catch (e) {
        setError(
          e instanceof ApiError && e.status === 401
            ? 'This device needs the access link. Open the link printed by `npm run start:lan`, or tap a Go Window notification.'
            : (e as Error).message,
        );
      }
    })();
  }, [loadPlan, loadSide]);

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
  const isNew = !!receipt && !receipt.windowsTaken && !receipt.skipped;

  return (
    <div className="app">
      <header className={`topbar ${tab === 'plan' ? 'narrow' : ''}`}>
        <div className="brand">
          <div className="logo">🌿</div>
          <h1>Go Window</h1>
        </div>
        <nav className="tabs">
          {(['plan', 'limits', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'plan' ? 'Plan' : t === 'limits' ? 'My limits' : 'Settings'}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'plan' && (
        <div className="subline">
          <button className="linkish" onClick={() => setTab('settings')} title="Change location">
            📍 {settings.location.name.split(',')[0]}
          </button>
          {!settings.notify.enabled && (
            <button className="linkish" onClick={() => setTab('settings')} title="Get a nudge on your phone">
              🔕 alerts off
            </button>
          )}
          {ollama && !ollama.hasModel && (
            <span className="warn-text" title={ollama.error ?? ''}>
              {ollama.up ? `${settings.model} not installed` : 'Ollama offline'}, using plain text
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="linkish" onClick={() => loadPlan(true)} disabled={loading} title="Refresh forecast">
            {loading ? 'refreshing…' : `↻ ${plan ? new Date(plan.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`}
          </button>
        </div>
      )}

      {error && (
        <div className="banner error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      {tab === 'plan' && (
        <div className="single">
          {quickResult && (
            <section className="card">
              <div className="banner ok" style={{ marginBottom: 8 }}>
                Logged: you went and it felt great. 🌿
              </div>
              <ChangeList changes={quickResult} />
            </section>
          )}
          <CheckinCard checkins={checkins} launch={launchCheckin} onChanged={() => void loadPlan()} />
          {plan && narrative ? (
            <>
              <NextWindowHero plan={plan} narrative={narrative} writing={writing} />
              {!plan.airAvailable && <div className="banner">Air-quality forecast is unavailable right now, so this plan uses weather only.</div>}
              <section className="card days-card">
                <div className="section-title">Next 3 days</div>
                {plan.days.map((d) => (
                  <DayRow
                    key={d.date}
                    day={d}
                    story={narrative.days.find((s) => s.date === d.date)}
                    timezone={plan.location.timezone}
                    activity={plan.activity}
                    open={openDay === d.date}
                    onToggle={() => setOpenDay((o) => (o === d.date ? null : d.date))}
                  />
                ))}
              </section>
              {receipt && <ReceiptLine receipt={receipt} />}
              {isNew && !tipDismissed && (
                <section className="card tip">
                  <div className="spread">
                    <b>How it works</b>
                    <button
                      className="icon-btn"
                      aria-label="Dismiss"
                      onClick={() => {
                        localStorage.setItem(TIP_KEY, '1');
                        setTipDismissed(true);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <ol>
                    <li>Go outside in your window. Turn on phone alerts for a nudge.</li>
                    <li>Afterwards, tap how it felt (too hot, smoky, great…).</li>
                    <li>Go Window learns your limits and picks better times.</li>
                  </ol>
                </section>
              )}
            </>
          ) : (
            <div className="card empty">{loading ? 'Reading the sky…' : 'No plan yet.'}</div>
          )}
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
