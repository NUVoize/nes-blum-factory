import type { ProjectStore } from '../project/store.js';
import type { DirectorId, Proposal } from '../project/proposal.js';
import type { ContentBlock, LlmProvider, Msg, StreamEvent, Usage } from '../llm/types.js';
import { costOf, type Prices } from '../llm/prices.js';
import { containsKey, redactString } from '../llm/redact.js';
import { ulid } from '../util/ulid.js';
import { DIRECTORS, offlineProposal, toolSpec, type ToolContext, type ToolOutput } from './specs.js';
import type { SourceImages } from './chroma.js';

// DirectorRuntime (PLAN §4.3): chat -> tool call -> Ops -> dry-run validation -> pending proposal.
// An invalid proposal never reaches Blum: it goes back to the model as a tool error (2 retries max).
export const MAX_TURNS = 6;
export const MAX_RETRIES = 2;
const HISTORY_TURNS = 12;

/** A key pasted in a chat would be saved in the project and leave in every zip (W1 P1-1). */
export const KEY_IN_CHAT = {
  fr: 'Ne colle pas ta clé ici : va dans Réglages. Ton message n’a pas été envoyé.',
  en: 'Do not paste your key here: go to Settings. Your message was not sent.',
};

export type RuntimeEvent =
  | { type: 'text'; text: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'usage'; model: string; usage: Usage; costUsd: number; costKnown: boolean }
  | { type: 'error'; fr: string; en: string };

export interface SendResult {
  text: string;
  proposals: Proposal[];
  failure: { fr: string; en: string } | null;
  turns: number;
  stoppedAtCap: boolean;
  costUsd: number;
}

export interface RuntimeOptions {
  store: ProjectStore;
  provider: LlmProvider;
  prices: Prices;
  locale?: 'fr' | 'en';
  model?: string;
  maxTurns?: number;
  onEvent?: (e: RuntimeEvent) => void;
  onUsage?: (rec: { director: DirectorId; model: string; usage: Usage; costUsd: number; costKnown: boolean }) => void;
  now?: () => Date;
  /** Images dropped in the CHROMA panel (PLAN §6). */
  sources?: SourceImages;
}

export class DirectorRuntime {
  constructor(private readonly opts: RuntimeOptions) {}

  private get store(): ProjectStore {
    return this.opts.store;
  }

  private now(): Date {
    return (this.opts.now ?? (() => new Date()))();
  }

  private get ctx(): ToolContext {
    return { ...(this.opts.sources ? { sources: this.opts.sources } : {}), asset: (p: string) => this.store.asset(p) };
  }

  /** Recent chat turns as plain text (tool traffic is not replayed: the context slice carries the state). */
  private history(director: DirectorId): Msg[] {
    const lines = this.store.chat(director).filter((l) => l.role === 'user' || l.role === 'assistant');
    const msgs: Msg[] = [];
    for (const l of lines.slice(-HISTORY_TURNS)) {
      const text = String(l.text ?? '');
      if (!text) continue;
      const role = l.role as 'user' | 'assistant';
      if (msgs.length === 0 && role === 'assistant') continue;
      const last = msgs.at(-1);
      if (last && last.role === role) last.content.push({ type: 'text', text });
      else msgs.push({ role, content: [{ type: 'text', text }] });
    }
    return msgs;
  }

  private makeProposal(director: DirectorId, tool: string, out: ToolOutput): Proposal {
    return {
      id: ulid(this.now().getTime()),
      director,
      state: 'pending',
      createdAt: this.now().toISOString(),
      tool,
      summary: out.summary,
      ops: out.ops,
      warnings: out.warnings ?? [],
    };
  }

  /** Run a tool call through Ops + validation. Returns a proposal or a French reason. */
  private tryTool(director: DirectorId, name: string, input: unknown): { proposal: Proposal } | { reason: { fr: string; en: string } } {
    const spec = DIRECTORS[director];
    const tool = spec.tools.find((t) => t.name === name);
    if (!tool) return { reason: { fr: `outil inconnu : ${name}`, en: `unknown tool: ${name}` } };
    const parsed = tool.input.safeParse(input);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      const where = '/' + i.path.join('/');
      return { reason: { fr: `données invalides ${where} : ${i.message}`, en: `invalid input ${where}: ${i.message}` } };
    }
    let out: ToolOutput;
    try {
      out = tool.toOps(parsed.data, this.store.docs(), this.ctx);
    } catch (e) {
      const m = (e as Error).message;
      return { reason: { fr: m, en: m } };
    }
    const dry = this.store.dryRun(out.ops);
    const errors = dry.issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      return {
        reason: {
          fr: errors.map((e) => `${e.doc} ${e.fr}`).join(' ; '),
          en: errors.map((e) => `${e.doc} ${e.en}`).join('; '),
        },
      };
    }
    const warnings = [...(out.warnings ?? []), ...dry.issues.filter((i) => i.severity === 'warning').map((w) => ({ fr: w.fr, en: w.en }))];
    const proposal = this.makeProposal(director, name, { ...out, warnings });
    return { proposal };
  }

  async send(director: DirectorId, userText: string, signal?: AbortSignal): Promise<SendResult> {
    const spec = DIRECTORS[director];
    const locale = this.opts.locale ?? 'fr';
    const emit = this.opts.onEvent ?? (() => {});
    const maxTurns = this.opts.maxTurns ?? MAX_TURNS;
    if (containsKey(userText)) {
      emit({ type: 'error', ...KEY_IN_CHAT });
      return { text: '', proposals: [], failure: { ...KEY_IN_CHAT }, turns: 0, stoppedAtCap: false, costUsd: 0 };
    }
    const context = JSON.stringify(spec.contextSlice(this.store.docs(), this.ctx));
    const messages: Msg[] = [
      ...this.history(director),
      { role: 'user', content: [{ type: 'text', text: `<projet>${context}</projet>\n\n${userText}` }] },
    ];
    if (messages[0]!.role !== 'user') messages.shift();
    this.store.appendChat(director, { ts: this.now().toISOString(), role: 'user', text: redactString(userText) });

    const proposals: Proposal[] = [];
    let text = '';
    let failures = 0;
    let lastReason: { fr: string; en: string } | null = null;
    let failure: { fr: string; en: string } | null = null;
    let costUsd = 0;
    let turns = 0;
    let stoppedAtCap = false;

    while (true) {
      if (turns >= maxTurns) {
        stoppedAtCap = true;
        break;
      }
      turns++;
      const toolUses: Array<{ id: string; name: string; input: unknown }> = [];
      let turnText = '';
      let errored = false;
      for await (const ev of this.opts.provider.send({
        model: this.opts.model ?? spec.defaultModel,
        system: spec.systemPrompt(locale),
        messages,
        tools: spec.tools.map(toolSpec),
        maxTokens: 16000,
        director,
        ...(signal ? { signal } : {}),
      }) as AsyncIterable<StreamEvent>) {
        if (ev.type === 'text') {
          // BLUM-Q1: the text of a later turn starts a new sentence (« couleurs.C’est » had no space)
          const sep = turnText === '' && text !== '' && !/\s$/.test(text) && !/^\s/.test(ev.text) ? ' ' : '';
          text += sep;
          turnText += ev.text;
          emit({ type: 'text', text: sep + ev.text });
        } else if (ev.type === 'tool_use') toolUses.push(ev);
        else if (ev.type === 'usage') {
          const c = costOf(this.opts.prices, ev.model, ev.usage);
          costUsd += c.usd;
          emit({ type: 'usage', model: ev.model, usage: ev.usage, costUsd: c.usd, costKnown: c.known });
          this.opts.onUsage?.({ director, model: ev.model, usage: ev.usage, costUsd: c.usd, costKnown: c.known });
        } else if (ev.type === 'error') {
          errored = true;
          failure = { fr: ev.fr, en: ev.en };
          emit({ type: 'error', fr: ev.fr, en: ev.en });
        }
      }
      text += turnText;
      if (errored || signal?.aborted || toolUses.length === 0) break;

      const assistant: ContentBlock[] = [];
      if (turnText) assistant.push({ type: 'text', text: turnText });
      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        assistant.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
        const r = this.tryTool(director, tu.name, tu.input);
        if ('proposal' in r) {
          this.store.saveProposal(r.proposal);
          proposals.push(r.proposal);
          emit({ type: 'proposal', proposal: r.proposal });
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Proposition créée. Elle attend l’approbation de Blum ; ne la répète pas.' });
        } else {
          failures++;
          lastReason = r.reason;
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Refusé : ${r.reason.fr}`, is_error: true });
        }
      }
      messages.push({ role: 'assistant', content: assistant }, { role: 'user', content: results });
      if (failures > MAX_RETRIES) {
        failure = {
          fr: `${spec.name} n’a pas réussi : ${lastReason!.fr}`,
          en: `${spec.name} did not succeed: ${lastReason!.en}`,
        };
        emit({ type: 'error', ...failure });
        break;
      }
    }

    if (stoppedAtCap && !failure) {
      failure = { fr: `${spec.name} s’arrête : limite de ${maxTurns} tours atteinte.`, en: `${spec.name} stopped: ${maxTurns}-turn limit reached.` };
      emit({ type: 'error', ...failure });
    }
    this.store.appendChat(director, {
      ts: this.now().toISOString(),
      role: 'assistant',
      text: redactString(text),
      proposals: proposals.map((p) => p.id),
      costUsd,
      ...(failure ? { failure } : {}),
    });
    return { text, proposals, failure, turns, stoppedAtCap, costUsd };
  }

  /** Offline path: a template or preset becomes a normal pending proposal. */
  offline(director: DirectorId, choice: string): Proposal {
    const out = offlineProposal(director, choice, this.store.docs());
    if (!out) throw new Error(`choix inconnu : ${choice}`);
    const dry = this.store.dryRun(out.ops);
    if (!dry.ok) throw new Error(dry.issues[0]?.fr ?? 'proposition invalide');
    const p = this.makeProposal(director, `offline:${choice}`, out);
    this.store.saveProposal(p);
    return p;
  }

  /**
   * Manual path (a button in a director panel): the same tool, Ops and validation as the AI path, no
   * model call. Throws the French reason when the proposal would be invalid.
   */
  manual(director: DirectorId, tool: string, input: unknown): Proposal {
    const r = this.tryTool(director, tool, input);
    if ('reason' in r) throw new Error(r.reason.fr);
    this.store.saveProposal(r.proposal);
    return r.proposal;
  }

  approve(proposalId: string): Proposal {
    const p = this.store.proposal(proposalId);
    if (!p) throw new Error('proposition introuvable');
    if (p.state !== 'pending') throw new Error('proposition déjà traitée');
    const tx = this.store.apply({ director: p.director, summary: p.summary, ops: p.ops, proposalId: p.id });
    const done: Proposal = { ...p, state: 'approved', decidedAt: this.now().toISOString(), txId: tx.id };
    this.store.saveProposal(done);
    return done;
  }

  reject(proposalId: string): Proposal {
    const p = this.store.proposal(proposalId);
    if (!p) throw new Error('proposition introuvable');
    if (p.state !== 'pending') throw new Error('proposition déjà traitée');
    const done: Proposal = { ...p, state: 'rejected', decidedAt: this.now().toISOString() };
    this.store.saveProposal(done);
    return done;
  }
}
