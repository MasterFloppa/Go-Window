export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Current wall-clock time in an IANA timezone as "YYYY-MM-DDTHH:MM". */
export function nowInTimezone(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function datePart(localIso: string): string {
  return localIso.slice(0, 10);
}

export function timePart(localIso: string): string {
  return localIso.slice(11, 16);
}

export function weekdayIndex(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converts a local "YYYY-MM-DDTHH:MM" plus the zone's UTC offset to epoch seconds. */
export function localToEpochSeconds(localIso: string, utcOffsetSeconds: number): number {
  const asUtc = Date.parse(`${localIso.length === 16 ? localIso : localIso.slice(0, 16)}:00Z`);
  return Math.round(asUtc / 1000) - utcOffsetSeconds;
}

export function formatRange(start: string, end: string): string {
  return `${start}–${end}`;
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return WEEKDAYS[weekdayIndex(date)];
}
