// NES BLUM FACTORY engine: fixed contract shared with src/core/engine-data (ENGINE_DATA_VERSION 1).
// Values here are mirrored in TypeScript (engine-data/contract.ts); a vitest checks they agree.

#ifndef NBF_ENGINE_H
#define NBF_ENGINE_H

// Game states, probe $7F05 (PLAN 5.8).
#define ST_BOOT 0
#define ST_TITLE 1
#define ST_STORY 2
#define ST_PLAY 3
#define ST_DYING 4
#define ST_CLEAR 5
#define ST_BOSS 6
#define ST_ENDING 7
#define ST_GAMEOVER 8

// Tile behaviours, 4 bits per metatile (PLAN 5.6).
#define BEH_EMPTY 0
#define BEH_SOLID 1
#define BEH_ONEWAY 2
#define BEH_LADDER 3
#define BEH_WALL 4
#define BEH_WALL_SLIP 5
#define BEH_HAZARD 6
#define BEH_WATER 7
#define BEH_BREAKABLE 8
#define BEH_COLLECT 9
#define BEH_CHECKPOINT 10
#define BEH_EXIT 11
#define BEH_DOOR 12

// Event codes, probe $7F10.
#define EV_NONE 0
#define EV_DEATH_HAZARD 1
#define EV_DEATH_PIT 2
#define EV_DEATH_ENEMY 3
#define EV_CHECKPOINT 4
#define EV_PICKUP 5
#define EV_EXIT 6
#define EV_RESPAWN 7
#define EV_HURT 8
#define EV_KILL 9
#define EV_BOSS_PHASE 10
#define EV_BOSS_DEFEATED 11
#define EV_SHOT 12

// Probe flags, $7F0F.
#define PF_GROUNDED 0x01
#define PF_LADDER 0x02
#define PF_WALLGRAB 0x04
#define PF_WATER 0x08
#define PF_INVINCIBLE 0x10
#define PF_JUMPING 0x20
#define PF_DEAD 0x40
#define PF_DOUBLEJUMPED 0x80

// Enemy AI patterns (PLAN 5.7). Floor: walker, hopper, flyer, shooter.
#define AI_NONE 0
#define AI_WALKER 1
#define AI_HOPPER 2
#define AI_FLYER 3
#define AI_SHOOTER 4
#define BOSS_KIND_BASE 0xF0

// Probe block (WRAM $7F00-$7F3F).
#define PROBE ((unsigned char *)0x7F00)
#define PR_STATE 0x05
#define PR_WORLD 0x06
#define PR_STAGE 0x07
#define PR_FRAME 0x08
#define PR_PX 0x0A
#define PR_PY 0x0C
#define PR_HP 0x0D
#define PR_LIVES 0x0E
#define PR_FLAGS 0x0F
#define PR_EVENT 0x10
#define PR_BOSSHP 0x11
#define PR_ENEMIES 0x12
#define PR_CHECKPOINT 0x13
#define PR_LAG 0x14
#define PR_COLLECT 0x15
#define PR_CAMX 0x16
#define PR_STRESS_ERR 0x18
#define PR_SHOTS 0x19
#define PR_KILLS 0x1A
#define PR_ESHOTS 0x1B
#define PR_BOSSPHASE 0x1C
#define PR_TEXT 0x1D
#define PR_BOSSX 0x1E
#define PR_VX 0x20
#define PR_CHEATS 0x40

#define TS_NONE 0
#define TS_INTRO 1
#define TS_ENDING 2
#define TS_CREDITS 3
#define CHEAT_INVINCIBLE 0x01
#define CHEAT_SKIP 0x02

// Level header in a data bank (emitted by engine-data, read at load).
#define LH_WIDTH 0
#define LH_SPAWN_COL 1
#define LH_SPAWN_ROW 2
#define LH_WORLD 3
#define LH_CHR_BG 4
#define LH_CHR_ENEMIES 5
#define LH_SONG 6
#define LH_MT_COUNT 7
#define LH_MT_PTR 8
#define LH_ENT_PTR 10
#define LH_RLE_PTR 12
#define LH_EMPTY_MT 14
#define LH_BOSS_SONG 15
#define LH_SIZE 16

#define LEVEL_ROWS 13
#define MAX_METATILES 128
#define MAX_ENTITIES 64
#define MAX_ENEMIES 8
#define MAX_SHOTS 3
#define MAX_ESHOTS 4

#endif
