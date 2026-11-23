import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/core/llm/anthropic';
import { costOf, formatCost, pricesSchema } from '../src/core/llm/prices';
import type { StreamEvent } from '../src/core/llm/types';

// No network: every request goes to a mocked fetch that answers a recorded-shape SSE stream.
const KEY = 'sk-ant-api03-explicitTESTkey-000000000000000000000000';
const ENV_KEY = 'sk-ant-api03-fromENVIRONMENT-1111111111111111111111';
const prices = pricesSchema.parse(JSON.parse(readFileSync(new URL('../config/prices.json', import.meta.url), 'utf8')));

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e) => `event: ${e.type as string}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

const STREAM = sse([
  {
    type: 'message_start',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Voici ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'une idée.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_01', name: 'propose_physics', input: {} } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"changes":[{"pointer":"/gravity",' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"value":48}],"reason":"lourd"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 350 } },
  { type: 'message_stop' },
]);

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function mockFetch(captured: Captured[], status = 200, body: string = STREAM): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured.push({ url: String(input), headers, body: JSON.parse(String(init?.body)) });
    return new Response(body, {
      status,
      headers: { 'content-type': status === 200 ? 'text/event-stream' : 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof fetch;
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQ = {
  model: 'claude-sonnet-5-5',
  system: 'Tu es REBOND.',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Plus lourd' }] }],
  tools: [{ name: 'propose_physics', description: 'physics', input_schema: { type: 'object', properties: {} } }],
  maxTokens: 16000,
};

describe('M1 AnthropicProvider (mocked fetch)', () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN, base: process.env.ANTHROPIC_BASE_URL };
  beforeEach(() => {
    // Hostile environment: the provider must ignore all of it (PLAN ADR-4, W0 P1-9).
    process.env.ANTHROPIC_API_KEY = ENV_KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-bearer-token';
    process.env.ANTHROPIC_BASE_URL = 'https://evil.example';
  });
  afterEach(() => {
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['ANTHROPIC_AUTH_TOKEN', saved.token], ['ANTHROPIC_BASE_URL', saved.base]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('M1-T7 request shape: model, tools, cache_control, streaming; explicit apiKey, environment ignored', async () => {
    const captured: Captured[] = [];
    const p = new AnthropicProvider({ apiKey: KEY, fetch: mockFetch(captured) });
    await collect(p.send(REQ));
    expect(captured).toHaveLength(1);
    const c = captured[0]!;
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers.get('x-api-key')).toBe(KEY);
    expect(c.headers.get('authorization')).toBeNull();
    expect(JSON.stringify([...c.headers])).not.toContain(ENV_KEY);
    expect(c.body.model).toBe('claude-sonnet-5-5');
    expect(c.body.stream).toBe(true);
    expect(c.body.max_tokens).toBe(16000);
    expect(c.body.system).toEqual([{ type: 'text', text: 'Tu es REBOND.', cache_control: { type: 'ephemeral' } }]);
    expect((c.body.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['propose_physics']);
    expect(c.body.tool_choice).toBeUndefined();
  });

  it('M1-T7 streaming parse: text deltas, tool call input, usage, stop reason', async () => {
    const p = new AnthropicProvider({ apiKey: KEY, fetch: mockFetch([]) });
    const events = await collect(p.send(REQ));
    const text = events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('Voici une idée.');
    expect(events.find((e) => e.type === 'tool_use')).toEqual({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'propose_physics',
      input: { changes: [{ pointer: '/gravity', value: 48 }], reason: 'lourd' },
    });
    const usage = events.find((e) => e.type === 'usage') as Extract<StreamEvent, { type: 'usage' }>;
    expect(usage.usage).toEqual({ input_tokens: 1200, output_tokens: 350, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000 });
    expect(events.at(-1)).toEqual({ type: 'stop', reason: 'tool_use' });

    // usage -> cost from config/prices.json: (1200*2 + 350*10 + 3000*0.2) / 1e6 = 0.0065 USD
    const cost = costOf(prices, usage.model, usage.usage);
    expect(cost.known).toBe(true);
    expect(cost.usd).toBeCloseTo(0.0065, 10);
    expect(formatCost(cost, 'fr')).toBe('0,0065 $ US (estimation)');
    expect(formatCost(costOf(prices, 'modele-inconnu', usage.usage), 'fr')).toMatch(/inconnu \(estimation\)/);
  });

  it('M1-T7 errors are classified in French and never echo the key', async () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } });
    const p = new AnthropicProvider({ apiKey: KEY, fetch: mockFetch([], 401, body), maxRetries: 0 });
    const events = await collect(p.send(REQ));
    const err = events.find((e) => e.type === 'error') as Extract<StreamEvent, { type: 'error' }>;
    expect(err.code).toBe('invalid_key');
    expect(err.fr).toMatch(/Clé API refusée/);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('M1-T7 the provider refuses to start without an explicit key (no env fallback)', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(/clé API absente/);
  });

  it('M1-T7 prices.json covers the three default models and records its source and date', () => {
    for (const m of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']) expect(prices.models[m]).toBeDefined();
    expect(prices.checkedAt).toBe('2026-10-19');
    expect(prices.source).toMatch(/^https:\/\//);
  });
});
