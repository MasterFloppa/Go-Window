const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, '');

export interface OllamaHealth {
  up: boolean;
  models: string[];
  hasModel: boolean;
  error?: string;
}

export async function ollamaHealth(model: string): Promise<OllamaHealth> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json()) as { models: { name: string }[] };
    const models = json.models.map((m) => m.name);
    return { up: true, models, hasModel: models.includes(model) };
  } catch (err) {
    return { up: false, models: [], hasModel: false, error: (err as Error).message };
  }
}

/**
 * Calls a local model with a JSON schema so the reply is machine-checkable.
 * Low temperature keeps the narration close to the facts we pass in.
 */
export async function chatJson<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: object;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ data: T; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      stream: false,
      keep_alive: '30m',
      format: opts.schema,
      // A hard cap on output: small models can occasionally loop in JSON mode and never stop.
      options: { temperature: opts.temperature ?? 0.3, num_predict: opts.maxTokens ?? 320, repeat_penalty: 1.15 },
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
  });
  if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { message: { content: string } };
  return { data: JSON.parse(json.message.content) as T, ms: Date.now() - started };
}
