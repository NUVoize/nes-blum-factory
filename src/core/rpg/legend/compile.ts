// THE LEGEND OF BLUM (BLUMZ-M1): compiler. rpg/legend/*.json + the BLUMZ-A1 kit (rpg/kit/) -> ca65 sources
// for rpg/src/legend.s (gen/legend.inc constants, gen/fixed.s tables in the fixed bank, gen/world.s maps,
// gen/text.s scripts + French text, gen/screens*.s full nametables) and the 128 KiB CHR. The compiler is
// the only place that knows the binary layout (docs/RPG-PLAN.md section 5); sizes are checked per bank.
import { encodeTile } from '../../nes/chr.js';
import { RPG_FONT_ORDER, fontPixels } from '../spike-art.js';
import { FACINGS, type AreaDef, type BattleDef, type CondDef, type EntityDef, type LegendData, type Op } from './data.js';
import type { KitFrame, LegendKit } from './kit.js';
import { CODE_END, CODE_LINE, TEXT_W, choicePages, encodeBlock, encodeLine, paginate, type Page } from './text.js';

// ---- layout contract with rpg/src/legend.s ----
export const BANK_WORLD = 0;
export const BANK_TEXT = 1;
export const BANK_SCREENS0 = 2;
export const BANK_SOUND = 29;
export const BANK_SIZE = 0x2000;
export const MAX_ENTITIES = 8;
export const ENTITY_BYTES = 9;
export const MAX_FLAGS = 256;
export const MAX_ITEMS = 32;
export const NONE = 0xff;
/** Map screen: 16 x 15 metatiles of 16 px. */
export const MAP_W = 16;
export const MAP_H = 15;
/** Dialogue window rows (top or bottom), text column. */
export const BOX_TOP = 2;
export const BOX_BOTTOM = 22;
export const TEXT_COL = 2;
export const MENU_ROW = 2;
/** Title screen: cursor column, left of COMMENCER / CONTINUER. */
export const TITLE_COL = 9;
export const MENU_H = 14;
/** Battle screen layout (rows/cols of the nametable). */
export const BATTLE = {
  msgRow: 0,
  cmdRow0: 22,
  cmdCol: 4,
  cursorCol: 3,
  commands: ['Attaque', 'Pouvoir', 'Objet', 'Défense', 'Fuite'],
  hpRow: 22,
  hpCol: 18,
  maxCol: 22,
  enRow: 24,
  enCol: 18,
  enMaxCol: 22,
  ehpRow: 27,
  ehpCol: 18,
  blumX: 200,
  blumY: 128,
};
export const OP = {
  END: 0, SAY: 1, CHOICE: 2, JMP: 3, IFFLAG: 4, IFNFLAG: 5, IFITEM: 6, IFNITEM: 7, IFCHOICE: 8, SET: 9, CLR: 10, GIVE: 11, BATTLE: 12,
  WARP: 13, CLASSSEL: 14, CARD: 15, SAVE: 16, HEAL: 17, LEVELUP: 18, MUSIC: 19, SFX: 20, CHAPTER: 21, THEEND: 22, SAYCLASS: 23, GIVECOL: 24,
} as const;
export const MOVE_KIND_ID = { attack: 0, multi: 1, warn: 2, blast: 3, heal: 4, stun: 5 } as const;
export const EFFECT_ID = { hit: 0, all: 1, steal: 2, pierce: 3, summon: 4 } as const;
export const FACE_ID = { down: 0, up: 1, left: 2, right: 3 } as const;
/** Sprite pattern bases: R2 Blum $00, R3 NPC set CH00 $40, R4 map enemies + objects $80, R5 NPC set CH01 (map) or FX (battle) $C0. */
const SPR_BASE = { blum: 0x00, ch00: 0x40, map: 0x80, r5: 0xc0 } as const;

export interface CompiledEntity {
  id: string;
  x: number;
  y: number;
  sprite: string | null;
  ifFlag: string | null;
  unlessFlag: string | null;
  talk: string | null;
  touch: string | null;
}
export interface CompiledScreen {
  id: string;
  index: number;
  area: string;
  areaIndex: number;
  rows: string[];
  /** metatile indices, 240 */
  grid: number[];
  solid: boolean[];
  counter: boolean[];
  exits: Partial<Record<'up' | 'down' | 'left' | 'right', number>>;
  entities: CompiledEntity[];
}
export interface TextPlace {
  where: string;
  pages: Page[];
}
export interface LegendMeta {
  flags: Map<string, number>;
  items: Map<string, number>;
  screens: CompiledScreen[];
  screenIndex: Map<string, number>;
  scripts: Map<string, number>;
  battles: Map<string, number>;
  cards: Map<string, number>;
  /** choice id -> option the bot takes, and where it is */
  choices: { id: number; bot: number; script: string; options: string[] }[];
  texts: TextPlace[];
  /** say ids (hints) -> script name */
  sayIds: Map<string, string>;
  classes: string[];
  start: { screen: number; x: number; y: number; facing: number };
  chr: { units: Record<string, number> };
}
export interface CompiledLegend {
  inc: string;
  fixed: string;
  world: string;
  text: string;
  screens: string[];
  chr: Uint8Array;
  meta: LegendMeta;
  sizes: { world: number; text: number; screens: number[]; chrUnits: number; nametables: number };
}

export class LegendCompileError extends Error {}

const bytes = (label: string | null, b: ArrayLike<number>) => {
  const a = Array.from(b);
  const out = label ? [`${label}:`] : [];
  for (let i = 0; i < a.length; i += 16) out.push(`    .byte ${a.slice(i, i + 16).map((x) => `$${(x & 0xff).toString(16).padStart(2, '0')}`).join(',')}`);
  return out.join('\n');
};
const sym = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');

/** Kit frame -> metasprite bytes (n, then per sprite dy dx tile attr). anchor: feet = top-left of a 16x16 map
 * tile box, raw = the frame's top-left, center = the hotspot. */
function frameBytes(f: KitFrame, base: number, anchor: 'feet' | 'raw' | 'center'): number[] {
  const out = [f.sprites.length];
  for (const s of f.sprites) {
    const dx = anchor === 'feet' ? s.x + 8 - f.hotspot.x : anchor === 'center' ? s.x - f.hotspot.x : s.x;
    const dy = anchor === 'feet' ? s.y + 16 - f.hotspot.y : anchor === 'center' ? s.y - f.hotspot.y : s.y;
    out.push(dy & 0xff, dx & 0xff, (base + s.tile) & 0xff, (s.palette & 3) | (s.flipH ? 0x40 : 0) | (s.flipV ? 0x80 : 0));
  }
  return out;
}

export function compileLegend(d: LegendData, kit: LegendKit): CompiledLegend {
  const err = (m: string): never => {
    throw new LegendCompileError(m);
  };
  if (kit.font.order.join('') !== RPG_FONT_ORDER.join('')) err('kit : la police de ui.chr ne suit pas RPG_FONT_ORDER (spike-art.ts)');

  // ---- ids ----
  const flags = new Map<string, number>();
  const flag = (f: string) => {
    if (!flags.has(f)) {
      if (!/^F_[A-Z0-9_]+$/.test(f)) err(`drapeau « ${f} » : nom invalide (F_MAJUSCULES)`);
      flags.set(f, flags.size);
    }
    return flags.get(f)!;
  };
  const items = new Map<string, number>();
  d.items.items.forEach((it, i) => items.set(it.id, i));
  const item = (i: string) => items.get(i) ?? err(`objet inconnu : ${i}`);
  const classes = d.classes.classes.map((c) => c.id);

  const screenIndex = new Map<string, number>();
  const screenArea: AreaDef[] = [];
  d.areas.forEach((a) => a.screens.forEach((s) => (screenIndex.has(s.id) ? err(`écran en double : ${s.id}`) : (screenIndex.set(s.id, screenIndex.size), screenArea.push(a)))));
  const scr = (s: string) => screenIndex.get(s) ?? err(`écran inconnu : ${s}`);
  const scriptNames = Object.keys(d.scripts);
  const scripts = new Map(scriptNames.map((n, i) => [n, i] as const));
  if (scripts.size > 254) err('plus de 254 scripts');
  const scriptId = (n: string, where: string) => scripts.get(n) ?? err(`${where} : script inconnu « ${n} »`);
  const battles = new Map(d.battles.battles.map((b, i) => [b.id, i] as const));
  const cardNames = Object.keys(d.cards);
  const cards = new Map(cardNames.map((n, i) => [n, i] as const));
  const sound = kit.sound;
  const song = (n: string) => sound[`SONG_${n.toUpperCase()}`] ?? err(`musique inconnue : ${n}`);
  const sfx = (n: string) => sound[`SFX_${n.toUpperCase()}`] ?? err(`effet sonore inconnu : ${n}`);
  // flags in a stable order: entity conditions, then scripts, then the end flag
  for (const a of d.areas) for (const s of a.screens) for (const e of s.entities) for (const f of [e.show?.if, e.show?.unless]) if (f) flag(f);
  const walkFlags = (ops: Op[]) => {
    for (const op of ops) {
      if ('set' in op) flag(op.set);
      if ('clear' in op) flag(op.clear);
      if ('if' in op) {
        const c = (k: CondDef) => ('flag' in k ? flag(k.flag) : 'notFlag' in k ? flag(k.notFlag) : 'all' in k ? k.all.forEach(c) : undefined);
        c(op.if);
        walkFlags(op.then);
        walkFlags(op.else ?? []);
      }
      if ('choice' in op) op.then.forEach(walkFlags);
    }
  };
  for (const n of scriptNames) walkFlags(d.scripts[n]!);
  flag(d.game.end);
  if (flags.size > MAX_FLAGS) err(`${flags.size} drapeaux, maximum ${MAX_FLAGS}`);

  // ---- CHR layout (1 KiB units) ----
  const chr = new Uint8Array(128 * 1024);
  const units: Record<string, number> = {};
  let unit = 0;
  const place = (name: string, data: Uint8Array, size: 1 | 2) => {
    if (size === 2 && unit % 2) unit++;
    if (data.length > size * 1024) err(`CHR ${name} : ${data.length} octets, maximum ${size * 1024}`);
    chr.set(data, unit * 1024);
    units[name] = unit;
    unit += size;
  };
  // BLUMZ-F2: the font tiles of the UI bank come from fontPixels (the kit's copy predates the redrawn accented
  // capitals; every other glyph is the same, byte for byte).
  const ui = Uint8Array.from(kit.ui);
  RPG_FONT_ORDER.forEach((ch, i) => ui.set(encodeTile(fontPixels(ch)), (kit.font.first + i) * 16));
  place('ui', ui, 2);
  for (const [id, t] of kit.tilesets) place(`ts-${id}`, t.chr, 2);
  place('title', kit.title.chr, 2);
  const pairs: string[] = [];
  for (const b of d.battles.battles) {
    const pair = `${b.backdrop}+${b.art}`;
    if (pairs.includes(pair)) continue;
    pairs.push(pair);
    const bd = kit.backdrops.get(b.backdrop) ?? err(`${b.id} : fond de combat inconnu « ${b.backdrop} »`);
    const en = kit.enemies.get(b.art) ?? err(`${b.id} : art d'ennemi inconnu « ${b.art} »`);
    const both = new Uint8Array(2048);
    both.set(bd.chr.subarray(0, 1024), 0);
    both.set(en.chr.subarray(0, 1024), 1024);
    place(`bat-${pair}`, both, 2);
  }
  place('blum', kit.blumChr, 1);
  place('npc-ch00', kit.npcChr.ch00, 1);
  place('npc-ch01', kit.npcChr.ch01, 1);
  place('map', kit.mapChr, 1);
  place('fx', kit.fxChr, 1);
  if (unit > 128) err(`CHR : ${unit} Kio sur 128`);

  // ---- metasprites ----
  const ms: number[][] = [];
  const msName: string[] = [];
  const addMs = (name: string, b: number[]) => {
    ms.push(b);
    msName.push(name);
    return ms.length - 1;
  };
  const blumMap = ['down0', 'down1', 'up0', 'up1', 'side0', 'side1'].map((n) => addMs(`blum_${n}`, frameBytes(kit.blumMap[n] ?? err(`kit : Blum ${n} manquant`), SPR_BASE.blum, 'feet')));
  const blumBattle = ['idle', 'attack', 'hurt', 'victory'].map((n) => addMs(`blumb_${n}`, frameBytes(kit.blumBattle[n] ?? err(`kit : Blum combat ${n} manquant`), SPR_BASE.blum, 'raw')));
  // sprite sets for entities: down0 down1 up side, anim flag
  const spriteSets = new Map<string, { frames: number[]; anim: boolean }>();
  const spriteSet = (name: string): number => {
    if (!spriteSets.has(name)) {
      const npc = kit.npcs.get(name);
      if (npc) {
        const base = npc.set === 'ch00' ? SPR_BASE.ch00 : SPR_BASE.r5;
        const f = (k: string) => addMs(`${name}_${k}`, frameBytes(npc.frames[k] ?? err(`kit : ${name} ${k} manquant`), base, 'feet'));
        const d0 = f('down0');
        spriteSets.set(name, { frames: [d0, f('down1'), f('up'), f('side')], anim: false });
      } else if (kit.mapEnemies.has(name)) {
        const fr = kit.mapEnemies.get(name)!;
        const a = addMs(`${name}_0`, frameBytes(fr[0]!, SPR_BASE.map, 'feet'));
        const b = addMs(`${name}_1`, frameBytes(fr[1] ?? fr[0]!, SPR_BASE.map, 'feet'));
        spriteSets.set(name, { frames: [a, b, a, a], anim: true });
      } else if (kit.objects.has(name)) {
        const a = addMs(`obj_${name}`, frameBytes(kit.objects.get(name)!, SPR_BASE.map, 'feet'));
        spriteSets.set(name, { frames: [a, a, a, a], anim: false });
      } else err(`sprite inconnu : « ${name} » (PNJ du kit, ennemi de carte ou objet)`);
    }
    return [...spriteSets.keys()].indexOf(name);
  };
  const fxIds = d.classes.classes.map((c) => {
    const fr = kit.fxPowers.get(c.fx) ?? err(`${c.id} : effet « ${c.fx} » absent du kit`);
    return [addMs(`fx_${c.fx}_0`, frameBytes(fr[0]!, SPR_BASE.r5, 'center')), addMs(`fx_${c.fx}_1`, frameBytes(fr[1] ?? fr[0]!, SPR_BASE.r5, 'center'))];
  });
  const hitFr = kit.fxCommon.get('hit') ?? err('kit : effet hit manquant');
  const fxHit = [addMs('fx_hit_0', frameBytes(hitFr[0]!, SPR_BASE.r5, 'center')), addMs('fx_hit_1', frameBytes(hitFr[1] ?? hitFr[0]!, SPR_BASE.r5, 'center'))];
  const shFr = kit.fxCommon.get('bouclier') ?? err('kit : effet bouclier manquant');
  const fxShield = addMs('fx_shield', frameBytes(shFr[0]!, SPR_BASE.r5, 'center'));

  // ---- text bank: scripts + all text ----
  const textOut: string[] = ['; generated by src/core/rpg/legend/compile.ts: do not edit', '.segment "TEXT"'];
  let textSize = 0;
  const texts: TextPlace[] = [];
  const speakers: string[] = [''];
  const speaker = (who?: string) => {
    if (!who) return 0;
    if (!speakers.includes(who)) speakers.push(who);
    return speakers.indexOf(who);
  };
  let blockN = 0;
  const block = (pages: Page[], where: string, who?: string): string => {
    for (const [a, b] of pages) for (const l of [a, b]) if ([...l].length > TEXT_W + 3 && l.includes('[n]') === false) err(`${where} : ligne trop longue « ${l} »`);
    texts.push({ where, pages });
    const label = `tb_${blockN++}`;
    const b = encodeBlock(pages, speaker(who));
    textOut.push(bytes(label, b));
    textSize += b.length;
    return label;
  };
  const sayIds = new Map<string, string>();
  const choices: LegendMeta['choices'] = [];
  const scriptLabel = (n: string) => `sc_${sym(n)}`;
  // battle and UI text. A battle message is one page (2 lines): the battle window shows a single page per message.
  const onePage = (t: string, where: string): Page[] => {
    const pages = paginate(t);
    if (pages.length > 1) err(`${where} : message de combat sur ${pages.length} pages (1 page de 2 lignes maximum) « ${t} »`);
    return pages;
  };
  const bt = d.battles.text;
  const common: Record<string, string> = {};
  for (const [k, v] of Object.entries(bt)) common[k] = block(onePage(v, `combat : ${k}`), `combat : ${k}`);
  const clsText = d.classes.classes.map((c) => block(onePage(c.battleText, `classe ${c.id}`), `classe ${c.id} : combat`));
  const helperText = block(onePage(d.classes.helper.text, 'allié'), 'nécromancien : allié');
  const stealText = block(onePage(d.classes.stealText, 'vol'), 'voleur : vol');
  const clsInfo = d.classes.classes.map((c) => block(paginate([`${c.name} : ${c.pitch}`, `Pouvoir : ${c.tiers[0]}. Plus tard : ??? et ???.`]), `classe ${c.id} : menu`));
  const clsMenu = d.classes.classes.map((c) => block([[`BLUM   ${c.name}`, 'Niveau [n]    XP [n]'], ['PV [n]/[n]    Énergie [n]/[n]', '  Objets'], ['  Classe', '  Sauvegarder']], `menu ${c.id}`));
  const itemText = d.items.items.map((it) => block(paginate(`${it.name} : ${it.description}`), `objet ${it.id}`));
  const collationText = block(paginate(`${d.items.collation.name} : [n]. ${d.items.collation.description}`), 'collation');
  const savedText = block(paginate('Partie sauvegardée.'), 'sauvegarde');
  const levelText = block(paginate('Blum passe au niveau [n] ! PV et Énergie au maximum.'), 'niveau');
  const battleTexts = d.battles.battles.map((b) => ({
    intro: block(onePage(b.intro, `${b.id} intro`), `${b.id} : intro`),
    moves: b.moves.map((m) => ({ t: block(onePage(m.text, `${b.id} ${m.id}`), `${b.id} ${m.id}`), t2: m.blockedText ? block(onePage(m.blockedText, `${b.id} ${m.id}`), `${b.id} ${m.id} (bloqué)`) : null })),
  }));

  // scripts
  let choiceN = 0;
  for (const name of scriptNames) {
    const code: string[] = [];
    let lab = 0;
    const L = () => `${scriptLabel(name)}_${lab++}`;
    const labels = new Map<string, string>();
    const op = (...b: (number | string)[]) => code.push(`    .byte ${b.map((x) => (typeof x === 'number' ? `$${x.toString(16)}` : x)).join(',')}`);
    const addr = (l: string) => [`<${l}`, `>${l}`];
    const emitCond = (c: CondDef, onFalse: string) => {
      if ('flag' in c) op(OP.IFNFLAG, flag(c.flag), ...addr(onFalse));
      else if ('notFlag' in c) op(OP.IFFLAG, flag(c.notFlag), ...addr(onFalse));
      else if ('item' in c) op(OP.IFNITEM, item(c.item), ...addr(onFalse));
      else if ('notItem' in c) op(OP.IFITEM, item(c.notItem), ...addr(onFalse));
      else c.all.forEach((k) => emitCond(k, onFalse));
    };
    const emit = (ops: Op[]) => {
      for (const o of ops) {
        const where = `script ${name}`;
        if ('say' in o) {
          const l = block(paginate(o.say), where, o.who);
          if (o.id) (sayIds.has(o.id) ? err(`id de réplique en double : ${o.id}`) : sayIds.set(o.id, name));
          op(OP.SAY, ...addr(l));
        } else if ('choice' in o) {
          const { pages, cols } = choicePages(o.choice, o.options);
          const l = block(pages, where, o.who);
          if (o.then.length !== o.options.length) err(`${where} : choix « ${o.choice} » : ${o.options.length} options mais ${o.then.length} branches`);
          if (o.bot >= o.options.length) err(`${where} : choix « ${o.choice} » : bot ${o.bot} hors des options`);
          const id = choiceN++;
          choices.push({ id, bot: o.bot, script: name, options: o.options });
          op(OP.CHOICE, ...addr(l), o.options.length, ...cols.map((c) => c + TEXT_COL), id);
          const end = L();
          const branch = o.then.map(() => L());
          o.then.forEach((_, i) => op(OP.IFCHOICE, i, ...addr(branch[i]!)));
          op(OP.JMP, ...addr(end));
          o.then.forEach((ops2, i) => {
            code.push(`${branch[i]}:`);
            emit(ops2);
            op(OP.JMP, ...addr(end));
          });
          code.push(`${end}:`);
        } else if ('if' in o) {
          const els = L();
          const end = L();
          emitCond(o.if, els);
          emit(o.then);
          op(OP.JMP, ...addr(end));
          code.push(`${els}:`);
          emit(o.else ?? []);
          code.push(`${end}:`);
        } else if ('set' in o) op(OP.SET, flag(o.set));
        else if ('clear' in o) op(OP.CLR, flag(o.clear));
        else if ('give' in o) {
          const it = d.items.items.find((x) => x.id === o.give) ?? err(`${where} : objet inconnu ${o.give}`);
          op(OP.GIVE, item(o.give));
          op(OP.SFX, sfx('item'));
          op(OP.SAY, ...addr(block(paginate(`Blum reçoit : ${it.name} !`), where)));
        } else if ('giveCollations' in o) {
          op(OP.GIVECOL, o.giveCollations);
          op(OP.SAY, ...addr(block(paginate(`Blum reçoit ${o.giveCollations} collation${o.giveCollations > 1 ? 's' : ''} !`), where)));
        } else if ('battle' in o) op(OP.BATTLE, battles.get(o.battle) ?? err(`${where} : combat inconnu ${o.battle}`));
        else if ('warp' in o) op(OP.WARP, scr(o.warp.screen), o.warp.x * 16, o.warp.y * 16, FACE_ID[o.warp.facing]);
        else if ('classSelect' in o) op(OP.CLASSSEL);
        else if ('card' in o) op(OP.CARD, cards.get(o.card) ?? err(`${where} : carte inconnue ${o.card}`));
        else if ('save' in o) {
          op(OP.SAVE);
          op(OP.SAY, ...addr(savedText));
        } else if ('heal' in o) op(OP.HEAL);
        else if ('levelUp' in o) {
          op(OP.LEVELUP);
          op(OP.SFX, sfx('levelup'));
          op(OP.SAY, ...addr(levelText));
        } else if ('music' in o) op(OP.MUSIC, song(o.music));
        else if ('sfx' in o) op(OP.SFX, sfx(o.sfx));
        else if ('chapter' in o) op(OP.CHAPTER, o.chapter);
        else if ('theEnd' in o) op(OP.THEEND, cards.get(o.theEnd) ?? err(`${where} : carte inconnue ${o.theEnd}`));
        else if ('sayClass' in o) {
          const ls = classes.map((c) => block(paginate(o.sayClass[c] ?? err(`${where} : sayClass sans ${c}`)), where, o.who));
          op(OP.SAYCLASS, ...ls.flatMap(addr));
        } else if ('label' in o) {
          const l = L();
          labels.set(o.label, l);
          code.push(`${l}:`);
        } else if ('goto' in o) {
          code.push(`    .byte $${OP.JMP.toString(16)},<__goto_${sym(o.goto)},>__goto_${sym(o.goto)}`);
        }
      }
    };
    emit(d.scripts[name]!);
    op(OP.END);
    let src = code.join('\n');
    src = src.replace(/__goto_([A-Za-z0-9_]+)/g, (_, g: string) => labels.get(g) ?? err(`script ${name} : étiquette inconnue « ${g} »`));
    textOut.push(`${scriptLabel(name)}:`, src);
    textSize += code.reduce((n, l) => n + (l.trim().startsWith('.byte') ? l.split(',').length : 0), 0);
  }
  if (choiceN > 255) err('plus de 255 choix');
  if (textSize > BANK_SIZE) err(`banque texte : ${textSize} octets, maximum ${BANK_SIZE}`);

  // ---- world bank: metatile tables, screens, entities ----
  const worldOut: string[] = ['; generated by src/core/rpg/legend/compile.ts: do not edit', '.segment "WORLD"'];
  let worldSize = 0;
  for (const a of d.areas) {
    const ts = kit.tilesets.get(a.tileset) ?? err(`aire ${a.id} : tileset inconnu « ${a.tileset} »`);
    const t = ts.table;
    const cols = [0, 1, 2, 3].map((k) => Array.from({ length: 64 }, (_, i) => (t[i * 5 + k]! + 0x80) & 0xff));
    const attr = Array.from({ length: 64 }, (_, i) => t[i * 5 + 4]!);
    worldOut.push(bytes(`mt_${sym(a.id)}`, [...cols.flat(), ...attr]));
    worldSize += 320;
  }
  const screens: CompiledScreen[] = [];
  d.areas.forEach((a, ai) => {
    const ts = kit.tilesets.get(a.tileset)!;
    const charMap = new Map(ts.metatiles.map((m) => [m.ch, m] as const));
    for (const s of a.screens) {
      const idx = screenIndex.get(s.id)!;
      const grid: number[] = [];
      const solid: boolean[] = [];
      const counter: boolean[] = [];
      s.rows.forEach((row, y) => {
        if ([...row].length !== MAP_W) err(`écran ${s.id} ligne ${y} : ${[...row].length} cases au lieu de ${MAP_W}`);
        [...row].forEach((ch, x) => {
          const m = charMap.get(ch) ?? err(`écran ${s.id} (${x}, ${y}) : case « ${ch} » absente du tileset ${a.tileset}`);
          grid.push(m.index);
          solid.push(m.solid);
          counter.push(m.counter);
        });
      });
      const pal = (x: number, y: number) => (y < MAP_H ? ts.metatiles.find((m) => m.index === grid[y * MAP_W + x])!.palette & 3 : 0);
      const at: number[] = [];
      for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) at.push(pal(bx * 2, by * 2) | (pal(bx * 2 + 1, by * 2) << 2) | (pal(bx * 2, by * 2 + 1) << 4) | (pal(bx * 2 + 1, by * 2 + 1) << 6));
      const ents: CompiledEntity[] = s.entities.map((e: EntityDef) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        sprite: e.sprite ?? null,
        ifFlag: e.show?.if ?? null,
        unlessFlag: e.show?.unless ?? null,
        talk: e.talk ?? null,
        touch: e.touch ?? null,
      }));
      const er: number[] = [ents.length];
      for (const e of ents) {
        const set = e.sprite ? spriteSet(e.sprite) : NONE;
        er.push(e.x, e.y, set, FACE_ID[s.entities.find((x) => x.id === e.id)!.facing ?? 'down'], e.ifFlag ? flag(e.ifFlag) : NONE, e.unlessFlag ? flag(e.unlessFlag) : NONE, e.talk ? scriptId(e.talk, `entité ${e.id}`) : NONE, e.touch ? scriptId(e.touch, `entité ${e.id}`) : NONE, e.sprite && spriteSets.get(e.sprite)?.anim ? 1 : 0);
      }
      worldOut.push(bytes(`grid_${idx}`, grid), bytes(`attr_${idx}`, at), bytes(`ents_${idx}`, er));
      worldSize += 240 + 64 + er.length;
      const exits: CompiledScreen['exits'] = {};
      for (const [dir, to] of Object.entries(s.exits) as ['up' | 'down' | 'left' | 'right', string][]) exits[dir] = scr(to);
      screens.push({ id: s.id, index: idx, area: a.id, areaIndex: ai, rows: s.rows, grid, solid, counter, exits, entities: ents });
    }
  });
  screens.sort((x, y) => x.index - y.index);
  if (worldSize > BANK_SIZE) err(`banque monde : ${worldSize} octets, maximum ${BANK_SIZE}`);

  // ---- nametables (title, classes, cards, battles) ----
  const nts: { name: string; data: Uint8Array }[] = [];
  const addNt = (name: string, data: Uint8Array) => {
    if (data.length !== 1024) err(`nametable ${name} : ${data.length} octets`);
    nts.push({ name, data });
    return nts.length - 1;
  };
  const SPACE = 1; // font index 0 = ' '
  // BLUMZ-F2 (BLUMZ-W P3-3): stars of the kit's sky that touch the lettering (« OF », BLUM) become sky. A star is
  // a sky tile with a few lit pixels; lettering is any other tile above the cursor rows.
  const titleNt = kit.title.nametable.slice();
  const sky = titleNt[kit.title.cursorRow * 32 + TITLE_COL - 1]!;
  const titleTile = (t: number) => kit.title.chr.subarray((t - 0x80) * 16, (t - 0x80) * 16 + 16);
  const lit = (t: number) => {
    if (t < 0x80 || t === sky) return 0;
    const a = titleTile(t);
    const b = titleTile(sky);
    let n = 0;
    for (let i = 0; i < 16; i++) for (let x = 0; x < 8; x++) if (((a[i]! ^ b[i]!) >> x) & 1) n++;
    return n;
  };
  const isStar = (t: number) => t !== sky && t >= 0x80 && lit(t) <= 6;
  const isLetter = (t: number) => t !== sky && !isStar(t);
  for (let r = 1; r < 12; r++) {
    for (let col = 1; col < 31; col++) {
      if (!isStar(titleNt[r * 32 + col]!)) continue;
      const near = [-33, -32, -31, -1, 1, 31, 32, 33].some((o) => isLetter(titleNt[r * 32 + col + o]!));
      if (near) titleNt[r * 32 + col] = sky;
    }
  }
  const ntTitle = addNt('title', titleNt);
  const classesNt = kit.classes.nametable.slice();
  for (let i = 0; i < 960; i++) if (classesNt[i] === kit.common['cursor']) classesNt[i] = SPACE;
  const classRows: number[] = [];
  for (const c of d.classes.classes) {
    const enc = encodeLine(c.name.toUpperCase());
    let found = -1;
    for (let r = 0; r < 30 && found < 0; r++) {
      for (let col = 0; col + enc.length <= 32; col++) if (enc.every((v, k) => classesNt[r * 32 + col + k] === v)) found = r;
    }
    if (found < 0) err(`écran de classes : « ${c.name.toUpperCase()} » introuvable dans classes.bin`);
    classRows.push(found);
  }
  const ntClasses = addNt('classes', classesNt);
  const cardNt = cardNames.map((n) => {
    const lines = d.cards[n]!;
    const nt = new Uint8Array(1024);
    const r0 = Math.max(2, 14 - lines.length);
    lines.forEach((l, i) => {
      const enc = encodeLine(l);
      if (enc.length > 30) err(`carte ${n} : ligne trop longue « ${l} »`);
      texts.push({ where: `carte ${n}`, pages: [[l, '']] });
      const col = Math.floor((32 - enc.length) / 2);
      nt.set(enc, (r0 + i * 2) * 32 + col);
    });
    return addNt(`card-${n}`, nt);
  });
  const frame = kit.frame;
  const drawBox = (nt: Uint8Array, r0: number, c0: number, h: number, w: number) => {
    for (let r = r0; r < r0 + h; r++) {
      for (let c = c0; c < c0 + w; c++) {
        const top = r === r0;
        const bot = r === r0 + h - 1;
        const left = c === c0;
        const right = c === c0 + w - 1;
        nt[r * 32 + c] = top ? (left ? frame.tl : right ? frame.tr : frame.top) : bot ? (left ? frame.bl : right ? frame.br : frame.bottom) : left ? frame.left : right ? frame.right : SPACE;
      }
    }
  };
  const put = (nt: Uint8Array, r: number, c: number, s: string) => nt.set(encodeLine(s), r * 32 + c);
  const battleNt = d.battles.battles.map((b: BattleDef) => {
    const bd = kit.backdrops.get(b.backdrop)!;
    const en = kit.enemies.get(b.art)!;
    const nt = new Uint8Array(1024);
    for (let i = 0; i < 960; i++) nt[i] = 0x80 + bd.nametable[i]!;
    // per-quadrant palettes from the kit's attribute table, then the windows (0) and the enemy field (3)
    const q = (qx: number, qy: number) => (bd.nametable[960 + (qy >> 1) * 8 + (qx >> 1)]! >> (((qy & 1) << 2) | ((qx & 1) << 1))) & 3;
    const pal: number[][] = Array.from({ length: 15 }, (_, qy) => Array.from({ length: 16 }, (_, qx) => q(qx, qy)));
    const rows = en.grid.length;
    const cols = en.grid[0]!.length;
    const top = 19 - rows + 1;
    const left = 2 + Math.floor((14 - cols) / 2);
    en.grid.forEach((row, r) => row.forEach((t, c) => (t ? (nt[(top + r) * 32 + left + c] = 0xc0 + t) : undefined)));
    for (let qy = 0; qy < 15; qy++) {
      for (let qx = 0; qx < 16; qx++) {
        const r = qy * 2;
        if (r <= 4 || r >= 20) pal[qy]![qx] = 0;
        else if (r >= 14 || (r === 12 && top <= 13)) pal[qy]![qx] = 3;
      }
    }
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) nt[960 + by * 8 + bx] = pal[by * 2]![bx * 2]! | (pal[by * 2]![bx * 2 + 1]! << 2) | ((pal[by * 2 + 1]?.[bx * 2] ?? 0) << 4) | ((pal[by * 2 + 1]?.[bx * 2 + 1] ?? 0) << 6);
    drawBox(nt, 0, 1, 6, 30);
    drawBox(nt, 20, 1, 10, 12);
    drawBox(nt, 20, 13, 10, 18);
    BATTLE.commands.forEach((c, i) => put(nt, BATTLE.cmdRow0 + i, BATTLE.cmdCol, c));
    put(nt, 21, 15, 'BLUM');
    put(nt, BATTLE.hpRow, 15, 'PV');
    put(nt, BATTLE.hpRow, BATTLE.maxCol - 1, '/');
    put(nt, BATTLE.enRow - 1, 15, 'Énergie');
    put(nt, BATTLE.enRow, BATTLE.enMaxCol - 1, '/');
    put(nt, 26, 15, b.short);
    put(nt, BATTLE.ehpRow, 15, 'PV');
    return { nt: addNt(`battle-${b.id}`, nt), fxX: (left + cols / 2) * 8, fxY: (top + rows / 2) * 8 };
  });
  const perBank = BANK_SIZE / 1024;
  const screenBanks = Math.ceil(nts.length / perBank);
  if (BANK_SCREENS0 + screenBanks > BANK_SOUND) err('trop de nametables');
  const screensOut: string[] = [];
  for (let k = 0; k < screenBanks; k++) {
    const part = nts.slice(k * perBank, (k + 1) * perBank);
    screensOut.push(['; generated by src/core/rpg/legend/compile.ts: do not edit', `.segment "SCREENS${k}"`, ...part.map((n, i) => bytes(`nt_${k * perBank + i}`, n.data))].join('\n'));
  }

  // ---- fixed bank tables ----
  const fx: string[] = ['; generated by src/core/rpg/legend/compile.ts: do not edit', '.segment "RODATA"'];
  const tbl = (label: string, vals: (number | string)[]) => fx.push(`${label}: .byte ${vals.length ? vals.map((v) => (typeof v === 'number' ? `$${(v & 0xff).toString(16)}` : v)).join(',') : '0'}`);
  // areas
  const music = (a: AreaDef) => song(a.music);
  tbl('area_r1', d.areas.map((a) => units[`ts-${a.tileset}`]!));
  tbl('area_song', d.areas.map(music));
  tbl('area_mt_lo', d.areas.map((a) => `<mt_${sym(a.id)}`));
  tbl('area_mt_hi', d.areas.map((a) => `>mt_${sym(a.id)}`));
  tbl('area_pal_lo', d.areas.map((a) => `<pal_area_${sym(a.id)}`));
  tbl('area_pal_hi', d.areas.map((a) => `>pal_area_${sym(a.id)}`));
  for (const a of d.areas) fx.push(bytes(`pal_area_${sym(a.id)}`, kit.tilesets.get(a.tileset)!.palette));
  // screens
  tbl('scr_area', screens.map((s) => s.areaIndex));
  for (const k of ['grid', 'attr', 'ents'] as const) {
    tbl(`scr_${k}_lo`, screens.map((s) => `<${k}_${s.index}`));
    tbl(`scr_${k}_hi`, screens.map((s) => `>${k}_${s.index}`));
  }
  for (const dir of ['up', 'down', 'left', 'right'] as const) tbl(`scr_exit_${dir[0]}`, screens.map((s) => s.exits[dir] ?? NONE));
  // scripts
  tbl('scrp_lo', scriptNames.map((n) => `<${scriptLabel(n)}`));
  tbl('scrp_hi', scriptNames.map((n) => `>${scriptLabel(n)}`));
  // metasprites + sprite sets
  ms.forEach((b, i) => fx.push(bytes(`ms_${i}`, b)));
  tbl('ms_lo', ms.map((_, i) => `<ms_${i}`));
  tbl('ms_hi', ms.map((_, i) => `>ms_${i}`));
  const sets = [...spriteSets.values()];
  tbl('set_frames', sets.flatMap((s) => s.frames));
  tbl('set_anim', sets.map((s) => (s.anim ? 1 : 0)));
  tbl('blum_ms', blumMap);
  tbl('blumb_ms', blumBattle);
  // classes
  const cl = d.classes.classes;
  tbl('cls_effect', cl.map((c) => EFFECT_ID[c.effect]));
  tbl('cls_power', cl.map((c) => c.power));
  tbl('cls_cost', cl.map((c) => c.cost));
  tbl('cls_fx0', fxIds.map((f) => f[0]!));
  tbl('cls_fx1', fxIds.map((f) => f[1]!));
  for (const [k, arr] of [['text', clsText], ['info', clsInfo], ['menu', clsMenu]] as const) {
    tbl(`cls_${k}_lo`, arr.map((l) => `<${l}`));
    tbl(`cls_${k}_hi`, arr.map((l) => `>${l}`));
  }
  tbl('class_rows', classRows);
  // levels
  const lv = d.game.levels;
  tbl('lvl_hp', lv.map((l) => l.hp));
  tbl('lvl_atk', lv.map((l) => l.atk));
  tbl('lvl_def', lv.map((l) => l.def));
  tbl('lvl_en', lv.map((l) => l.energy));
  // items
  tbl('item_text_lo', itemText.map((l) => `<${l}`));
  tbl('item_text_hi', itemText.map((l) => `>${l}`));
  // speakers: length + tiles (shown in the window's top border)
  speakers.forEach((s, i) => fx.push(bytes(`spk_${i}`, s ? [encodeLine(` ${s} `).length, ...encodeLine(` ${s} `)] : [0])));
  tbl('spk_lo', speakers.map((_, i) => `<spk_${i}`));
  tbl('spk_hi', speakers.map((_, i) => `>spk_${i}`));
  // battles
  const bs = d.battles.battles;
  tbl('bat_hp', bs.map((b) => b.stats.hp));
  tbl('bat_atk', bs.map((b) => b.stats.atk));
  tbl('bat_def', bs.map((b) => b.stats.def));
  tbl('bat_xp', bs.map((b) => b.xp));
  tbl('bat_flags', bs.map((b) => (b.flee ? 1 : 0) | (b.boss ? 2 : 0)));
  tbl('bat_song', bs.map((b) => song(b.music)));
  tbl('bat_r1', bs.map((b) => units[`bat-${b.backdrop}+${b.art}`]!));
  tbl('bat_nt', battleNt.map((x) => x.nt));
  tbl('bat_fxx', battleNt.map((x) => x.fxX));
  tbl('bat_fxy', battleNt.map((x) => x.fxY));
  tbl('bat_intro_lo', battleTexts.map((t) => `<${t.intro}`));
  tbl('bat_intro_hi', battleTexts.map((t) => `>${t.intro}`));
  tbl('bat_pal_lo', bs.map((b) => `<pal_bat_${sym(`${b.backdrop}_${b.art}`)}`));
  tbl('bat_pal_hi', bs.map((b) => `>pal_bat_${sym(`${b.backdrop}_${b.art}`)}`));
  for (const pair of pairs) fx.push(bytes(`pal_bat_${sym(pair.replace('+', '_'))}`, kit.battlePalettes.get(pair) ?? err(`kit : palette de combat ${pair} manquante`)));
  const moveRows: { kind: number; p1: number; p2: number; t: string; t2: string }[] = [];
  const patterns: number[][] = [];
  bs.forEach((b, bi) => {
    const base = moveRows.length;
    b.moves.forEach((m, mi) => {
      const kind = MOVE_KIND_ID[m.kind];
      const p1 = m.kind === 'multi' ? (m.hits ?? err(`${b.id} ${m.id} : hits manquant`)) : m.kind === 'blast' ? (m.damage ?? err(`${b.id} ${m.id} : damage manquant`)) : m.kind === 'heal' ? (m.amount ?? err(`${b.id} ${m.id} : amount manquant`)) : 0;
      const p2 = m.kind === 'multi' ? (m.damage ?? err(`${b.id} ${m.id} : damage manquant`)) : m.kind === 'blast' ? (m.blocked ?? err(`${b.id} ${m.id} : blocked manquant`)) : 0;
      if (m.kind === 'blast' && !m.blockedText) err(`${b.id} ${m.id} : blockedText manquant`);
      const t = battleTexts[bi]!.moves[mi]!;
      moveRows.push({ kind, p1, p2, t: t.t, t2: t.t2 ?? t.t });
    });
    patterns.push(b.pattern.map((p) => base + (b.moves.findIndex((m) => m.id === p) < 0 ? err(`${b.id} : motif « ${p} » inconnu`) : b.moves.findIndex((m) => m.id === p))));
  });
  tbl('mv_kind', moveRows.map((m) => m.kind));
  tbl('mv_p1', moveRows.map((m) => m.p1));
  tbl('mv_p2', moveRows.map((m) => m.p2));
  tbl('mv_t_lo', moveRows.map((m) => `<${m.t}`));
  tbl('mv_t_hi', moveRows.map((m) => `>${m.t}`));
  tbl('mv_t2_lo', moveRows.map((m) => `<${m.t2}`));
  tbl('mv_t2_hi', moveRows.map((m) => `>${m.t2}`));
  patterns.forEach((p, i) => fx.push(bytes(`pat_${i}`, [p.length, ...p])));
  tbl('bat_pat_lo', patterns.map((_, i) => `<pat_${i}`));
  tbl('bat_pat_hi', patterns.map((_, i) => `>pat_${i}`));
  // common battle / UI text addresses
  for (const [k, l] of Object.entries(common)) fx.push(`txt_${k} = ${l}`);
  fx.push(`txt_helper = ${helperText}`, `txt_steal = ${stealText}`, `txt_collation_info = ${collationText}`, `txt_saved = ${savedText}`, `txt_level = ${levelText}`);
  // nametables
  tbl('nt_bank', nts.map((_, i) => BANK_SCREENS0 + Math.floor(i / perBank)));
  tbl('nt_hi', nts.map((_, i) => `>nt_${i}`));
  tbl('card_nt', cardNt);
  // palettes for full screens
  const uiPal = [0x0f, 0x02, 0x30, 0x27];
  const sprBattle = kit.battlePalettes.get(pairs[0]!)!.slice(16);
  fx.push(bytes('pal_title', kit.title.palette));
  fx.push(bytes('pal_classes', [...uiPal, ...uiPal, ...uiPal, ...uiPal, ...sprBattle]));
  fx.push(bytes('pal_card', [0x0f, 0x0f, 0x30, 0x27, 0x0f, 0x0f, 0x30, 0x27, 0x0f, 0x0f, 0x30, 0x27, 0x0f, 0x0f, 0x30, 0x27, ...sprBattle]));

  // ---- constants ----
  const inc: string[] = ['; generated by src/core/rpg/legend/compile.ts: do not edit'];
  const c = (k: string, v: number) => inc.push(`${k} = ${v}`);
  c('BANK_WORLD', BANK_WORLD);
  c('BANK_TEXT', BANK_TEXT);
  c('BANK_SOUND', BANK_SOUND);
  c('SCREEN_COUNT', screens.length);
  c('AREA_COUNT', d.areas.length);
  c('SCRIPT_COUNT', scriptNames.length);
  c('BATTLE_COUNT', bs.length);
  c('CLASS_COUNT', cl.length);
  c('LEVEL_MAX', lv.length);
  c('ITEM_COUNT', d.items.items.length);
  c('FLAG_COUNT', flags.size);
  c('START_SCREEN', scr(d.game.start.screen));
  c('START_X', d.game.start.x * 16);
  c('START_Y', d.game.start.y * 16);
  c('START_FACE', FACE_ID[d.game.start.facing]);
  c('START_SCRIPT', scriptId(d.game.start.script, 'game.start'));
  c('START_LEVEL', d.game.player.level);
  c('START_COLLATIONS', d.game.player.collations);
  c('COLLATION_HEAL', d.game.player.collationHeal);
  c('COLLATION_MAX', d.game.player.collationMax);
  c('HELPER_DMG', d.classes.helper.damage);
  c('HELPER_TURNS', d.classes.helper.turns);
  c('END_FLAG', flag(d.game.end));
  for (const [k, v] of Object.entries(units)) c(`CHR_${sym(k).toUpperCase()}`, v);
  c('NT_TITLE', ntTitle);
  c('NT_CLASSES', ntClasses);
  c('TITLE_CURSOR_ROW', kit.title.cursorRow);
  c('TITLE_COL', TITLE_COL);
  // BLUMZ-F2 (BLUMZ-W P2-1): the kit's title has the arrow drawn in front of COMMENCER, so the tile under the
  // cursor is not a blank one; erase with the sky tile left of the cursor column instead.
  c('TITLE_BLANK0', kit.title.nametable[kit.title.cursorRow * 32 + TITLE_COL - 1]!);
  c('TITLE_BLANK1', kit.title.nametable[(kit.title.cursorRow + 2) * 32 + TITLE_COL - 1]!);
  c('T_SPACE', SPACE);
  c('T_CURSOR', kit.common['cursor']!);
  for (const [k, v] of Object.entries(frame)) c(`T_${k.toUpperCase()}`, v);
  c('DIGIT0', 1 + RPG_FONT_ORDER.indexOf('0'));
  c('T_SLASH', 1 + RPG_FONT_ORDER.indexOf('/'));
  for (const [k, v] of Object.entries(sound)) c(k, v);
  for (const [k, v] of Object.entries(OP)) c(`OP_${k}`, v);
  for (const [k, v] of Object.entries(MOVE_KIND_ID)) c(`MV_${k.toUpperCase()}`, v);
  for (const [k, v] of Object.entries(EFFECT_ID)) c(`EFF_${k.toUpperCase()}`, v);
  c('MS_FX_HIT0', fxHit[0]!);
  c('MS_FX_HIT1', fxHit[1]!);
  c('MS_FX_SHIELD', fxShield);
  for (const [k, v] of Object.entries(BATTLE)) if (typeof v === 'number') c(`B_${k.toUpperCase()}`, v);
  c('BOX_TOP', BOX_TOP);
  c('BOX_BOTTOM', BOX_BOTTOM);
  c('TEXT_COL', TEXT_COL);
  c('TEXT_W', TEXT_W);
  c('MENU_ROW', MENU_ROW);
  c('MENU_H', MENU_H);
  c('CODE_NUM', 0xfd);
  c('CODE_LINE', CODE_LINE);
  c('CODE_END', CODE_END);
  for (const [k, v] of flags) c(k, v);
  for (const [k, v] of items) c(k, v);

  return {
    inc: inc.join('\n') + '\n',
    fixed: fx.join('\n') + '\n',
    world: worldOut.join('\n') + '\n',
    text: textOut.join('\n') + '\n',
    screens: screensOut.map((s) => s + '\n'),
    chr,
    meta: {
      flags,
      items,
      screens,
      screenIndex,
      scripts,
      battles,
      cards,
      choices,
      texts,
      sayIds,
      classes,
      start: { screen: scr(d.game.start.screen), x: d.game.start.x * 16, y: d.game.start.y * 16, facing: FACE_ID[d.game.start.facing] },
      chr: { units },
    },
    sizes: { world: worldSize, text: textSize, screens: Array.from({ length: screenBanks }, (_, k) => Math.min(perBank, nts.length - k * perBank) * 1024), chrUnits: unit, nametables: nts.length },
  };
}

export { FACINGS };
