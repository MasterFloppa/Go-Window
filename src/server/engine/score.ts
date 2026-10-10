import type { Factor, FactorKey, HourConditions, HourScore, Limits } from '../../shared/types.js';

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

function factor(key: FactorKey, value: number, limit: number, penalty: number, bad: boolean, label: string): Factor {
  const p = Math.max(0, round(penalty, 1));
  return { key, value: round(value, 1), limit: round(limit, 1), penalty: p, level: bad ? 'bad' : p >= 8 ? 'meh' : 'ok', label };
}

/**
 * Scores one forecast hour against personal limits. Any factor over its limit blocks the hour;
 * otherwise small penalties rank otherwise-acceptable hours (cooler, cleaner, drier is better).
 */
export function scoreHour(c: HourConditions, limits: Limits, darkOk: boolean): HourScore {
  const f: Factor[] = [];

  const storm = c.weatherCode >= 95;
  f.push(factor('storm', c.weatherCode, 95, storm ? 100 : 0, storm, storm ? 'thunderstorm forecast' : 'no thunderstorms'));

  const wet = c.rainProb > limits.rainProb || c.precip >= 0.5;
  f.push(
    factor(
      'rain',
      c.rainProb,
      limits.rainProb,
      (c.rainProb / Math.max(1, limits.rainProb)) * 15,
      wet,
      c.precip >= 0.5 ? `rain expected (${round(c.precip, 1)} mm)` : `rain chance ${c.rainProb}% (your limit ${limits.rainProb}%)`,
    ),
  );

  if (c.pm25 === null) {
    f.push(factor('air', 0, limits.pm25, 0, false, 'air quality data unavailable'));
  } else {
    const ratio = c.pm25 / limits.pm25;
    f.push(
      factor('air', c.pm25, limits.pm25, ratio ** 2 * 25, ratio > 1, `PM2.5 ${round(c.pm25)} µg/m³ (your limit ${limits.pm25})`),
    );
  }

  f.push(
    factor(
      'heat',
      c.feels,
      limits.maxFeels,
      (c.feels - (limits.maxFeels - 6)) * 2.5,
      c.feels > limits.maxFeels,
      `feels like ${round(c.feels)}°C (your max ${limits.maxFeels}°C)`,
    ),
  );
  f.push(
    factor(
      'cold',
      c.feels,
      limits.minFeels,
      (limits.minFeels + 4 - c.feels) * 2.5,
      c.feels < limits.minFeels,
      `feels like ${round(c.feels)}°C (your min ${limits.minFeels}°C)`,
    ),
  );
  f.push(
    factor(
      'humidity',
      c.humidity,
      limits.humidity,
      ((c.humidity - (limits.humidity - 20)) / 20) * 10,
      c.humidity > limits.humidity,
      `humidity ${c.humidity}% (your limit ${limits.humidity}%)`,
    ),
  );
  f.push(
    factor('uv', c.uv, limits.uv, (c.uv / limits.uv) * 10 - 4, c.uv > limits.uv, `UV ${round(c.uv, 1)} (your limit ${limits.uv})`),
  );
  f.push(
    factor(
      'wind',
      c.gust,
      limits.gust,
      ((c.gust / limits.gust) - 0.6) * 20,
      c.gust > limits.gust,
      `gusts ${round(c.gust)} km/h (your limit ${limits.gust})`,
    ),
  );
  f.push(factor('dark', c.isDay ? 1 : 0, 1, c.isDay ? 0 : 6, !c.isDay && !darkOk, c.isDay ? 'daylight' : 'after dark'));

  const blocked = f.some((x) => x.level === 'bad');
  const score = blocked ? 0 : Math.max(0, Math.min(100, round(100 - f.reduce((s, x) => s + x.penalty, 0))));
  return { time: c.time, score, blocked, limiting: limitingFactor(f), factors: f, conditions: c };
}

function severity(x: Factor): number {
  if (x.level !== 'bad') return x.penalty;
  if (x.key === 'storm' || x.key === 'dark') return 1000;
  const over = x.key === 'cold' ? (x.limit - x.value) / Math.max(1, Math.abs(x.limit)) : (x.value - x.limit) / Math.max(1, x.limit);
  return 100 + over * 100;
}

export function limitingFactor(factors: Factor[]): Factor | null {
  let worst: Factor | null = null;
  for (const x of factors) if (x.penalty > 0 && (!worst || severity(x) > severity(worst))) worst = x;
  return worst;
}
