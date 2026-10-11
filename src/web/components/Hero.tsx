import type { Plan, Narrative } from '../../shared/types';
import { fmtMinutes } from '../format';
import { CalendarButton, Conditions } from './DayCard';

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
export function NextWindowHero({ plan, narrative, writing }: { plan: Plan; narrative: Narrative; writing: boolean }) {
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
        <div className="hero-kicker">Next 3 days</div>
        <div className="hero-time">No window</div>
        <div className="hero-head">
          {top ? `Mostly blocked by ${BLOCKER[top] ?? top} in your free hours.` : "Your free hours and the forecast don't line up."}
        </div>
        <div className="muted small">Tap a day below to see why. You can add free hours, or loosen strictness in Settings.</div>
      </section>
    );
  }

  const { d, w } = next;
  const live = `${w.date}T${w.start}` <= now;
  const story = narrative.days.find((s) => s.date === d.date);
  const kicker = live ? 'Open now' : d.label;
  return (
    <section className={`card hero ${w.fallback ? 'fallback' : ''}`}>
      <div className="hero-kicker">
        {kicker} · {fmtMinutes(w.minutes)}
        {w.fallback && <span className="tag light">best available</span>}
      </div>
      <div className="hero-time">
        {w.start}–{w.end}
      </div>
      {/* Template text would repeat the time and chips, so only Gemma's sentence is shown here. */}
      {(() => {
        const line = w.fallback ? 'Closest slot to your limits' : story?.source === 'gemma' ? story.why : 'Good conditions in your free time';
        return <div className={line.length > 70 ? 'hero-sub' : 'hero-head'}>{line}</div>;
      })()}
      {w.fallback && w.overLimits?.length ? <div className="small hero-over">Over: {w.overLimits.join(' · ')}</div> : null}
      <Conditions w={w} />
      <div className="row" style={{ marginTop: 6 }}>
        {w.park && (
          <span className="small">
            📍 {w.park.name} · {w.park.walkMinutes} min walk
          </span>
        )}
        <span style={{ flex: 1 }} />
        <CalendarButton w={w} timezone={plan.location.timezone} activity={plan.activity} label="Add to calendar" />
      </div>
      {live && <div className="hero-head" style={{ marginTop: 8 }}>Phone in your pocket. Go. 🌿</div>}
      {writing && <div className="hero-writing">Gemma is writing your plan…</div>}
    </section>
  );
}
