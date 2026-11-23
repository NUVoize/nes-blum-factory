// TABLEAU's level validator (PLAN §5.6, MILESTONES M4-T7): size, spawn, enemies per screen, one boss,
// and a reachability *warning* from a conservative run + jump + double-jump envelope on the real grid.
// The envelope replays the engine's movement rules (engine/src/game.c) frame by frame with the project
// physics; it is a hint for Blum, never a proof (walls jumps and doors are not modelled).
import { BEHAVIOUR, LEVEL_ROWS, type BehaviourName } from '../engine-data/contract.js';
import type { Issue } from '../schema/common.js';
import type { Level, Tileset } from '../schema/engine-docs.js';
import type { Physics } from '../schema/physics.js';

export const LEVEL_LIMITS = { floorColumns: 128, enemiesPerScreen: 6, bossesPerLevel: 1 } as const;

const PW = 12;
const PH = 20;

type Kind = 'empty' | 'solid' | 'oneWay' | 'ladder' | 'hazard' | 'exit';

function kindOf(b: BehaviourName): Kind {
  switch (b) {
    case 'solid':
    case 'wall':
    case 'wallSlippery':
    case 'breakable':
    case 'conveyorLeft':
    case 'conveyorRight':
      return 'solid';
    case 'oneWay':
      return 'oneWay';
    case 'ladder':
      return 'ladder';
    case 'hazard':
      return 'hazard';
    case 'exit':
      return 'exit';
    default:
      return 'empty';
  }
}

export interface LevelGrid {
  width: number;
  at(col: number, row: number): Kind;
  /** Behaviour at a level pixel, with the engine's out-of-level rules. */
  px(x: number, y: number): Kind;
}

export function levelGrid(level: Level, tileset: Tileset): LevelGrid {
  const beh = new Map(tileset.metatiles.map((m) => [m.id, kindOf(m.behaviour)]));
  const at = (c: number, r: number): Kind => {
    if (r < 0 || r >= LEVEL_ROWS) return 'empty';
    if (c < 0 || c >= level.width) return 'solid';
    return beh.get(level.grid[r]![c]!) ?? 'empty';
  };
  return {
    width: level.width,
    at,
    px: (x, y) => (y < 0 || y >= LEVEL_ROWS * 16 ? 'empty' : x < 0 || x >= level.width * 16 ? 'solid' : at(Math.floor(x / 16), Math.floor(y / 16))),
  };
}

const solid = (k: Kind) => k === 'solid';
const floorK = (k: Kind) => k === 'solid' || k === 'oneWay';

interface Body {
  x: number;
  y: number;
}

/** Feet cell of a standing body: [col of the centre, row of the feet]. */
const node = (b: Body): [number, number] => [Math.floor((b.x + PW / 2) / 16), Math.floor((b.y + PH - 1) / 16)];

function touches(g: LevelGrid, b: Body, k: Kind): boolean {
  const pts: Array<[number, number]> = [
    [b.x + 2, b.y + 2],
    [b.x + PW - 3, b.y + 2],
    [b.x + 2, b.y + PH - 2],
    [b.x + PW - 3, b.y + PH - 2],
  ];
  return pts.some(([x, y]) => g.px(x, y) === k);
}

/** Exits are touched at the player's centre, as in the engine. */
const atExit = (g: LevelGrid, b: Body) => g.px(b.x + PW / 2, b.y + PH / 2) === 'exit';

type Arc = { landed: [number, number] | null; exit: boolean };

/**
 * One airtime from (x, y): horizontal speed vx (8.8), initial vy (8.8, negative = up), a double jump at
 * the apex when `double`. Engine collision points: 3 on the sides, 2 under the feet and over the head.
 */
function arc(g: LevelGrid, p: Physics, start: Body, vx0: number, vy0: number, double: boolean): Arc {
  let x = start.x * 256;
  let y = start.y * 256;
  let vx = vx0;
  let vy = vy0;
  let dj = double && p.doubleJump.enabled;
  for (let f = 0; f < 240; f++) {
    if (dj && vy >= 0) {
      vy = -p.doubleJump.velocity;
      dj = false;
    }
    vy = Math.min(vy + p.gravity, p.maxFall);
    // x
    const nx = x + vx;
    const bx = Math.floor(nx / 256);
    const by = Math.floor(y / 256);
    const edge = vx > 0 ? bx + PW - 1 : bx;
    if (vx !== 0 && [by, by + PH / 2, by + PH - 1].some((yy) => solid(g.px(edge, yy)))) vx = 0;
    else x = nx;
    // y
    const ny = y + vy;
    const b = { x: Math.floor(x / 256), y: Math.floor(ny / 256) };
    if (vy > 0) {
      const foot = b.y + PH - 1;
      const k1 = g.px(b.x + 2, foot);
      const k2 = g.px(b.x + PW - 3, foot);
      const prevFoot = Math.floor(y / 256) + PH - 1;
      const crossing = prevFoot < Math.floor(foot / 16) * 16;
      if (solid(k1) || solid(k2) || ((k1 === 'oneWay' || k2 === 'oneWay') && crossing)) {
        const landed = { x: b.x, y: Math.floor(foot / 16) * 16 - PH };
        if (atExit(g, landed)) return { landed: null, exit: true };
        if (touches(g, landed, 'hazard')) return { landed: null, exit: false };
        return { landed: node(landed), exit: false };
      }
    } else if (vy < 0) {
      if (solid(g.px(b.x + 2, b.y)) || solid(g.px(b.x + PW - 3, b.y))) {
        vy = 0;
        continue;
      }
    }
    y = ny;
    const body = { x: Math.floor(x / 256), y: Math.floor(y / 256) };
    if (atExit(g, body)) return { landed: null, exit: true };
    if (touches(g, body, 'hazard')) return { landed: null, exit: false };
    if (body.y > LEVEL_ROWS * 16) return { landed: null, exit: false }; // pit
    // ladders catch the player (Up held)
    if (g.px(body.x + PW / 2, body.y + PH / 2) === 'ladder') return { landed: node(body), exit: false };
  }
  return { landed: null, exit: false };
}

/** Can the player stand (or hang on a ladder) with the feet in cell (c, r)? */
function standable(g: LevelGrid, c: number, r: number): boolean {
  if (c < 0 || c >= g.width || r < 0 || r >= LEVEL_ROWS) return false;
  const here = g.at(c, r);
  const head = g.at(c, r - 1);
  if (solid(here) || solid(head) || here === 'hazard' || head === 'hazard') return false;
  return floorK(g.at(c, r + 1)) || here === 'ladder';
}

/** Breadth-first search over standing cells; true when an exit is touched. */
export function exitReachable(level: Level, tileset: Tileset, p: Physics): boolean {
  const g = levelGrid(level, tileset);
  const hasExit = level.grid.some((row, r) => row.some((_, c) => g.at(c, r) === 'exit'));
  if (!hasExit) return false;
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[level.spawn.col, level.spawn.row]];
  const key = (c: number, r: number) => `${c},${r}`;
  seen.add(key(level.spawn.col, level.spawn.row));
  const push = (n: [number, number] | null) => {
    if (!n) return;
    const k = key(n[0], n[1]);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push(n);
  };
  const speeds = [p.runMax, Math.round(p.runMax / 2), -p.runMax, -Math.round(p.runMax / 2), 0];
  while (queue.length) {
    const [c, r] = queue.shift()!;
    const body = { x: c * 16 + 2, y: r * 16 + 16 - PH };
    if (atExit(g, body) || g.at(c, r) === 'exit' || g.at(c, r - 1) === 'exit') return true;
    // walk to the next column, or walk off the ledge
    for (const d of [-1, 1]) {
      const nc = c + d;
      if (nc < 0 || nc >= g.width || solid(g.at(nc, r)) || solid(g.at(nc, r - 1))) continue;
      if (g.at(nc, r) === 'hazard' || g.at(nc, r - 1) === 'hazard') continue;
      if (standable(g, nc, r)) push([nc, r]);
      else {
        const a = arc(g, p, { x: nc * 16 + 2, y: body.y }, d * Math.round(p.runMax / 2), 0, true);
        if (a.exit) return true;
        push(a.landed);
      }
    }
    // ladders: climb up and down the column
    if (g.at(c, r) === 'ladder' && !solid(g.at(c, r - 1)) && !solid(g.at(c, r - 2))) push([c, r - 1]);
    if (g.at(c, r + 1) === 'ladder') push([c, r + 1]);
    // jumps (from the ground, or off a ladder when allowed)
    const onLadder = g.at(c, r) === 'ladder' && !floorK(g.at(c, r + 1));
    if (onLadder && !p.ladders.canJumpOff) continue;
    for (const vx of speeds) {
      for (const dbl of [false, true]) {
        if (dbl && !p.doubleJump.enabled) continue;
        const a = arc(g, p, body, vx, -p.jumpVelocity, dbl);
        if (a.exit) return true;
        push(a.landed);
      }
    }
  }
  return false;
}

const err = (doc: string, path: string, fr: string, en: string): Issue => ({ doc, path, fr, en, severity: 'error' });
const warn = (doc: string, path: string, fr: string, en: string): Issue => ({ doc, path, fr, en, severity: 'warning' });

export interface LevelContext {
  tileset: Tileset | undefined;
  physics: Physics | undefined;
  /** Actor kinds by id ('enemy' | 'boss'). */
  actorKind: (id: string) => string | undefined;
  allowWide: boolean;
}

export function validateLevel(level: Level, ctx: LevelContext): Issue[] {
  const doc = `levels/${level.id}.json`;
  const issues: Issue[] = [];
  if (level.width > LEVEL_LIMITS.floorColumns && !ctx.allowWide) {
    issues.push(
      err(doc, '/width', `niveau trop large : ${level.width} colonnes, soit ${Math.ceil(level.width / 16)} écrans (max 8 écrans)`, `stage too wide: ${level.width} columns, ${Math.ceil(level.width / 16)} screens (max 8)`),
    );
  }
  const tileset = ctx.tileset;
  if (!tileset) {
    issues.push(err(doc, '/tileset', `jeu de tuiles « ${level.tileset} » introuvable`, `tileset "${level.tileset}" not found`));
    return issues;
  }
  const g = levelGrid(level, tileset);
  const { col, row } = level.spawn;
  if (solid(g.at(col, row)) || solid(g.at(col, row - 1))) {
    issues.push(err(doc, '/spawn', `le départ (colonne ${col}, ligne ${row}) est dans un mur`, `the start (column ${col}, row ${row}) is inside a wall`));
  }
  // enemies on one screen: any window of 16 columns the camera can show
  const cols = level.entities.map((e) => e.col).sort((a, b) => a - b);
  for (let i = 0; i < cols.length; i++) {
    let n = 0;
    while (i + n < cols.length && cols[i + n]! < cols[i]! + 16) n++;
    if (n > LEVEL_LIMITS.enemiesPerScreen) {
      issues.push(
        err(doc, '/entities', `trop d’ennemis sur un écran : ${n} à partir de la colonne ${cols[i]} (max ${LEVEL_LIMITS.enemiesPerScreen})`, `too many enemies on one screen: ${n} from column ${cols[i]} (max ${LEVEL_LIMITS.enemiesPerScreen})`),
      );
      break;
    }
  }
  const bosses = level.entities.filter((e) => ctx.actorKind(e.actor) === 'boss');
  if (bosses.length > LEVEL_LIMITS.bossesPerLevel) issues.push(err(doc, '/entities', `un seul boss par niveau (il y en a ${bosses.length})`, `one boss per stage (found ${bosses.length})`));
  level.entities.forEach((e, i) => {
    const kind = ctx.actorKind(e.actor);
    if (!kind) issues.push(err(doc, `/entities/${i}/actor`, `personnage « ${e.actor} » introuvable (actors/${e.actor}.json)`, `actor "${e.actor}" not found`));
    if (solid(g.at(e.col, e.row))) issues.push(err(doc, `/entities/${i}`, `« ${e.actor} » est placé dans un mur (colonne ${e.col}, ligne ${e.row})`, `"${e.actor}" is inside a wall (column ${e.col}, row ${e.row})`));
  });
  const hasExit = level.grid.some((r, ri) => r.some((_, ci) => g.at(ci, ri) === 'exit'));
  if (!hasExit && bosses.length === 0) {
    issues.push(warn(doc, '/grid', 'ce niveau n’a ni sortie ni boss : on ne peut pas le finir', 'this stage has no exit and no boss: it cannot be finished'));
  } else if (hasExit && bosses.length === 0 && ctx.physics && !exitReachable(level, tileset, ctx.physics)) {
    // a boss stage is finished by beating the boss (EV_BOSS_DEFEATED), its exit tile is optional
    issues.push(warn(doc, '/grid', 'la sortie semble inaccessible avec les sauts actuels', 'the exit looks out of reach with the current jumps'));
  }
  return issues;
}

/** Behaviour names that the tile editor paints with (BEHAVIOUR order). */
export const PAINT_BEHAVIOURS = Object.keys(BEHAVIOUR) as BehaviourName[];
