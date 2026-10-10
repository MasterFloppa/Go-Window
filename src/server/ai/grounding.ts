/**
 * Grounding check: every number the model writes must come from the facts we gave it.
 * The model narrates; it never gets to invent a temperature, time or distance.
 */
const NUMBER = /\d+(?:\.\d+)?/g;
const ALWAYS_OK = new Set(['1', '2']);

function normalize(n: string): string[] {
  const v = Number(n);
  if (!Number.isFinite(v)) return [n];
  const out = new Set([String(v), String(Math.round(v))]);
  if (Number.isInteger(v) && v < 10) out.add(`0${v}`);
  return [...out];
}

export function allowedNumbers(facts: unknown): Set<string> {
  const allowed = new Set(ALWAYS_OK);
  const text = JSON.stringify(facts);
  for (const m of text.match(NUMBER) ?? []) for (const n of normalize(m)) allowed.add(n);
  return allowed;
}

/** Returns the numbers in `text` that are not backed by the facts. */
export function ungroundedNumbers(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const m of text.match(NUMBER) ?? []) {
    if (!normalize(m).some((n) => allowed.has(n))) bad.push(m);
  }
  return bad;
}
