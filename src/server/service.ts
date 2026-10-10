import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import type {
  Feeling,
  FeedbackEntry,
  GoWindow,
  LimitChange,
  Limits,
  Narrative,
  Park,
  Plan,
  Receipt,
  SkipReason,
} from '../shared/types.js';
import { addDays, datePart, nowInTimezone, toMinutes } from '../shared/time.js';
import { parseNote } from './ai/feedbackParse.js';
import { narratePlan, PROMPT_VERSION } from './ai/narrate.js';
import { ollamaHealth } from './ai/ollama.js';
import { applyFeedback } from './engine/learn.js';
import { effectiveLimits } from './engine/limits.js';
import { buildPlan, findWindow } from './engine/plan.js';
import { desiredNotifications, syncSchedule, type SyncResult } from './notify/scheduler.js';
import { coarse } from './sources/http.js';
import { getForecast, type Forecast } from './sources/openmeteo.js';
import { findParks } from './sources/parks.js';
import type { OfferedWindow, Store } from './store.js';

export class NotConfiguredError extends Error {}
export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

const PARKS_TTL_MS = 7 * 24 * 3600 * 1000;
const PARKS_RETRY_MS = 10 * 60 * 1000;

export interface FeedbackInput {
  windowId: string;
  went?: boolean | null;
  feelings?: Feeling[];
  skipReason?: SkipReason;
  note?: string;
  minutes?: number;
}

export class GoWindowService {
  private narrating: { hash: string; promise: Promise<Narrative> } | null = null;
  private parksInFlight: Promise<void> | null = null;
  private parksFailedAt = 0;
  private syncChain: Promise<unknown> = Promise.resolve();
  lastSync: { at: string; result: SyncResult } | null = null;

  constructor(
    readonly store: Store,
    readonly port: number,
  ) {}

  get settings() {
    return this.store.data.settings;
  }

  private parksKey(lat: number, lon: number) {
    return `${coarse(lat)},${coarse(lon)}`;
  }

  /** Returns cached parks and refreshes them in the background, so a slow Overpass never blocks the plan. */
  private cachedParks(lat: number, lon: number): Park[] | null {
    const key = this.parksKey(lat, lon);
    const hit = this.store.data.parks[key];
    const stale = !hit || Date.now() - hit.at > PARKS_TTL_MS;
    if (stale && !this.parksInFlight && Date.now() - this.parksFailedAt > PARKS_RETRY_MS) {
      this.parksInFlight = findParks(lat, lon)
        .then((parks) => this.store.update((d) => void (d.parks[key] = { at: Date.now(), parks })))
        .catch((err) => {
          this.parksFailedAt = Date.now();
          console.warn(`[parks] ${(err as Error).message}`);
        })
        .finally(() => (this.parksInFlight = null));
    }
    return hit?.parks ?? null;
  }

  async waitForParks(): Promise<void> {
    await this.parksInFlight;
  }

  async plan(force = false): Promise<{ plan: Plan; forecast: Forecast }> {
    const loc = this.settings.location;
    if (!loc) throw new NotConfiguredError('Set your location first');
    const forecast = await getForecast(loc.lat, loc.lon, force);
    const plan = buildPlan({
      settings: this.settings,
      forecast,
      parks: this.cachedParks(loc.lat, loc.lon),
      base: this.store.data.learning.base,
    });
    this.recordOffered(plan);
    return { plan, forecast };
  }

  private recordOffered(plan: Plan): void {
    const offered = this.store.data.offered;
    let changed = false;
    for (const day of plan.days) {
      for (const w of day.windows) {
        const prev = offered[w.id];
        // Keep the latest forecast for a window until it starts; after that, freeze what was offered.
        if (prev && (`${w.date}T${w.start}` <= plan.now || (prev.best === w.best && JSON.stringify(prev.summary) === JSON.stringify(w.summary)))) continue;
        offered[w.id] = { id: w.id, date: w.date, start: w.start, end: w.end, minutes: w.minutes, best: w.best, summary: w.summary };
        changed = true;
      }
    }
    const cutoff = addDays(datePart(plan.now), -14);
    for (const [id, w] of Object.entries(offered)) {
      if (w.date < cutoff) {
        delete offered[id];
        changed = true;
      }
    }
    if (changed) this.store.save();
  }

  cachedNarrative(plan: Plan): Narrative | null {
    const n = this.store.data.narrative;
    return n && n.hash === plan.hash && n.promptVersion === PROMPT_VERSION ? n : null;
  }

  isNarrating(hash: string): boolean {
    return this.narrating?.hash === hash;
  }

  narrate(plan: Plan): Promise<Narrative> {
    const cached = this.cachedNarrative(plan);
    if (cached) return Promise.resolve(cached);
    if (this.narrating?.hash === plan.hash) return this.narrating.promise;
    const promise = narratePlan(plan, this.settings.model, this.store.data.narrative)
      .then((n) => {
        this.store.update((d) => void (d.narrative = n));
        return n;
      })
      .finally(() => {
        if (this.narrating?.hash === plan.hash) this.narrating = null;
      });
    this.narrating = { hash: plan.hash, promise };
    return promise;
  }

  nowLocal(): string {
    const tz = this.settings.location?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return nowInTimezone(tz);
  }

  /** Offered windows that have started in the last 3 days and have no feedback yet. */
  pendingCheckins(): OfferedWindow[] {
    const now = this.nowLocal();
    const today = datePart(now);
    const nowMin = toMinutes(now.slice(11, 16));
    const answered = new Set(this.store.data.feedback.map((f) => f.windowId));
    return Object.values(this.store.data.offered)
      .filter((w) => w.best && !answered.has(w.id) && w.date >= addDays(today, -3))
      .filter((w) => w.date < today || (w.date === today && toMinutes(w.start) <= nowMin))
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 5);
  }

  async feedback(input: FeedbackInput): Promise<{ entry: FeedbackEntry; changes: LimitChange[]; limits: Limits }> {
    let w: OfferedWindow | GoWindow | null = this.store.data.offered[input.windowId] ?? null;
    if (!w && this.settings.location) w = findWindow((await this.plan()).plan, input.windowId);
    if (!w) throw new NotFoundError(`Unknown window ${input.windowId}`);
    if (`${w.date}T${w.start}` > this.nowLocal()) throw new BadRequestError('This window has not started yet. Check in after you go.');

    const feelings = new Set<Feeling>(input.feelings ?? []);
    let went = input.went ?? null;
    let skipReason = input.skipReason;
    let parsedBy: FeedbackEntry['parsedBy'] = 'buttons';
    const note = input.note?.trim() || undefined;
    if (note) {
      const parsed = await parseNote(note, this.settings.model);
      parsed.feelings.forEach((f) => feelings.add(f));
      if (went === null) went = parsed.went;
      if (!skipReason && parsed.skipReason) skipReason = parsed.skipReason;
      parsedBy = parsed.parsedBy;
    }
    if (went === null) went = true;
    if (!went) feelings.delete('great');

    const s = w.summary;
    const previous = this.store.data.feedback.find((f) => f.windowId === w.id);
    const entry: FeedbackEntry = {
      id: previous?.id ?? randomUUID(),
      windowId: w.id,
      date: w.date,
      start: w.start,
      end: w.end,
      went,
      minutes: went ? Math.min(600, Math.max(1, input.minutes ?? w.minutes)) : 0,
      feelings: [...new Set([...(previous?.went === went ? previous.feelings : []), ...feelings])],
      skipReason: went ? undefined : (skipReason ?? 'not_feeling_it'),
      note: [previous?.note, note].filter(Boolean).join(' / ') || undefined,
      parsedBy,
      conditions: {
        feels: s.feelsMax,
        feelsMin: s.feelsMin,
        pm25: s.pm25Max,
        humidity: s.humidityMax,
        uv: s.uvMax,
        rainProb: s.rainProbMax,
        gust: s.gustMax,
      },
      createdAt: new Date().toISOString(),
    };

    // Only learn from what is new, so tapping "great" and then adding a note does not double count.
    const already = new Set(previous?.went === went ? previous.feelings : []);
    const fresh = { ...entry, feelings: entry.feelings.filter((f) => !already.has(f)) };
    const { state, changes } = applyFeedback(this.store.data.learning, fresh, this.settings.activity, this.settings.sensitive);

    this.store.update((d) => {
      d.learning = state;
      d.feedback = [...d.feedback.filter((f) => f.windowId !== w.id), entry].slice(-500);
    });
    return { entry, changes, limits: effectiveLimits(state.base, this.settings.activity, this.settings.sensitive) };
  }

  receipt(): Receipt {
    const today = datePart(this.nowLocal());
    const from = addDays(today, -6);
    const inRange = (d: string) => d >= from && d <= today;
    const fb = this.store.data.feedback.filter((f) => inRange(f.date));
    const went = fb.filter((f) => f.went);
    const now = this.nowLocal();
    const offered = Object.values(this.store.data.offered).filter(
      (w) => w.best && inRange(w.date) && `${w.date}T${w.end}` <= now,
    );
    return {
      from,
      to: today,
      daysOutside: new Set(went.map((f) => f.date)).size,
      minutesOutside: went.reduce((s, f) => s + f.minutes, 0),
      windowsOffered: offered.length,
      windowsTaken: went.length,
      skipped: fb.length - went.length,
    };
  }

  async syncNotifications(): Promise<SyncResult> {
    // Saving settings and the background refresh can both trigger a sync; run them one at a time.
    const run = this.syncChain.then(() => this.doSync());
    this.syncChain = run.catch(() => undefined);
    return run;
  }

  private async doSync(): Promise<SyncResult> {
    const n = this.settings.notify;
    const nowS = Math.floor(Date.now() / 1000);
    let desired: ReturnType<typeof desiredNotifications> = [];
    if (n.enabled && this.settings.location) {
      const { plan, forecast } = await this.plan();
      desired = desiredNotifications(
        plan,
        this.cachedNarrative(plan),
        this.settings,
        this.store.data.accessKey,
        forecast.utcOffsetSeconds,
        nowS,
      );
    }
    const { scheduled, result } = await syncSchedule(desired, this.store.data.scheduled, n.server, n.topic, nowS);
    this.store.update((d) => void (d.scheduled = scheduled));
    this.lastSync = { at: new Date().toISOString(), result };
    return result;
  }

  async status() {
    return {
      ollama: await ollamaHealth(this.settings.model),
      model: this.settings.model,
      configured: !!this.settings.location,
      notify: { enabled: this.settings.notify.enabled, lastSync: this.lastSync, scheduled: Object.keys(this.store.data.scheduled).length },
      lanUrls: this.lanUrls(),
    };
  }

  lanUrls(): string[] {
    return Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => `http://${i!.address}:${this.port}`);
  }

  /** Background refresh: plan, warm the Gemma narration, keep phone notifications in sync. */
  async tick(): Promise<void> {
    if (!this.settings.location) return;
    const { plan } = await this.plan();
    const health = await ollamaHealth(this.settings.model);
    if (health.hasModel) await this.narrate(plan).catch((e) => console.warn(`[gemma] ${(e as Error).message}`));
    if (this.settings.notify.enabled) {
      const r = await this.syncNotifications();
      if (r.published.length || r.cancelled.length || r.errors.length) console.log('[notify]', r);
    }
  }
}
