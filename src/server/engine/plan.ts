import { createHash } from 'node:crypto';
import type { DayPlan, GoWindow, HourScore, Limits, Park, Plan, Settings } from '../../shared/types.js';
import { addDays, datePart, dayLabel, nowInTimezone, timePart, toMinutes, weekdayIndex, WEEKDAYS } from '../../shared/time.js';
import type { Forecast } from '../sources/openmeteo.js';
import { effectiveLimits, MIN_MINUTES, TOLERANCE } from './limits.js';
import { scoreHour } from './score.js';
import { complement, findWindows } from './windows.js';

export const PLAN_DAYS = 3;
const ELSEWHERE_FROM = 5 * 60;
const ELSEWHERE_TO = 22 * 60;
const ELSEWHERE_MARGIN = 10;
/** An open window stays on the plan until fewer than this many minutes are left. */
const LIVE_MIN_LEFT = 15;

export interface PlanInput {
  settings: Settings;
  forecast: Forecast;
  parks: Park[] | null;
  base: Limits;
  now?: Date;
}

/**
 * Picks a park you can reach in about a third of the window, favouring bigger ones:
 * a 2-hour window deserves a real park, not the nearest traffic island with a name.
 */
export function pickPark(w: GoWindow, parks: Park[] | null): Park | null {
  if (!parks?.length) return null;
  const budget = Math.max(10, Math.floor(w.minutes / 3));
  const size = (p: Park) => (p.areaM2 ? Math.min(6, Math.max(2, Math.log10(p.areaM2))) : 2.5);
  const reachable = parks.filter((p) => p.walkMinutes <= budget);
  if (!reachable.length) return null;
  return reachable.reduce((best, p) => (size(p) - p.walkMinutes / 12 > size(best) - best.walkMinutes / 12 ? p : best));
}

export function buildPlan({ settings, forecast, parks, base, now = new Date() }: PlanInput): Plan {
  if (!settings.location) throw new Error('Location is not set');
  const limits = effectiveLimits(base, settings.activity, settings.sensitive);
  const minMinutes = settings.minMinutes ?? MIN_MINUTES[settings.activity];
  const nowLocal = nowInTimezone(forecast.timezone, now);
  const today = datePart(nowLocal);
  const nowMin = toMinutes(timePart(nowLocal));

  const tolerance = settings.tolerance ?? 'balanced';
  const scored = forecast.hours.map((h) => scoreHour(h, limits, settings.darkOk, TOLERANCE[tolerance]));
  const byDate = new Map<string, HourScore[]>();
  for (const h of scored) {
    const d = datePart(h.time);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(h);
  }

  const days: DayPlan[] = [];
  for (let i = 0; i < PLAN_DAYS; i++) {
    const date = addDays(today, i);
    const hours = byDate.get(date) ?? [];
    const wd = weekdayIndex(date);
    const free = settings.freeHours[wd] ?? [];
    const clip = i === 0 ? nowMin : null;
    const stillOpen = (w: GoWindow) => clip === null || toMinutes(w.end) - clip >= LIVE_MIN_LEFT;

    // Today's windows are found on the full free ranges and then filtered, rather than clipped to "now",
    // so a window that is already open keeps a stable id (no new check-in or alert every few minutes).
    const found = findWindows(date, hours, free, minMinutes, null, true);
    let windows = found.windows.filter(stillOpen);
    let nearMisses = clip === null ? found.nearMisses : found.nearMisses.filter((m) => toMinutes(m.end) > clip);

    // Nothing inside your limits: offer the least-bad free slot that stays within tolerance, clearly marked.
    if (!windows.length && tolerance !== 'strict') {
      const fallback = findWindows(date, hours, free, minMinutes, null, true, 'fallback')
        .windows.filter(stillOpen)
        .reduce<GoWindow | null>((b, w) => (!b || w.score > b.score ? w : b), null);
      if (fallback) {
        windows = [{ ...fallback, fallback: true }];
        // The fallback card already says why its own slot is over the limits.
        nearMisses = nearMisses.filter((m) => !(m.start < fallback.end && fallback.start < m.end));
      }
    }

    const best = windows.reduce<GoWindow | null>((b, w) => (!b || w.score > b.score ? w : b), null);
    if (best) best.best = true;
    for (const w of windows) w.park = pickPark(w, parks);

    const elsewhere = findWindows(
      date,
      hours,
      complement(free, ELSEWHERE_FROM, ELSEWHERE_TO),
      minMinutes,
      clip,
      false,
    ).windows;
    const topElsewhere = elsewhere.reduce<GoWindow | null>((b, w) => (!b || w.score > b.score ? w : b), null);
    const betterElsewhere =
      topElsewhere && topElsewhere.score >= (best?.score ?? 0) + ELSEWHERE_MARGIN ? topElsewhere : null;
    if (betterElsewhere) betterElsewhere.park = pickPark(betterElsewhere, parks);
    const freeLeftMinutes = free.reduce(
      (sum, r) => sum + Math.max(0, toMinutes(r.end) - Math.max(toMinutes(r.start), clip ?? 0)),
      0,
    );

    days.push({
      date,
      weekday: WEEKDAYS[wd],
      label: dayLabel(date, today),
      free,
      hours,
      windows,
      nearMisses,
      betterElsewhere,
      freeLeftMinutes,
      sunrise: forecast.daylight[date]?.sunrise ?? null,
      sunset: forecast.daylight[date]?.sunset ?? null,
    });
  }

  const fingerprint = JSON.stringify({
    limits,
    activity: settings.activity,
    tolerance,
    air: forecast.airAvailable,
    days: days.map((d) => ({
      f: d.freeLeftMinutes > 0,
      w: d.windows.map((w) => [w.id, w.score, w.summary, w.park?.name, w.fallback, w.overLimits]),
      m: d.nearMisses.map((m) => [m.start, m.end, m.reason]),
      e: d.betterElsewhere?.id,
    })),
  });

  return {
    generatedAt: new Date(now).toISOString(),
    now: nowLocal,
    location: settings.location,
    activity: settings.activity,
    limits,
    tolerance,
    minMinutes,
    days,
    parksAvailable: !!parks?.length,
    airAvailable: forecast.airAvailable,
    hash: createHash('sha1').update(fingerprint).digest('hex').slice(0, 12),
  };
}

export function findWindow(plan: Plan, windowId: string): GoWindow | null {
  for (const d of plan.days) {
    const w = d.windows.find((x) => x.id === windowId) ?? (d.betterElsewhere?.id === windowId ? d.betterElsewhere : null);
    if (w) return w;
  }
  return null;
}
