import type { Plan, Narrative } from '../../shared/types';
import { fmtMinutes } from '../format';
import { Conditions } from './DayCard';

const BLOCKER: Record<string, string> = {
  storm: 'thunderstorms',
  rain: 'rain',
  air: 'air quality',
  heat: 'heat',
  cold: 'cold',
  humidity: 'humidity',
  uv: 'strong UV',
  wind: 'wind',
  dark: 'darkness',
  short: 'slots that are too short',
};

/** The one thing to know: when is the next window, and is it now? */
export function NextWindowHero({ plan, narrative }: { plan: Plan; narrative: Narrative }) {
  const now = plan.now;
  const next = plan.days
    .flatMap((d) => d.windows.filter((w) => w.best).map((w) => ({ d, w })))
    .find(({ w }) => `${w.date}T${w.end}` > now);

  if (!next) {
    const counts = new Map<string, number>();
    for (const m of plan.days.flatMap((d) => d.nearMisses)) counts.set(m.factor, (counts.get(m.factor) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return (
      <section className="card hero">
        <div className="muted">Next go window</div>
        <div className="hero-time">None in the next 3 days</div>
        <div className="hero-head">
          {top ? `Mostly blocked by ${BLOCKER[top] ?? top} in your free hours.` : "Your free hours and the forecast don't line up."}
        </div>
        <div className="muted small">See the reasons below. You can widen your free hours, or raise a limit in My limits if it's too strict.</div>
      </section>
    );
  }

  const { d, w } = next;
  const live = `${w.date}T${w.start}` <= now;
  const story = narrative.days.find((s) => s.date === d.date);
  const kind = w.fallback ? 'Best available' : 'Next go window';
  return (
    <section className={`card hero ${w.fallback ? 'fallback' : ''}`}>
      <div className="muted">{live ? `${w.fallback ? 'Best available slot' : 'Your window'} is open now` : `${kind} · ${d.label}`}</div>
      <div className="hero-time">
        {w.start}–{w.end}
      </div>
      <div className="hero-head">{story?.headline ?? `${fmtMinutes(w.minutes)} outside`}</div>
      {story?.why && <div className="muted">{story.why}</div>}
      {w.fallback && w.overLimits?.length ? <div className="small">⚠ Over your limits: {w.overLimits.join('; ')}</div> : null}
      <Conditions w={w} />
      {w.park && (
        <div className="small">
          📍 {w.park.name} · {w.park.walkMinutes} min on foot
        </div>
      )}
      {live && <div className="hero-head">Put the phone in your pocket and go. 🌿</div>}
    </section>
  );
}
