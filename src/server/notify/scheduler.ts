import { createHash } from 'node:crypto';
import type { DayPlan, GoWindow, Narrative, Plan, Settings } from '../../shared/types.js';
import { localToEpochSeconds, toMinutes } from '../../shared/time.js';
import { ACTIVITY_WORD } from '../ai/narrate.js';
import { ntfyCancel, ntfyPublish, type NtfyMessage } from './ntfy.js';

/** ntfy.sh holds scheduled messages for up to 3 days. */
const MAX_AHEAD_S = 3 * 24 * 3600 - 3600;
const MIN_AHEAD_S = 30;

export interface Desired {
  seq: string;
  msg: NtfyMessage;
}

export interface SyncResult {
  published: string[];
  cancelled: string[];
  errors: string[];
}

function epochAt(date: string, hhmm: string, offset: number): number {
  return localToEpochSeconds(`${date}T00:00`, offset) + toMinutes(hhmm) * 60;
}

function conditionsLine(w: GoWindow): string {
  const s = w.summary;
  const feels = s.feelsMin === s.feelsMax ? `${s.feelsMin}°C` : `${s.feelsMin}–${s.feelsMax}°C`;
  const air = s.pm25Max === null ? '' : ` · PM2.5 ${s.pm25Max}`;
  return `Feels ${feels}${air} · rain ${s.rainProbMax}%`;
}

function link(settings: Settings, accessKey: string, params: Record<string, string> = {}): string | undefined {
  const base = settings.notify.publicUrl.trim().replace(/\/$/, '');
  if (!base) return undefined;
  const q = new URLSearchParams({ ...params, k: accessKey });
  return `${base}/?${q.toString()}`;
}

function digest(day: DayPlan, story: string | null, settings: Settings, accessKey: string): NtfyMessage {
  const best = day.windows.find((w) => w.best);
  const lines: string[] = [];
  if (story) lines.push(story);
  if (best) {
    lines.push(`${best.fallback ? 'Best available' : 'Best'}: ${best.start}–${best.end} (${best.minutes} min). ${conditionsLine(best)}`);
    if (best.fallback && best.overLimits?.length) lines.push(`Over your limits: ${best.overLimits.join('; ')}.`);
    if (best.park) lines.push(`Nearby: ${best.park.name}, ${best.park.walkMinutes} min on foot.`);
  } else {
    const miss = day.nearMisses[0];
    lines.push(miss ? `No good window in your free hours. ${miss.start}–${miss.end}: ${miss.reason}.` : 'No good window in your free hours.');
  }
  if (day.betterElsewhere) lines.push(`Better if you can move things: ${day.betterElsewhere.start}–${day.betterElsewhere.end}.`);
  return {
    title: `Go Window: ${day.weekday}`,
    message: lines.join('\n'),
    tags: [best ? 'sunrise' : 'cloud'],
    priority: 2,
    click: link(settings, accessKey),
  };
}

export function desiredNotifications(
  plan: Plan,
  narrative: Narrative | null,
  settings: Settings,
  accessKey: string,
  utcOffsetSeconds: number,
  nowS: number,
): Desired[] {
  const n = settings.notify;
  const out: Desired[] = [];
  const word = ACTIVITY_WORD[plan.activity];
  const ok = (at: number) => at - nowS >= MIN_AHEAD_S && at - nowS <= MAX_AHEAD_S;

  for (const day of plan.days) {
    const ymd = day.date.replace(/-/g, '');
    const story = narrative?.hash === plan.hash ? narrative.days.find((s) => s.date === day.date)?.headline ?? null : null;

    const digestAt = epochAt(day.date, n.digestTime, utcOffsetSeconds);
    if (ok(digestAt)) out.push({ seq: `gw-digest-${ymd}`, msg: { ...digest(day, story, settings, accessKey), at: digestAt } });

    const best = day.windows.find((w) => w.best);
    if (!best) continue;
    const hhmm = best.start.replace(':', '');
    const goAt = epochAt(day.date, best.start, utcOffsetSeconds) - n.leadMinutes * 60;
    if (ok(goAt)) {
      out.push({
        seq: `gw-go-${ymd}-${hhmm}`,
        msg: {
          title: `${best.fallback ? 'Best available' : 'Go outside'}: ${best.start}-${best.end}`,
          message: [
            `Your ${best.minutes}-minute ${word} window opens at ${best.start}.`,
            best.fallback && best.overLimits?.length ? `Over your limits: ${best.overLimits.join('; ')}. Keep it gentle.` : '',
            conditionsLine(best),
            best.park ? `Try ${best.park.name}, ${best.park.walkMinutes} min on foot.` : '',
            'Phone in your pocket.',
          ]
            .filter(Boolean)
            .join('\n'),
          tags: ['herb'],
          priority: 4,
          click: link(settings, accessKey),
          at: goAt,
        },
      });
    }

    const checkAt = epochAt(day.date, best.end, utcOffsetSeconds) + 10 * 60;
    if (n.checkin && ok(checkAt)) {
      const params = (r: string) => link(settings, accessKey, { checkin: best.id, r });
      const actions = params('great')
        ? [
            { label: 'Went - great', url: params('great')! },
            { label: 'Went - tell more', url: params('went')! },
            { label: 'Skipped', url: params('skipped')! },
          ]
        : undefined;
      out.push({
        seq: `gw-chk-${ymd}-${hhmm}`,
        msg: {
          title: `How was your ${word}?`,
          message: `${best.start}–${best.end}. One tap teaches Go Window your limits.`,
          tags: ['memo'],
          priority: 3,
          click: params('went'),
          actions,
          at: checkAt,
        },
      });
    }
  }
  return out;
}

const hashOf = (msg: NtfyMessage) => createHash('sha1').update(JSON.stringify(msg)).digest('hex').slice(0, 12);

/**
 * Makes ntfy's scheduled queue match the current plan: publish new or changed messages
 * (same sequence id replaces), cancel ones whose window disappeared.
 */
export async function syncSchedule(
  desired: Desired[],
  scheduled: Record<string, { at: number; hash: string }>,
  server: string,
  topic: string,
  nowS: number,
): Promise<{ scheduled: Record<string, { at: number; hash: string }>; result: SyncResult }> {
  const next: Record<string, { at: number; hash: string }> = {};
  const result: SyncResult = { published: [], cancelled: [], errors: [] };
  const wanted = new Set(desired.map((d) => d.seq));

  for (const d of desired) {
    const hash = hashOf(d.msg);
    const prev = scheduled[d.seq];
    if (prev && prev.hash === hash) {
      next[d.seq] = prev;
      continue;
    }
    try {
      await ntfyPublish(server, topic, d.msg, d.seq);
      next[d.seq] = { at: d.msg.at ?? nowS, hash };
      result.published.push(d.seq);
    } catch (err) {
      result.errors.push(`${d.seq}: ${(err as Error).message}`);
      if (prev) next[d.seq] = prev;
    }
  }

  for (const [seq, entry] of Object.entries(scheduled)) {
    if (wanted.has(seq) || entry.at <= nowS) continue;
    try {
      await ntfyCancel(server, topic, seq);
      result.cancelled.push(seq);
    } catch (err) {
      result.errors.push(`${seq}: ${(err as Error).message}`);
      next[seq] = entry;
    }
  }
  return { scheduled: next, result };
}
