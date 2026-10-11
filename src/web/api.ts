import type {
  Activity,
  FeedbackEntry,
  Feeling,
  LimitChange,
  LimitKey,
  Limits,
  Location,
  Narrative,
  Plan,
  Receipt,
  Settings,
  SkipReason,
  WindowSummary,
} from '../shared/types';

const KEY_STORAGE = 'go-window-key';

// A phone opening a notification link carries ?k=<access key>; remember it for later requests.
const initialParams = new URLSearchParams(window.location.search);
const urlKey = initialParams.get('k');
if (urlKey) localStorage.setItem(KEY_STORAGE, urlKey);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-go-window-key': localStorage.getItem(KEY_STORAGE) ?? '',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(json?.error ?? `Request failed (${res.status})`, res.status, json?.code, json);
  return json as T;
}

export interface Status {
  ollama: { up: boolean; models: string[]; hasModel: boolean; error?: string };
  model: string;
  configured: boolean;
  notify: { enabled: boolean; scheduled: number; lastSync: { at: string; result: { published: string[]; cancelled: string[]; errors: string[] } } | null };
  lanUrls: string[];
}

export interface PlanResponse {
  plan: Plan;
  narrative: Narrative;
  narrativePending: boolean;
  narrating: boolean;
}

export interface SettingsResponse {
  settings: Settings;
  minMinutes: Record<Activity, number>;
  subscribeUrl: string;
}

export interface LimitsView {
  base: Limits;
  effective: Limits;
  adjustments: Limits;
  defaults: Limits;
  bounds: Record<LimitKey, [number, number]>;
  labels: Record<LimitKey, { label: string; unit: string }>;
  log: LimitChange[];
}

export interface Checkin {
  id: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  best: boolean;
  summary: WindowSummary;
}

export interface FeedbackResult {
  entry: FeedbackEntry;
  changes: LimitChange[];
  limits: Limits;
}

export interface FeedbackBody {
  windowId: string;
  went?: boolean | null;
  feelings?: Feeling[];
  skipReason?: SkipReason;
  note?: string;
  minutes?: number;
}

export const client = {
  status: () => api<Status>('/api/status'),
  settings: () => api<SettingsResponse>('/api/settings'),
  saveSettings: (s: Settings) => api<{ settings: Settings }>('/api/settings', { method: 'PUT', body: s }),
  geocode: (q: string) => api<Location[]>(`/api/geocode?q=${encodeURIComponent(q)}`),
  locate: (lat: number, lon: number) => api<Location>('/api/locate', { method: 'POST', body: { lat, lon } }),
  plan: (force = false) => api<PlanResponse>(`/api/plan${force ? '?force=1' : ''}`),
  narrate: () => api<{ narrative: Narrative; error?: string }>('/api/narrate', { method: 'POST' }),
  checkins: () => api<Checkin[]>('/api/checkins'),
  feedback: (body: FeedbackBody) => api<FeedbackResult>('/api/feedback', { method: 'POST', body }),
  history: () => api<FeedbackEntry[]>('/api/feedback'),
  limits: () => api<LimitsView>('/api/limits'),
  setLimit: (key: LimitKey, value: number) => api<LimitsView>('/api/limits', { method: 'PUT', body: { key, value } }),
  resetLimits: () => api<LimitsView>('/api/limits/reset', { method: 'POST' }),
  receipt: () => api<Receipt>('/api/receipt'),
  testNotify: () => api<{ ok: boolean }>('/api/notify/test', { method: 'POST' }),
  syncNotify: () =>
    api<{ published: string[]; cancelled: string[]; errors: string[]; scheduled: number }>('/api/notify/sync', { method: 'POST' }),
  qr: () => api<{ url: string; svg: string }>('/api/notify/qr'),
  access: () => api<{ key: string; lanUrls: string[] }>('/api/access'),
};

/** Query parameters from a notification check-in link, read once at startup. */
export const launchCheckin = (() => {
  const id = initialParams.get('checkin');
  const r = initialParams.get('r');
  if (initialParams.has('k') || id) {
    const clean = new URL(window.location.href);
    ['k', 'checkin', 'r'].forEach((p) => clean.searchParams.delete(p));
    window.history.replaceState(null, '', clean.toString());
  }
  return id ? { id, response: (r ?? 'went') as 'great' | 'went' | 'skipped' } : null;
})();
