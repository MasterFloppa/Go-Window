import type { Factor, FactorKey, HourConditions, HourScore, Limits } from '../../shared/types.js';
import { TOLERANCE, type ToleranceSpec } from './limits.js';

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

/** Rounds for display, but keeps a decimal when rounding would hide that a limit was crossed (30.3 vs 30). */
const shown = (v: number, limit: number) => (Math.round(v) === limit && v !== limit ? round(v, 1) : round(v));

/**
 * `over`: past your comfort limit but within tolerance (allowed only for a "best available" window).
 * `hard`: past the tolerance too, so the hour is blocked.
 */
function factor(key: FactorKey, value: number, limit: number, penalty: number, over: boolean, hard: boolean, label: string): Factor {
  const p = Math.max(0, round(penalty, 1));
  return {
    key,
    value: round(value, 1),
    limit: round(limit, 1),
    penalty: p,
    level: hard ? 'bad' : over || p >= 8 ? 'meh' : 'ok',
    over: over && !hard,
    label,
  };
}

/**
 * Scores one forecast hour against personal limits. Your limits are comfort limits; the tolerance
 * decides how far past them an hour may go before it is blocked outright. Penalties rank the rest
 * (cooler, cleaner, drier is better).
 */
export function scoreHour(c: HourConditions, limits: Limits, darkOk: boolean, tol: ToleranceSpec = TOLERANCE.strict): HourScore {
  const f: Factor[] = [];

  const storm = c.weatherCode >= 95;
  f.push(factor('storm', c.weatherCode, 95, storm ? 100 : 0, storm, storm, storm ? 'thunderstorm forecast' : 'no thunderstorms'));

  const pouring = c.precip >= tol.precip;
  f.push(
    factor(
      'rain',
      c.rainProb,
      limits.rainProb,
      (c.rainProb / Math.max(1, limits.rainProb)) * 15,
      c.rainProb > limits.rainProb || c.precip >= 0.5,
      pouring || c.rainProb > limits.rainProb + tol.rainProb,
      c.precip >= 0.5 ? `rain expected (${round(c.precip, 1)} mm)` : `rain chance ${c.rainProb}% (your limit ${limits.rainProb}%)`,
    ),
  );

  if (c.pm25 === null) {
    f.push(factor('air', 0, limits.pm25, 0, false, false, 'air quality data unavailable'));
  } else {
    const ratio = c.pm25 / limits.pm25;
    f.push(
      factor(
        'air',
        c.pm25,
        limits.pm25,
        Math.min(ratio, 1) ** 2 * 25 + Math.max(0, ratio - 1) * 40,
        ratio > 1,
        c.pm25 > limits.pm25 * tol.pm25Factor,
        `PM2.5 ${shown(c.pm25, limits.pm25)} µg/m³ (your limit ${limits.pm25})`,
      ),
    );
  }

  f.push(
    factor(
      'heat',
      c.feels,
      limits.maxFeels,
      (c.feels - (limits.maxFeels - 6)) * 2.5,
      c.feels > limits.maxFeels,
      c.feels > limits.maxFeels + tol.heat,
      `feels like ${shown(c.feels, limits.maxFeels)}°C (your max ${limits.maxFeels}°C)`,
    ),
  );
  f.push(
    factor(
      'cold',
      c.feels,
      limits.minFeels,
      (limits.minFeels + 4 - c.feels) * 2.5,
      c.feels < limits.minFeels,
      c.feels < limits.minFeels - tol.cold,
      `feels like ${shown(c.feels, limits.minFeels)}°C (your min ${limits.minFeels}°C)`,
    ),
  );
  f.push(
    factor(
      'humidity',
      c.humidity,
      limits.humidity,
      ((c.humidity - (limits.humidity - 20)) / 20) * 10,
      c.humidity > limits.humidity,
      c.humidity > limits.humidity + tol.humidity,
      `humidity ${c.humidity}% (your limit ${limits.humidity}%)`,
    ),
  );
  f.push(
    factor(
      'uv',
      c.uv,
      limits.uv,
      (c.uv / limits.uv) * 10 - 4,
      c.uv > limits.uv,
      c.uv > limits.uv + tol.uv,
      `UV ${round(c.uv, 1)} (your limit ${limits.uv})`,
    ),
  );
  f.push(
    factor(
      'wind',
      c.gust,
      limits.gust,
      (c.gust / limits.gust - 0.6) * 20,
      c.gust > limits.gust,
      c.gust > limits.gust + tol.gust,
      `gusts ${round(c.gust)} km/h (your limit ${limits.gust})`,
    ),
  );
  const darkBad = !c.isDay && !darkOk;
  f.push(factor('dark', c.isDay ? 1 : 0, 1, c.isDay ? 0 : 6, darkBad, darkBad, c.isDay ? 'daylight' : 'after dark'));

  const blocked = f.some((x) => x.level === 'bad');
  const score = blocked ? 0 : Math.max(0, Math.min(100, round(100 - f.reduce((s, x) => s + x.penalty, 0))));
  return { time: c.time, score, blocked, overLimit: f.some((x) => x.over), limiting: limitingFactor(f), factors: f, conditions: c };
}

function excess(x: Factor): number {
  return x.key === 'cold' ? (x.limit - x.value) / Math.max(1, Math.abs(x.limit)) : (x.value - x.limit) / Math.max(1, x.limit);
}

function severity(x: Factor): number {
  if (x.level === 'bad') return x.key === 'storm' || x.key === 'dark' ? 1000 : 100 + excess(x) * 100;
  if (x.over) return 50 + excess(x) * 100;
  return x.penalty;
}

export function limitingFactor(factors: Factor[]): Factor | null {
  let worst: Factor | null = null;
  for (const x of factors) if (x.penalty > 0 && (!worst || severity(x) > severity(worst))) worst = x;
  return worst;
}
