const USER_AGENT = 'go-window/0.1 (+https://github.com/MasterFloppa/Go-Window)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(
  url: string,
  init: { method?: string; body?: BodyInit; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    });
  } catch (err) {
    throw new HttpError(`${new URL(url).host}: ${(err as Error).message}`, null);
  }
  if (!res.ok) {
    throw new HttpError(`${new URL(url).host} responded ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** Rounds coordinates to ~1 km so precise location never leaves the machine. */
export function coarse(value: number): number {
  return Math.round(value * 100) / 100;
}
