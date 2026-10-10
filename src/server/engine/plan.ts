import { createHash } from 'node:crypto';
import type { DayPlan, GoWindow, HourScore, Limits, Park, Plan, Settings } from '../../shared/types.js';
import { addDays, datePart, dayLabel, nowInTimezone, timePart, toMinutes, weekdayIndex, WEEKDAYS } from '../../shared/time.js';
import type { Forecast } from '../sources/openmeteo.js';
import { effectiveLimits, MIN_MINUTES } from './limits.js';
import { scoreHour } from './score.js';
import { complement, findWindows } from './windows.js';

export const PLAN_DAYS = 3;
const ELSEWHERE_FROM = 5 * 60;
const ELSEWHERE_TO = 22 * 60;
const ELSEWHERE_MARGIN = 10;

export interface PlanInput {
  settings: Settings;
  forecast: Forecast;
  parks: Park[] | null;
  base: Limits;
  now?: Date;
}

function pickPark(w: GoWindow, parks: Park[] | null): Park | null {
  if (!parks?.length) return null;
  const budget = Math.max(10, Math.floor(w.minutes / 3));
  return parks.find((p) => p.walkMinutes <= budget) ?? null;
}

export function buildPlan({ settings, forecast, parks, base, now = new Date() }: PlanInput): Plan {
  if (!settings.location) throw new Error('Location is not set');
  const limits = effectiveLimits(base, settings.activity, settings.sensitive);
  const minMinutes = settings.minMinutes ?? MIN_MINUTES[settings.activity];
  const nowLocal = nowInTimezone(forecast.timezone, now);
  const today = datePart(nowLocal);
  const nowMin = toMinutes(timePart(nowLocal));

  const scored = forecast.hours.map((h) => scoreHour(h, limits, settings.darkOk));
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

    const { windows, nearMisses } = findWindows(date, hours, free, minMinutes, clip, true);
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
    air: forecast.airAvailable,
    days: days.map((d) => ({
      f: d.freeLeftMinutes > 0,
      w: d.windows.map((w) => [w.id, w.score, w.summary, w.park?.name]),
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
