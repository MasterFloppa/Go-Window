import type { TimeRange } from '../../shared/types';
import { WEEKDAYS } from '../../shared/time';

// Display Monday first; storage stays Sunday = 0.
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export function FreeHoursEditor({ value, onChange }: { value: TimeRange[][]; onChange: (v: TimeRange[][]) => void }) {
  const set = (day: number, ranges: TimeRange[]) => onChange(value.map((r, i) => (i === day ? ranges : r)));

  const copyTo = (from: number, days: number[]) =>
    onChange(value.map((r, i) => (days.includes(i) ? value[from].map((x) => ({ ...x })) : r)));

  return (
    <div>
      {ORDER.map((d) => (
        <div key={d} className="fh-day">
          <div>
            <b>{WEEKDAYS[d].slice(0, 3)}</b>
            {d === 1 && (
              <div>
                <button className="icon-btn small" title="Copy Monday to Tue–Fri" onClick={() => copyTo(1, [2, 3, 4, 5])}>
                  ⇣ weekdays
                </button>
              </div>
            )}
            {d === 6 && (
              <div>
                <button className="icon-btn small" title="Copy Saturday to Sunday" onClick={() => copyTo(6, [0])}>
                  ⇣ Sunday
                </button>
              </div>
            )}
          </div>
          <div className="fh-ranges">
            {value[d].map((r, i) => (
              <span key={i} className="fh-range">
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => set(d, value[d].map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                />
                –
                <input
                  type="time"
                  value={r.end === '24:00' ? '23:59' : r.end}
                  onChange={(e) => set(d, value[d].map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                />
                <button className="icon-btn" aria-label="Remove" onClick={() => set(d, value[d].filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            ))}
            <button
              className="btn ghost small"
              onClick={() => set(d, [...value[d], { start: '18:00', end: '19:00' }])}
              disabled={value[d].length >= 8}
            >
              + slot
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
