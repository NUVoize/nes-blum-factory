// Log redaction (PLAN ADR-4): the API key never reaches a log, a chat file or the renderer.
// Covers plain strings, Error objects (message, stack, cause), SDK error objects and header maps.
const KEY_RE = /sk-ant-[A-Za-z0-9_\-]{4,}/g;
const SECRET_HEADERS = new Set(['x-api-key', 'authorization', 'anthropic-api-key', 'proxy-authorization']);

export function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `sk-ant-…${tail}`;
}

/** True when a text carries something shaped like an Anthropic key (W1 P1-1: refuse it in a chat). */
export function containsKey(s: string): boolean {
  return new RegExp(KEY_RE.source).test(s);
}

export function redactString(s: string): string {
  return s.replace(KEY_RE, (m) => maskKey(m));
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circulaire]';
  seen.add(value);
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: redactString(value.message) };
    if (value.stack) out.stack = redactString(value.stack);
    for (const k of Object.keys(value)) out[k] = redactField(k, (value as unknown as Record<string, unknown>)[k], seen);
    if ('cause' in value && value.cause !== undefined) out.cause = redact(value.cause, seen);
    return out;
  }
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    const out: Record<string, string> = {};
    value.forEach((v, k) => (out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? '[masqué]' : redactString(v)));
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactField(k, v, seen);
  return out;
}

function redactField(key: string, v: unknown, seen: WeakSet<object>): unknown {
  if (SECRET_HEADERS.has(key.toLowerCase()) || key === 'apiKey' || key === 'api_key') return v == null ? v : '[masqué]';
  return redact(v, seen);
}

/** Safe text for any log line built from an unknown thrown value. */
export function redactForLog(value: unknown): string {
  const r = redact(value);
  return typeof r === 'string' ? r : JSON.stringify(r);
}
