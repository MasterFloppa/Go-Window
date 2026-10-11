export type Activity = 'walk' | 'run' | 'cycle' | 'kids';

/** Local wall-clock range, "HH:MM". `end` may be "24:00". */
export interface TimeRange {
  start: string;
  end: string;
}

export interface Location {
  name: string;
  lat: number;
  lon: number;
  timezone: string;
}

/** Personal comfort limits. Crossing any of them blocks an hour. */
export interface Limits {
  minFeels: number;
  maxFeels: number;
  pm25: number;
  rainProb: number;
  uv: number;
  humidity: number;
  gust: number;
}

export type LimitKey = keyof Limits;

export interface NotifySettings {
  enabled: boolean;
  server: string;
  topic: string;
  digestTime: string;
  leadMinutes: number;
  checkin: boolean;
  /** Base URL the phone can reach (for check-in links), e.g. http://192.168.1.20:8787 */
  publicUrl: string;
}

export interface Settings {
  location: Location | null;
  activity: Activity;
  sensitive: boolean;
  darkOk: boolean;
  /** Shortest window worth suggesting, in minutes; null uses the activity default. */
  minMinutes: number | null;
  /** Index 0 = Sunday ... 6 = Saturday. */
  freeHours: TimeRange[][];
  notify: NotifySettings;
  model: string;
}

export interface HourConditions {
  /** Local time "YYYY-MM-DDTHH:00" in the location's timezone. */
  time: string;
  temp: number;
  feels: number;
  humidity: number;
  rainProb: number;
  precip: number;
  weatherCode: number;
  uv: number;
  wind: number;
  gust: number;
  isDay: boolean;
  pm25: number | null;
  pm10: number | null;
  usAqi: number | null;
}

export type FactorKey = 'storm' | 'rain' | 'air' | 'heat' | 'cold' | 'humidity' | 'uv' | 'wind' | 'dark';
export type FactorLevel = 'ok' | 'meh' | 'bad';

export interface Factor {
  key: FactorKey;
  level: FactorLevel;
  penalty: number;
  value: number;
  limit: number;
  label: string;
}

export interface HourScore {
  time: string;
  score: number;
  blocked: boolean;
  limiting: Factor | null;
  factors: Factor[];
  conditions: HourConditions;
}

export interface Park {
  name: string;
  kind: string;
  lat: number;
  lon: number;
  distanceKm: number;
  walkMinutes: number;
  /** Approximate size from the OpenStreetMap bounding box; null when unknown. */
  areaM2?: number | null;
}

export interface WindowSummary {
  feelsMin: number;
  feelsMax: number;
  pm25Max: number | null;
  rainProbMax: number;
  uvMax: number;
  humidityMax: number;
  gustMax: number;
}

export interface GoWindow {
  id: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  score: number;
  limiting: Factor | null;
  summary: WindowSummary;
  park: Park | null;
  best: boolean;
  inFreeHours: boolean;
}

export interface NearMiss {
  date: string;
  start: string;
  end: string;
  factor: FactorKey | 'short';
  reason: string;
}

export interface DayPlan {
  date: string;
  weekday: string;
  label: string;
  free: TimeRange[];
  hours: HourScore[];
  windows: GoWindow[];
  nearMisses: NearMiss[];
  /** A clearly better slot outside the free hours, if one exists. */
  betterElsewhere: GoWindow | null;
  /** Free minutes still ahead on this day (0 once today's free hours have passed). */
  freeLeftMinutes: number;
  sunrise: string | null;
  sunset: string | null;
}

export interface Plan {
  generatedAt: string;
  now: string;
  location: Location;
  activity: Activity;
  limits: Limits;
  minMinutes: number;
  days: DayPlan[];
  parksAvailable: boolean;
  airAvailable: boolean;
  hash: string;
}

export interface DayStory {
  date: string;
  headline: string;
  why: string;
  idea: string;
  source: 'gemma' | 'template';
  /** Fingerprint of the facts this story was written from, so unchanged days are not regenerated. */
  factsHash?: string;
}

export interface Narrative {
  hash: string;
  /** Bumped when the prompt changes so stale stories are regenerated. */
  promptVersion: number;
  model: string | null;
  days: DayStory[];
  generatedAt: string;
  ms: number;
  /** Numbers Gemma used that were not in the facts; those lines were replaced. */
  rejected: string[];
}

export type Feeling = 'great' | 'too_hot' | 'too_cold' | 'air_bad' | 'too_humid' | 'too_sunny' | 'rain' | 'windy';
export type SkipReason = 'busy' | 'weather' | 'not_feeling_it';

export const FEELINGS: Feeling[] = ['great', 'too_hot', 'too_cold', 'air_bad', 'too_humid', 'too_sunny', 'rain', 'windy'];
export const SKIP_REASONS: SkipReason[] = ['busy', 'weather', 'not_feeling_it'];

export interface ConditionSnapshot {
  feels: number;
  feelsMin?: number;
  pm25: number | null;
  humidity: number;
  uv: number;
  rainProb: number;
  gust: number;
}

export interface FeedbackEntry {
  id: string;
  windowId: string;
  date: string;
  start: string;
  end: string;
  went: boolean;
  minutes: number;
  feelings: Feeling[];
  skipReason?: SkipReason;
  note?: string;
  parsedBy: 'buttons' | 'gemma' | 'keywords';
  conditions: ConditionSnapshot;
  createdAt: string;
}

export interface LimitChange {
  at: string;
  key: LimitKey;
  from: number;
  to: number;
  reason: string;
  feedbackId: string | null;
}

export interface LearningState {
  /** Learned personal limits before activity / sensitivity adjustments. */
  base: Limits;
  log: LimitChange[];
}

export interface Receipt {
  from: string;
  to: string;
  daysOutside: number;
  minutesOutside: number;
  windowsOffered: number;
  windowsTaken: number;
  skipped: number;
}
