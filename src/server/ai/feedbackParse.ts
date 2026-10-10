import { FEELINGS, SKIP_REASONS, type Feeling, type SkipReason } from '../../shared/types.js';
import { chatJson } from './ollama.js';

export interface ParsedNote {
  went: boolean | null;
  feelings: Feeling[];
  skipReason: SkipReason | null;
  parsedBy: 'gemma' | 'keywords';
}

const SYSTEM = `You classify a short note someone wrote after a planned outdoor walk, run or ride.
Return:
- went: true if they went outside, false if they skipped, null if unclear.
- feelings: zero or more of ${FEELINGS.join(', ')}.
  great = they enjoyed it; too_hot = heat or sweating; too_cold = chilly; air_bad = smoke, smog, dust, coughing, pollution;
  too_humid = muggy, sticky, humid; too_sunny = harsh sun, glare, sunburn; rain = got wet or it rained; windy = strong wind.
- skip_reason: busy, weather, not_feeling_it, or none.
Only include feelings the note clearly states.`;

const SCHEMA = {
  type: 'object',
  properties: {
    went: { type: ['boolean', 'null'] },
    feelings: { type: 'array', items: { type: 'string', enum: FEELINGS } },
    skip_reason: { type: 'string', enum: [...SKIP_REASONS, 'none'] },
  },
  required: ['went', 'feelings', 'skip_reason'],
};

const KEYWORDS: [Feeling, RegExp][] = [
  ['too_hot', /\b(hot|heat|sweat\w*|boiling|scorching)\b/i],
  ['too_cold', /\b(cold|chilly|freezing|shiver\w*)\b/i],
  ['air_bad', /\b(smok\w*|smog|dust\w*|cough\w*|pollut\w*|haz[ey]|aqi)\b/i],
  ['too_humid', /\b(humid\w*|muggy|sticky|stuffy)\b/i],
  ['too_sunny', /\b(sunburn\w*|glare|harsh sun|too sunny|blazing)\b/i],
  ['rain', /\b(rain\w*|drizzl\w*|wet|shower\w*)\b/i],
  ['windy', /\b(wind\w*|gust\w*)\b/i],
  ['great', /\b(great|lovely|perfect|nice|amazing|loved|beautiful|pleasant|good)\b/i],
];

export function parseByKeywords(note: string): ParsedNote {
  const feelings = KEYWORDS.filter(([, re]) => re.test(note)).map(([f]) => f);
  const skipped = /\b(skip\w*|didn'?t go|did not go|stayed in|couldn'?t)\b/i.test(note);
  const busy = /\b(busy|meeting|work|call|deadline)\b/i.test(note);
  return {
    went: skipped ? false : feelings.length ? true : null,
    feelings: skipped ? feelings.filter((f) => f !== 'great') : feelings,
    skipReason: skipped ? (busy ? 'busy' : feelings.length ? 'weather' : 'not_feeling_it') : null,
    parsedBy: 'keywords',
  };
}

export async function parseNote(note: string, model: string): Promise<ParsedNote> {
  try {
    const { data } = await chatJson<{ went: boolean | null; feelings: string[]; skip_reason: string }>({
      model,
      system: SYSTEM,
      user: note.slice(0, 600),
      schema: SCHEMA,
      temperature: 0,
      timeoutMs: 60000,
    });
    const feelings = [...new Set(data.feelings)].filter((f): f is Feeling => (FEELINGS as string[]).includes(f));
    const skip = (SKIP_REASONS as string[]).includes(data.skip_reason) ? (data.skip_reason as SkipReason) : null;
    return { went: data.went, feelings, skipReason: skip, parsedBy: 'gemma' };
  } catch {
    return parseByKeywords(note);
  }
}
