import { createHash } from 'node:crypto';
import type { Activity, DayPlan, DayStory, GoWindow, Narrative, Plan } from '../../shared/types.js';
import { allowedNumbers, ungroundedNumbers } from './grounding.js';
import { chatJson } from './ollama.js';

export const ACTIVITY_WORD: Record<Activity, string> = { walk: 'walk', run: 'run', cycle: 'ride', kids: 'outdoor play' };
export const PROMPT_VERSION = 3;

function conditions(w: GoWindow, limits: Plan['limits']): string {
  const s = w.summary;
  const feels = s.feelsMin === s.feelsMax ? `${s.feelsMin}°C` : `${s.feelsMin} to ${s.feelsMax}°C`;
  const air = s.pm25Max === null ? 'air quality unknown' : `PM2.5 up to ${s.pm25Max} µg/m³ (the user's limit is ${limits.pm25})`;
  return `feels like ${feels} (the user's max is ${limits.maxFeels}°C), ${air}, rain chance up to ${s.rainProbMax}%, UV up to ${s.uvMax}`;
}

/**
 * Facts as short plain sentences. Small models misread nested JSON (e.g. treating
 * "minutes to the park" as "minutes to walk"), so every number carries its meaning inline.
 */
export function dayFacts(d: DayPlan, activity: Activity, limits: Plan['limits']): string {
  const best = d.windows.find((w) => w.best) ?? null;
  const lines = [
    `Day: ${d.label} (${d.weekday} ${d.date})`,
    `Activity: ${ACTIVITY_WORD[activity]}`,
    `User's free hours: ${d.free.length ? d.free.map((r) => `${r.start}-${r.end}`).join(', ') : 'none'}`,
  ];
  if (best) {
    lines.push(`Best window: ${best.start}-${best.end}, which is ${best.minutes} minutes long.`);
    lines.push(`Conditions in the best window: ${conditions(best, limits)}.`);
    if (best.limiting && best.limiting.penalty >= 5) lines.push(`Main thing to watch: ${best.limiting.label}.`);
    if (best.park) lines.push(`Nearby park: ${best.park.name}, reachable in ${best.park.walkMinutes} minutes on foot from home.`);
  } else {
    lines.push('Best window: none inside the free hours.');
  }
  const others = d.windows.filter((w) => !w.best);
  if (others.length) lines.push(`Other good windows: ${others.map((w) => `${w.start}-${w.end}`).join(', ')}.`);
  for (const m of d.nearMisses) lines.push(`Free slot ${m.start}-${m.end} does not work: ${m.reason}.`);
  if (d.betterElsewhere) {
    lines.push(`Better time outside the free hours: ${d.betterElsewhere.start}-${d.betterElsewhere.end} (${conditions(d.betterElsewhere, limits)}).`);
  }
  if (d.sunset) lines.push(`Sunset: ${d.sunset}.`);
  return lines.join('\n');
}

export function templateStory(d: DayPlan, activity: Activity): DayStory {
  const best = d.windows.find((w) => w.best);
  const word = ACTIVITY_WORD[activity];
  if (best) {
    const s = best.summary;
    const feels = s.feelsMin === s.feelsMax ? `${s.feelsMin}°C` : `${s.feelsMin}–${s.feelsMax}°C`;
    const air = s.pm25Max === null ? '' : `, PM2.5 up to ${s.pm25Max}`;
    const concern = best.limiting && best.limiting.penalty >= 5 ? ` Watch: ${best.limiting.label}.` : '';
    return {
      date: d.date,
      headline: `${d.label}: ${word} ${best.start}–${best.end}`,
      why: `Feels like ${feels}${air}, rain chance up to ${s.rainProbMax}%.${concern}`,
      idea: best.park
        ? `Head to ${best.park.name}, about ${best.park.walkMinutes} min on foot.`
        : `A ${best.minutes}-minute loop around your neighbourhood fits this window.`,
      source: 'template',
    };
  }
  if (d.freeLeftMinutes === 0) {
    return {
      date: d.date,
      headline: `${d.label}: your free hours are done`,
      why: d.free.length ? 'Nothing left to plan for this day.' : 'You have no free hours set for this day.',
      idea: 'Rest up and look at the next day below.',
      source: 'template',
    };
  }
  const miss = d.nearMisses[0];
  return {
    date: d.date,
    headline: `${d.label}: no good window in your free hours`,
    why: miss ? `${miss.start}–${miss.end}: ${miss.reason}.` : 'None of your free slots are long enough.',
    idea: d.betterElsewhere
      ? `If you can move things, ${d.betterElsewhere.start}–${d.betterElsewhere.end} looks much better.`
      : 'Stretch indoors today and check back tomorrow.',
    source: 'template',
  };
}

const SYSTEM = `You are Go Window, a warm, practical outdoor coach.
You get computed facts about ONE day and write a very short plan for it.
Rules:
- Use only times, numbers and place names that appear in the facts. Never invent a number.
- headline: at most 10 words. If there is a best window, include its start and end time.
- why: at most 30 words. Mention at least two of the actual conditions (feels-like, PM2.5, rain chance, UV).
  Describe air honestly relative to the user's limit: only call it clean if PM2.5 is well under half the limit.
- idea: at most 25 words. One concrete thing to do outside in that window that suits the activity:
  something to notice, a route, or someone to bring. Encourage leaving the phone in a pocket.
- The park time is how long it takes to reach the park, not how long to stay.
- If there is no best window, say so kindly, give the reason, and mention the better time outside the free hours if one is listed.
- No emojis, no markdown, do not tell the user to check an app or website.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    why: { type: 'string' },
    idea: { type: 'string' },
  },
  required: ['headline', 'why', 'idea'],
};

type GemmaDay = { headline: string; why: string; idea: string };

const factsKey = (facts: string) => createHash('sha1').update(facts).digest('hex').slice(0, 12);

async function narrateDay(
  d: DayPlan,
  activity: Activity,
  limits: Plan['limits'],
  model: string,
  rejected: string[],
): Promise<DayStory> {
  const facts = dayFacts(d, activity, limits);
  const allowed = allowedNumbers(facts);
  let retryNote = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await chatJson<GemmaDay>({
      model,
      system: SYSTEM,
      user: `Facts:\n${facts}${retryNote}`,
      schema: SCHEMA,
      temperature: attempt === 0 ? 0.4 : 0.1,
      timeoutMs: 90000,
    });
    const text = `${data.headline} ${data.why} ${data.idea}`;
    const bad = ungroundedNumbers(text, allowed);
    if (!bad.length && data.headline.trim() && data.why.trim()) {
      return {
        date: d.date,
        headline: data.headline.trim(),
        why: data.why.trim(),
        idea: data.idea.trim(),
        source: 'gemma',
        factsHash: factsKey(facts),
      };
    }
    rejected.push(...bad.map((b) => `${d.date}: ${b}`));
    retryNote = `\n\nYour previous answer used numbers that are not in the facts (${bad.join(', ')}). Use only numbers from the facts.`;
  }
  return { ...templateStory(d, activity), factsHash: factsKey(facts) };
}

/**
 * Narrates each day with the local model, one small call per day, and checks every number it
 * used against that day's facts. Days whose facts did not change reuse the previous story.
 * Days with nothing left to plan skip the model entirely.
 */
export async function narratePlan(plan: Plan, model: string, previous: Narrative | null = null): Promise<Narrative> {
  const started = Date.now();
  const rejected: string[] = [];
  const days: DayStory[] = [];
  for (const d of plan.days) {
    if (!d.windows.length && d.freeLeftMinutes === 0) {
      days.push(templateStory(d, plan.activity));
      continue;
    }
    const key = factsKey(dayFacts(d, plan.activity, plan.limits));
    const reuse =
      previous?.promptVersion === PROMPT_VERSION
        ? previous.days.find((s) => s.date === d.date && s.factsHash === key && s.source === 'gemma')
        : undefined;
    days.push(reuse ?? (await narrateDay(d, plan.activity, plan.limits, model, rejected)));
  }
  return {
    hash: plan.hash,
    promptVersion: PROMPT_VERSION,
    model,
    days,
    generatedAt: new Date().toISOString(),
    ms: Date.now() - started,
    rejected,
  };
}

export function templateNarrative(plan: Plan): Narrative {
  return {
    hash: plan.hash,
    promptVersion: PROMPT_VERSION,
    model: null,
    days: plan.days.map((d) => templateStory(d, plan.activity)),
    generatedAt: new Date().toISOString(),
    ms: 0,
    rejected: [],
  };
}
