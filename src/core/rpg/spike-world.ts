// LEGEND OF BLUM engine spike (BLUMZ-PLAN): rpg/spike/data/world.json -> checks -> gen/world.inc
// (ca65 data + constants for rpg/spike/src/spike.s). The full game keeps this shape (docs/RPG-PLAN.md
// section 5): data in the repo, one compiler that is the only place knowing the binary layout.
import { z } from 'zod';
import { buildSpikeArt, encodeText, textWidth, unknownChars, type SpikeArt } from './spike-art.js';

export const MAP_W = 16;
export const MAP_H = 15;
export const TEXT_W = 28;
export const TEXT_COL = 2;
export const PAGE_BYTES = TEXT_W * 2;
/** Dialogue window: 6 tile rows at BOX_TOP or BOX_BOTTOM (both on even rows: whole metatile rows). */
export const BOX_TOP = 2;
export const BOX_BOTTOM = 22;

const Line = z.string();
const Page = z.tuple([Line, Line]);
const Colour = z.number().int().min(0).max(63);
const Pal = z.array(z.tuple([Colour, Colour, Colour, Colour])).length(4);

export const WorldSchema = z.object({
  schemaVersion: z.literal(1),
  comment: z.string().optional(),
  palettes: z.object({ world: Pal, battle: Pal, sprites: Pal }),
  player: z.object({
    room: z.string(),
    x: z.number().int().min(0).max(MAP_W - 1),
    y: z.number().int().min(0).max(MAP_H - 1),
    facing: z.enum(['down', 'up', 'left', 'right']),
    hp: z.number().int().min(1).max(99),
    class: z.string(),
  }),
  classes: z.array(z.object({ id: z.string(), name: z.string(), power: z.string(), powerDamage: z.number().int().min(1).max(99) })).min(1),
  rooms: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        exits: z.object({ left: z.string().optional(), right: z.string().optional() }),
        rows: z.array(z.string()).length(MAP_H),
      }),
    )
    .min(1)
    .max(16),
  npcs: z.array(
    z.object({
      id: z.string(),
      room: z.string(),
      x: z.number().int().min(0).max(MAP_W - 1),
      y: z.number().int().min(0).max(MAP_H - 1),
      sprite: z.string(),
      dialogue: z.string(),
      gives: z.string().optional(),
    }),
  ),
  dialogue: z.record(z.string(), z.array(Page).min(1)),
  items: z.array(z.object({ id: z.string(), name: z.string(), critical: z.boolean() })),
  battles: z
    .array(
      z.object({
        id: z.string(),
        room: z.string(),
        x: z.number().int().min(0).max(MAP_W - 1),
        y: z.number().int().min(0).max(MAP_H - 1),
        flag: z.string(),
        enemy: z.object({ name: z.string(), short: z.string(), hp: z.number().int().min(1).max(99), attack: z.number().int().min(1).max(99) }),
        attackDamage: z.number().int().min(1).max(99),
        itemHeal: z.number().int().min(1).max(99),
        xp: z.number().int().min(0).max(255),
        text: z.object({ intro: Page, attack: Page, item: Page, defend: Page, enemy: Page, enemyDefended: Page, win: Page, lose: Page }),
      }),
    )
    .length(1),
});
export type World = z.infer<typeof WorldSchema>;

export interface WorldIssue {
  where: string;
  fr: string;
}

/** Everything the spike compiler refuses, in French (the full game's validator grows from this). */
export function checkWorld(w: World, art: SpikeArt = buildSpikeArt()): WorldIssue[] {
  const out: WorldIssue[] = [];
  const mts = new Map(art.tiles.metatiles.map((m) => [m.ch, m]));
  const roomIds = new Set(w.rooms.map((r) => r.id));
  const solidAt = (room: string, x: number, y: number) => mts.get(w.rooms.find((r) => r.id === room)!.rows[y]![x]!)?.solid ?? true;
  const text = (where: string, page: readonly string[]) => {
    page.forEach((l, i) => {
      if (textWidth(l) > TEXT_W) out.push({ where: `${where} ligne ${i + 1}`, fr: `${textWidth(l)} caractères, maximum ${TEXT_W} : « ${l} »` });
      const bad = unknownChars(l);
      if (bad.length) out.push({ where: `${where} ligne ${i + 1}`, fr: `caractères absents de la police : ${bad.map((c) => `« ${c} »`).join(' ')}` });
    });
  };
  for (const r of w.rooms) {
    r.rows.forEach((row, y) => {
      if ([...row].length !== MAP_W) out.push({ where: `salle ${r.id} rangée ${y}`, fr: `${[...row].length} cases au lieu de ${MAP_W}` });
      for (const ch of row) if (!mts.has(ch)) out.push({ where: `salle ${r.id} rangée ${y}`, fr: `tuile inconnue « ${ch} »` });
    });
    for (const side of ['left', 'right'] as const) {
      const to = r.exits[side];
      if (!to) continue;
      if (!roomIds.has(to)) out.push({ where: `salle ${r.id}`, fr: `sortie ${side} vers une salle inconnue « ${to} »` });
      const col = side === 'left' ? 0 : MAP_W - 1;
      const back = w.rooms.find((x) => x.id === to);
      const other = side === 'left' ? 'right' : 'left';
      if (back && back.exits[other] !== r.id) out.push({ where: `salle ${r.id}`, fr: `la salle « ${to} » n'a pas de sortie ${other} vers « ${r.id} » (aller simple : risque de blocage)` });
      const open = r.rows.some((row) => !mts.get(row[col]!)?.solid);
      if (!open) out.push({ where: `salle ${r.id}`, fr: `sortie ${side} : aucune case libre sur le bord` });
    }
  }
  if (!roomIds.has(w.player.room)) out.push({ where: 'joueur', fr: `salle de départ inconnue « ${w.player.room} »` });
  else if (solidAt(w.player.room, w.player.x, w.player.y)) out.push({ where: 'joueur', fr: 'la case de départ est un mur' });
  if (!w.classes.some((c) => c.id === w.player.class)) out.push({ where: 'joueur', fr: `classe inconnue « ${w.player.class} »` });
  for (const c of w.classes) text(`classe ${c.id}`, [`${c.power} !`, `${c.powerDamage} dégâts.`]);
  const items = new Set(w.items.map((i) => i.id));
  for (const n of w.npcs) {
    if (!roomIds.has(n.room)) out.push({ where: n.id, fr: `salle inconnue « ${n.room} »` });
    if (!w.dialogue[n.dialogue]) out.push({ where: n.id, fr: `dialogue inconnu « ${n.dialogue} »` });
    if (n.gives && !items.has(n.gives)) out.push({ where: n.id, fr: `objet inconnu « ${n.gives} »` });
    if (!(n.sprite in art.sprites)) out.push({ where: n.id, fr: `sprite inconnu « ${n.sprite} »` });
  }
  for (const [id, pages] of Object.entries(w.dialogue)) pages.forEach((p, i) => text(`${id} page ${i + 1}`, p));
  for (const b of w.battles) {
    if (!roomIds.has(b.room)) out.push({ where: b.id, fr: `salle inconnue « ${b.room} »` });
    for (const [k, p] of Object.entries(b.text)) text(`${b.id} ${k}`, p);
    const has = (k: keyof typeof b.text, n: number) => b.text[k].join(' ').includes(String(n));
    if (!has('attack', b.attackDamage)) out.push({ where: `${b.id} attack`, fr: `le texte ne dit pas ${b.attackDamage} dégâts` });
    if (!has('item', b.itemHeal)) out.push({ where: `${b.id} item`, fr: `le texte ne dit pas +${b.itemHeal} PV` });
    if (!has('enemy', b.enemy.attack)) out.push({ where: `${b.id} enemy`, fr: `le texte ne dit pas ${b.enemy.attack} PV` });
    if (!has('enemyDefended', Math.max(1, b.enemy.attack >> 1))) out.push({ where: `${b.id} enemyDefended`, fr: `le texte ne dit pas ${Math.max(1, b.enemy.attack >> 1)} PV` });
    if (!has('win', b.xp)) out.push({ where: `${b.id} win`, fr: `le texte ne dit pas ${b.xp} XP` });
  }
  return out;
}

export interface CompiledWorld {
  /** Constants (NAME = value), included first. */
  inc: string;
  /** Labels + .byte data, included in RODATA. */
  data: string;
  art: SpikeArt;
  /** Page index of each dialogue / battle message (for tests). */
  pages: string[][];
  battleNametable: Uint8Array;
}

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, '0')}`;
const bytes = (a: ArrayLike<number>) => {
  const lines: string[] = [];
  for (let i = 0; i < a.length; i += 16) lines.push('    .byte ' + Array.from(a).slice(i, i + 16).map(hex).join(','));
  return lines.join('\n');
};

function attrTable(pal: (mx: number, my: number) => number): number[] {
  const out: number[] = [];
  for (let ay = 0; ay < 8; ay++) {
    for (let ax = 0; ax < 8; ax++) {
      const p = (dx: number, dy: number) => {
        const mx = ax * 2 + dx;
        const my = ay * 2 + dy;
        return my < MAP_H ? pal(mx, my) & 3 : 0;
      };
      out.push(p(0, 0) | (p(1, 0) << 2) | (p(0, 1) << 4) | (p(1, 1) << 6));
    }
  }
  return out;
}

/** A window frame of h tile rows from row r, columns c0-c1, written into a tile grid. */
function windowRows(grid: number[][], r: number, c0: number, c1: number, art: SpikeArt, h = 6) {
  const f = art.tiles.frame;
  for (let i = 0; i < h; i++) {
    for (let c = c0; c <= c1; c++) {
      const edge = c === c0 ? 'l' : c === c1 ? 'r' : 'm';
      let t: number;
      if (i === 0) t = edge === 'l' ? f.tl : edge === 'r' ? f.tr : f.top;
      else if (i === h - 1) t = edge === 'l' ? f.bl : edge === 'r' ? f.br : f.bottom;
      else t = edge === 'l' ? f.left : edge === 'r' ? f.right : art.tiles.space;
      grid[r + i]![c] = t;
    }
  }
}

export interface BattleLayout {
  menuRows: number[];
  menuCol: number;
  playerHpRow: number;
  playerHpCol: number;
  enemyHpRow: number;
  enemyHpCol: number;
}
export const BATTLE_LAYOUT: BattleLayout = { menuRows: [19, 21, 23, 25], menuCol: 4, playerHpRow: 21, playerHpCol: 18, enemyHpRow: 25, enemyHpCol: 18 };

export function compileWorld(w: World): CompiledWorld {
  const art = buildSpikeArt();
  const issues = checkWorld(w, art);
  if (issues.length) throw new Error(issues.map((i) => `${i.where} : ${i.fr}`).join('\n'));
  const mtIndex = new Map(art.tiles.metatiles.map((m, i) => [m.ch, i]));
  const roomIndex = new Map(w.rooms.map((r, i) => [r.id, i]));
  const L: string[] = [];
  const def = (k: string, v: number) => L.push(`${k} = ${v}`);

  // ---- text pages (2 lines × 28 tiles, padded with spaces) ----
  const pages: string[][] = [];
  const page = (p: readonly string[]) => {
    pages.push([...p]);
    return pages.length - 1;
  };
  const player = w.player;
  const cls = w.classes.find((c) => c.id === player.class)!;
  const b = w.battles[0]!;
  const dlgFirst: number[] = [];
  const dlgCount: number[] = [];
  const dlgIds = Object.keys(w.dialogue);
  for (const id of dlgIds) {
    dlgFirst.push(pages.length);
    dlgCount.push(w.dialogue[id]!.length);
    for (const p of w.dialogue[id]!) page(p);
  }
  const pg = {
    PG_B_INTRO: page(b.text.intro),
    PG_B_ATTACK: page(b.text.attack),
    PG_B_POWER: page([`${cls.power} !`, `${cls.powerDamage} dégâts.`]),
    PG_B_ITEM: page(b.text.item),
    PG_B_DEFEND: page(b.text.defend),
    PG_B_ENEMY: page(b.text.enemy),
    PG_B_ENEMY_DEF: page(b.text.enemyDefended),
    PG_B_WIN: page(b.text.win),
    PG_B_LOSE: page(b.text.lose),
  };
  if (pages.length > 128) throw new Error(`${pages.length} pages de texte, maximum 128 dans le spike`);
  const pad = (s: string) => {
    const t = encodeText(s);
    while (t.length < TEXT_W) t.push(art.tiles.space);
    return t;
  };

  // ---- constants ----
  def('MAP_W', MAP_W);
  def('ROOM_COUNT', w.rooms.length);
  def('START_ROOM', roomIndex.get(player.room)!);
  def('START_X', player.x * 16);
  def('START_Y', player.y * 16);
  def('START_FACE', ['down', 'up', 'left', 'right'].indexOf(player.facing));
  def('START_HP', player.hp);
  def('T_SPACE', art.tiles.space);
  for (const [k, v] of Object.entries(art.tiles.frame)) def(`T_${k.toUpperCase()}`, v);
  def('DIGIT0', art.tiles.space + 1);
  for (const [k, v] of Object.entries(art.sprites)) def(`SPR_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`, v);
  def('BOX_TOP', BOX_TOP);
  def('BOX_BOTTOM', BOX_BOTTOM);
  def('TEXT_COL', TEXT_COL);
  def('TEXT_W', TEXT_W);
  def('PAGE_BYTES', PAGE_BYTES);
  def('NPC_COUNT', w.npcs.length);
  const n0 = w.npcs[0]!;
  def('NPC0_ROOM', roomIndex.get(n0.room)!);
  def('NPC0_X', n0.x * 16);
  def('NPC0_Y', n0.y * 16);
  def('NPC0_DLG_FIRST', dlgFirst[dlgIds.indexOf(n0.dialogue)]!);
  def('NPC0_DLG_COUNT', dlgCount[dlgIds.indexOf(n0.dialogue)]!);
  def('NPC0_GIVES', n0.gives ? 1 : 0); // flag bit 0 = ITEM_CLOCHE
  def('ENEMY_ROOM', roomIndex.get(b.room)!);
  def('ENEMY_X', b.x * 16);
  def('ENEMY_Y', b.y * 16);
  def('ENEMY_HP', b.enemy.hp);
  def('ENEMY_ATK', b.enemy.attack);
  def('ENEMY_ATK_DEF', Math.max(1, b.enemy.attack >> 1));
  def('ATTACK_DMG', b.attackDamage);
  def('POWER_DMG', cls.powerDamage);
  def('ITEM_HEAL', b.itemHeal);
  def('BATTLE_XP', b.xp);
  for (const [k, v] of Object.entries(pg)) def(k, v);
  const lay = BATTLE_LAYOUT;
  def('B_PHP_ADDR', lay.playerHpRow * 32 + lay.playerHpCol);
  def('B_EHP_ADDR', lay.enemyHpRow * 32 + lay.enemyHpCol);
  def('B_CURSOR_X', (lay.menuCol - 2) * 8);
  lay.menuRows.forEach((r, i) => def(`B_MENU_Y${i}`, r * 8 - 1));

  // ---- metatiles ----
  const mt = art.tiles.metatiles;
  const C = L.splice(0, L.length); // constants -> world.inc; data below -> world-data.inc
  for (const k of ['tl', 'tr', 'bl', 'br'] as const) L.push(`mt_${k}:`, bytes(mt.map((m) => m[k])));
  L.push('mt_solid:', bytes(mt.map((m) => (m.solid ? 1 : 0))));

  // ---- rooms ----
  const roomAttr: number[][] = [];
  w.rooms.forEach((r, i) => {
    const cells = r.rows.flatMap((row) => [...row].map((ch) => mtIndex.get(ch)!));
    L.push(`room${i}_mt:`, bytes(cells));
    const at = attrTable((mx, my) => mt[cells[my * MAP_W + mx]!]!.palette);
    roomAttr.push(at);
    L.push(`room${i}_attr:`, bytes(at));
  });
  const ri = w.rooms.map((_, i) => i);
  L.push('room_mt_lo:', `    .byte ${ri.map((i) => `<room${i}_mt`).join(',')}`);
  L.push('room_mt_hi:', `    .byte ${ri.map((i) => `>room${i}_mt`).join(',')}`);
  L.push('room_attr_lo:', `    .byte ${ri.map((i) => `<room${i}_attr`).join(',')}`);
  L.push('room_attr_hi:', `    .byte ${ri.map((i) => `>room${i}_attr`).join(',')}`);
  L.push('room_exit_l:', bytes(w.rooms.map((r) => (r.exits.left ? roomIndex.get(r.exits.left)! : 0xff))));
  L.push('room_exit_r:', bytes(w.rooms.map((r) => (r.exits.right ? roomIndex.get(r.exits.right)! : 0xff))));

  // ---- text ----
  pages.forEach((p, i) => L.push(`page${i}:`, bytes([...pad(p[0]!), ...pad(p[1]!)])));
  const pi = pages.map((_, i) => i);
  L.push('page_lo:', `    .byte ${pi.map((i) => `<page${i}`).join(',')}`);
  L.push('page_hi:', `    .byte ${pi.map((i) => `>page${i}`).join(',')}`);

  // ---- palettes ----
  const flat = (p: number[][]) => p.flat();
  L.push('pal_world:', bytes([...flat(w.palettes.world), ...flat(w.palettes.sprites)]));
  L.push('pal_battle:', bytes([...flat(w.palettes.battle), ...flat(w.palettes.sprites)]));

  // ---- battle screen (1 KiB nametable + attributes) ----
  const grid: number[][] = Array.from({ length: 30 }, () => new Array<number>(32).fill(0));
  const pal: number[][] = Array.from({ length: MAP_H }, () => new Array<number>(MAP_W).fill(0));
  windowRows(grid, 2, 1, 30, art); // message window, same place as the top dialogue box
  windowRows(grid, 18, 1, 12, art, 10); // menu
  windowRows(grid, 18, 14, 30, art, 10); // status
  const put = (r: number, c: number, s: string) => encodeText(s).forEach((t, i) => (grid[r]![c + i] = t));
  ['Attaque', 'Pouvoir', 'Objet', 'Défense'].forEach((s, i) => put(lay.menuRows[i]!, lay.menuCol, s));
  put(19, 15, `Blum ${cls.name}`.slice(0, 15));
  put(lay.playerHpRow, 15, `PV ${String(player.hp).padStart(2, ' ')}/${String(player.hp).padStart(2, ' ')}`);
  put(23, 15, b.enemy.short.slice(0, 15));
  put(lay.enemyHpRow, 15, `PV ${String(b.enemy.hp).padStart(2, ' ')}`);
  art.tiles.enemy.forEach((t, i) => (grid[10 + (i >> 2)]![6 + (i & 3)] = t));
  pal[5]![3] = pal[5]![4] = pal[6]![3] = pal[6]![4] = 1;
  const g = mt[mtIndex.get('g')!]!;
  for (let mx = 0; mx < MAP_W; mx++) {
    grid[14]![mx * 2] = g.tl;
    grid[14]![mx * 2 + 1] = g.tr;
    grid[15]![mx * 2] = g.bl;
    grid[15]![mx * 2 + 1] = g.br;
    pal[7]![mx] = 2;
  }
  const battleNametable = new Uint8Array(1024);
  grid.forEach((row, r) => row.forEach((t, c) => (battleNametable[r * 32 + c] = t)));
  battleNametable.set(attrTable((mx, my) => pal[my]![mx]!), 960);
  L.push('battle_nt:', bytes(battleNametable));

  return { inc: C.join('\n') + '\n', data: L.join('\n') + '\n', art, pages, battleNametable };
}

export function parseWorld(json: unknown): World {
  return WorldSchema.parse(json);
}
