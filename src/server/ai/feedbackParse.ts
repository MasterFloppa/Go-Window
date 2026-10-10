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
- feelings: zero or more items. Each item has a feeling and a quote.
  feeling is one of ${FEELINGS.join(', ')}:
  great = they enjoyed it; too_hot = heat or sweating; too_cold = chilly or shivering; air_bad = smoke, smog, dust, coughing, pollution;
  too_humid = muggy, sticky, humid; too_sunny = harsh sun, glare, sunburn; rain = got wet or it rained; windy = strong wind.
  quote = the exact words copied from the note that show this feeling.
  Only include a feeling if the note clearly says it. Never guess. If no words in the note show it, leave it out.
- skip_reason: busy, weather, not_feeling_it, or none.`;

const SCHEMA = {
  type: 'object',
  properties: {
    went: { type: ['boolean', 'null'] },
    feelings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { feeling: { type: 'string', enum: FEELINGS }, quote: { type: 'string' } },
        required: ['feeling', 'quote'],
      },
    },
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

export interface QuotedFeeling {
  feeling: string;
  quote: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Keeps only feelings backed by words that really appear in the note. If one quote is used for
 * several feelings (e.g. "muggy" for both too_humid and too_cold), only the ones whose keywords
 * match that quote survive. This stops a small model from inventing a feeling.
 */
export function verifyFeelings(note: string, items: QuotedFeeling[]): Feeling[] {
  const text = norm(note);
  const valid = items.filter(
    (i): i is { feeling: Feeling; quote: string } =>
      (FEELINGS as string[]).includes(i.feeling) && norm(i.quote).length >= 3 && text.includes(norm(i.quote)),
  );
  const byQuote = new Map<string, Feeling[]>();
  for (const i of valid) byQuote.set(norm(i.quote), [...(byQuote.get(norm(i.quote)) ?? []), i.feeling]);
  const keep = new Set<Feeling>();
  for (const [quote, feelings] of byQuote) {
    const unique = [...new Set(feelings)];
    if (unique.length === 1) keep.add(unique[0]);
    else for (const f of unique) if (KEYWORDS.find(([k]) => k === f)?.[1].test(quote)) keep.add(f);
  }
  if (keep.has('too_hot') && keep.has('too_cold')) {
    for (const f of ['too_hot', 'too_cold'] as Feeling[]) if (!KEYWORDS.find(([k]) => k === f)?.[1].test(note)) keep.delete(f);
  }
  return [...keep];
}

export async function parseNote(note: string, model: string): Promise<ParsedNote> {
  try {
    const { data } = await chatJson<{ went: boolean | null; feelings: QuotedFeeling[]; skip_reason: string }>({
      model,
      system: SYSTEM,
      user: note.slice(0, 600),
      schema: SCHEMA,
      temperature: 0,
      timeoutMs: 60000,
    });
    const feelings = verifyFeelings(note, data.feelings ?? []);
    const skip = (SKIP_REASONS as string[]).includes(data.skip_reason) ? (data.skip_reason as SkipReason) : null;
    return { went: data.went, feelings, skipReason: skip, parsedBy: 'gemma' };
  } catch {
    return parseByKeywords(note);
  }
}
