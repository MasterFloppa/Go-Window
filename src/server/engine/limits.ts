import { LIMIT_TEXT, type Activity, type LimitKey, type Limits, type Tolerance } from '../../shared/types.js';

export const DEFAULT_LIMITS: Limits = {
  minFeels: 12,
  maxFeels: 32,
  pm25: 35,
  rainProb: 40,
  uv: 8,
  humidity: 88,
  gust: 45,
};

/** Hard guard rails so learning can never drift into unsafe or absurd limits. */
export const LIMIT_BOUNDS: Record<LimitKey, [number, number]> = {
  minFeels: [-10, 24],
  maxFeels: [20, 40],
  pm25: [10, 120],
  rainProb: [5, 90],
  uv: [2, 11],
  humidity: [50, 100],
  gust: [15, 80],
};

export const ACTIVITY_ADJUST: Record<Activity, Partial<Limits>> = {
  walk: {},
  run: { maxFeels: -3, pm25: -5, humidity: -5 },
  cycle: { gust: -15, rainProb: -10 },
  kids: { uv: -2, pm25: -5, maxFeels: -1 },
};

export const SENSITIVE_ADJUST: Partial<Limits> = { pm25: -10, maxFeels: -2, humidity: -5 };

export const MIN_MINUTES: Record<Activity, number> = { walk: 30, run: 30, cycle: 45, kids: 45 };

export interface ToleranceSpec {
  heat: number;
  cold: number;
  pm25Factor: number;
  humidity: number;
  uv: number;
  rainProb: number;
  gust: number;
  /** Rain in mm/h that blocks an hour regardless of chance. */
  precip: number;
}

/**
 * How far past your comfort limits a "best available" window may go when nothing fits.
 * Strict never goes past them. Thunderstorms always block.
 */
export const TOLERANCE: Record<Tolerance, ToleranceSpec> = {
  strict: { heat: 0, cold: 0, pm25Factor: 1, humidity: 0, uv: 0, rainProb: 0, gust: 0, precip: 0.5 },
  balanced: { heat: 2, cold: 2, pm25Factor: 1.4, humidity: 7, uv: 2, rainProb: 15, gust: 10, precip: 1 },
  relaxed: { heat: 4, cold: 4, pm25Factor: 2, humidity: 12, uv: 3, rainProb: 30, gust: 20, precip: 2 },
};

export const LIMIT_LABELS = LIMIT_TEXT;

export function clampLimit(key: LimitKey, value: number): number {
  const [lo, hi] = LIMIT_BOUNDS[key];
  return Math.min(hi, Math.max(lo, value));
}

export function adjustments(activity: Activity, sensitive: boolean): Limits {
  const out = { minFeels: 0, maxFeels: 0, pm25: 0, rainProb: 0, uv: 0, humidity: 0, gust: 0 } as Limits;
  for (const src of [ACTIVITY_ADJUST[activity], sensitive ? SENSITIVE_ADJUST : {}]) {
    for (const [k, v] of Object.entries(src) as [LimitKey, number][]) out[k] += v;
  }
  return out;
}

export function effectiveLimits(base: Limits, activity: Activity, sensitive: boolean): Limits {
  const adj = adjustments(activity, sensitive);
  const out = { ...base };
  for (const k of Object.keys(out) as LimitKey[]) out[k] = clampLimit(k, base[k] + adj[k]);
  return out;
}
