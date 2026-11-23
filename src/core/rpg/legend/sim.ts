// THE LEGEND OF BLUM (BLUMZ-M1): battle simulator, docs/RPG-PLAN.md 6.3. Same data and the same formula as
// rpg/src/battle.s: damage = base + roll(0..2) - (defence + 1), minimum 1; Défense halves (rounded up); multi =
// hits x damage (no defence); warn then blast (blocked by Défense); heal; stun (unless Défense); the
// necromancer's helper hits before each enemy move; the thief steals one collation per battle. The player
// policy is the test bot's (src/core/rpg/legend/run.ts): Défense when the enemy announced its blast, a
// collation under 35 % PV, the class power while Énergie lasts, else Attaque.
import type { BattleDef, ClassDef, GameDef } from './data.js';

export interface SimStart {
  level: number;
  hp?: number;
  energy?: number;
  collations: number;
}
export interface SimResult {
  win: boolean;
  turns: number;
  hpLeft: number;
  maxHp: number;
  log: string[];
}
export type Rolls = 'worst' | 'best' | 'mid';

export const POLICY_HEAL_PCT = 35;

export function simulateBattle(game: GameDef, cls: ClassDef, helper: { damage: number; turns: number }, b: BattleDef, start: SimStart, rolls: Rolls = 'worst', maxTurns = 40): SimResult {
  const lv = game.levels[start.level - 1]!;
  const maxHp = lv.hp;
  let hp = start.hp ?? maxHp;
  let energy = start.energy ?? lv.energy;
  let col = start.collations;
  let ehp = b.stats.hp;
  let charge = false;
  let defending = false;
  let stunned = false;
  let help = 0;
  let stolen = false;
  let pat = 0;
  let turns = 0;
  const log: string[] = [];
  const pRoll = rolls === 'worst' ? 0 : rolls === 'best' ? 2 : 1;
  const eRoll = rolls === 'worst' ? 2 : rolls === 'best' ? 0 : 1;
  const dmg = (base: number, def: number, roll: number) => Math.max(1, base + roll - (def + 1));
  const halve = (d: number) => (defending ? (d + 1) >> 1 : d);
  const enemyPhase = (): 'win' | 'lose' | 'on' => {
    if (help > 0) {
      help--;
      ehp = Math.max(0, ehp - helper.damage);
      log.push(`allié ${helper.damage}`);
      if (ehp === 0) return 'win';
    }
    const id = b.pattern[pat]!;
    pat = (pat + 1) % b.pattern.length;
    const m = b.moves.find((x) => x.id === id)!;
    let d = 0;
    switch (m.kind) {
      case 'attack':
        d = halve(dmg(b.stats.atk, lv.def, eRoll));
        break;
      case 'multi':
        d = halve((m.hits ?? 1) * (m.damage ?? 0));
        break;
      case 'warn':
        charge = true;
        break;
      case 'blast':
        charge = false;
        d = defending ? (m.blocked ?? 0) : (m.damage ?? 0);
        break;
      case 'heal':
        ehp = Math.min(b.stats.hp, ehp + (m.amount ?? 0));
        break;
      case 'stun':
        if (!defending) stunned = true;
        break;
    }
    hp = Math.max(0, hp - d);
    log.push(`${m.id} ${d}`);
    defending = false;
    if (hp === 0) return 'lose';
    if (stunned) {
      stunned = false;
      return enemyPhase();
    }
    return 'on';
  };
  while (turns < maxTurns) {
    turns++;
    if (charge) {
      defending = true;
      log.push('défense');
    } else if (hp * 100 < maxHp * POLICY_HEAL_PCT && col > 0) {
      col--;
      hp = Math.min(maxHp, hp + game.player.collationHeal);
      log.push('collation');
    } else if (energy >= cls.cost) {
      energy -= cls.cost;
      const d = dmg(cls.power + 2 * start.level, cls.effect === 'pierce' ? 0 : b.stats.def, pRoll);
      ehp = Math.max(0, ehp - d);
      if (cls.effect === 'summon') help = helper.turns;
      log.push(`pouvoir ${d}`);
      if (ehp > 0 && cls.effect === 'steal' && !stolen) {
        stolen = true;
        col = Math.min(game.player.collationMax, col + 1);
      }
    } else {
      const d = dmg(lv.atk, b.stats.def, pRoll);
      ehp = Math.max(0, ehp - d);
      log.push(`attaque ${d}`);
    }
    if (ehp === 0) return { win: true, turns, hpLeft: hp, maxHp, log };
    const r = enemyPhase();
    if (r === 'win') return { win: true, turns, hpLeft: hp, maxHp, log };
    if (r === 'lose') return { win: false, turns, hpLeft: 0, maxHp, log };
  }
  return { win: false, turns, hpLeft: hp, maxHp, log };
}

/** What the bot (and the simulator) does on a turn. */
export function policyAction(p: { charge: boolean; hp: number; maxHp: number; collations: number; energy: number; cost: number }): 'defend' | 'item' | 'power' | 'attack' {
  if (p.charge) return 'defend';
  if (p.hp * 100 < p.maxHp * POLICY_HEAL_PCT && p.collations > 0) return 'item';
  if (p.energy >= p.cost) return 'power';
  return 'attack';
}
