import type { Activity, DayPlan, DayStory, GoWindow, Narrative, Plan } from '../../shared/types.js';
import { allowedNumbers, ungroundedNumbers } from './grounding.js';
import { chatJson } from './ollama.js';

export const ACTIVITY_WORD: Record<Activity, string> = { walk: 'walk', run: 'run', cycle: 'ride', kids: 'outdoor play' };

function windowFacts(w: GoWindow) {
  const s = w.summary;
  return {
    start: w.start,
    end: w.end,
    minutes: w.minutes,
    score_out_of_100: w.score,
    feels_like_c: s.feelsMin === s.feelsMax ? `${s.feelsMin}` : `${s.feelsMin} to ${s.feelsMax}`,
    pm25_max: s.pm25Max,
    rain_chance_max_pct: s.rainProbMax,
    uv_max: s.uvMax,
    humidity_max_pct: s.humidityMax,
    main_concern: w.limiting && w.limiting.penalty >= 5 ? w.limiting.label : 'none',
    park: w.park ? { name: w.park.name, walk_minutes: w.park.walkMinutes } : null,
  };
}

export function dayFacts(d: DayPlan) {
  const best = d.windows.find((w) => w.best) ?? null;
  return {
    date: d.date,
    day: d.label,
    free_hours: d.free.map((r) => `${r.start}-${r.end}`),
    best_window: best ? windowFacts(best) : null,
    other_windows: d.windows.filter((w) => !w.best).map((w) => `${w.start}-${w.end}`),
    missed_free_slots: d.nearMisses.map((m) => `${m.start}-${m.end}: ${m.reason}`),
    better_time_outside_free_hours: d.betterElsewhere
      ? `${d.betterElsewhere.start}-${d.betterElsewhere.end} (score ${d.betterElsewhere.score})`
      : null,
    sunset: d.sunset,
  };
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
You receive computed facts about the user's next days and write a very short plan for each day.
Rules:
- Use ONLY the times, numbers and place names present in the facts. Never add a new number.
- If best_window is null, say kindly there is no good window in their free hours, give the missed slot reason,
  and mention better_time_outside_free_hours if present.
- headline: at most 10 words and must include the best window's start and end time when there is one.
- why: at most 30 words; explain the conditions that make this the best time.
- idea: at most 25 words; one concrete thing to do outside during the window (something to notice, a route, someone to bring).
  Suit it to the activity. Encourage leaving the phone in a pocket.
- No emojis. No markdown. Do not tell the user to check an app or website.`;

const SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          headline: { type: 'string' },
          why: { type: 'string' },
          idea: { type: 'string' },
        },
        required: ['date', 'headline', 'why', 'idea'],
      },
    },
  },
  required: ['days'],
};

type GemmaDays = { days: { date: string; headline: string; why: string; idea: string }[] };

/**
 * Asks the local model to narrate the plan, then checks every number it used against the facts.
 * Any day that fails twice falls back to the deterministic template.
 */
export async function narratePlan(plan: Plan, model: string): Promise<Narrative> {
  const started = Date.now();
  const facts = { activity: ACTIVITY_WORD[plan.activity], timezone: plan.location.timezone, days: plan.days.map(dayFacts) };
  const allowed = allowedNumbers(facts);
  const stories = new Map<string, DayStory>();
  const rejected: string[] = [];
  let feedback = '';

  for (let attempt = 0; attempt < 2 && stories.size < plan.days.length; attempt++) {
    const { data } = await chatJson<GemmaDays>({
      model,
      system: SYSTEM,
      user: `Facts:\n${JSON.stringify(facts, null, 1)}${feedback}`,
      schema: SCHEMA,
      temperature: attempt === 0 ? 0.4 : 0.1,
    });
    const problems: string[] = [];
    data.days.forEach((g, i) => {
      const day = plan.days.find((d) => d.date === g.date) ?? plan.days[i];
      if (!day || stories.has(day.date)) return;
      const bad = ungroundedNumbers(`${g.headline} ${g.why} ${g.idea}`, allowed);
      if (bad.length) {
        rejected.push(...bad.map((b) => `${day.date}: ${b}`));
        problems.push(`${day.date} used numbers not in the facts: ${bad.join(', ')}`);
        return;
      }
      stories.set(day.date, { date: day.date, headline: g.headline.trim(), why: g.why.trim(), idea: g.idea.trim(), source: 'gemma' });
    });
    feedback = problems.length ? `\n\nYour previous answer was rejected: ${problems.join('; ')}. Only use numbers from the facts.` : '';
  }

  return {
    hash: plan.hash,
    model,
    days: plan.days.map((d) => stories.get(d.date) ?? templateStory(d, plan.activity)),
    generatedAt: new Date().toISOString(),
    ms: Date.now() - started,
    rejected,
  };
}

export function templateNarrative(plan: Plan): Narrative {
  return {
    hash: plan.hash,
    model: null,
    days: plan.days.map((d) => templateStory(d, plan.activity)),
    generatedAt: new Date().toISOString(),
    ms: 0,
    rejected: [],
  };
}
