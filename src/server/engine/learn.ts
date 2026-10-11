import type { Activity, FeedbackEntry, LearningState, LimitChange, LimitKey, Limits } from '../../shared/types.js';
import { adjustments, clampLimit, DEFAULT_LIMITS } from './limits.js';

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
  const said = entry.went ? 'You said' : 'You skipped because';
  const out: Proposal[] = [];
  const f = new Set(entry.feelings);
  const deg = (v: number) => `${Math.round(v)}°C`;

  if (f.has('too_hot') && c.feels - 1 < eff.maxFeels)
    out.push({ key: 'maxFeels', target: c.feels - 1, rate, reason: `${said} ${deg(c.feels)} felt too hot.` });
  if (f.has('too_cold') && (c.feelsMin ?? c.feels) + 1 > eff.minFeels)
    out.push({ key: 'minFeels', target: (c.feelsMin ?? c.feels) + 1, rate, reason: `${said} ${deg(c.feelsMin ?? c.feels)} felt too cold.` });
  if (f.has('air_bad') && c.pm25 !== null && c.pm25 - 3 < eff.pm25)
    out.push({ key: 'pm25', target: c.pm25 - 3, rate, reason: `${said} the air felt bad at ${Math.round(c.pm25)} µg/m³.` });
  if (f.has('too_humid') && c.humidity - 3 < eff.humidity)
    out.push({ key: 'humidity', target: c.humidity - 3, rate, reason: `${said} ${c.humidity}% humidity felt too muggy.` });
  if (f.has('too_sunny') && c.uv - 1 < eff.uv)
    out.push({ key: 'uv', target: c.uv - 1, rate, reason: `${said} UV ${c.uv} felt too harsh.` });
  if (f.has('rain') && c.rainProb - 5 < eff.rainProb)
    out.push({ key: 'rainProb', target: c.rainProb - 5, rate: rate / 2, reason: `${said} it rained at a ${c.rainProb}% chance.` });
  if (f.has('windy') && c.gust - 3 < eff.gust)
    out.push({ key: 'gust', target: c.gust - 3, rate, reason: `${said} ${Math.round(c.gust)} km/h gusts were too much.` });

  if (entry.went && f.has('great')) {
    // Felt great past a limit (a "best available" window): move halfway toward what you handled.
    // Felt great near a limit: nudge it a little. Either way the per-check-in cap still applies.
    const loosen = (key: LimitKey, value: number, nearEdge: boolean, what: string) => {
      if (value > eff[key]) out.push({ key, target: value, rate: 0.5, reason: `${what} felt great, even past your limit.` });
      else if (nearEdge) out.push({ key, target: eff[key] + LOOSEN_STEP[key]!, rate: 1, reason: `${what} felt great.` });
    };
    if (!f.has('too_hot')) loosen('maxFeels', c.feels, c.feels >= eff.maxFeels - 1.5, `A feels-like of ${deg(c.feels)}`);
    if ((c.feelsMin ?? c.feels) <= eff.minFeels + 1.5 && !f.has('too_cold'))
      out.push({ key: 'minFeels', target: eff.minFeels + LOOSEN_STEP.minFeels!, rate: 1, reason: `${deg(c.feelsMin ?? c.feels)} felt great, so cooler is fine.` });
    if (c.pm25 !== null && !f.has('air_bad')) loosen('pm25', c.pm25, c.pm25 >= eff.pm25 * 0.8, `Air at ${Math.round(c.pm25)} µg/m³`);
    if (!f.has('too_humid')) loosen('humidity', c.humidity, c.humidity >= eff.humidity - 5, `${c.humidity}% humidity`);
    if (!f.has('too_sunny')) loosen('uv', c.uv, c.uv >= eff.uv - 1, `UV ${c.uv}`);
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
      kind: 'feedback',
      when: `${entry.date}T${entry.start}`,
      key: p.key,
      from: base[p.key],
      to: nextBase,
      reason: p.reason,
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
    kind: 'manual',
    key,
    from: state.base[key],
    to,
    reason: 'Set by you.',
    feedbackId: null,
  };
  return { base: { ...state.base, [key]: to }, log: [...state.log, change].slice(-200) };
}
