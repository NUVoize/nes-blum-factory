// Error catalog (PLAN §7.2): known cc65 / ca65 / ld65 / validator / ROM check messages -> a plain
// explanation in French and English (« quoi », « pourquoi », « comment réparer ») and, when BOULON can
// repair it himself, a fix hint. An unknown message is shown raw with the « pas encore connue » note.
import type { Issue } from '../schema/common.js';

export interface L10n {
  fr: string;
  en: string;
}

export type BuildStepId = 'validate' | 'compile' | 'rom' | 'run';

/** A repair BOULON knows how to propose (as a normal proposal, approved by Blum). */
export type FixHint = { kind: 'split-stage'; stage: string; width: number };

export interface Problem {
  /** Catalog id, or `unknown`. */
  id: string;
  known: boolean;
  step: BuildStepId;
  severity: 'error' | 'warning';
  what: L10n;
  why: L10n;
  fix: L10n;
  /** The tool or validator text it was read from (trimmed). */
  raw: string;
  doc?: string;
  hint?: FixHint;
}

export const UNKNOWN_NOTE: L10n = {
  fr: 'BOULON ne connaît pas encore cette erreur (pas encore connue). Le texte brut est affiché tel quel.',
  en: 'BOULON does not know this error yet (not known yet). The raw text is shown as is.',
};

interface Entry {
  id: string;
  step?: BuildStepId;
  re: RegExp;
  severity?: 'error' | 'warning';
  explain(m: RegExpExecArray, ctx: { doc?: string }): { what: L10n; why: L10n; fix: L10n; hint?: FixHint };
}

const Q = `[\`'"‘’]?`; // ld65 / ca65 quote names with ‘…’ (2.19 snapshot) or '…' (older builds)
const q = (s: string) => new RegExp(s.replaceAll('{Q}', Q), 'm');

const ENGINE_FIX: L10n = {
  fr: 'Ce n’est pas ton jeu : c’est le moteur. Refais « Construire » ; si l’erreur revient, exporte le projet (zip) et envoie-le à Fred.',
  en: 'This is not your game: it is the engine. Build again; if the error comes back, export the project (zip) and send it to Fred.',
};

/** Known messages, most specific first. */
const CATALOG: Entry[] = [
  // ---------- linker (ld65) ----------
  {
    id: 'sound-bank-full',
    step: 'compile',
    re: q(`Segment {Q}SOUND{Q} overflows memory area {Q}PRG28{Q} by (\\d+) bytes?`),
    explain: (m) => ({
      what: { fr: `La banque de musique est pleine (${m[1]} octets de trop).`, en: `The music bank is full (${m[1]} bytes too many).` },
      why: { fr: 'Toutes les musiques et tous les bruitages partagent une banque de 8 Ko.', en: 'All songs and sound effects share one 8 KiB bank.' },
      fix: { fr: 'Retire une musique ou raccourcis-la dans la bibliothèque sonore.', en: 'Remove a song or make it shorter in the sound library.' },
    }),
  },
  {
    id: 'data-bank-full',
    step: 'compile',
    re: q(`Segment {Q}BANK(\\d+){Q} overflows memory area {Q}PRG\\d+{Q} by (\\d+) bytes?`),
    explain: (m) => ({
      what: { fr: `La banque ${m[1]} ne rentre plus (${m[2]} octets de trop).`, en: `Bank ${m[1]} no longer fits (${m[2]} bytes too many).` },
      why: { fr: 'Chaque banque de la cartouche contient 8 Ko ; les niveaux, boss et textes rangés dedans dépassent.', en: 'Each cartridge bank holds 8 KiB; the stages, bosses and texts stored in it are too big.' },
      fix: { fr: 'Coupe le niveau le plus long en deux niveaux, ou raccourcis les textes.', en: 'Split the longest stage into two stages, or shorten the texts.' },
    }),
  },
  {
    id: 'engine-code-full',
    step: 'compile',
    re: q(`Segment {Q}(CODE|CODE2|RODATA|DATA|LOWCODE|INIT|ONCE|STARTUP|VECTORS){Q} overflows memory area {Q}(PRG|PRGE){Q} by (\\d+) bytes?`),
    explain: (m) => ({
      what: { fr: `Le code du moteur ne rentre plus (${m[3]} octets de trop dans ${m[2] === 'PRGE' ? 'la banque de démarrage' : 'le code fixe'}).`, en: `The engine code no longer fits (${m[3]} bytes too many in the ${m[2] === 'PRGE' ? 'startup bank' : 'fixed code'}).` },
      why: { fr: 'Le moteur a 24 Ko de code fixe ; les options avancées activées prennent de la place.', en: 'The engine has 24 KiB of fixed code; the advanced options you turned on take room.' },
      fix: { fr: 'Désactive une option avancée dans Réglages. Si tu n’en as activé aucune, envoie le projet à Fred.', en: 'Turn off an advanced option in Settings. If none is on, send the project to Fred.' },
    }),
  },
  {
    id: 'unresolved-symbol',
    step: 'compile',
    re: q(`Unresolved external {Q}(\\w+){Q}`),
    explain: (m) => ({
      what: { fr: `Le moteur cherche « ${m[1]} » et ne le trouve pas.`, en: `The engine looks for "${m[1]}" and cannot find it.` },
      why: { fr: 'Une pièce du moteur ou des données générées manque à l’assemblage.', en: 'A piece of the engine or of the generated data is missing at link time.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'duplicate-symbol',
    step: 'compile',
    re: q(`Duplicate external identifier: {Q}(\\w+){Q}`),
    explain: (m) => ({
      what: { fr: `« ${m[1]} » est défini deux fois dans le moteur.`, en: `"${m[1]}" is defined twice in the engine.` },
      why: { fr: 'Deux pièces du moteur portent le même nom.', en: 'Two pieces of the engine have the same name.' },
      fix: ENGINE_FIX,
    }),
  },
  // ---------- compiler / assembler ----------
  {
    id: 'missing-include',
    step: 'compile',
    re: q(`(?:Include file {Q}([^‘’'"\`]+?){Q} not found|Cannot open include file {Q}([^‘’'"\`:]+){Q})`),
    explain: (m) => ({
      what: { fr: `Un fichier du moteur manque : ${m[1] ?? m[2]}.`, en: `An engine file is missing: ${m[1] ?? m[2]}.` },
      why: { fr: 'Le dossier du moteur ou du compilateur est incomplet (antivirus, zip mal extrait).', en: 'The engine or compiler folder is incomplete (antivirus, zip not fully extracted).' },
      fix: { fr: 'Extrais de nouveau le zip de NES BLUM FACTORY (après « Débloquer »), puis reconstruis.', en: 'Extract the NES BLUM FACTORY zip again (after "Unblock"), then build again.' },
    }),
  },
  {
    id: 'undeclared',
    step: 'compile',
    re: /^(\S+\.c):(\d+): Error: Undeclared identifier '(\w+)'/m,
    explain: (m) => ({
      what: { fr: `Le moteur utilise « ${m[3]} » sans le déclarer (${m[1]}, ligne ${m[2]}).`, en: `The engine uses "${m[3]}" without declaring it (${m[1]}, line ${m[2]}).` },
      why: { fr: 'Le code C du moteur et ses données générées ne vont plus ensemble.', en: 'The engine C code and its generated data no longer match.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'value-range',
    step: 'compile',
    re: /^(\S+):(\d+): Error: Range error \((-?\d+) not in \[(-?\d+)\.\.(-?\d+)\]\)/m,
    explain: (m) => ({
      what: { fr: `Une valeur est trop grande pour la NES : ${m[3]} (de ${m[4]} à ${m[5]} seulement, ${m[1]} ligne ${m[2]}).`, en: `A value is too big for the NES: ${m[3]} (only ${m[4]} to ${m[5]}, ${m[1]} line ${m[2]}).` },
      why: { fr: 'La NES range la plupart des nombres dans un octet (0 à 255).', en: 'The NES keeps most numbers in one byte (0 to 255).' },
      fix: { fr: 'Baisse le réglage concerné (vitesse, points de vie, taille) chez REBOND ou TABLEAU.', en: 'Lower the setting involved (speed, hit points, size) with REBOND or TABLEAU.' },
    }),
  },
  {
    id: 'c-error',
    step: 'compile',
    re: /^(\S+\.[ch]):(\d+): Error: (.+)$/m,
    explain: (m) => ({
      what: { fr: `Le code C du moteur a une faute (${m[1]}, ligne ${m[2]}) : ${m[3]}`, en: `The engine C code has a mistake (${m[1]}, line ${m[2]}): ${m[3]}` },
      why: { fr: 'Le compilateur cc65 refuse une ligne du moteur.', en: 'The cc65 compiler refuses a line of the engine.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'asm-error',
    step: 'compile',
    re: /^(\S+\.(?:s|asm|inc)):(\d+): Error: (.+)$/m,
    explain: (m) => ({
      what: { fr: `L’assembleur refuse une ligne (${m[1]}, ligne ${m[2]}) : ${m[3]}`, en: `The assembler refuses a line (${m[1]}, line ${m[2]}): ${m[3]}` },
      why: { fr: 'Le code assembleur du moteur ou les données générées ont une faute.', en: 'The engine assembly code or the generated data has a mistake.' },
      fix: ENGINE_FIX,
    }),
  },
  // ---------- processes ----------
  {
    id: 'toolchain-missing',
    re: /compilateur cc65 introuvable|cc65 toolchain not found/,
    explain: () => ({
      what: { fr: 'Le compilateur cc65 est introuvable.', en: 'The cc65 compiler cannot be found.' },
      why: { fr: 'Il est livré avec NES BLUM FACTORY, dans resources\\toolchain ; il a été déplacé ou mis en quarantaine.', en: 'It ships with NES BLUM FACTORY in resources\\toolchain; it was moved or quarantined.' },
      fix: { fr: 'Extrais de nouveau le zip (clic droit > Propriétés > Débloquer d’abord).', en: 'Extract the zip again (right-click > Properties > Unblock first).' },
    }),
  },
  {
    id: 'tool-blocked',
    re: /\b(EPERM|EACCES|UNKNOWN)\b.*\b(cc65|ca65|ld65)\.exe|\b(cc65|ca65|ld65)\.exe\b.*\b(EPERM|EACCES)\b/,
    explain: () => ({
      what: { fr: 'Windows a empêché le compilateur de démarrer.', en: 'Windows stopped the compiler from starting.' },
      why: { fr: 'Le zip venait d’Internet et n’a pas été débloqué, ou l’antivirus a bloqué cc65.', en: 'The zip came from the Internet and was not unblocked, or the antivirus blocked cc65.' },
      fix: { fr: 'Clic droit sur le zip > Propriétés > Débloquer, puis extrais de nouveau.', en: 'Right-click the zip > Properties > Unblock, then extract again.' },
    }),
  },
  {
    id: 'tool-timeout',
    re: /\bETIMEDOUT\b/,
    explain: () => ({
      what: { fr: 'Le compilateur a mis plus d’une minute et a été arrêté.', en: 'The compiler took more than a minute and was stopped.' },
      why: { fr: 'L’ordinateur était très occupé, ou l’antivirus examinait le compilateur.', en: 'The computer was very busy, or the antivirus was scanning the compiler.' },
      fix: { fr: 'Ferme les autres programmes lourds et refais « Construire ».', en: 'Close other heavy programs and build again.' },
    }),
  },
  {
    id: 'build-path',
    re: /dossier de construction avec espace ou accent|build folder has a space or accent/,
    explain: () => ({
      what: { fr: 'Le dossier de construction contient un espace ou un accent.', en: 'The build folder has a space or an accent.' },
      why: { fr: 'cc65 ne sait pas lire ces chemins.', en: 'cc65 cannot read those paths.' },
      fix: { fr: 'NES BLUM FACTORY choisit normalement un dossier sans accent ; envoie le message à Fred.', en: 'NES BLUM FACTORY normally picks a plain folder; send the message to Fred.' },
    }),
  },
  // ---------- validators (project documents) ----------
  {
    id: 'stage-too-wide',
    step: 'validate',
    re: /niveau trop large : (\d+) colonnes/,
    explain: (m, ctx) => {
      const stage = /^levels\/([a-z0-9-]+)\.json$/.exec(ctx.doc ?? '')?.[1] ?? '';
      const width = Number(m[1]);
      return {
        what: { fr: `Le niveau « ${stage} » est trop long : ${Math.ceil(width / 16)} écrans (8 au plus).`, en: `Stage "${stage}" is too long: ${Math.ceil(width / 16)} screens (8 at most).` },
        why: { fr: 'Le moteur garde un niveau entier en mémoire : 8 écrans de large au plus.', en: 'The engine keeps a whole stage in memory: 8 screens wide at most.' },
        fix: { fr: 'BOULON peut couper ce niveau en deux niveaux qui se suivent.', en: 'BOULON can split this stage into two stages in a row.' },
        ...(stage ? { hint: { kind: 'split-stage' as const, stage, width } } : {}),
      };
    },
  },
  {
    id: 'too-many-enemies',
    step: 'validate',
    re: /trop d’ennemis sur un écran : (\d+)/,
    explain: (m) => ({
      what: { fr: `Trop d’ennemis sur un même écran (${m[1]}).`, en: `Too many enemies on one screen (${m[1]}).` },
      why: { fr: 'La NES affiche 8 sprites par ligne : au-delà de 6 ennemis, ils clignotent trop.', en: 'The NES shows 8 sprites per line: past 6 enemies they flicker too much.' },
      fix: { fr: 'Demande à TABLEAU d’espacer les ennemis.', en: 'Ask TABLEAU to spread the enemies out.' },
    }),
  },
  {
    id: 'stages-full',
    step: 'compile',
    re: /les niveaux ne rentrent plus dans la cartouche/,
    explain: () => ({
      what: { fr: 'Les niveaux ne rentrent plus dans la cartouche.', en: 'The stages no longer fit in the cartridge.' },
      why: { fr: 'La cartouche range les niveaux dans 28 banques de 8 Ko.', en: 'The cartridge stores the stages in 28 banks of 8 KiB.' },
      fix: { fr: 'Raccourcis des niveaux ou retire un monde avec PLUME.', en: 'Shorten some stages or remove a world with PLUME.' },
    }),
  },
  {
    id: 'text-too-long',
    step: 'validate',
    re: /est trop long pour un écran|les textes du jeu prennent (\d+) octets/,
    explain: () => ({
      what: { fr: 'Un texte du jeu est trop long.', en: 'A game text is too long.' },
      why: { fr: 'Un écran de texte a 10 lignes de 28 lettres, et tous les textes partagent 2 Ko.', en: 'A text screen has 10 lines of 28 letters, and all texts share 2 KiB.' },
      fix: { fr: 'Demande à PLUME de raccourcir l’introduction ou la fin.', en: 'Ask PLUME to shorten the intro or the ending.' },
    }),
  },
  {
    id: 'missing-document',
    step: 'validate',
    re: /document manquant : (\S+)/,
    explain: (m) => ({
      what: { fr: `Il manque le fichier ${m[1]} dans le projet.`, en: `The project is missing ${m[1]}.` },
      why: { fr: 'Le projet a été modifié à la main ou mal copié.', en: 'The project was edited by hand or copied badly.' },
      fix: { fr: 'Annule la dernière modification dans l’Historique, ou importe de nouveau le zip.', en: 'Undo the last change in History, or import the zip again.' },
    }),
  },
  {
    id: 'not-available',
    step: 'validate',
    re: /n’est pas encore disponible|pas encore disponible/,
    explain: (_m, ctx) => ({
      what: { fr: `Une fonction demandée n’existe pas encore dans le moteur${ctx.doc ? ` (${ctx.doc})` : ''}.`, en: `A requested feature is not in the engine yet${ctx.doc ? ` (${ctx.doc})` : ''}.` },
      why: { fr: 'Le moteur de cette version ne sait pas encore la faire.', en: 'This version of the engine cannot do it yet.' },
      fix: { fr: 'Demande au directeur concerné de la retirer (REBOND pour les mouvements, TABLEAU pour les tuiles).', en: 'Ask the director involved to remove it (REBOND for moves, TABLEAU for tiles).' },
    }),
  },
  // ---------- ROM checks and headless run ----------
  {
    id: 'header-mismatch',
    step: 'rom',
    re: /en-tête NES différent|NES header differs/,
    explain: () => ({
      what: { fr: 'L’en-tête de la ROM ne correspond pas à la cartouche choisie.', en: 'The ROM header does not match the chosen cartridge.' },
      why: { fr: 'Le flasheur lit ces 16 octets pour savoir comment brancher la mémoire.', en: 'The flasher reads these 16 bytes to wire the memory.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'rom-size',
    step: 'rom',
    re: /taille de ROM inattendue|unexpected ROM size/,
    explain: () => ({
      what: { fr: 'La ROM n’a pas la bonne taille.', en: 'The ROM does not have the right size.' },
      why: { fr: 'Elle doit faire 16 octets d’en-tête + le programme + les graphismes.', en: 'It must be 16 header bytes + program + graphics.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'mapper',
    step: 'rom',
    re: /mapper non pris en charge|unsupported mapper/,
    explain: () => ({
      what: { fr: 'La ROM annonce une puce de cartouche (mapper) inconnue.', en: 'The ROM announces an unknown cartridge chip (mapper).' },
      why: { fr: 'NES BLUM FACTORY fait des cartouches MMC3 (mapper 4).', en: 'NES BLUM FACTORY makes MMC3 cartridges (mapper 4).' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'chr-bank-full',
    step: 'rom',
    re: /banque de graphismes pleine|graphics bank full/,
    explain: () => ({
      what: { fr: 'Une banque de graphismes est pleine.', en: 'A graphics bank is full.' },
      why: { fr: 'Chaque banque de tuiles a une taille fixe (256 tuiles de fond, 64 de sprites).', en: 'Each tile bank has a fixed size (256 background tiles, 64 sprite tiles).' },
      fix: { fr: 'Demande à CHROMA de simplifier l’image (moins de tuiles différentes).', en: 'Ask CHROMA to simplify the picture (fewer different tiles).' },
    }),
  },
  {
    id: 'run-no-probe',
    step: 'run',
    re: /sonde absente|probe missing/,
    explain: () => ({
      what: { fr: 'La ROM ne démarre pas dans l’émulateur.', en: 'The ROM does not start in the emulator.' },
      why: { fr: 'Le moteur n’a pas écrit sa signature en mémoire après 600 images.', en: 'The engine did not write its signature in memory after 600 frames.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'run-frozen',
    step: 'run',
    re: /jeu figé|game frozen/,
    explain: () => ({
      what: { fr: 'Le jeu se fige dans l’émulateur.', en: 'The game freezes in the emulator.' },
      why: { fr: 'Le compteur d’images ne bouge plus : le moteur tourne en rond.', en: 'The frame counter stopped: the engine is stuck in a loop.' },
      fix: ENGINE_FIX,
    }),
  },
  {
    id: 'run-blank',
    step: 'run',
    re: /écran vide|blank screen/,
    explain: () => ({
      what: { fr: 'L’écran reste d’une seule couleur.', en: 'The screen stays one colour.' },
      why: { fr: 'Les graphismes ou la palette ne sont pas chargés.', en: 'The graphics or the palette are not loaded.' },
      fix: { fr: 'Vérifie les palettes avec CHROMA, puis reconstruis.', en: 'Check the palettes with CHROMA, then build again.' },
    }),
  },
  {
    id: 'run-lag',
    step: 'run',
    severity: 'warning',
    re: /images en retard : (\d+)|lag frames: (\d+)/,
    explain: (m) => ({
      what: { fr: `Le jeu a ralenti ${m[1] ?? m[2]} fois pendant l’essai.`, en: `The game slowed down ${m[1] ?? m[2]} times during the test.` },
      why: { fr: 'Trop de choses à calculer sur une image (beaucoup d’ennemis ou de tirs).', en: 'Too much to compute in one frame (many enemies or shots).' },
      fix: { fr: 'Ce n’est pas grave ; si ça se voit en jouant, retire un ennemi.', en: 'Not serious; if you can see it while playing, remove an enemy.' },
    }),
  },
];

export const CATALOG_IDS = CATALOG.map((e) => e.id);

function trimRaw(text: string): string {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    // ld65 lists every unused segment of the shared cfg: noise for Blum
    .filter((l) => l && !/Warning: Segment .* does not exist/.test(l));
  return lines.slice(0, 12).join('\n');
}

/** Explain one message (a tool output or a validator text). Unknown text becomes an `unknown` problem. */
export function explain(text: string, step: BuildStepId, ctx: { doc?: string; severity?: 'error' | 'warning' } = {}): Problem[] {
  const raw = trimRaw(text);
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const e of CATALOG) {
    const m = e.re.exec(text);
    if (!m) continue;
    const ex = e.explain(m, ctx);
    const key = `${e.id}|${ex.what.fr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // the generic C / asm entries only when nothing more specific matched
    if ((e.id === 'c-error' || e.id === 'asm-error') && out.length) continue;
    out.push({
      id: e.id,
      known: true,
      step: e.step ?? step,
      severity: ctx.severity ?? e.severity ?? 'error',
      ...ex,
      raw,
      ...(ctx.doc ? { doc: ctx.doc } : {}),
    });
    // one explanation per message: the catalog is ordered most specific first
    break;
  }
  if (out.length) return out;
  return [
    {
      id: 'unknown',
      known: false,
      step,
      severity: ctx.severity ?? 'error',
      what: { fr: raw.split('\n')[0] || 'erreur inconnue', en: raw.split('\n')[0] || 'unknown error' },
      why: UNKNOWN_NOTE,
      fix: { fr: 'Refais « Construire ». Si l’erreur reste, exporte le projet (zip) et envoie-le à Fred avec ce texte.', en: 'Build again. If the error stays, export the project (zip) and send it to Fred with this text.' },
      raw,
      ...(ctx.doc ? { doc: ctx.doc } : {}),
    },
  ];
}

/** Validator issues (already bilingual) explained through the catalog; the issue text stays the « quoi ». */
export function explainIssue(issue: Issue, step: BuildStepId): Problem {
  const p = explain(issue.fr, step, { doc: issue.doc, severity: issue.severity })[0]!;
  if (p.known) {
    // keep the validator's precise sentence when the catalog line is generic
    return p.id === 'not-available' || p.id === 'too-many-enemies' || p.id === 'text-too-long' ? { ...p, what: { fr: issue.fr, en: issue.en } } : p;
  }
  // a validator message the catalog does not cover: it is already a plain sentence about a project rule
  if (issue.severity === 'warning') {
    // BLUM-Q1: a warning never blocks the ROM (the sample itself has some): say so, never « annule »
    return {
      ...p,
      id: 'project-advice',
      known: true,
      what: { fr: issue.fr, en: issue.en },
      why: { fr: 'Ce n’est pas une erreur : la ROM marche. C’est un conseil pour que le jeu soit plus beau sur une vraie NES.', en: 'This is not an error: the ROM works. It is advice to make the game look better on a real NES.' },
      fix: { fr: 'Rien d’obligatoire. Si tu veux, demande à TABLEAU (niveaux) ou au directeur de ce fichier de le changer.', en: 'Nothing required. If you want, ask TABLEAU (stages) or the director of this file to change it.' },
      raw: `${issue.doc}${issue.path} ${issue.fr}`,
    };
  }
  return {
    ...p,
    id: 'project-rule',
    known: true,
    what: { fr: issue.fr, en: issue.en },
    why: { fr: 'Le projet ne respecte pas une règle de la cartouche NES.', en: 'The project breaks a rule of the NES cartridge.' },
    fix: { fr: `Demande au directeur de ce fichier (${issue.doc || 'projet'}) de le corriger, ou annule la dernière modification.`, en: `Ask the director of this file (${issue.doc || 'project'}) to fix it, or undo the last change.` },
    raw: `${issue.doc}${issue.path} ${issue.fr}`,
  };
}
