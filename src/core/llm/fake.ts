import type { LlmProvider, SendRequest, StreamEvent, Usage } from './types.js';

// Scripted provider for tests and the sample-game replay (PLAN §12.3). Each `send` plays the next turn.
export type FakeTurn = Array<{ text: string } | { tool: string; input: unknown; id?: string }>;

export class FakeProvider implements LlmProvider {
  readonly id = 'fake' as const;
  readonly requests: SendRequest[] = [];
  private i = 0;

  constructor(
    private readonly turns: FakeTurn[],
    private readonly usage: Usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 800 },
    private readonly model = 'claude-sonnet-5-5',
  ) {}

  async available(): Promise<{ ok: boolean }> {
    return { ok: true };
  }

  async *send(req: SendRequest): AsyncIterable<StreamEvent> {
    this.requests.push(structuredClone({ ...req, signal: undefined }));
    const turn = this.turns[this.i++] ?? [{ text: '' }];
    let hasTool = false;
    let n = 0;
    for (const step of turn) {
      if ('text' in step) yield { type: 'text', text: step.text };
      else {
        hasTool = true;
        yield { type: 'tool_use', id: step.id ?? `toolu_fake_${this.i}_${n++}`, name: step.tool, input: step.input };
      }
    }
    yield { type: 'usage', model: this.model, usage: this.usage };
    yield { type: 'stop', reason: hasTool ? 'tool_use' : 'end_turn' };
  }

  get callCount(): number {
    return this.i;
  }
}
