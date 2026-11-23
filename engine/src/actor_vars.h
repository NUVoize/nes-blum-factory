// Shots, enemy shots and boss state (M4a). Included once by game.c, before the HUD and probe code
// that read them. RAM only: everything is reset by reset_actors() at each stage load.

#ifndef NBF_ACTOR_VARS_H
#define NBF_ACTOR_VARS_H

// player shots (physics projectile.*)
unsigned char s_on[MAX_SHOTS];
unsigned int s_x[MAX_SHOTS];
unsigned char s_y[MAX_SHOTS];
unsigned char s_sub[MAX_SHOTS];
unsigned char s_left[MAX_SHOTS];
unsigned char shot_cd;

// enemy and boss shots
unsigned char es_on[MAX_ESHOTS];
unsigned int es_x[MAX_ESHOTS];
unsigned char es_xs[MAX_ESHOTS];
int es_y[MAX_ESHOTS];
unsigned char es_ys[MAX_ESHOTS];
int es_vx[MAX_ESHOTS];
int es_vy[MAX_ESHOTS];
// spawn_eshot() arguments
unsigned int a_x;
int a_y;
int a_vx;
int a_vy;

// boss block in the stage's data bank (emit.ts BOSS_BLOCK): hp, damage, w, h, phases, chr bank,
// 4 metasprite pointers (right 0/1, left 0/1), then per phase [hp threshold, step count, steps ptr]
#define BB_HP 0
#define BB_DMG 1
#define BB_W 2
#define BB_H 3
#define BB_PHASES 4
#define BB_CHR 5
#define BB_MS 6
#define BB_PHASE_TABLE 14
#define BB_PHASE_SIZE 4

// boss op codes (core/engine-data/boss-dsl.ts BOSS_OPS order)
#define OP_MOVE_TO 0
#define OP_WAIT 1
#define OP_JUMP 2
#define OP_SHOOT 3
#define OP_SPAWN 4
#define OP_CHARGE 5
#define OP_VULNERABLE 6
#define OP_FLASH 7

const unsigned char * bblk;    // boss block of the current stage, 0 = none
const unsigned char * bsteps;  // steps of the current phase

// zero page: the enemy being updated (update_enemies copies a slot here) and the hot boss fields
#pragma bss-name(push, "ZEROPAGE")
unsigned int ex;
int ey;
int evy;
unsigned char exs;
unsigned char eys;
unsigned char eleft;
unsigned char et;
unsigned char egnd;
unsigned int b_x;
int b_y;
int b_vx;
int b_vy;
unsigned char b_w;
unsigned char b_h;
unsigned char b_on;
#pragma bss-name(pop)
unsigned char b_hp;
unsigned char b_phase;
unsigned char b_step;
unsigned char b_nsteps;
unsigned char b_timer;
unsigned char b_started;
unsigned char b_vuln;
unsigned char b_flash;
unsigned char b_left;
unsigned char b_gnd;
unsigned char b_wall;
unsigned char b_xs;
unsigned char b_ys;

#endif
