import { LIMIT_TEXT, type Activity, type Feeling, type GoWindow, type HourScore, type LimitChange, type LimitKey, type SkipReason, type WindowSummary } from '../shared/types';

export const ACTIVITIES: { id: Activity; label: string; hint: string }[] = [
  { id: 'walk', label: 'Walk', hint: '30+ min' },
  { id: 'run', label: 'Run', hint: 'stricter heat & air' },
  { id: 'cycle', label: 'Cycle', hint: 'stricter wind & rain' },
  { id: 'kids', label: 'Kids play', hint: 'stricter UV & air' },
];

export const FEELING_LABELS: Record<Feeling, string> = {
  great: 'Felt great',
  too_hot: 'Too hot',
  too_cold: 'Too cold',
  air_bad: 'Air felt bad',
  too_humid: 'Too muggy',
  too_sunny: 'Sun too harsh',
  rain: 'Got rained on',
  windy: 'Too windy',
};

export const SKIP_LABELS: Record<SkipReason, string> = {
  busy: 'Got busy',
  weather: 'Weather looked bad',
  not_feeling_it: 'Not feeling it',
};

export function fmtMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function feelsText(s: WindowSummary): string {
  return s.feelsMin === s.feelsMax ? `${s.feelsMin}°C` : `${s.feelsMin}–${s.feelsMax}°C`;
}

export function scoreClass(h: HourScore | undefined): string {
  if (!h) return 'cell-none';
  if (h.blocked) return 'cell-bad';
  if (h.score >= 80) return 'cell-great';
  if (h.score >= 50) return 'cell-ok';
  return 'cell-meh';
}

export function hourTooltip(h: HourScore): string {
  const c = h.conditions;
  const parts = [
    `${h.time.slice(11, 16)} · ${h.blocked ? 'not recommended' : `score ${h.score}`}`,
    `feels ${Math.round(c.feels)}°C · humidity ${c.humidity}%`,
    `${c.pm25 === null ? 'air n/a' : `PM2.5 ${Math.round(c.pm25)}`} · rain ${c.rainProb}% · UV ${c.uv}`,
  ];
  if (h.limiting) parts.push(`${h.blocked ? 'Blocked by' : 'Watch'}: ${h.limiting.label}`);
  return parts.join('\n');
}

const pad = (n: number) => String(n).padStart(2, '0');

function icsTime(date: string, hhmm: string): string {
  if (hhmm === '24:00') return `${date.replace(/-/g, '')}T235900`;
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`;
}

/** A calendar invite for a window, so the free slot is defended like a meeting. */
export function downloadIcs(w: GoWindow, timezone: string, activityWord: string): void {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const desc = `Feels ${feelsText(w.summary)}${w.summary.pm25Max === null ? '' : `, PM2.5 up to ${w.summary.pm25Max}`}, rain up to ${w.summary.rainProbMax}%.${w.park ? ` Try ${w.park.name}.` : ''}`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Go Window//EN',
    'BEGIN:VEVENT',
    `UID:${w.id}@go-window`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${timezone}:${icsTime(w.date, w.start)}`,
    `DTEND;TZID=${timezone}:${icsTime(w.date, w.end)}`,
    `SUMMARY:Go outside: ${activityWord}`,
    `DESCRIPTION:${desc.replace(/[,;]/g, (m) => `\\${m}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `go-window-${w.date}-${w.start.replace(':', '')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

export function osmLink(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;
}

/** When the walk behind a change happened (or, for manual edits, when the change was made). */
export function changeWhen(c: LimitChange): string {
  if (c.when) {
    const [d, t] = c.when.split('T');
    return `${shortDate(d)} · ${t}`;
  }
  const dt = new Date(c.at);
  const day = dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day} · ${time}`;
}

/** One clean sentence; older entries looked like "Label: you said … (2026-10-10 07:00)". */
export function changeReason(c: LimitChange): string {
  let r = c.reason.replace(/^[A-Z][\w .-]{1,28}:\s+/, '').replace(/\s*\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\s*$/, '').trim();
  r = r.charAt(0).toUpperCase() + r.slice(1);
  return /[.!?]$/.test(r) ? r : `${r}.`;
}

export function limitValue(key: LimitKey, v: number): string {
  const unit = LIMIT_TEXT[key].unit;
  return unit === '°C' || unit === '%' ? `${v}${unit}` : unit ? `${v} ${unit}` : `${v}`;
}

/** Tighter means fewer hours qualify: a lower max, or a higher minimum. */
export function isTighter(key: LimitKey, from: number, to: number): boolean {
  return key === 'minFeels' ? to > from : to < from;
}
