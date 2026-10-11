import { describe, expect, it } from 'vitest';
import type { FeedbackEntry, GoWindow, HourConditions, Park, Settings } from '../src/shared/types.js';
import { localToEpochSeconds, nowInTimezone, toMinutes } from '../src/shared/time.js';
import { allowedNumbers, ungroundedNumbers } from '../src/server/ai/grounding.js';
import { parseByKeywords, verifyFeelings } from '../src/server/ai/feedbackParse.js';
import { cleanField } from '../src/server/ai/narrate.js';
import { applyFeedback, initialLearning, MAX_STEP } from '../src/server/engine/learn.js';
import { DEFAULT_LIMITS, effectiveLimits, TOLERANCE } from '../src/server/engine/limits.js';
import { buildPlan, pickPark } from '../src/server/engine/plan.js';
import { scoreHour } from '../src/server/engine/score.js';
import { complement, findWindows } from '../src/server/engine/windows.js';
import { desiredNotifications } from '../src/server/notify/scheduler.js';
import { defaultSettings } from '../src/server/store.js';
import type { Forecast } from '../src/server/sources/openmeteo.js';

function hour(time: string, over: Partial<HourConditions> = {}): HourConditions {
  return {
    time,
    temp: 24,
    feels: 24,
    humidity: 60,
    rainProb: 0,
    precip: 0,
    weatherCode: 1,
    uv: 2,
    wind: 8,
    gust: 15,
    isDay: true,
    pm25: 12,
    pm10: 20,
    usAqi: 50,
    ...over,
  };
}

function day(date: string, tweak: (h: number) => Partial<HourConditions> = () => ({})): HourConditions[] {
  return Array.from({ length: 24 }, (_, h) => hour(`${date}T${String(h).padStart(2, '0')}:00`, tweak(h)));
}

describe('scoreHour', () => {
  it('scores a pleasant hour highly and does not block it', () => {
    const s = scoreHour(hour('2026-10-11T07:00'), DEFAULT_LIMITS, true);
    expect(s.blocked).toBe(false);
    expect(s.score).toBeGreaterThan(85);
  });

  it('blocks an hour over the heat limit and names heat as the limiting factor', () => {
    const s = scoreHour(hour('2026-10-11T14:00', { feels: 36 }), DEFAULT_LIMITS, true);
    expect(s.blocked).toBe(true);
    expect(s.limiting?.key).toBe('heat');
  });

  it('blocks thunderstorms regardless of other factors', () => {
    const s = scoreHour(hour('2026-10-11T17:00', { weatherCode: 95 }), DEFAULT_LIMITS, true);
    expect(s.blocked).toBe(true);
    expect(s.limiting?.key).toBe('storm');
  });

  it('respects darkOk', () => {
    const night = hour('2026-10-11T21:00', { isDay: false });
    expect(scoreHour(night, DEFAULT_LIMITS, false).blocked).toBe(true);
    expect(scoreHour(night, DEFAULT_LIMITS, true).blocked).toBe(false);
  });

  it('does not block when air data is missing', () => {
    const s = scoreHour(hour('2026-10-11T07:00', { pm25: null }), DEFAULT_LIMITS, true);
    expect(s.blocked).toBe(false);
  });
});

describe('findWindows', () => {
  const scored = (hours: HourConditions[]) => hours.map((h) => scoreHour(h, DEFAULT_LIMITS, true));

  it('finds a window that fits exactly inside a free range', () => {
    const { windows } = findWindows('2026-10-11', scored(day('2026-10-11')), [{ start: '07:30', end: '08:30' }], 30, null, true);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ start: '07:30', end: '08:30', minutes: 60 });
  });

  it('splits a free range around a blocked hour and explains a near miss', () => {
    const hours = scored(day('2026-10-11', (h) => (h === 18 ? { pm25: 80 } : {})));
    const { windows } = findWindows('2026-10-11', hours, [{ start: '17:00', end: '20:00' }], 30, null, true);
    expect(windows.map((w) => `${w.start}-${w.end}`)).toEqual(['17:00-18:00', '19:00-20:00']);

    const miss = findWindows('2026-10-11', hours, [{ start: '18:00', end: '19:00' }], 30, null, true);
    expect(miss.windows).toHaveLength(0);
    expect(miss.nearMisses[0].factor).toBe('air');
  });

  it('never suggests the past on the current day', () => {
    const { windows } = findWindows('2026-10-11', scored(day('2026-10-11')), [{ start: '07:00', end: '09:00' }], 30, 8 * 60 + 2, true);
    expect(windows[0].start).toBe('08:05');
  });

  it('drops stretches shorter than the minimum and reports them as short', () => {
    const hours = scored(day('2026-10-11', (h) => (h === 8 ? { feels: 38 } : {})));
    const res = findWindows('2026-10-11', hours, [{ start: '07:40', end: '08:30' }], 30, null, true);
    expect(res.windows).toHaveLength(0);
    expect(res.nearMisses[0].factor).toBe('short');
  });
});

describe('complement', () => {
  it('returns the gaps between free ranges', () => {
    expect(complement([{ start: '07:00', end: '08:00' }, { start: '18:00', end: '20:00' }], 5 * 60, 22 * 60)).toEqual([
      { start: '05:00', end: '07:00' },
      { start: '08:00', end: '18:00' },
      { start: '20:00', end: '22:00' },
    ]);
  });
});

describe('buildPlan', () => {
  const settings: Settings = {
    ...defaultSettings(),
    location: { name: 'Test', lat: 12.97, lon: 77.59, timezone: 'Asia/Kolkata' },
  };
  const forecast: Forecast = {
    timezone: 'Asia/Kolkata',
    utcOffsetSeconds: 19800,
    hours: [
      ...day('2026-10-11', (h) => (h >= 11 && h <= 15 ? { feels: 35, uv: 9 } : {})),
      ...day('2026-10-12', (h) => (h === 7 || h === 8 ? { pm25: 70 } : {})),
      ...day('2026-10-13'),
    ],
    daylight: {},
    airAvailable: true,
    fetchedAt: 0,
  };
  // 2026-10-11 05:00 IST
  const now = new Date('2026-10-10T23:30:00Z');

  it('plans three days with a best window per day and a better slot outside free hours', () => {
    const plan = buildPlan({ settings, forecast, parks: null, base: DEFAULT_LIMITS, now });
    expect(plan.days.map((d) => d.label)).toEqual(['Today', 'Tomorrow', 'Tuesday']);
    expect(plan.days[0].windows.filter((w) => w.best)).toHaveLength(1);
    // Monday's morning free slot is polluted.
    const monday = plan.days[1];
    expect(monday.nearMisses.some((m) => m.factor === 'air')).toBe(true);
    expect(monday.windows.every((w) => w.start !== '07:00')).toBe(true);
  });

  it('keeps an open window with a stable id instead of clipping it to now', () => {
    const at = (iso: string) => buildPlan({ settings, forecast, parks: null, base: DEFAULT_LIMITS, now: new Date(iso) });
    // 07:20 and 07:45 IST on 2026-10-11 (weekend free slot 07:00-10:00).
    const a = at('2026-10-11T01:50:00Z').days[0].windows.find((w) => w.best)!;
    const b = at('2026-10-11T02:15:00Z').days[0].windows.find((w) => w.best)!;
    expect(a.id).toBe('2026-10-11T07:00-10:00');
    expect(b.id).toBe(a.id);
    // With under 15 minutes left it drops off the plan.
    expect(at('2026-10-11T04:20:00Z').days[0].windows.some((w) => w.id === a.id)).toBe(false);
  });

  it('changes its hash when limits change', () => {
    const a = buildPlan({ settings, forecast, parks: null, base: DEFAULT_LIMITS, now });
    const b = buildPlan({ settings, forecast, parks: null, base: { ...DEFAULT_LIMITS, maxFeels: 28 }, now });
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('pickPark', () => {
  const w = { minutes: 120 } as GoWindow;
  const park = (name: string, walkMinutes: number, areaM2: number | null): Park => ({
    name,
    kind: 'park',
    lat: 0,
    lon: 0,
    distanceKm: walkMinutes / 12,
    walkMinutes,
    areaM2,
  });

  it('prefers a real park a little further away over a tiny nearby one', () => {
    expect(pickPark(w, [park('traffic island', 4, 900), park('big park', 15, 400_000)])?.name).toBe('big park');
  });

  it('never picks a park that is too far for the window', () => {
    expect(pickPark({ minutes: 30 } as GoWindow, [park('far park', 25, 1_000_000)])).toBeNull();
  });
});

describe('tolerance and best available', () => {
  const sensitive: Settings = {
    ...defaultSettings(),
    location: { name: 'Hyderabad', lat: 17.38, lon: 78.46, timezone: 'Asia/Kolkata' },
    sensitive: true,
  };
  // Sensitive walk: PM2.5 limit 25. Every hour is a bit over (30), mornings are far over (50).
  const smoggy: Forecast = {
    timezone: 'Asia/Kolkata',
    utcOffsetSeconds: 19800,
    hours: ['2026-10-11', '2026-10-12', '2026-10-13'].flatMap((d) => day(d, (h) => ({ pm25: h < 12 ? 50 : 30, feels: 29 }))),
    daylight: {},
    airAvailable: true,
    fetchedAt: 0,
  } as Forecast;
  const now = new Date('2026-10-10T23:30:00Z');

  it('marks an hour slightly over a limit as over, not blocked, in balanced mode', () => {
    const h = scoreHour(hour('2026-10-11T18:00', { pm25: 30 }), { ...DEFAULT_LIMITS, pm25: 25 }, true, TOLERANCE.balanced);
    expect(h.blocked).toBe(false);
    expect(h.overLimit).toBe(true);
    expect(scoreHour(hour('2026-10-11T07:00', { pm25: 50 }), { ...DEFAULT_LIMITS, pm25: 25 }, true, TOLERANCE.balanced).blocked).toBe(true);
  });

  it('offers a clearly marked best-available window when nothing fits', () => {
    const plan = buildPlan({ settings: { ...sensitive, tolerance: 'balanced' }, forecast: smoggy, parks: null, base: DEFAULT_LIMITS, now });
    for (const d of plan.days) {
      const best = d.windows.find((w) => w.best)!;
      expect(best.fallback).toBe(true);
      expect(best.overKeys).toContain('air');
      expect(best.overLimits?.[0]).toMatch(/PM2.5 30/);
      expect(toMinutes(best.start)).toBeGreaterThanOrEqual(12 * 60);
      expect(d.nearMisses.length).toBeGreaterThan(0);
    }
  });

  it('shows nothing in strict mode', () => {
    const plan = buildPlan({ settings: { ...sensitive, tolerance: 'strict' }, forecast: smoggy, parks: null, base: DEFAULT_LIMITS, now });
    expect(plan.days.every((d) => d.windows.length === 0)).toBe(true);
  });

  it('loosens a limit toward what you handled when a best-available walk felt great', () => {
    const entry: FeedbackEntry = {
      id: 'f1',
      windowId: 'w1',
      date: '2026-10-11',
      start: '18:00',
      end: '19:00',
      went: true,
      minutes: 60,
      feelings: ['great'],
      parsedBy: 'buttons',
      conditions: { feels: 29, pm25: 30, humidity: 40, uv: 0, rainProb: 0, gust: 10 },
      createdAt: '2026-10-11T13:40:00Z',
    };
    const { state } = applyFeedback(initialLearning(), entry, 'walk', true);
    const eff = effectiveLimits(state.base, 'walk', true);
    expect(eff.pm25).toBeGreaterThan(25);
    expect(eff.pm25).toBeLessThanOrEqual(30);
  });
});

describe('applyFeedback', () => {
  const entry = (over: Partial<FeedbackEntry>): FeedbackEntry => ({
    id: 'f1',
    windowId: 'w1',
    date: '2026-10-11',
    start: '17:00',
    end: '18:00',
    went: true,
    minutes: 60,
    feelings: [],
    parsedBy: 'buttons',
    conditions: { feels: 31, feelsMin: 29, pm25: 30, humidity: 70, uv: 3, rainProb: 10, gust: 20 },
    createdAt: '2026-10-11T12:40:00Z',
    ...over,
  });

  it('tightens the heat limit quickly after "too hot"', () => {
    const { state, changes } = applyFeedback(initialLearning(), entry({ feelings: ['too_hot'] }), 'walk', false);
    expect(state.base.maxFeels).toBeLessThan(32);
    expect(state.base.maxFeels).toBeGreaterThanOrEqual(30);
    expect(changes[0].reason).toMatch(/too hot/);
  });

  it('loosens slowly after "great" near the edge', () => {
    const { state } = applyFeedback(initialLearning(), entry({ feelings: ['great'], conditions: { feels: 31.5, pm25: 10, humidity: 60, uv: 2, rainProb: 0, gust: 10 } }), 'walk', false);
    expect(state.base.maxFeels).toBe(32.5);
  });

  it('learns in effective space so activity adjustments are preserved', () => {
    // Running lowers maxFeels by 3, so effective is 29. "Too hot" at 28 should pull base below 32.
    const { state } = applyFeedback(initialLearning(), entry({ feelings: ['too_hot'], conditions: { feels: 28, pm25: 10, humidity: 60, uv: 2, rainProb: 0, gust: 10 } }), 'run', false);
    expect(effectiveLimits(state.base, 'run', false).maxFeels).toBeLessThan(29);
  });

  it('learns more gently from skipped windows', () => {
    const went = applyFeedback(initialLearning(), entry({ feelings: ['air_bad'] }), 'walk', false).state.base.pm25;
    const skipped = applyFeedback(initialLearning(), entry({ went: false, feelings: ['air_bad'] }), 'walk', false).state.base.pm25;
    expect(went).toBeLessThan(skipped);
    expect(skipped).toBeLessThan(35);
  });

  it('never moves a limit more than one step per check-in', () => {
    const { state } = applyFeedback(initialLearning(), entry({ feelings: ['too_cold'], conditions: { feels: 30, feelsMin: 30, pm25: 10, humidity: 60, uv: 2, rainProb: 0, gust: 10 } }), 'walk', false);
    expect(state.base.minFeels - DEFAULT_LIMITS.minFeels).toBeLessThanOrEqual(MAX_STEP.minFeels);
  });

  it('never leaves the guard rails', () => {
    let state = initialLearning();
    for (let i = 0; i < 30; i++) {
      state = applyFeedback(state, entry({ id: `f${i}`, feelings: ['too_hot'], conditions: { feels: 5, pm25: 10, humidity: 60, uv: 2, rainProb: 0, gust: 10 } }), 'walk', false).state;
    }
    expect(state.base.maxFeels).toBe(20);
  });
});

describe('cleanField', () => {
  it('cuts text after the model closes the JSON inside a string', () => {
    expect(cleanField('Walk to the park, notice the light.”}  18:00-20:00 is also good')).toBe('Walk to the park, notice the light.');
  });

  it('cuts at a switch to another script', () => {
    expect(cleanField('Notice the changing light. শুন্য সময় নেই')).toBe('Notice the changing light.');
  });

  it('keeps normal text with degrees, µg/m³ and dashes', () => {
    expect(cleanField('Feels like 29°C, PM2.5 33 µg/m³ – close to your limit')).toBe('Feels like 29°C, PM2.5 33 µg/m³ – close to your limit');
  });
});

describe('grounding', () => {
  const facts = 'Best window: 17:40-18:30, 50 minutes. Feels like 29°C, PM2.5 up to 22.';

  it('accepts text that only uses numbers from the facts', () => {
    expect(ungroundedNumbers('Go 17:40 to 18:30, it feels like 29°C with PM2.5 at 22.', allowedNumbers(facts))).toEqual([]);
  });

  it('flags invented numbers', () => {
    expect(ungroundedNumbers('Feels like 31°C, walk 5 km.', allowedNumbers(facts))).toEqual(['31', '5']);
  });
});

describe('verifyFeelings', () => {
  const note = 'Went to the lake but it was so muggy and the traffic smoke had me coughing';

  it('keeps feelings backed by a real quote', () => {
    expect(
      verifyFeelings(note, [
        { feeling: 'too_humid', quote: 'so muggy' },
        { feeling: 'air_bad', quote: 'smoke had me coughing' },
      ]).sort(),
    ).toEqual(['air_bad', 'too_humid']);
  });

  it('drops feelings with invented quotes or a reused quote that does not fit', () => {
    expect(
      verifyFeelings(note, [
        { feeling: 'too_humid', quote: 'muggy' },
        { feeling: 'too_cold', quote: 'muggy' },
        { feeling: 'too_hot', quote: 'it was boiling' },
      ]),
    ).toEqual(['too_humid']);
  });
});

describe('parseByKeywords', () => {
  it('maps a muggy, smoky walk to humidity and air feelings', () => {
    const p = parseByKeywords('Went, but it was muggy and the smoke made me cough');
    expect(p.went).toBe(true);
    expect(p.feelings).toEqual(expect.arrayContaining(['too_humid', 'air_bad']));
  });

  it('detects a skip because of work', () => {
    const p = parseByKeywords("Skipped, stuck in a meeting");
    expect(p.went).toBe(false);
    expect(p.skipReason).toBe('busy');
  });
});

describe('notifications', () => {
  it('schedules digest, go alert and check-in for the best window, inside ntfy limits', () => {
    const settings: Settings = {
      ...defaultSettings(),
      location: { name: 'Test', lat: 12.97, lon: 77.59, timezone: 'Asia/Kolkata' },
      notify: { ...defaultSettings().notify, enabled: true, publicUrl: 'http://192.168.1.5:8787' },
    };
    const forecast: Forecast = {
      timezone: 'Asia/Kolkata',
      utcOffsetSeconds: 19800,
      hours: [...day('2026-10-11'), ...day('2026-10-12'), ...day('2026-10-13')],
      daylight: {},
      airAvailable: true,
      fetchedAt: 0,
    };
    const now = new Date('2026-10-10T23:30:00Z');
    const plan = buildPlan({ settings, forecast, parks: null, base: DEFAULT_LIMITS, now });
    const nowS = Math.floor(now.getTime() / 1000);
    const desired = desiredNotifications(plan, null, settings, 'KEY', 19800, nowS);
    const seqs = desired.map((d) => d.seq);
    expect(seqs).toContain('gw-digest-20261011');
    expect(seqs.some((s) => s.startsWith('gw-go-20261011'))).toBe(true);
    expect(seqs.some((s) => s.startsWith('gw-chk-20261011'))).toBe(true);
    for (const d of desired) {
      expect(d.msg.at! - nowS).toBeGreaterThan(0);
      expect(d.msg.at! - nowS).toBeLessThan(3 * 24 * 3600);
    }
    const go = desired.find((d) => d.seq.startsWith('gw-go-20261011'))!;
    // Best window starts 07:00 IST on 2026-10-11, alert 10 minutes before.
    expect(go.msg.at).toBe(localToEpochSeconds('2026-10-11T06:50', 19800));
    const chk = desired.find((d) => d.seq.startsWith('gw-chk-20261011'))!;
    expect(chk.msg.actions?.[0].url).toContain('k=KEY');
  });
});

describe('time helpers', () => {
  it('formats now in a timezone', () => {
    expect(nowInTimezone('Asia/Kolkata', new Date('2026-10-10T18:30:00Z'))).toBe('2026-10-11T00:00');
  });
});
