import { useState } from 'react';
import type { TimeRange } from '../../shared/types';
import { fromMinutes, toMinutes, WEEKDAYS } from '../../shared/time';

const WEEKDAY_IDX = [1, 2, 3, 4, 5];
const WEEKEND_IDX = [6, 0];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const same = (days: TimeRange[][], idx: number[]) => idx.every((i) => JSON.stringify(days[i]) === JSON.stringify(days[idx[0]]));

/** A one-hour slot that doesn't overlap the existing ones, preferring common free times. */
function nextFreeSlot(ranges: TimeRange[]): TimeRange {
  const taken = ranges.map((r) => [toMinutes(r.start), toMinutes(r.end)]);
  for (const h of [18, 7, 12, 17, 19, 20, 13, 6, 21, 8, 16, 14, 15, 9, 10, 11, 22]) {
    const s = h * 60;
    if (taken.every(([a, b]) => s + 60 <= a || s >= b)) return { start: fromMinutes(s), end: fromMinutes(s + 60) };
  }
  return { start: '18:00', end: '19:00' };
}

function RangeRow({ ranges, onChange }: { ranges: TimeRange[]; onChange: (r: TimeRange[]) => void }) {
  return (
    <div className="fh-ranges">
      {ranges.map((r, i) => (
        <span key={i} className="fh-range">
          <input
            type="time"
            aria-label="From"
            value={r.start}
            onChange={(e) => onChange(ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
          />
          –
          <input
            type="time"
            aria-label="To"
            value={r.end === '24:00' ? '23:59' : r.end}
            onChange={(e) => onChange(ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
          />
          <button className="icon-btn" aria-label="Remove slot" onClick={() => onChange(ranges.filter((_, j) => j !== i))}>
            ✕
          </button>
        </span>
      ))}
      {ranges.length < 8 && (
        <button className="btn ghost small" onClick={() => onChange([...ranges, nextFreeSlot(ranges)])}>
          + slot
        </button>
      )}
      {!ranges.length && <span className="muted small">No free time</span>}
    </div>
  );
}

/**
 * Two rows (weekdays, weekend) cover most routines. "Each day" reveals all seven,
 * and opens automatically if the saved week already differs day to day.
 */
export function FreeHoursEditor({ value, onChange }: { value: TimeRange[][]; onChange: (v: TimeRange[][]) => void }) {
  const uniform = same(value, WEEKDAY_IDX) && same(value, WEEKEND_IDX);
  const [perDay, setPerDay] = useState(!uniform);

  const setDays = (idx: number[], ranges: TimeRange[]) =>
    onChange(value.map((r, i) => (idx.includes(i) ? ranges.map((x) => ({ ...x })) : r)));

  return (
    <div>
      {perDay ? (
        DAY_ORDER.map((d) => (
          <div key={d} className="fh-day">
            <b>{WEEKDAYS[d].slice(0, 3)}</b>
            <RangeRow ranges={value[d]} onChange={(r) => setDays([d], r)} />
          </div>
        ))
      ) : (
        <>
          <div className="fh-day">
            <b>Mon–Fri</b>
            <RangeRow ranges={value[1]} onChange={(r) => setDays(WEEKDAY_IDX, r)} />
          </div>
          <div className="fh-day">
            <b>Sat–Sun</b>
            <RangeRow ranges={value[6]} onChange={(r) => setDays(WEEKEND_IDX, r)} />
          </div>
        </>
      )}
      <label className="check small" style={{ marginTop: 8 }}>
        <input
          type="checkbox"
          checked={perDay}
          onChange={(e) => {
            if (!e.target.checked) {
              // Collapse back to two rows using Monday and Saturday as the templates.
              onChange(value.map((r, i) => (WEEKDAY_IDX.includes(i) ? value[1] : WEEKEND_IDX.includes(i) ? value[6] : r).map((x) => ({ ...x }))));
            }
            setPerDay(e.target.checked);
          }}
        />
        Different hours on different days
      </label>
    </div>
  );
}
