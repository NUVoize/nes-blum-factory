// Provider-neutral shapes (PLAN §4.4). AnthropicProvider maps them to the SDK types; Offline and Fake
// providers never touch the network.
export type ModelId = string;

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface Msg {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'cancelled' | 'error' | string;

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'usage'; model: ModelId; usage: Usage }
  | { type: 'stop'; reason: StopReason }
  | { type: 'error'; code: LlmErrorCode; fr: string; en: string };

export type LlmErrorCode = 'invalid_key' | 'no_credit' | 'rate_limit' | 'network' | 'overloaded' | 'bad_request' | 'no_key' | 'unknown';

export interface SendRequest {
  model: ModelId;
  system: string;
  messages: Msg[];
  tools: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
  /** Which director is asking (offline templates and fixtures use it). */
  director?: string;
}

export interface LlmProvider {
  readonly id: 'anthropic' | 'offline' | 'fake';
  available(): Promise<{ ok: boolean; reason?: string }>;
  send(req: SendRequest): AsyncIterable<StreamEvent>;
}

export const EMPTY_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
