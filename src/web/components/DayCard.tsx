import type { Activity, DayPlan, DayStory, GoWindow } from '../../shared/types';
import { downloadIcs, feelsText, fmtMinutes, osmLink, shortDate } from '../format';
import { Timeline } from './Timeline';

const WORD: Record<Activity, string> = { walk: 'walk', run: 'run', cycle: 'ride', kids: 'outdoor play' };

/** Three chips that always matter, plus one more only when UV, humidity or wind is the concern. */
export function Conditions({ w }: { w: GoWindow }) {
  const s = w.summary;
  const lim = w.limiting;
  const warnKey = lim && lim.penalty >= 5 ? lim.key : null;
  const cls = (key: string) => (warnKey === key ? 'chip warn' : 'chip');
  return (
    <div className="chips">
      <span className={cls('heat')}>🌡 feels {feelsText(s)}</span>
      <span className={cls('air')}>🫁 {s.pm25Max === null ? 'air n/a' : `PM2.5 ≤ ${s.pm25Max}`}</span>
      <span className={cls('rain')}>☔ rain {s.rainProbMax}%</span>
      {warnKey === 'uv' && <span className="chip warn">☀ UV {s.uvMax}</span>}
      {warnKey === 'humidity' && <span className="chip warn">💧 {s.humidityMax}%</span>}
      {warnKey === 'wind' && <span className="chip warn">🍃 gusts {s.gustMax} km/h</span>}
      {warnKey === 'dark' && <span className="chip warn">🌙 after dark</span>}
    </div>
  );
}

function CalendarButton({ w, timezone, activity }: { w: GoWindow; timezone: string; activity: Activity }) {
  return (
    <button className="icon-btn" onClick={() => downloadIcs(w, timezone, WORD[activity])} title="Add to calendar" aria-label="Add to calendar">
      📅
    </button>
  );
}

function WindowRow({ w, timezone, activity }: { w: GoWindow; timezone: string; activity: Activity }) {
  if (!w.best) {
    return (
      <div className="window-row compact">
        <span>
          <b>{w.start}–{w.end}</b> <span className="muted small">· {fmtMinutes(w.minutes)} · feels {feelsText(w.summary)}</span>
        </span>
        <CalendarButton w={w} timezone={timezone} activity={activity} />
      </div>
    );
  }
  return (
    <div className="window-row best">
      <div style={{ flex: 1 }}>
        <div className="spread">
          <div className="window-time">
            {w.start}–{w.end} <span className="muted small">· {fmtMinutes(w.minutes)}</span>
          </div>
          <CalendarButton w={w} timezone={timezone} activity={activity} />
        </div>
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

export function DayCard({
  day,
  story,
  writing,
  timezone,
  activity,
}: {
  day: DayPlan;
  story: DayStory | undefined;
  writing: boolean;
  timezone: string;
  activity: Activity;
}) {
  const windows = [...day.windows].sort((a, b) => (a.best === b.best ? a.start.localeCompare(b.start) : a.best ? -1 : 1));
  return (
    <section className="card">
      <div className="day-head">
        <h2>
          {day.label} <span className="muted small">{shortDate(day.date)}</span>
        </h2>
        {story && (
          <span className={`badge ${story.source === 'gemma' ? 'gemma' : ''}`} title={story.source === 'gemma' ? 'Written by local Gemma; every number checked against the plan' : 'Plain template text'}>
            {story.source === 'gemma' ? 'Gemma · checked' : 'template'}
          </span>
        )}
      </div>

      {story && (
        <>
          <div className="story-head">{story.headline}</div>
          <div className="muted">{story.why}</div>
          {story.idea && <div className="idea">🌿 {story.idea}</div>}
        </>
      )}
      {writing && story?.source !== 'gemma' && <div className="writing">Gemma is writing this day…</div>}

      {windows.map((w) => (
        <WindowRow key={w.id} w={w} timezone={timezone} activity={activity} />
      ))}

      {day.nearMisses.map((m) => (
        <div key={`${m.start}-${m.end}`} className="miss">
          ⛅ Free {m.start}–{m.end}: {m.reason}
        </div>
      ))}

      {day.betterElsewhere && (
        <div className="elsewhere">
          💡 If you can move things: <b>{day.betterElsewhere.start}–{day.betterElsewhere.end}</b> looks better
          {day.betterElsewhere.park ? ` (${day.betterElsewhere.park.name})` : ''}.
        </div>
      )}

      {!day.free.length && <div className="muted small">No free hours set for {day.weekday}. Add some in Settings.</div>}

      <Timeline day={day} />
      {day.sunrise && day.sunset && (
        <div className="muted small" style={{ marginTop: 4 }}>
          Sunrise {day.sunrise} · Sunset {day.sunset}
        </div>
      )}
    </section>
  );
}
