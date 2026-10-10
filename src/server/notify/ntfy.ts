/**
 * ntfy (https://ntfy.sh) is an open-source push service: the phone app subscribes to a topic,
 * we publish to it. Scheduled messages are held by the ntfy server, so alerts still arrive
 * if this laptop is asleep. Publishing again with the same sequence id replaces a scheduled message.
 */
export interface NtfyMessage {
  title: string;
  message: string;
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string;
  actions?: { label: string; url: string }[];
  /** Unix seconds; omit to deliver now. */
  at?: number;
}

/** Header values must be plain ASCII. */
function ascii(s: string): string {
  return s
    .replace(/[–—]/g, '-')
    .replace(/°/g, '')
    .replace(/µ/g, 'u')
    .replace(/[^\x20-\x7E]/g, '');
}

function topicUrl(server: string, topic: string, sequenceId?: string): string {
  const base = `${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;
  return sequenceId ? `${base}/${encodeURIComponent(sequenceId)}` : base;
}

export async function ntfyPublish(server: string, topic: string, msg: NtfyMessage, sequenceId?: string): Promise<void> {
  const headers: Record<string, string> = { Title: ascii(msg.title) };
  if (msg.tags?.length) headers.Tags = msg.tags.join(',');
  if (msg.priority) headers.Priority = String(msg.priority);
  if (msg.click) headers.Click = msg.click;
  if (msg.at) headers.At = String(msg.at);
  if (msg.actions?.length) {
    headers.Actions = msg.actions
      .slice(0, 3)
      .map((a) => `view, ${ascii(a.label).replace(/[,;]/g, ' ')}, ${a.url}, clear=true`)
      .join('; ');
  }
  const res = await fetch(topicUrl(server, topic, sequenceId), {
    method: 'POST',
    headers,
    body: msg.message,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`ntfy responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

export async function ntfyCancel(server: string, topic: string, sequenceId: string): Promise<void> {
  const res = await fetch(topicUrl(server, topic, sequenceId), { method: 'DELETE', signal: AbortSignal.timeout(10000) });
  if (!res.ok && res.status !== 404) throw new Error(`ntfy cancel responded ${res.status}`);
}

export function subscribeUrl(server: string, topic: string): string {
  return topicUrl(server, topic);
}
