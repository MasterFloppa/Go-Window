import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import QRCode from 'qrcode';
import { z } from 'zod';
import { FEELINGS, SKIP_REASONS, type LimitKey, type Settings, type TimeRange } from '../shared/types.js';
import { fromMinutes, toMinutes } from '../shared/time.js';
import { templateNarrative } from './ai/narrate.js';
import { initialLearning, setLimitManually } from './engine/learn.js';
import { adjustments, DEFAULT_LIMITS, effectiveLimits, LIMIT_BOUNDS, LIMIT_LABELS, MIN_MINUTES } from './engine/limits.js';
import { ntfyPublish, subscribeUrl } from './notify/ntfy.js';
import { BadRequestError, NotConfiguredError, NotFoundError, SupersededError, type GoWindowService } from './service.js';
import { coarse } from './sources/http.js';
import { geocode, reverseTimezone } from './sources/openmeteo.js';

const hhmm = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'use HH:MM');
const range = z
  .object({ start: hhmm, end: hhmm })
  .refine((r) => toMinutes(r.end) > toMinutes(r.start), 'end must be after start');
const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const settingsSchema = z.object({
  location: z
    .object({
      name: z.string().min(1).max(120),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      timezone: z.string().refine(validTz, 'unknown timezone'),
    })
    .nullable(),
  activity: z.enum(['walk', 'run', 'cycle', 'kids']),
  sensitive: z.boolean(),
  darkOk: z.boolean(),
  minMinutes: z.number().int().min(10).max(240).nullable(),
  tolerance: z.enum(['strict', 'balanced', 'relaxed']),
  freeHours: z.array(z.array(range).max(8)).length(7),
  notify: z.object({
    enabled: z.boolean(),
    server: z.string().regex(/^https?:\/\/[^\s]+$/, 'must be an http(s) URL'),
    topic: z.string().regex(/^[-_A-Za-z0-9]{8,64}$/, '8-64 letters, digits, - or _'),
    digestTime: hhmm,
    leadMinutes: z.number().int().min(0).max(60),
    checkin: z.boolean(),
    publicUrl: z.union([z.literal(''), z.string().regex(/^https?:\/\/[^\s]+$/, 'must be an http(s) URL')]),
  }),
  model: z.string().min(1).max(80),
});

const feedbackSchema = z.object({
  windowId: z.string().min(1).max(64),
  went: z.boolean().nullable().optional(),
  feelings: z.array(z.enum(FEELINGS as [string, ...string[]])).max(8).optional(),
  skipReason: z.enum(SKIP_REASONS as [string, ...string[]]).optional(),
  note: z.string().max(600).optional(),
  minutes: z.number().int().min(1).max(600).optional(),
});

/** Sorts and merges overlapping free ranges so the planner sees a clean day. */
function normalizeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.map((r) => [toMinutes(r.start), toMinutes(r.end)]).sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out.map(([s, e]) => ({ start: fromMinutes(s), end: fromMinutes(e) }));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function createApp(service: GoWindowService): Hono {
  const app = new Hono();
  const store = service.store;

  // Loopback is trusted. Anything else (your phone over Wi-Fi) must present the access key.
  app.use('/api/*', async (c, next) => {
    const addr = getConnInfo(c).remote.address ?? '';
    const key = c.req.header('x-go-window-key') ?? c.req.query('k');
    if (!LOOPBACK.has(addr) && key !== store.data.accessKey) return c.json({ error: 'access key required' }, 401);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof NotConfiguredError) return c.json({ error: err.message, code: 'location_required' }, 409);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof BadRequestError) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: err.message }, 500);
  });

  const bad = (c: Context, issues: z.ZodError) =>
    c.json({ error: issues.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);

  app.get('/api/status', async (c) => c.json(await service.status()));

  app.get('/api/geocode', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json([]);
    return c.json(await geocode(q.slice(0, 80)));
  });

  app.post('/api/locate', async (c) => {
    const body = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).safeParse(await c.req.json());
    if (!body.success) return bad(c, body.error);
    const lat = coarse(body.data.lat);
    const lon = coarse(body.data.lon);
    return c.json({ name: `Near ${lat}, ${lon}`, lat, lon, timezone: await reverseTimezone(lat, lon) });
  });

  app.get('/api/settings', (c) =>
    c.json({ settings: store.data.settings, minMinutes: MIN_MINUTES, subscribeUrl: subscribeUrl(store.data.settings.notify.server, store.data.settings.notify.topic) }),
  );

  app.put('/api/settings', async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json());
    if (!parsed.success) return bad(c, parsed.error);
    const s = parsed.data as Settings;
    if (s.location) s.location = { ...s.location, lat: coarse(s.location.lat), lon: coarse(s.location.lon) };
    s.freeHours = s.freeHours.map(normalizeRanges);
    store.update((d) => void (d.settings = s));
    service.syncNotifications().catch((e) => console.warn(`[notify] ${(e as Error).message}`));
    return c.json({ settings: store.data.settings });
  });

  app.get('/api/plan', async (c) => {
    const { plan } = await service.plan(c.req.query('force') === '1');
    const narrative = service.cachedNarrative(plan);
    return c.json({
      plan,
      narrative: narrative ?? templateNarrative(plan),
      narrativePending: !narrative,
      narrating: service.isNarrating(plan.hash),
    });
  });

  app.post('/api/narrate', async (c) => {
    const { plan } = await service.plan();
    try {
      return c.json({ narrative: await service.narrate(plan), narrativePending: false });
    } catch (err) {
      // A newer plan is being narrated instead; not an error, the client will pick up the newer one.
      if (err instanceof SupersededError) return c.json({ narrative: templateNarrative(plan), narrativePending: true }, 202);
      return c.json({ narrative: templateNarrative(plan), narrativePending: false, error: `Gemma unavailable: ${(err as Error).message}` }, 503);
    }
  });

  app.get('/api/checkins', (c) => c.json(service.pendingCheckins()));

  app.get('/api/feedback', (c) => c.json(store.data.feedback.slice(-30).reverse()));

  app.post('/api/feedback', async (c) => {
    const parsed = feedbackSchema.safeParse(await c.req.json());
    if (!parsed.success) return bad(c, parsed.error);
    const result = await service.feedback(parsed.data as Parameters<GoWindowService['feedback']>[0]);
    service.syncNotifications().catch(() => undefined);
    return c.json(result);
  });

  const limitsView = () => {
    const { activity, sensitive } = store.data.settings;
    return {
      base: store.data.learning.base,
      effective: effectiveLimits(store.data.learning.base, activity, sensitive),
      adjustments: adjustments(activity, sensitive),
      defaults: DEFAULT_LIMITS,
      bounds: LIMIT_BOUNDS,
      labels: LIMIT_LABELS,
      log: store.data.learning.log.slice(-40).reverse(),
    };
  };

  app.get('/api/limits', (c) => c.json(limitsView()));

  app.put('/api/limits', async (c) => {
    const parsed = z
      .object({ key: z.enum(Object.keys(DEFAULT_LIMITS) as [LimitKey, ...LimitKey[]]), value: z.number() })
      .safeParse(await c.req.json());
    if (!parsed.success) return bad(c, parsed.error);
    store.update((d) => void (d.learning = setLimitManually(d.learning, parsed.data.key, parsed.data.value)));
    return c.json(limitsView());
  });

  app.post('/api/limits/reset', (c) => {
    store.update((d) => {
      const fresh = initialLearning();
      d.learning = {
        base: fresh.base,
        log: [
          ...d.learning.log,
          { at: new Date().toISOString(), key: 'maxFeels', from: d.learning.base.maxFeels, to: fresh.base.maxFeels, reason: 'All limits reset to defaults by you', feedbackId: null },
        ],
      };
    });
    return c.json(limitsView());
  });

  app.get('/api/receipt', (c) => c.json(service.receipt()));

  app.post('/api/notify/test', async (c) => {
    const n = store.data.settings.notify;
    await ntfyPublish(n.server, n.topic, {
      title: 'Go Window is connected',
      message: 'You will get a morning digest, a nudge when your window opens, and a one-tap check-in afterwards.',
      tags: ['herb'],
      priority: 3,
    });
    return c.json({ ok: true });
  });

  app.post('/api/notify/sync', async (c) => {
    const result = await service.syncNotifications();
    return c.json({ ...result, scheduled: Object.keys(store.data.scheduled).length });
  });

  app.get('/api/notify/qr', async (c) => {
    const n = store.data.settings.notify;
    const url = subscribeUrl(n.server, n.topic);
    return c.json({ url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, width: 180 }) });
  });

  app.get('/api/access', (c) => c.json({ key: store.data.accessKey, lanUrls: service.lanUrls() }));

  return app;
}
