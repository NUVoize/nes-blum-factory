import Anthropic from '@anthropic-ai/sdk';
import { redactString } from './redact.js';
import type { LlmErrorCode, LlmProvider, Msg, SendRequest, StreamEvent } from './types.js';

export interface AnthropicProviderOptions {
  /** Read from KeyVault in main. Never from the environment (PLAN ADR-4, W0 P1-9). */
  apiKey: string;
  /** Tests inject a mocked fetch; the app uses the global one. */
  fetch?: typeof fetch;
  maxRetries?: number;
}

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';

/** Explicit key, explicit base URL, no env token, no profile, SDK logging off. */
export function buildAnthropicClient(opts: AnthropicProviderOptions): Anthropic {
  if (!opts.apiKey) throw new Error('clé API absente');
  return new Anthropic({
    apiKey: opts.apiKey,
    authToken: null,
    baseURL: ANTHROPIC_BASE_URL,
    logLevel: 'off',
    maxRetries: opts.maxRetries ?? 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

function toSdkMessages(messages: Msg[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): Anthropic.ContentBlockParam => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      return { type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content, ...(b.is_error ? { is_error: true } : {}) };
    }),
  }));
}

export function classifyError(e: unknown): { code: LlmErrorCode; fr: string; en: string } {
  const raw = redactString(e instanceof Error ? e.message : String(e));
  if (e instanceof Anthropic.AuthenticationError) return { code: 'invalid_key', fr: 'Clé API refusée. Vérifie la clé dans les Réglages.', en: 'API key refused. Check the key in Settings.' };
  if (e instanceof Anthropic.PermissionDeniedError) return { code: 'invalid_key', fr: 'Cette clé n’a pas accès à ce modèle.', en: 'This key has no access to this model.' };
  if (e instanceof Anthropic.RateLimitError) return { code: 'rate_limit', fr: 'Trop de demandes, réessaie dans une minute.', en: 'Too many requests, try again in a minute.' };
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance|billing/i.test(raw)) return { code: 'no_credit', fr: 'Plus de crédit sur le compte Anthropic.', en: 'No credit left on the Anthropic account.' };
    return { code: 'bad_request', fr: `Demande refusée : ${raw}`, en: `Request refused: ${raw}` };
  }
  if (e instanceof Anthropic.InternalServerError) return { code: 'overloaded', fr: 'Le service est surchargé, réessaie plus tard.', en: 'The service is overloaded, try again later.' };
  if (e instanceof Anthropic.APIConnectionError) return { code: 'network', fr: 'Pas de connexion Internet (ou service injoignable).', en: 'No Internet connection (or service unreachable).' };
  return { code: 'unknown', fr: `Erreur : ${raw}`, en: `Error: ${raw}` };
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(opts: AnthropicProviderOptions) {
    this.client = buildAnthropicClient(opts);
  }

  async available(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: true };
  }

  async *send(req: SendRequest): AsyncIterable<StreamEvent> {
    try {
      // Prompt caching: tools render before system, so one breakpoint on the large system prompt
      // caches the tool list too. Forced tool_choice is not allowed on current models; `auto` is the default.
      const stream = this.client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
          messages: toSdkMessages(req.messages),
        },
        req.signal ? { signal: req.signal } : undefined,
      );
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { type: 'text', text: ev.delta.text };
      }
      const msg = await stream.finalMessage();
      for (const b of msg.content) {
        if (b.type === 'tool_use') yield { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      }
      yield {
        type: 'usage',
        model: msg.model,
        usage: {
          input_tokens: msg.usage.input_tokens,
          output_tokens: msg.usage.output_tokens,
          cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
        },
      };
      yield { type: 'stop', reason: msg.stop_reason ?? 'end_turn' };
    } catch (e) {
      if (req.signal?.aborted) {
        yield { type: 'stop', reason: 'cancelled' };
        return;
      }
      yield { type: 'error', ...classifyError(e) };
      yield { type: 'stop', reason: 'error' };
    }
  }
}
