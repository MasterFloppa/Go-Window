import type { Activity, FeedbackEntry, LearningState, LimitChange, LimitKey, Limits } from '../../shared/types.js';
import { adjustments, clampLimit, DEFAULT_LIMITS, LIMIT_LABELS } from './limits.js';

/** Tighten fast when something felt bad, loosen slowly when it felt great: safety first. */
const TIGHTEN = 0.6;
const TIGHTEN_SKIPPED = 0.3;
const LOOSEN_STEP: Partial<Record<LimitKey, number>> = { maxFeels: 0.5, minFeels: -0.5, pm25: 2, humidity: 1, uv: 0.5 };
/** One check-in can only move a limit this far, so a single odd day (or misread note) can't wreck your plan. */
export const MAX_STEP: Record<LimitKey, number> = { maxFeels: 3, minFeels: 3, pm25: 10, humidity: 8, uv: 2, rainProb: 15, gust: 8 };

const step = (key: LimitKey) => (key === 'maxFeels' || key === 'minFeels' || key === 'uv' ? 0.5 : 1);
const snap = (key: LimitKey, v: number) => Math.round(v / step(key)) * step(key);

export function initialLearning(): LearningState {
  return { base: { ...DEFAULT_LIMITS }, log: [] };
}

interface Proposal {
  key: LimitKey;
  /** Desired effective limit. */
  target: number;
  rate: number;
  reason: string;
}

function proposals(entry: FeedbackEntry, eff: Limits): Proposal[] {
  const c = entry.conditions;
  const rate = entry.went ? TIGHTEN : TIGHTEN_SKIPPED;
  const when = `${entry.date} ${entry.start}`;
  const verb = entry.went ? 'you said' : 'you skipped because';
  const out: Proposal[] = [];
  const f = new Set(entry.feelings);

  if (f.has('too_hot') && c.feels - 1 < eff.maxFeels)
    out.push({ key: 'maxFeels', target: c.feels - 1, rate, reason: `${verb} feels-like ${Math.round(c.feels)}°C was too hot (${when})` });
  if (f.has('too_cold') && (c.feelsMin ?? c.feels) + 1 > eff.minFeels)
    out.push({ key: 'minFeels', target: (c.feelsMin ?? c.feels) + 1, rate, reason: `${verb} feels-like ${Math.round(c.feelsMin ?? c.feels)}°C was too cold (${when})` });
  if (f.has('air_bad') && c.pm25 !== null && c.pm25 - 3 < eff.pm25)
    out.push({ key: 'pm25', target: c.pm25 - 3, rate, reason: `${verb} the air felt bad at PM2.5 ${Math.round(c.pm25)} (${when})` });
  if (f.has('too_humid') && c.humidity - 3 < eff.humidity)
    out.push({ key: 'humidity', target: c.humidity - 3, rate, reason: `${verb} ${c.humidity}% humidity was too muggy (${when})` });
  if (f.has('too_sunny') && c.uv - 1 < eff.uv)
    out.push({ key: 'uv', target: c.uv - 1, rate, reason: `${verb} UV ${c.uv} was too harsh (${when})` });
  if (f.has('rain') && c.rainProb - 5 < eff.rainProb)
    out.push({ key: 'rainProb', target: c.rainProb - 5, rate: rate / 2, reason: `${verb} it rained at a ${c.rainProb}% chance (${when})` });
  if (f.has('windy') && c.gust - 3 < eff.gust)
    out.push({ key: 'gust', target: c.gust - 3, rate, reason: `${verb} ${Math.round(c.gust)} km/h gusts were too much (${when})` });

  if (entry.went && f.has('great')) {
    if (c.feels >= eff.maxFeels - 1.5 && !f.has('too_hot'))
      out.push({ key: 'maxFeels', target: eff.maxFeels + LOOSEN_STEP.maxFeels!, rate: 1, reason: `${Math.round(c.feels)}°C felt great, so you handle heat a bit better (${when})` });
    if ((c.feelsMin ?? c.feels) <= eff.minFeels + 1.5 && !f.has('too_cold'))
      out.push({ key: 'minFeels', target: eff.minFeels + LOOSEN_STEP.minFeels!, rate: 1, reason: `${Math.round(c.feelsMin ?? c.feels)}°C felt great, so cooler is fine (${when})` });
    if (c.pm25 !== null && c.pm25 >= eff.pm25 * 0.8 && !f.has('air_bad'))
      out.push({ key: 'pm25', target: eff.pm25 + LOOSEN_STEP.pm25!, rate: 1, reason: `PM2.5 ${Math.round(c.pm25)} felt fine (${when})` });
    if (c.humidity >= eff.humidity - 5 && !f.has('too_humid'))
      out.push({ key: 'humidity', target: eff.humidity + LOOSEN_STEP.humidity!, rate: 1, reason: `${c.humidity}% humidity felt fine (${when})` });
    if (c.uv >= eff.uv - 1 && !f.has('too_sunny'))
      out.push({ key: 'uv', target: eff.uv + LOOSEN_STEP.uv!, rate: 1, reason: `UV ${c.uv} felt fine (${when})` });
  }
  return out;
}

/**
 * Applies one feedback entry. Rules work on the effective limits (what you actually experienced)
 * and are converted back to your base limits, so switching activity keeps what was learned.
 */
export function applyFeedback(
  state: LearningState,
  entry: FeedbackEntry,
  activity: Activity,
  sensitive: boolean,
  at: Date = new Date(),
): { state: LearningState; changes: LimitChange[] } {
  const adj = adjustments(activity, sensitive);
  const base = { ...state.base };
  const eff = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v + adj[k as LimitKey]])) as unknown as Limits;
  const changes: LimitChange[] = [];

  for (const p of proposals(entry, eff)) {
    const delta = Math.max(-MAX_STEP[p.key], Math.min(MAX_STEP[p.key], p.rate * (p.target - eff[p.key])));
    const nextEff = eff[p.key] + delta;
    const nextBase = clampLimit(p.key, snap(p.key, nextEff - adj[p.key]));
    if (nextBase === base[p.key]) continue;
    changes.push({
      at: at.toISOString(),
      key: p.key,
      from: base[p.key],
      to: nextBase,
      reason: `${LIMIT_LABELS[p.key].label}: ${p.reason}`,
      feedbackId: entry.id,
    });
    base[p.key] = nextBase;
    eff[p.key] = nextBase + adj[p.key];
  }
  return { state: { base, log: [...state.log, ...changes].slice(-200) }, changes };
}

export function setLimitManually(state: LearningState, key: LimitKey, value: number, at = new Date()): LearningState {
  const to = clampLimit(key, snap(key, value));
  if (to === state.base[key]) return state;
  const change: LimitChange = {
    at: at.toISOString(),
    key,
    from: state.base[key],
    to,
    reason: `${LIMIT_LABELS[key].label}: set by you`,
    feedbackId: null,
  };
  return { base: { ...state.base, [key]: to }, log: [...state.log, change].slice(-200) };
}
