// BOULON fix loop (PLAN §4.4, §7): build -> red -> BOULON proposes a repair (a normal proposal) -> Blum
// approves -> rebuild. Never writes by itself, never more than 5 builds per request.
import type { Proposal } from '../project/proposal.js';
import type { L10n } from './errors.js';
import type { BuildReport } from './report.js';

export const MAX_FIX_ATTEMPTS = 5;

export type FixLoopState =
  | { state: 'green'; attempts: number; report: BuildReport }
  | { state: 'proposed'; attempts: number; report: BuildReport; proposals: Proposal[]; text: string }
  | { state: 'no-fix'; attempts: number; report: BuildReport; reason: L10n }
  | { state: 'stopped'; attempts: number; report: BuildReport; reason: L10n };

export interface AskResult {
  proposals: Proposal[];
  text: string;
  failure: L10n | null;
}

export interface FixLoopDeps {
  build(): BuildReport | Promise<BuildReport>;
  /** BOULON (AI, or the catalog's own repair when offline) answers one red report. */
  ask(report: BuildReport, attempt: number, max: number): Promise<AskResult>;
  max?: number;
}

/** The user turn BOULON gets: the problems of the report, in French, with the attempt count. */
export function fixRequest(report: BuildReport, attempt: number, max: number): string {
  const lines = report.problems
    .filter((p) => p.severity === 'error')
    .map((p) => `- [${p.id}] ${p.what.fr}${p.doc ? ` (${p.doc})` : ''} -> ${p.fix.fr}${p.known ? '' : `\n  texte brut : ${p.raw.split('\n').slice(0, 4).join(' / ')}`}`);
  return [
    `La construction de la ROM a échoué (essai ${attempt} sur ${max}). Problèmes :`,
    ...lines,
    'Propose une seule réparation avec un outil, ou explique pourquoi tu ne peux pas.',
  ].join('\n');
}

const stopReason = (report: BuildReport, max: number): L10n => {
  const first = report.problems.find((p) => p.severity === 'error');
  return {
    fr: `BOULON s’arrête après ${max} essais : la ROM ne se construit toujours pas${first ? ` (${first.what.fr})` : ''}. Regarde le rapport ; tu peux annuler les dernières modifications dans l’Historique ou envoyer le projet à Fred.`,
    en: `BOULON stops after ${max} attempts: the ROM still does not build${first ? ` (${first.what.en})` : ''}. Read the report; you can undo the last changes in History or send the project to Fred.`,
  };
};

export class BuildFixLoop {
  attempts = 0;
  last: FixLoopState | null = null;
  private readonly max: number;

  constructor(private readonly deps: FixLoopDeps) {
    this.max = deps.max ?? MAX_FIX_ATTEMPTS;
  }

  /** One round: build; when red and attempts are left, ask BOULON for one repair. */
  async step(): Promise<FixLoopState> {
    if (this.last?.state === 'stopped' || this.last?.state === 'green') return this.last;
    this.attempts++;
    const report = await this.deps.build();
    if (report.ok) return (this.last = { state: 'green', attempts: this.attempts, report });
    if (this.attempts >= this.max) return (this.last = { state: 'stopped', attempts: this.attempts, report, reason: stopReason(report, this.max) });
    const r = await this.deps.ask(report, this.attempts, this.max);
    if (r.proposals.length === 0) {
      return (this.last = {
        state: 'no-fix',
        attempts: this.attempts,
        report,
        reason: r.failure ?? {
          fr: 'BOULON n’a pas de réparation à proposer pour ce problème. Lis le rapport : il dit quoi faire.',
          en: 'BOULON has no repair to offer for this problem. Read the report: it says what to do.',
        },
      });
    }
    return (this.last = { state: 'proposed', attempts: this.attempts, report, proposals: r.proposals, text: r.text });
  }
}
