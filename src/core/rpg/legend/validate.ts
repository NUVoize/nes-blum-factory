// THE LEGEND OF BLUM (BLUMZ-M1): the validator, docs/RPG-PLAN.md section 6. Runs before every build and in
// npm test. French messages (English twin), each with the place.
//  - structure: exits both ways and open on both sides, start and warps on the floor, sprites per line;
//  - progression (6.1): a breadth-first walk over (screen, walkable area, flags, items, level) that runs every
//    script symbolically (both answers of every choice, battles won or lost, saves = reload points);
//    error when the end is unreachable, and when any reachable state (reload points included) can no longer
//    reach the end: a softlock;
//  - every class (6.2, 6.3): puzzles may require items and flags only, never a class; every battle met on
//    the way is simulated for the 5 classes at the level the story guarantees, from a retry (full PV and
//    Énergie, no collation, worst rolls): every class must win;
//  - critical items (6.4): one source, never removed, at least 2 hints said before the puzzle is solved;
//  - text and taste (6.5): page width, font, no emoji, Québec spacing, privacy (postal codes, street
//    numbers, links), names (only the bible's locked names and the declared fictional names speak).
import { badChars, lineWidth, TEXT_W } from './text.js';
import { MAP_W, MAP_H, type CompiledLegend, type CompiledScreen } from './compile.js';
import type { CondDef, LegendData, Op } from './data.js';
import { simulateBattle, type SimResult } from './sim.js';

export interface LegendIssue {
  level: 'error' | 'warning';
  code: string;
  fr: string;
  en: string;
}

/** Real names locked by the bible (BLUMZ-BRIEF): the only real people who may speak or be named. */
export const LOCKED_NAMES = ['Blum', 'Ekaterina', 'Madame Bélanger', 'Magdi', 'Nivoix', 'Maxi', 'Paul', 'Mainguy', 'Marie-Claude', 'Huguette', 'Rodolphe', 'DR', 'Roger Rudy', 'M. Gélinas', 'Bernard'];
export const MAX_TURNS = { boss: 12, normal: 6 };

type Ins =
  | { k: 'say'; id?: string }
  | { k: 'choice'; targets: number[] }
  | { k: 'jf'; cond: CondDef; target: number }
  | { k: 'jmp'; target: number }
  | { k: 'set'; f: string }
  | { k: 'clear'; f: string }
  | { k: 'give'; i: string }
  | { k: 'battle'; id: string }
  | { k: 'warp'; screen: string; x: number; y: number }
  | { k: 'save' }
  | { k: 'levelUp' }
  | { k: 'theEnd' }
  | { k: 'end' }
  | { k: 'nop' };

/** Script tree -> flat instructions with jumps (the shape of the ROM's bytecode). */
export function flattenScript(ops: Op[]): Ins[] {
  const out: Ins[] = [];
  const labels = new Map<string, number>();
  const gotos: { at: number; label: string }[] = [];
  const emit = (list: Op[]) => {
    for (const o of list) {
      if ('say' in o) out.push({ k: 'say', id: o.id });
      else if ('sayClass' in o) out.push({ k: 'say' });
      else if ('choice' in o) {
        out.push({ k: 'say', id: o.id });
        const at = out.length;
        out.push({ k: 'choice', targets: [] });
        const ends: number[] = [];
        const targets: number[] = [];
        for (const branch of o.then) {
          targets.push(out.length);
          emit(branch);
          ends.push(out.length);
          out.push({ k: 'jmp', target: -1 });
        }
        (out[at] as { targets: number[] }).targets = targets;
        for (const e of ends) (out[e] as { target: number }).target = out.length;
      } else if ('if' in o) {
        const at = out.length;
        out.push({ k: 'jf', cond: o.if, target: -1 });
        emit(o.then);
        const j = out.length;
        out.push({ k: 'jmp', target: -1 });
        (out[at] as { target: number }).target = out.length;
        emit(o.else ?? []);
        (out[j] as { target: number }).target = out.length;
      } else if ('set' in o) out.push({ k: 'set', f: o.set });
      else if ('clear' in o) out.push({ k: 'clear', f: o.clear });
      else if ('give' in o) out.push({ k: 'give', i: o.give });
      else if ('battle' in o) out.push({ k: 'battle', id: o.battle });
      else if ('warp' in o) out.push({ k: 'warp', screen: o.warp.screen, x: o.warp.x, y: o.warp.y });
      else if ('save' in o) out.push({ k: 'save' });
      else if ('levelUp' in o) out.push({ k: 'levelUp' });
      else if ('theEnd' in o) out.push({ k: 'theEnd' });
      else if ('label' in o) labels.set(o.label, out.length);
      else if ('goto' in o) {
        gotos.push({ at: out.length, label: o.goto });
        out.push({ k: 'jmp', target: -1 });
      } else out.push({ k: 'nop' });
    }
  };
  emit(ops);
  out.push({ k: 'end' });
  for (const g of gotos) (out[g.at] as { target: number }).target = labels.get(g.label) ?? -1;
  return out;
}

interface GState {
  screen: number;
  tile: number; // a walkable tile of Blum's area (any tile of the component)
  flags: Set<string>;
  items: Set<string>;
  level: number;
}

export function validateLegend(d: LegendData, c: CompiledLegend): LegendIssue[] {
  const issues: LegendIssue[] = [];
  const error = (code: string, fr: string, en: string) => issues.push({ level: 'error', code, fr, en });
  const warn = (code: string, fr: string, en: string) => issues.push({ level: 'warning', code, fr, en });
  const m = c.meta;
  const S = m.screens;
  const scripts = new Map(Object.entries(d.scripts).map(([k, v]) => [k, flattenScript(v)] as const));

  // ---- structure ----
  const walk = (s: CompiledScreen, x: number, y: number) => x >= 0 && x < MAP_W && y >= 0 && y < MAP_H && !s.solid[y * MAP_W + x];
  const opposite = { right: 'left', left: 'right', up: 'down', down: 'up' } as const;
  for (const s of S) {
    for (const [dir, to] of Object.entries(s.exits) as [keyof typeof opposite, number][]) {
      const t = S[to]!;
      if (t.exits[opposite[dir]] !== s.index) error('one-way-exit', `écran ${s.id} : la sortie ${dir} vers ${t.id} n'a pas de retour (${t.id}.${opposite[dir]})`, `screen ${s.id}: exit ${dir} to ${t.id} has no way back`);
      for (let i = 0; i < (dir === 'left' || dir === 'right' ? MAP_H : MAP_W); i++) {
        const [sx, sy, tx, ty] = dir === 'right' ? [MAP_W - 1, i, 0, i] : dir === 'left' ? [0, i, MAP_W - 1, i] : dir === 'down' ? [i, MAP_H - 1, i, 0] : [i, 0, i, MAP_H - 1];
        if (walk(s, sx, sy) && !walk(t, tx, ty)) error('blocked-exit', `écran ${s.id} (${sx}, ${sy}) : la sortie ${dir} arrive dans un mur de ${t.id} (${tx}, ${ty})`, `screen ${s.id}: exit ${dir} lands in a wall of ${t.id}`);
      }
    }
    const rows = new Map<number, number>();
    for (const e of s.entities) {
      if (e.sprite) rows.set(e.y, (rows.get(e.y) ?? 0) + 1);
      if (!s.solid[e.y * MAP_W + e.x] && e.sprite === null && !e.touch && !e.talk) warn('empty-entity', `écran ${s.id} : ${e.id} ne fait rien`, `screen ${s.id}: ${e.id} does nothing`);
    }
    for (const [y, n] of rows) if (n > 3) error('sprite-line', `écran ${s.id} rangée ${y} : ${n} personnages sur la même ligne (maximum 3 + Blum, 8 sprites par ligne)`, `screen ${s.id} row ${y}: ${n} sprites on one line`);
  }

  // ---- text and taste ----
  const names = new Set([...LOCKED_NAMES, ...d.game.fictionalNames]);
  const allText: { where: string; text: string }[] = [];
  for (const t of m.texts) for (const l of t.pages.flat()) if (l) allText.push({ where: t.where, text: l });
  for (const t of m.texts) {
    for (const l of t.pages.flat()) {
      if (lineWidth(l) > TEXT_W + 2) error('text-width', `${t.where} : ligne de ${lineWidth(l)} cases (maximum ${TEXT_W}) « ${l} »`, `${t.where}: line too wide`);
      const bad = badChars(l);
      if (bad.length) error('text-glyph', `${t.where} : caractère absent de la police « ${bad.join('')} » dans « ${l} »`, `${t.where}: glyph missing`);
    }
  }
  const speakers = new Set<string>();
  const walkWho = (ops: Op[]) => {
    for (const o of ops) {
      if (('say' in o || 'choice' in o || 'sayClass' in o) && o.who) speakers.add(o.who);
      if ('if' in o) (walkWho(o.then), walkWho(o.else ?? []));
      if ('choice' in o) o.then.forEach(walkWho);
    }
  };
  Object.values(d.scripts).forEach(walkWho);
  for (const w of speakers) if (!names.has(w)) error('name', `nom qui parle : « ${w} » n'est ni un nom réel de la bible ni dans game.json fictionalNames`, `speaker « ${w} » is not a locked or fictional name`);
  const privacy: [RegExp, string][] = [
    [/\b[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d\b/, 'code postal'],
    [/\b\d{1,5}\s*,?\s*(rue|avenue|av\.|boulevard|boul\.|chemin|place|croissant|street|st\.)\b/i, 'numéro + rue'],
    [/https?:|www\.|\.com\b|\.ca\b|maps\.|goo\.gl/i, 'lien'],
  ];
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  for (const { where, text } of [...allText, ...[...speakers].map((s) => ({ where: 'nom', text: s }))]) {
    for (const [re, what] of privacy) if (re.test(text)) error('privacy', `${where} : ${what} interdit (vie privée) « ${text} »`, `${where}: private data (${what})`);
    if (emoji.test(text)) error('emoji', `${where} : emoji interdit « ${text} »`, `${where}: emoji`);
    if (/[^\s!?;:]([!?;:])/.test(text.replace(/https?:/g, '').replace(/\d:\d/g, ''))) warn('typo', `${where} : espace manquante avant la ponctuation (typographie québécoise) « ${text} »`, `${where}: missing space before punctuation`);
  }

  // ---- puzzles: items and flags only ----
  for (const p of d.puzzles) {
    const extra = Object.keys(p.requires).filter((k) => k !== 'items' && k !== 'flags');
    if (extra.length) error('class-gate', `${p.id} : exige « ${extra.join(', ')} » : une énigme bloquante ne peut exiger que des objets et des drapeaux, jamais une classe`, `${p.id}: requires ${extra.join(', ')} (class-gated puzzle)`);
    for (const i of p.requires.items) if (!m.items.has(i)) error('puzzle-item', `${p.id} : objet inconnu ${i}`, `${p.id}: unknown item ${i}`);
    if (p.hints.length < 2) error('hints', `${p.id} : ${p.hints.length} indice(s), il en faut au moins 2`, `${p.id}: fewer than 2 hints`);
    for (const h of p.hints) if (!m.sayIds.has(h)) error('hints', `${p.id} : indice ${h} introuvable dans les scripts`, `${p.id}: hint ${h} not found`);
    const ent = S.flatMap((s) => s.entities).find((e) => e.id === p.obstacle);
    if (!ent) error('puzzle-obstacle', `${p.id} : obstacle ${p.obstacle} introuvable`, `${p.id}: obstacle ${p.obstacle} not found`);
  }
  // ---- critical items: one source ----
  const gives = new Map<string, string[]>();
  for (const [n, ins] of scripts) for (const i of ins) if (i.k === 'give') gives.set(i.i, [...(gives.get(i.i) ?? []), n]);
  for (const it of d.items.items) {
    const g = gives.get(it.id) ?? [];
    if (it.critical && g.length !== 1) error('critical-source', `${it.id} : objet critique donné ${g.length} fois (il faut exactement une source)`, `${it.id}: critical item given ${g.length} times`);
  }

  // ---- progression: breadth-first over states ----
  const flagKey = (s: GState) => `${s.screen}|${compOf(s)}|${[...s.flags].sort().join(',')}|${[...s.items].sort().join(',')}|${s.level}`;
  const visible = (scr: CompiledScreen, flags: Set<string>) => scr.entities.filter((e) => (!e.ifFlag || flags.has(e.ifFlag)) && (!e.unlessFlag || !flags.has(e.unlessFlag)));
  const compCache = new Map<string, Int16Array>();
  function comps(scr: CompiledScreen, flags: Set<string>): Int16Array {
    const vis = visible(scr, flags);
    const key = `${scr.index}|${vis.map((e) => e.id).join(',')}`;
    let cm = compCache.get(key);
    if (cm) return cm;
    cm = new Int16Array(MAP_W * MAP_H).fill(-1);
    const blocked = new Set(vis.map((e) => e.y * MAP_W + e.x));
    let n = 0;
    for (let t = 0; t < MAP_W * MAP_H; t++) {
      if (cm[t] !== -1 || scr.solid[t] || blocked.has(t)) continue;
      const q = [t];
      cm[t] = n;
      while (q.length) {
        const u = q.pop()!;
        const ux = u % MAP_W;
        const uy = Math.floor(u / MAP_W);
        for (const [vx, vy] of [[ux + 1, uy], [ux - 1, uy], [ux, uy + 1], [ux, uy - 1]] as const) {
          if (vx < 0 || vx >= MAP_W || vy < 0 || vy >= MAP_H) continue;
          const v = vy * MAP_W + vx;
          if (cm[v] !== -1 || scr.solid[v] || blocked.has(v)) continue;
          cm[v] = n;
          q.push(v);
        }
      }
      n++;
    }
    compCache.set(key, cm);
    return cm;
  }
  function compOf(s: GState): number {
    return comps(S[s.screen]!, s.flags)[s.tile]!;
  }
  const evalCond = (cond: CondDef, s: GState): boolean =>
    'flag' in cond ? s.flags.has(cond.flag) : 'notFlag' in cond ? !s.flags.has(cond.notFlag) : 'item' in cond ? s.items.has(cond.item) : 'notItem' in cond ? !s.items.has(cond.notItem) : cond.all.every((k) => evalCond(k, s));
  const battlesMet = new Map<string, number>(); // battle -> lowest level met
  const hintSeen = new Map<string, boolean>(); // hint id -> said while its puzzle was open
  const puzzleOfHint = new Map<string, (typeof d.puzzles)[number]>();
  for (const p of d.puzzles) for (const h of p.hints) puzzleOfHint.set(h, p);
  const unlockOf = new Map<string, (typeof d.puzzles)[number]>();
  for (const p of d.puzzles) for (const f of p.unlocks.flags) unlockOf.set(f, p);

  interface Outcome {
    s: GState;
    goal: boolean;
  }
  const clone = (s: GState): GState => ({ screen: s.screen, tile: s.tile, flags: new Set(s.flags), items: new Set(s.items), level: s.level });
  const tileOk = (screen: number, tile: number, flags: Set<string>) => comps(S[screen]!, flags)[tile]! >= 0;
  function runScript(name: string, s0: GState, where: string): Outcome[] {
    const ins = scripts.get(name)!;
    const out: Outcome[] = [];
    const seen = new Set<string>();
    const stack: { pc: number; s: GState }[] = [{ pc: 0, s: clone(s0) }];
    while (stack.length) {
      const { pc, s } = stack.pop()!;
      const key = `${pc}|${[...s.flags].sort().join(',')}|${[...s.items].sort().join(',')}|${s.level}|${s.screen}|${s.tile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const i = ins[pc]!;
      const next = (st: GState, p = pc + 1) => stack.push({ pc: p, s: st });
      switch (i.k) {
        case 'say':
          if (i.id && puzzleOfHint.has(i.id)) {
            const p = puzzleOfHint.get(i.id)!;
            if (!p.unlocks.flags.every((f) => s.flags.has(f))) hintSeen.set(i.id, true);
          }
          next(s);
          break;
        case 'choice':
          for (const t of i.targets) next(clone(s), t);
          break;
        case 'jf':
          next(s, evalCond(i.cond, s) ? pc + 1 : i.target);
          break;
        case 'jmp':
          next(s, i.target);
          break;
        case 'set': {
          const p = unlockOf.get(i.f);
          if (p && !s.flags.has(i.f)) {
            const missing = [...p.requires.items.filter((x) => !s.items.has(x)), ...p.requires.flags.filter((x) => !s.flags.has(x))];
            if (missing.length) error('puzzle-bypass', `${p.id} : ${i.f} posé par ${name} sans ${missing.join(', ')}`, `${p.id}: ${i.f} set by ${name} without ${missing.join(', ')}`);
          }
          s.flags.add(i.f);
          next(s);
          break;
        }
        case 'clear':
          s.flags.delete(i.f);
          next(s);
          break;
        case 'give':
          s.items.add(i.i);
          next(s);
          break;
        case 'battle': {
          const prev = battlesMet.get(i.id);
          if (prev === undefined || s.level < prev) battlesMet.set(i.id, s.level);
          out.push({ s: clone(s), goal: false }); // lost or fled: the script stops here, the enemy stays
          next(s);
          break;
        }
        case 'warp': {
          const scr = m.screenIndex.get(i.screen)!;
          const t = i.y * MAP_W + i.x;
          if (!tileOk(scr, t, s.flags)) error('warp-wall', `${where} (${name}) : arrivée dans un mur ou sur un personnage, ${i.screen} (${i.x}, ${i.y})`, `${name}: warp into a wall`);
          s.screen = scr;
          s.tile = t;
          next(s);
          break;
        }
        case 'save':
          out.push({ s: clone(s), goal: false }); // reload point
          next(s);
          break;
        case 'levelUp':
          s.level = Math.min(d.game.levels.length, s.level + 1);
          next(s);
          break;
        case 'theEnd':
          out.push({ s, goal: true });
          break;
        case 'end':
          out.push({ s, goal: false });
          break;
        case 'nop':
          next(s);
          break;
      }
    }
    return out;
  }

  const start: GState = { screen: m.start.screen, tile: (m.start.y / 16) * MAP_W + m.start.x / 16, flags: new Set(), items: new Set(), level: d.game.player.level };
  if (!tileOk(start.screen, start.tile, start.flags)) error('start-wall', 'départ dans un mur ou sur un personnage', 'start in a wall');
  const nodes = new Map<string, GState>();
  const edges = new Map<string, Set<string>>();
  const goals = new Set<string>();
  const queue: string[] = [];
  const addNode = (s: GState): string => {
    const k = flagKey(s);
    if (!nodes.has(k)) {
      nodes.set(k, s);
      edges.set(k, new Set());
      queue.push(k);
    }
    return k;
  };
  const link = (from: string, s: GState, goal: boolean) => {
    if (goal) {
      goals.add(from);
      return;
    }
    if (compOf(s) < 0) return;
    const k = addNode(s);
    if (k !== from) edges.get(from)!.add(k);
  };
  // the start script runs first
  const k0 = 'START';
  nodes.set(k0, start);
  edges.set(k0, new Set());
  for (const o of runScript(d.game.start.script, start, 'départ')) link(k0, o.s, o.goal);
  let guard = 0;
  while (queue.length) {
    if (++guard > 20000) {
      error('state-explosion', 'plus de 20 000 états : progression trop ramifiée pour le vérificateur', 'more than 20000 states');
      break;
    }
    const k = queue.shift()!;
    const s = nodes.get(k)!;
    const scr = S[s.screen]!;
    const cm = comps(scr, s.flags);
    const me = cm[s.tile]!;
    const tiles: number[] = [];
    for (let t = 0; t < cm.length; t++) if (cm[t] === me) tiles.push(t);
    const inComp = new Set(tiles);
    // entities next to the area
    for (const e of visible(scr, s.flags)) {
      const et = e.y * MAP_W + e.x;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const ax = e.x + dx!;
        const ay = e.y + dy!;
        if (ax < 0 || ax >= MAP_W || ay < 0 || ay >= MAP_H) return false;
        if (inComp.has(ay * MAP_W + ax)) return true;
        // across a counter (talk only)
        const cx = e.x + 2 * dx!;
        const cy = e.y + 2 * dy!;
        return !!e.talk && scr.counter[ay * MAP_W + ax] === true && cx >= 0 && cx < MAP_W && cy >= 0 && cy < MAP_H && inComp.has(cy * MAP_W + cx);
      });
      void et;
      if (!near) continue;
      for (const sc of [e.talk, e.touch]) {
        if (!sc) continue;
        for (const o of runScript(sc, s, `${scr.id}/${e.id}`)) link(k, o.s, o.goal);
      }
    }
    // screen edges
    for (const [dir, to] of Object.entries(scr.exits) as [keyof typeof opposite, number][]) {
      for (const t of tiles) {
        const x = t % MAP_W;
        const y = Math.floor(t / MAP_W);
        const edge = dir === 'right' ? x === MAP_W - 1 : dir === 'left' ? x === 0 : dir === 'down' ? y === MAP_H - 1 : y === 0;
        if (!edge) continue;
        const [tx, ty] = dir === 'right' ? [0, y] : dir === 'left' ? [MAP_W - 1, y] : dir === 'down' ? [x, 0] : [x, MAP_H - 1];
        const ns = clone(s);
        ns.screen = to;
        ns.tile = ty * MAP_W + tx;
        link(k, ns, false);
      }
    }
  }
  if (!goals.size) error('no-end', `la fin (${d.game.end}) n'est jamais atteinte depuis le départ`, 'the end is unreachable');
  // softlock: every reachable state must still reach a goal
  const canEnd = new Set<string>(goals);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [k, out] of edges) {
      if (canEnd.has(k)) continue;
      for (const t of out)
        if (canEnd.has(t)) {
          canEnd.add(k);
          grew = true;
          break;
        }
    }
  }
  const stuck = [...nodes.keys()].filter((k) => !canEnd.has(k));
  for (const k of stuck.slice(0, 5)) {
    const s = nodes.get(k)!;
    error('softlock', `blocage : depuis ${S[s.screen]?.id ?? '?'} avec [${[...s.flags].join(', ')}] et [${[...s.items].join(', ')}], la fin n'est plus atteignable`, `softlock at ${S[s.screen]?.id}`);
  }
  if (stuck.length > 5) error('softlock', `… et ${stuck.length - 5} autres états bloqués`, `… and ${stuck.length - 5} more stuck states`);
  // hints said before their puzzle is solved
  for (const p of d.puzzles) for (const h of p.hints) if (m.sayIds.has(h) && !hintSeen.get(h)) error('hints', `${p.id} : l'indice ${h} n'est jamais dit avant que l'énigme soit résolue`, `${p.id}: hint ${h} never said before the puzzle is solved`);

  // ---- every class wins every battle met on the way ----
  const sims: BattleReport[] = [];
  for (const b of d.battles.battles) {
    const level = battlesMet.get(b.id);
    if (level === undefined) {
      warn('battle-unused', `${b.id} : jamais rencontré`, `${b.id}: never met`);
      continue;
    }
    if (level < b.minLevel) error('battle-level', `${b.id} : rencontré au niveau ${level}, minLevel ${b.minLevel}`, `${b.id}: met at level ${level} below minLevel`);
    for (const cl of d.classes.classes) {
      const r = simulateBattle(d.game, cl, d.classes.helper, b, { level, collations: 0 }, 'worst');
      sims.push({ battle: b.id, cls: cl.id, level, ...r });
      const max = b.boss ? MAX_TURNS.boss : MAX_TURNS.normal;
      if (!r.win) error('battle-lost', `${b.id} : la classe ${cl.name} perd au niveau ${level} (pire tirage, sans collation)`, `${b.id}: ${cl.id} loses at level ${level}`);
      else if (r.turns > max) error('battle-long', `${b.id} : la classe ${cl.name} met ${r.turns} tours (maximum ${max})`, `${b.id}: ${cl.id} needs ${r.turns} turns`);
      else if (r.turns < 2) warn('battle-easy', `${b.id} : la classe ${cl.name} gagne en ${r.turns} tour`, `${b.id}: ${cl.id} wins in ${r.turns} turn`);
    }
  }
  lastReport = { states: nodes.size, goals: goals.size, sims, battlesMet };
  return issues;
}

export interface BattleReport extends SimResult {
  battle: string;
  cls: string;
  level: number;
}
/** Numbers of the last validateLegend run (for reports and tests). */
export let lastReport: { states: number; goals: number; sims: BattleReport[]; battlesMet: Map<string, number> } = { states: 0, goals: 0, sims: [], battlesMet: new Map() };
