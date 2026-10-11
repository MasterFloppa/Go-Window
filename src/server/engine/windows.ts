import type { Factor, FactorKey, GoWindow, HourScore, NearMiss, TimeRange, WindowSummary } from '../../shared/types.js';
import { fromMinutes, toMinutes } from '../../shared/time.js';
import { limitingFactor } from './score.js';

/** Hours scoring below this are "meh enough" that we would rather not send you out. */
export const SCORE_THRESHOLD = 50;

/**
 * normal: inside every comfort limit and scoring well.
 * fallback: anything not blocked outright (used only when a day has no normal window).
 */
export type WindowMode = 'normal' | 'fallback';

interface Segment {
  from: number;
  to: number;
  hour: HourScore | undefined;
}

const isGood = (s: Segment) => !!s.hour && !s.hour.blocked && !s.hour.overLimit && s.hour.score >= SCORE_THRESHOLD;
const isTolerable = (s: Segment) => !!s.hour && !s.hour.blocked;

function splitByHour(from: number, to: number, byHour: Map<number, HourScore>): Segment[] {
  const out: Segment[] = [];
  let m = from;
  while (m < to) {
    const h = Math.floor(m / 60);
    const next = Math.min(to, (h + 1) * 60);
    out.push({ from: m, to: next, hour: byHour.get(h) });
    m = next;
  }
  return out;
}

function summarize(hours: HourScore[]): WindowSummary {
  const c = hours.map((h) => h.conditions);
  const pm = c.map((x) => x.pm25).filter((x): x is number => x !== null);
  return {
    feelsMin: Math.round(Math.min(...c.map((x) => x.feels))),
    feelsMax: Math.round(Math.max(...c.map((x) => x.feels))),
    pm25Max: pm.length ? Math.round(Math.max(...pm)) : null,
    rainProbMax: Math.max(...c.map((x) => x.rainProb)),
    uvMax: Math.round(Math.max(...c.map((x) => x.uv)) * 10) / 10,
    humidityMax: Math.max(...c.map((x) => x.humidity)),
    gustMax: Math.round(Math.max(...c.map((x) => x.gust))),
  };
}

function buildWindow(date: string, run: Segment[], inFreeHours: boolean): GoWindow {
  const from = run[0].from;
  const to = run[run.length - 1].to;
  const minutes = to - from;
  const hours = [...new Set(run.map((s) => s.hour!))];
  const score = Math.round(run.reduce((sum, s) => sum + s.hour!.score * (s.to - s.from), 0) / minutes);
  const start = fromMinutes(from);
  const end = fromMinutes(to);
  // For each limit this window goes past, keep the hour where it is worst.
  const worstOver = new Map<FactorKey, Factor>();
  for (const f of hours.flatMap((h) => h.factors)) {
    if (!f.over) continue;
    const cur = worstOver.get(f.key);
    const worse = f.key === 'cold' ? (cur?.value ?? Infinity) > f.value : (cur?.value ?? -Infinity) < f.value;
    if (worse) worstOver.set(f.key, f);
  }
  return {
    id: `${date}T${start}-${end}`,
    date,
    start,
    end,
    minutes,
    score,
    limiting: limitingFactor(hours.flatMap((h) => h.factors)),
    summary: summarize(hours),
    park: null,
    best: false,
    inFreeHours,
    ...(worstOver.size ? { overKeys: [...worstOver.keys()], overLimits: [...worstOver.values()].map((f) => f.label) } : {}),
  };
}

function explainMiss(date: string, from: number, to: number, segs: Segment[], hadShortRun: number): NearMiss {
  const start = fromMinutes(from);
  const end = fromMinutes(to);
  const bad = segs.filter((s) => s.hour && !isGood(s)).map((s) => s.hour!);
  if (bad.length === 0) {
    return { date, start, end, factor: 'short', reason: 'no forecast data for this slot yet' };
  }
  const counts = new Map<string, { n: number; worst: HourScore }>();
  for (const h of bad) {
    const key = h.limiting?.key ?? 'meh';
    const cur = counts.get(key);
    if (!cur) counts.set(key, { n: 1, worst: h });
    else {
      cur.n += 1;
      if ((h.limiting?.penalty ?? 0) > (cur.worst.limiting?.penalty ?? 0)) cur.worst = h;
    }
  }
  const [, top] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const lim = top.worst.limiting;
  if (hadShortRun > 0) {
    return {
      date,
      start,
      end,
      factor: 'short',
      reason: `only ${hadShortRun} clear minutes; otherwise ${lim ? lim.label : 'conditions are poor'}`,
    };
  }
  return {
    date,
    start,
    end,
    factor: lim?.key ?? 'short',
    reason: lim ? lim.label : `conditions score below ${SCORE_THRESHOLD}`,
  };
}

/**
 * Finds contiguous good stretches inside each range that are at least `minMinutes` long.
 * `nowMinutes` clips ranges on the current day so we never suggest the past.
 */
export function findWindows(
  date: string,
  dayHours: HourScore[],
  ranges: TimeRange[],
  minMinutes: number,
  nowMinutes: number | null,
  inFreeHours: boolean,
  mode: WindowMode = 'normal',
): { windows: GoWindow[]; nearMisses: NearMiss[] } {
  const byHour = new Map(dayHours.map((h) => [Number(h.time.slice(11, 13)), h]));
  const windows: GoWindow[] = [];
  const nearMisses: NearMiss[] = [];
  const accept = mode === 'normal' ? isGood : isTolerable;

  for (const range of ranges) {
    let from = toMinutes(range.start);
    const to = toMinutes(range.end);
    if (nowMinutes !== null) from = Math.max(from, Math.ceil(nowMinutes / 5) * 5);
    if (to - from < minMinutes) continue;

    const segs = splitByHour(from, to, byHour);
    const found: GoWindow[] = [];
    let run: Segment[] = [];
    let longestShort = 0;
    const flush = () => {
      if (!run.length) return;
      const len = run[run.length - 1].to - run[0].from;
      if (len >= minMinutes) found.push(buildWindow(date, run, inFreeHours));
      else longestShort = Math.max(longestShort, len);
      run = [];
    };
    for (const s of segs) {
      if (accept(s)) run.push(s);
      else flush();
    }
    flush();

    windows.push(...found);
    if (!found.length && inFreeHours && mode === 'normal') nearMisses.push(explainMiss(date, from, to, segs, longestShort));
  }
  return { windows, nearMisses };
}

/** Gaps between free ranges within [from, to] minutes; used to look for better slots elsewhere. */
export function complement(ranges: TimeRange[], from: number, to: number): TimeRange[] {
  const sorted = ranges.map((r) => [toMinutes(r.start), toMinutes(r.end)] as const).sort((a, b) => a[0] - b[0]);
  const gaps: TimeRange[] = [];
  let cursor = from;
  for (const [s, e] of sorted) {
    if (s > cursor) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(Math.min(s, to)) });
    cursor = Math.max(cursor, e);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: fromMinutes(cursor), end: fromMinutes(to) });
  return gaps.filter((g) => toMinutes(g.end) > toMinutes(g.start));
}
