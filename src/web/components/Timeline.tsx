import type { DayPlan } from '../../shared/types';
import { toMinutes } from '../../shared/time';
import { hourTooltip, scoreClass } from '../format';

const FIRST_HOUR = 5;
const HOURS = 19;
const SPAN = HOURS * 60;

const pct = (hhmm: string) => {
  const m = Math.min(Math.max(toMinutes(hhmm) - FIRST_HOUR * 60, 0), SPAN);
  return (m / SPAN) * 100;
};

export function Timeline({ day }: { day: DayPlan }) {
  const byHour = new Map(day.hours.map((h) => [Number(h.time.slice(11, 13)), h]));
  const hours = Array.from({ length: HOURS }, (_, i) => FIRST_HOUR + i);
  return (
    <div className="timeline" aria-label="Hour by hour conditions">
      <div className="tl-hours">
        {hours.map((h) => {
          const s = byHour.get(h);
          return <div key={h} className={`tl-cell ${scoreClass(s)}`} title={s ? hourTooltip(s) : 'no data'} />;
        })}
      </div>
      <div className="tl-track" title="Grey: your free hours. Green: go windows.">
        {day.free.map((r) => (
          <div key={`${r.start}`} className="tl-free" style={{ left: `${pct(r.start)}%`, width: `${pct(r.end) - pct(r.start)}%` }} />
        ))}
        {day.windows.map((w) => (
          <div key={w.id} className="tl-win" style={{ left: `${pct(w.start)}%`, width: `${pct(w.end) - pct(w.start)}%` }} />
        ))}
      </div>
      <div className="tl-labels">
        {hours.map((h) => (
          <span key={h}>{h % 3 === 0 ? `${h}` : ''}</span>
        ))}
      </div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="cell-great" /> great
      </span>
      <span>
        <i className="cell-ok" /> fine
      </span>
      <span>
        <i className="cell-meh" /> meh
      </span>
      <span>
        <i className="cell-bad" /> over your limits
      </span>
      <span>
        <i style={{ background: '#9aa9a0' }} /> free hours
      </span>
      <span>
        <i style={{ background: 'var(--green)' }} /> go window
      </span>
    </div>
  );
}
