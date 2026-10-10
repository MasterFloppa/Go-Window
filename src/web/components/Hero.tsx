import type { Plan, Narrative } from '../../shared/types';
import { fmtMinutes } from '../format';
import { Conditions } from './DayCard';

/** The one thing to know: when is the next window, and is it now? */
export function NextWindowHero({ plan, narrative }: { plan: Plan; narrative: Narrative }) {
  const now = plan.now;
  const next = plan.days
    .flatMap((d) => d.windows.filter((w) => w.best).map((w) => ({ d, w })))
    .find(({ w }) => `${w.date}T${w.end}` > now);

  if (!next) {
    return (
      <section className="card hero">
        <div className="muted">Next go window</div>
        <div className="hero-time">None in the next 3 days</div>
        <div className="hero-head">Your free hours and the forecast don't line up.</div>
        <div className="muted small">Check the days below for near misses, or widen your free hours or limits.</div>
      </section>
    );
  }

  const { d, w } = next;
  const live = `${w.date}T${w.start}` <= now;
  const story = narrative.days.find((s) => s.date === d.date);
  return (
    <section className="card hero">
      <div className="muted">{live ? 'Your window is open now' : `Next go window · ${d.label}`}</div>
      <div className="hero-time">
        {w.start}–{w.end}
      </div>
      <div className="hero-head">{story?.headline ?? `${fmtMinutes(w.minutes)} outside`}</div>
      {story?.why && <div className="muted">{story.why}</div>}
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
