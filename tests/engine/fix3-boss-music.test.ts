// BLUM-FIX3: the boss song plays during every boss fight. In 4-F the boss stands in the first screen, so
// load_level's spawn_enemies() spawned it (boss song, ST_BOSS) and load_level then posted the stage song and
// ST_PLAY in the same frame: the last NBF_MUSIC_REQ write won and « tempete » played against the Gros Frette.
// The song the NMI starts is tracked from the CPU writes to NBF_MUSIC_REQ (the NMI writes $FF once it took one).
import { describe, expect, it } from 'vitest';
import { SONG_LIBRARY } from '../../src/core/engine-data/audio-library';
import { GAME_STATE } from '../../src/core/engine-data/contract';
import { BLUM_STAGE_IDS, blumProject, buildBlum, readScript } from './blum';
import { harness } from './rom';

const BOSS_STAGES = ['w1-s2', 'w2-s2', 'w3-s2', 'w4-s2', 'w4-f'] as const;

/** Follows NBF_MUSIC_REQ: `playing` is the last song the NMI handed to FamiStudio (null after a stop). */
function songTracker(h: ReturnType<typeof harness>, reqAddr: number) {
  const cpu = (h.s.nes as unknown as { cpu: { write(a: number, v: number): void } }).cpu;
  const write = cpu.write.bind(cpu);
  const t = { pending: -1, playing: null as number | null };
  cpu.write = (a: number, v: number) => {
    if (a === reqAddr) {
      if (v === 0xff) {
        if (t.pending >= 0) t.playing = t.pending === 0xfe ? null : t.pending;
        t.pending = -1;
      } else t.pending = v;
    }
    write(a, v);
  };
  return t;
}

describe('FIX3 boss music', () => {
  for (const stage of BOSS_STAGES) {
    it(`${stage}: the boss song plays from the boss spawn to its defeat, in ST_BOSS`, async () => {
      const p = await blumProject();
      const level = p.docs[`levels/${stage}.json`] as { music: string; bossMusic?: string };
      const want = SONG_LIBRARY.indexOf((level.bossMusic ?? 'boss') as (typeof SONG_LIBRARY)[number]);
      expect(want).toBeGreaterThanOrEqual(0);
      const r = await buildBlum({ startLevel: BLUM_STAGE_IDS.indexOf(stage) });
      const req = r.labels.get('NBF_MUSIC_REQ');
      expect(req).toBeDefined();
      const h = harness(r.rom!);
      const music = songTracker(h, req!);
      let fight = 0;
      let inFight = false;
      let wrong: string | null = null;
      let cleared = false;
      outer: for (const st of readScript(stage)) {
        for (let i = 0; i < st.frames; i++) {
          h.step(1, st.hold);
          const q = h.probe();
          if (q.state === GAME_STATE.clear) {
            cleared = true;
            break outer;
          }
          // the boss is on (bossHp > 0) while the player can act: the state must say boss and, from the frame
          // after the spawn (the next NMI takes the request; a death respawns the boss), the boss song plays
          const on = q.bossHp > 0 && (q.state === GAME_STATE.play || q.state === GAME_STATE.boss);
          if (on) {
            fight++;
            if (!wrong && (q.state !== GAME_STATE.boss || (inFight && music.playing !== want))) {
              wrong = `frame ${q.frame}: state ${q.state}, song ${music.playing === null ? 'none' : SONG_LIBRARY[music.playing]}`;
            }
          }
          inFight = on;
        }
      }
      expect(cleared, `${stage} not cleared`).toBe(true);
      expect(fight).toBeGreaterThan(60);
      expect(wrong, `${stage} wants « ${SONG_LIBRARY[want]} »`).toBeNull();
    });
  }
});
