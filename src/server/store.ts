import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  FeedbackEntry,
  GoWindow,
  LearningState,
  Narrative,
  Park,
  Settings,
  TimeRange,
} from '../shared/types.js';
import { initialLearning } from './engine/learn.js';

export interface OfferedWindow {
  id: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  best: boolean;
  summary: GoWindow['summary'];
}

export interface StoreData {
  version: 1;
  settings: Settings;
  learning: LearningState;
  feedback: FeedbackEntry[];
  offered: Record<string, OfferedWindow>;
  scheduled: Record<string, { at: number; hash: string }>;
  narrative: Narrative | null;
  parks: Record<string, { at: number; parks: Park[] }>;
  accessKey: string;
}

const weekday: TimeRange[] = [
  { start: '07:00', end: '08:30' },
  { start: '18:00', end: '20:00' },
];
const weekend: TimeRange[] = [
  { start: '07:00', end: '10:00' },
  { start: '16:30', end: '19:00' },
];

export function defaultSettings(): Settings {
  return {
    location: null,
    activity: 'walk',
    sensitive: false,
    darkOk: true,
    minMinutes: null,
    freeHours: [weekend, weekday, weekday, weekday, weekday, weekday, weekend].map((d) => d.map((r) => ({ ...r }))),
    notify: {
      enabled: false,
      server: 'https://ntfy.sh',
      topic: `go-window-${randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`,
      digestTime: '07:00',
      leadMinutes: 10,
      checkin: true,
      publicUrl: '',
    },
    model: process.env.GO_WINDOW_MODEL ?? 'gemma3:4b',
  };
}

function defaults(): StoreData {
  return {
    version: 1,
    settings: defaultSettings(),
    learning: initialLearning(),
    feedback: [],
    offered: {},
    scheduled: {},
    narrative: null,
    parks: {},
    accessKey: randomBytes(12).toString('base64url'),
  };
}

/** A tiny JSON file store. Everything stays on this machine. */
export class Store {
  data: StoreData;

  constructor(private readonly path: string) {
    this.data = this.load();
    this.save();
  }

  private load(): StoreData {
    const base = defaults();
    if (!existsSync(this.path)) return base;
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<StoreData>;
      return {
        ...base,
        ...raw,
        settings: { ...base.settings, ...raw.settings, notify: { ...base.settings.notify, ...raw.settings?.notify } },
        learning: { ...base.learning, ...raw.learning, base: { ...base.learning.base, ...raw.learning?.base } },
      };
    } catch (err) {
      console.warn(`Could not read ${this.path}, starting fresh: ${(err as Error).message}`);
      return base;
    }
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  update(fn: (d: StoreData) => void): void {
    fn(this.data);
    this.save();
  }
}
