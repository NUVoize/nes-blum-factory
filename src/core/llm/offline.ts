import type { LlmProvider, SendRequest, StreamEvent } from './types.js';

// No key or no network: deterministic answers that point to the manual path (PLAN §4.4, principle 4).
export const OFFLINE_REPLIES: Record<string, { fr: string; en: string }> = {
  story: {
    fr: 'Mode hors ligne : je ne peux pas discuter sans clé API. Choisis un modèle d’histoire ci-dessous, puis modifie-le dans le formulaire.',
    en: 'Offline mode: I cannot chat without an API key. Pick a story template below, then edit it in the form.',
  },
  visual: {
    fr: 'Mode hors ligne : dépose une image dans le convertisseur, il marche sans clé. Je ne peux pas commenter le résultat.',
    en: 'Offline mode: drop an image into the converter, it works without a key. I cannot comment on the result.',
  },
  movement: {
    fr: 'Mode hors ligne : choisis un réglage tout prêt (léger, lourd, flottant), puis ajuste les curseurs.',
    en: 'Offline mode: pick a ready-made feel (light, heavy, floaty), then tune the sliders.',
  },
  level: {
    fr: 'Mode hors ligne : dessine ton niveau case par case dans la grille. Je vérifie quand même les règles.',
    en: 'Offline mode: paint your level tile by tile in the grid. The rules are still checked.',
  },
  build: {
    fr: 'Mode hors ligne : « Construire » et « Réparer » marchent sans clé. J’explique les erreurs connues et je sais couper un niveau trop long ; pour le reste, il faut la clé.',
    en: 'Offline mode: Build and Repair work without a key. I explain the known errors and can split a stage that is too long; the rest needs the key.',
  },
};

export class OfflineProvider implements LlmProvider {
  readonly id = 'offline' as const;

  constructor(private readonly locale: 'fr' | 'en' = 'fr') {}

  async available(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: this.locale === 'fr' ? 'mode hors ligne' : 'offline mode' };
  }

  async *send(req: SendRequest): AsyncIterable<StreamEvent> {
    const r = OFFLINE_REPLIES[req.director ?? ''] ?? OFFLINE_REPLIES.story!;
    yield { type: 'text', text: r[this.locale] };
    yield { type: 'stop', reason: 'end_turn' };
  }
}
