import type { Activity, DayPlan, DayStory, GoWindow } from '../../shared/types';
import { downloadIcs, feelsText, fmtMinutes, osmLink, shortDate } from '../format';
import { Legend, Timeline } from './Timeline';

const WORD: Record<Activity, string> = { walk: 'walk', run: 'run', cycle: 'ride', kids: 'outdoor play' };

/** Three chips that always matter, plus one more only when UV, humidity or wind is the concern. */
export function Conditions({ w }: { w: GoWindow }) {
  const s = w.summary;
  const lim = w.limiting;
  const warnKey = lim && lim.penalty >= 5 ? lim.key : null;
  const over = new Set(w.overKeys ?? []);
  const cls = (key: string) => (over.has(key as never) ? 'chip bad' : warnKey === key ? 'chip warn' : 'chip');
  return (
    <div className="chips">
      <span className={cls('heat')}>🌡 feels {feelsText(s)}</span>
      <span className={cls('air')}>🫁 {s.pm25Max === null ? 'air n/a' : `PM2.5 ≤ ${s.pm25Max}`}</span>
      <span className={cls('rain')}>☔ rain {s.rainProbMax}%</span>
      {(warnKey === 'uv' || over.has('uv')) && <span className={cls('uv')}>☀ UV {s.uvMax}</span>}
      {(warnKey === 'humidity' || over.has('humidity')) && <span className={cls('humidity')}>💧 {s.humidityMax}%</span>}
      {(warnKey === 'wind' || over.has('wind')) && <span className={cls('wind')}>🍃 gusts {s.gustMax} km/h</span>}
      {warnKey === 'dark' && <span className="chip warn">🌙 after dark</span>}
    </div>
  );
}

export function OverNote({ w }: { w: GoWindow }) {
  if (!w.fallback) return null;
  return <div className="over-note">⚠ Over your limits: {(w.overLimits ?? []).join('; ') || 'slightly'}</div>;
}

export function CalendarButton({ w, timezone, activity, label }: { w: GoWindow; timezone: string; activity: Activity; label?: string }) {
  return (
    <button
      className={label ? 'btn ghost small' : 'icon-btn'}
      onClick={() => downloadIcs(w, timezone, WORD[activity])}
      title="Add to calendar"
      aria-label="Add to calendar"
    >
      📅{label ? ` ${label}` : ''}
    </button>
  );
}

function WindowRow({ w, timezone, activity }: { w: GoWindow; timezone: string; activity: Activity }) {
  return (
    <div className={`window-row best ${w.fallback ? 'fallback' : ''}`}>
      <div style={{ flex: 1 }}>
        <div className="spread">
          <div className="window-time">
            {w.start}–{w.end} <span className="muted small">· {fmtMinutes(w.minutes)}</span>
          </div>
          <CalendarButton w={w} timezone={timezone} activity={activity} />
        </div>
        <OverNote w={w} />
        <Conditions w={w} />
        {w.park && (
          <div className="small">
            📍{' '}
            <a href={osmLink(w.park.lat, w.park.lon)} target="_blank" rel="noreferrer">
              {w.park.name}
            </a>{' '}
            <span className="muted">· {w.park.walkMinutes} min on foot</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DayRow({
  day,
  story,
  timezone,
  activity,
  open,
  onToggle,
}: {
  day: DayPlan;
  story: DayStory | undefined;
  timezone: string;
  activity: Activity;
  open: boolean;
  onToggle: () => void;
}) {
  const best = day.windows.find((w) => w.best);
  const others = day.windows.filter((w) => !w.best);
  const summary = best ? (
    <>
      <b>
        {best.start}–{best.end}
      </b>
      {best.fallback && <span className="tag amber">best available</span>}
    </>
  ) : (
    <span className="muted">{day.freeLeftMinutes === 0 ? (day.free.length ? 'Free hours done' : 'No free hours set') : 'No good window'}</span>
  );

  return (
    <div className={`day-row ${open ? 'open' : ''}`}>
      <button className="day-row-head" onClick={onToggle} aria-expanded={open}>
        <span className="day-name">
          {day.label} <span className="muted small">{shortDate(day.date)}</span>
        </span>
        <span className="day-summary">{summary}</span>
        <span className="chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="day-body">
          {story && (
            <>
              <div className="story-head">
                {story.headline}
                {story.source === 'gemma' && (
                  <span className="tag" title="Written by Gemma on this machine; every number checked against the plan">
                    Gemma
                  </span>
                )}
              </div>
              <div className="muted">{story.why}</div>
              {story.idea && <div className="idea">🌿 {story.idea}</div>}
            </>
          )}

          {best && <WindowRow w={best} timezone={timezone} activity={activity} />}
          {others.length > 0 && (
            <div className="small" style={{ marginTop: 8 }}>
              Also good:{' '}
              {others.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ', '}
                  <b>
                    {w.start}–{w.end}
                  </b>
                </span>
              ))}
            </div>
          )}

          {day.nearMisses.length > 0 && (
            <div className="reasons">
              <div className="muted small">Why not your other free time</div>
              <ul>
                {day.nearMisses.map((m) => (
                  <li key={`${m.start}-${m.end}`}>
                    {m.start}–{m.end}: {m.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {day.betterElsewhere && (
            <div className="small" style={{ marginTop: 8 }}>
              💡 Outside your free hours, <b>{day.betterElsewhere.start}–{day.betterElsewhere.end}</b> looks better, if you can move things.
            </div>
          )}

          <Timeline day={day} />
          <Legend />
        </div>
      )}
    </div>
  );
}
