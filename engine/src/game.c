// NES BLUM FACTORY engine, ENGINE_DATA_VERSION 1 (PLAN 5).
// A data-driven side-scrolling platformer: every game-specific value comes from gen/ (emitted from
// the project JSON by src/core/engine-data). Directors never write this file.
//
// Structure: title -> story text -> play (scrolling stage, HUD split, player, enemies, shots, boss,
// behaviours) -> stage clear -> ... -> ending -> credits. Movement and scroll logic are written for
// this data contract after studying nesdoug's 17_Platformer and 26_Full_Game (MIT); no code is copied
// from them. Enemies and shots: actors.c; boss DSL interpreter: boss.c; text screens: screens.c.

#include "../lib/neslib.h"
#include "../lib/nesdoug.h"
#include "../lib/mmc3.h"
#include "engine.h"
#include "../gen/config.h"

// ---------------------------------------------------------------------------------------------
// Generated data (gen/data.s)
// ---------------------------------------------------------------------------------------------
extern const unsigned char world_palettes[];
extern const unsigned char title_palette[];
extern const unsigned char level_bank[];
extern const unsigned char * const level_ptr[];
extern const unsigned char * const ms_table[];
extern const unsigned char kind_ai[];
extern const unsigned int kind_speed[];
extern const unsigned char kind_hp[];
extern const unsigned char kind_ms[];
extern const unsigned char kind_flags[];
extern const unsigned char kind_dmg[];
extern const unsigned char kind_p1[];
extern const unsigned int kind_p2[];
extern const unsigned char title_screen[];
extern const unsigned char hud_static[];
extern const unsigned char text_clear[];
extern const unsigned char text_gameover[];
extern const unsigned char text_press[];
extern const unsigned char text_bank[];
extern const unsigned char * const text_ptr[];
extern const unsigned char world_intro[];
extern const unsigned char level_first[];

// HUD split double buffer (crt0.s / neslib.s NMI): the NMI copies these into irq_array on finished frames.
extern unsigned char nbf_split_on;
extern unsigned char nbf_split_ctrl;
extern unsigned char nbf_split_x;
extern unsigned char nbf_player_chr;
#pragma zpsym("nbf_split_on")
#pragma zpsym("nbf_split_ctrl")
#pragma zpsym("nbf_split_x")
#pragma zpsym("nbf_player_chr")
extern const unsigned char player_ms_bank[];

// ---------------------------------------------------------------------------------------------
// WRAM: level buffer (column-major, 16 bytes per column) and level tables
// ---------------------------------------------------------------------------------------------
#pragma bss-name(push, "LEVELBUF")
unsigned char levelbuf[4096];
#pragma bss-name(pop)

#pragma bss-name(push, "XRAM")
unsigned char mt_tl[MAX_METATILES];
unsigned char mt_tr[MAX_METATILES];
unsigned char mt_bl[MAX_METATILES];
unsigned char mt_br[MAX_METATILES];
unsigned char mt_attr[MAX_METATILES];
unsigned char mt_beh[MAX_METATILES];
unsigned char ent_kind[MAX_ENTITIES];
unsigned char ent_col[MAX_ENTITIES];
unsigned char ent_row[MAX_ENTITIES];
unsigned char ent_flags[MAX_ENTITIES];
unsigned char col_buf_l[26];
unsigned char col_buf_r[26];
unsigned char text_buf[32];
#pragma bss-name(pop)

// ---------------------------------------------------------------------------------------------
// Zero page: hot variables
// ---------------------------------------------------------------------------------------------
#pragma bss-name(push, "ZEROPAGE")
unsigned char game_state;
unsigned char pad1;
unsigned char pad1_new;
unsigned char i;
unsigned char j;
unsigned char k;
unsigned char n;
unsigned char b1;
unsigned char b2;
unsigned int cx;       // collision probe x (level pixels)
int cy;                // collision probe y (level pixels)
unsigned int px;       // player hitbox left, level pixels
unsigned char pxs;     // subpixel
int py;                // player hitbox top, level pixels (0 = top of playfield)
unsigned char pys;
int vx;                // 8.8 px/frame
int vy;
int dx;
int dy;
unsigned int t16;
unsigned int cam_x;
unsigned char grounded;
unsigned char frame_parity;
const unsigned char * dptr;
unsigned char * wptr;
// step88(): 8.8 velocity m_v + subpixel m_sub -> whole pixels m_d
int m_v;
int m_d;
unsigned char m_sub;
#pragma bss-name(pop)

// ---------------------------------------------------------------------------------------------
// RAM
// ---------------------------------------------------------------------------------------------
unsigned int frame16;
unsigned char level_index;
unsigned char lvl_width;       // columns
unsigned int lvl_px_width;     // pixels
unsigned int cam_max;
unsigned int cam_lock;         // boss arena: camera position, reached at 2 px per frame
unsigned char cam_locked;
unsigned char lvl_world;
unsigned char lvl_chr_bg;
unsigned char lvl_song;
unsigned char lvl_boss_song;
unsigned char lvl_empty_mt;
unsigned char lvl_spawn_col;
unsigned char lvl_spawn_row;
unsigned char ent_count;
unsigned char ent_next;
unsigned char right_col;
unsigned char draw_col;        // loop counter of load_level (helpers clobber i/j/k/b1)
unsigned char attr_pending;    // column whose attributes are queued next frame, 0xFF none
unsigned char coyote;
unsigned char jbuf;
unsigned char jumping;
unsigned char dj_used;         // the double jump of this airtime is spent
unsigned char facing_left;
unsigned char climbing;
unsigned char iframes;
unsigned char hp;
unsigned char lives;
unsigned char collected;
unsigned char kills;
unsigned char state_timer;
unsigned char event_code;
unsigned char cp_id;
unsigned char cp_col;
unsigned char cp_row;
unsigned char anim;
unsigned char hud_dirty;
unsigned char text_kind;
unsigned int acc;
// hurt_player() arguments
unsigned char hurt_dmg;
unsigned int hurt_from;        // source centre x

unsigned char irq_array[16];

// enemies (active slots)
unsigned char e_active[MAX_ENEMIES];
unsigned char e_kind[MAX_ENEMIES];
unsigned int e_x[MAX_ENEMIES];
unsigned char e_xs[MAX_ENEMIES];
int e_y[MAX_ENEMIES];
unsigned char e_ys[MAX_ENEMIES];
int e_vy[MAX_ENEMIES];
unsigned char e_left[MAX_ENEMIES];
unsigned char e_hp[MAX_ENEMIES];
unsigned char e_ent[MAX_ENEMIES];  // entity index, 0xFF = called by the boss
unsigned char e_t[MAX_ENEMIES];    // pattern timer / flyer phase
int e_by[MAX_ENEMIES];             // flyer base y
unsigned char e_gnd[MAX_ENEMIES];
unsigned char e_hit[MAX_ENEMIES];  // blink after a hit

#define PW 12
#define PH 20
// a in [b + lo, b + lo + len): one unsigned compare instead of two signed ones (cc65 tosicmp is slow)
#define IN_RANGE(a, b, lo, len) ((unsigned int)(a) - (unsigned int)(b) - (unsigned int)(lo) < (unsigned int)(len))
#define CAM_LEAD 120
#define TILE_BLANK_HUD HUD_TILE_BLANK

void step88(void) {
    t16 = (unsigned int)m_sub + (unsigned char)m_v;
    m_sub = (unsigned char)t16;
    m_d = (signed char)((unsigned int)m_v >> 8) + (t16 >> 8);
}

// ---------------------------------------------------------------------------------------------
// Collision lookup
// ---------------------------------------------------------------------------------------------

// Behaviour at (cx, cy). Outside the level: walls left/right, empty above and below. In hot.s.
unsigned char beh_at(void);

unsigned char solid_at(void) {
    return beh_at() == BEH_SOLID;
}

unsigned char floor_beh(unsigned char b) {
    return b == BEH_SOLID || b == BEH_ONEWAY;
}

// ---------------------------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------------------------

// Draw list: [addr_hi, addr_lo, len, tiles...]..., addr_hi 0 ends. Rendering must be off.
void draw_list(const unsigned char * p) {
    while (p[0]) {
        vram_adr(((unsigned int)p[0] << 8) | p[1]);
        k = p[2];
        p += 3;
        while (k) {
            vram_put(*p);
            ++p;
            --k;
        }
    }
}

// Text record [len, tiles...] to the HUD row 2 through the VRAM buffer (rendering on).
void hud_text(const unsigned char * t, unsigned char col) {
    multi_vram_buffer_horz(t + 1, t[0], NTADR_A(col, 2));
}

void build_column(unsigned char col) {
    wptr = levelbuf + ((unsigned int)col << 4);
    j = 0;
    for (i = 0; i < LEVEL_ROWS; ++i) {
        k = wptr[i];
        col_buf_l[j] = mt_tl[k];
        col_buf_r[j] = mt_tr[k];
        ++j;
        col_buf_l[j] = mt_bl[k];
        col_buf_r[j] = mt_br[k];
        ++j;
    }
}

unsigned int column_addr(unsigned char col) {
    return ((col & 0x10) ? 0x2400 : 0x2000) + 4 * 32 + ((col & 15) << 1);
}

unsigned char attr_byte(unsigned char colpair, unsigned char row0) {
    // colpair = even column; row0 = top metatile row of this attribute row
    wptr = levelbuf + ((unsigned int)colpair << 4) + row0;
    b1 = mt_attr[wptr[0]] | (mt_attr[wptr[16]] << 2);
    if (row0 + 1 < LEVEL_ROWS) {
        b1 |= (mt_attr[wptr[1]] << 4) | (mt_attr[wptr[17]] << 6);
    }
    return b1;
}

unsigned int attr_addr(unsigned char col, unsigned char arow) {
    return ((col & 0x10) ? 0x27C0 : 0x23C0) + (arow << 3) + ((col & 15) >> 1);
}

// Rendering off: draw a full column (tiles + its attribute bytes) straight to the PPU.
void draw_column_now(unsigned char col) {
    build_column(col);
    vram_inc(1);
    vram_adr(column_addr(col));
    for (i = 0; i < 26; ++i) vram_put(col_buf_l[i]);
    vram_adr(column_addr(col) + 1);
    for (i = 0; i < 26; ++i) vram_put(col_buf_r[i]);
    vram_inc(0);
    for (i = 1; i < 8; ++i) {
        vram_adr(attr_addr(col, i));
        vram_put(attr_byte(col & 0xFE, (i - 1) << 1));
    }
}

// Rendering on: queue a column's tiles now, its attributes next frame.
void queue_column(unsigned char col) {
    build_column(col);
    multi_vram_buffer_vert(col_buf_l, 26, column_addr(col));
    multi_vram_buffer_vert(col_buf_r, 26, column_addr(col) + 1);
    attr_pending = col;
}

void queue_attrs(void) {
    for (i = 1; i < 8; ++i) {
        one_vram_buffer(attr_byte(attr_pending & 0xFE, (i - 1) << 1), attr_addr(attr_pending, i));
    }
    attr_pending = 0xFF;
}

// Redraw one metatile cell (collectible taken).
void queue_cell(unsigned char col, unsigned char row) {
    k = levelbuf[((unsigned int)col << 4) | row];
    t16 = ((col & 0x10) ? 0x2400 : 0x2000) + ((4 + (row << 1)) << 5) + ((col & 15) << 1);
    one_vram_buffer(mt_tl[k], t16);
    one_vram_buffer(mt_tr[k], t16 + 1);
    one_vram_buffer(mt_bl[k], t16 + 32);
    one_vram_buffer(mt_br[k], t16 + 33);
}

#include "actor_vars.h"

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

void hud_values(void) {
    // hearts
    for (i = 0; i < 8; ++i) text_buf[i] = (i < hp) ? HUD_TILE_HEART : TILE_BLANK_HUD;
    multi_vram_buffer_horz(text_buf, 8, NTADR_A(2, 2));
    // lives
    text_buf[0] = HUD_TILE_LIFE;
    text_buf[1] = HUD_TILE_X;
    text_buf[2] = HUD_TILE_DIGIT0 + lives;
    multi_vram_buffer_horz(text_buf, 3, NTADR_A(13, 2));
    // boss hp while a boss fights
    if (b_on) {
        text_buf[0] = HUD_TILE_BOSS;
        text_buf[1] = HUD_TILE_DIGIT0 + (b_hp / 10);
        text_buf[2] = HUD_TILE_DIGIT0 + (b_hp % 10);
        multi_vram_buffer_horz(text_buf, 3, NTADR_A(19, 2));
    }
    // collectibles
    text_buf[0] = HUD_TILE_FLOWER;
    text_buf[1] = HUD_TILE_DIGIT0 + (collected / 10);
    text_buf[2] = HUD_TILE_DIGIT0 + (collected % 10);
    multi_vram_buffer_horz(text_buf, 3, NTADR_A(25, 2));
    hud_dirty = 0;
}

// ---------------------------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------------------------

void probe_update(void) {
    PROBE[PR_STATE] = game_state;
    PROBE[PR_WORLD] = lvl_world;
    PROBE[PR_STAGE] = level_index;
    PROBE[PR_FRAME] = (unsigned char)frame16;
    PROBE[PR_FRAME + 1] = (unsigned char)(frame16 >> 8);
    PROBE[PR_PX] = (unsigned char)px;
    PROBE[PR_PX + 1] = (unsigned char)(px >> 8);
    PROBE[PR_PY] = (py < 0) ? 0 : ((py > 255) ? 255 : (unsigned char)py);
    PROBE[PR_HP] = hp;
    PROBE[PR_LIVES] = lives;
    b1 = 0;
    if (grounded) b1 |= PF_GROUNDED;
    if (climbing) b1 |= PF_LADDER;
    if (iframes) b1 |= PF_INVINCIBLE;
    if (jumping) b1 |= PF_JUMPING;
    if (game_state == ST_DYING) b1 |= PF_DEAD;
    if (dj_used) b1 |= PF_DOUBLEJUMPED;
    PROBE[PR_FLAGS] = b1;
    PROBE[PR_EVENT] = event_code;
    PROBE[PR_CHECKPOINT] = cp_id;
    b1 = 0;
    for (i = 0; i < MAX_ENEMIES; ++i) if (e_active[i]) ++b1;
    PROBE[PR_ENEMIES] = b1;
    PROBE[PR_COLLECT] = collected;
    PROBE[PR_CAMX] = (unsigned char)cam_x;
    PROBE[PR_CAMX + 1] = (unsigned char)(cam_x >> 8);
    b1 = 0;
    for (i = 0; i < MAX_SHOTS; ++i) if (s_on[i]) ++b1;
    PROBE[PR_SHOTS] = b1;
    PROBE[PR_KILLS] = kills;
    b1 = 0;
    for (i = 0; i < MAX_ESHOTS; ++i) if (es_on[i]) ++b1;
    PROBE[PR_ESHOTS] = b1;
    PROBE[PR_BOSSHP] = b_on ? b_hp : 0;
    PROBE[PR_BOSSPHASE] = b_phase;
    PROBE[PR_BOSSX] = (unsigned char)b_x;
    PROBE[PR_BOSSX + 1] = (unsigned char)(b_x >> 8);
    PROBE[PR_TEXT] = text_kind;
    PROBE[PR_VX] = (unsigned char)vx;
    PROBE[PR_VX + 1] = (unsigned char)((unsigned int)vx >> 8);
}

// ---------------------------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------------------------

void enter_title(void) {
    ppu_off();
    nbf_split_on = 0;
    disable_irq();
    oam_clear();
    set_chr_mode_0(CHR_FONT);
    set_chr_mode_1(CHR_TITLE);
    pal_bg(title_palette);
    pal_spr(title_palette + 16);
    vram_adr(NAMETABLE_A);
    vram_fill(TILE_BLANK_HUD, 960);
    vram_fill(0, 64);
    draw_list(title_screen);
    scroll(0, 0);
    game_state = ST_TITLE;
    text_kind = TS_NONE;
    state_timer = 0;
    music_play(SONG_TITLE);
    ppu_on_all();
}

void update_title(void) {
    ++state_timer;
    if ((state_timer & 31) == 0) {
        if (state_timer & 32) {
            for (i = 0; i < text_press[0]; ++i) text_buf[i] = TILE_BLANK_HUD;
            multi_vram_buffer_horz(text_buf, text_press[0], NTADR_A(TITLE_PRESS_COL, TITLE_PRESS_ROW));
        } else {
            multi_vram_buffer_horz(text_press + 1, text_press[0], NTADR_A(TITLE_PRESS_COL, TITLE_PRESS_ROW));
        }
    }
}

// Fixed bank 31 ($E000) holds these after the reset code (cfg CODE2): $A000-$DFFF is full.
#pragma code-name(push, "CODE2")
#include "actors.c"
#include "boss.c"
#pragma code-name(pop)
#include "screens.c"

// ---------------------------------------------------------------------------------------------
// Level load
// ---------------------------------------------------------------------------------------------

void load_level(unsigned char respawn) {
    ppu_off();
    nbf_split_on = 0;
    disable_irq();
    oam_clear();
    set_prg_8000(level_bank[level_index]);
    dptr = level_ptr[level_index];
    lvl_width = dptr[LH_WIDTH];
    lvl_px_width = (unsigned int)lvl_width << 4;
    cam_max = lvl_px_width - 256;
    cam_locked = 0;
    lvl_spawn_col = dptr[LH_SPAWN_COL];
    lvl_spawn_row = dptr[LH_SPAWN_ROW];
    lvl_world = dptr[LH_WORLD];
    lvl_chr_bg = dptr[LH_CHR_BG];
    lvl_song = dptr[LH_SONG];
    lvl_boss_song = dptr[LH_BOSS_SONG];
    lvl_empty_mt = dptr[LH_EMPTY_MT];
    set_chr_mode_1(lvl_chr_bg + 2);
    set_chr_mode_3(CHR_COMMON);
    set_chr_mode_4(dptr[LH_CHR_ENEMIES]);

    // metatile tables: tl[n], tr[n], bl[n], br[n], attr[n], beh[n]
    k = dptr[LH_MT_COUNT];
    wptr = (unsigned char *)(dptr[LH_MT_PTR] | (dptr[LH_MT_PTR + 1] << 8));
    memcpy(mt_tl, wptr, k);
    memcpy(mt_tr, wptr + k, k);
    memcpy(mt_bl, wptr + 2 * k, k);
    memcpy(mt_br, wptr + 3 * k, k);
    memcpy(mt_attr, wptr + 4 * k, k);
    memcpy(mt_beh, wptr + 5 * k, k);

    // entities: count, then kind[], col[], row[], flags[], then the boss block pointer (0 = none)
    wptr = (unsigned char *)(dptr[LH_ENT_PTR] | (dptr[LH_ENT_PTR + 1] << 8));
    ent_count = wptr[0];
    memcpy(ent_kind, wptr + 1, ent_count);
    memcpy(ent_col, wptr + 1 + ent_count, ent_count);
    memcpy(ent_row, wptr + 1 + 2 * ent_count, ent_count);
    memcpy(ent_flags, wptr + 1 + 3 * ent_count, ent_count);
    wptr += 1 + 4 * ent_count;
    bblk = (const unsigned char *)(wptr[0] | (wptr[1] << 8));
    if (bblk) set_chr_mode_5(bblk[BB_CHR]);

    // grid: column-major RLE pairs [count, metatile], count 1..255, 13 cells per column
    wptr = (unsigned char *)(dptr[LH_RLE_PTR] | (dptr[LH_RLE_PTR + 1] << 8));
    i = 0;   // row
    j = 0;   // column
    while (j < lvl_width) {
        k = wptr[0];
        b2 = wptr[1];
        wptr += 2;
        while (k) {
            levelbuf[((unsigned int)j << 4) | i] = b2;
            ++i;
            if (i == LEVEL_ROWS) {
                i = 0;
                ++j;
            }
            --k;
        }
    }

    // palettes and HUD
    pal_bg(world_palettes + (lvl_world << 5));
    pal_spr(world_palettes + (lvl_world << 5) + 16);
    vram_adr(NAMETABLE_A);
    vram_fill(TILE_BLANK_HUD, 128);   // HUD rows 0-3 of nametable A
    vram_adr(0x23C0);
    vram_fill(0, 8);                  // HUD attribute row: BG subpalette 0
    draw_list(hud_static);

    // player
    if (respawn && cp_id) {
        px = ((unsigned int)cp_col << 4) + 2;
        py = ((int)cp_row << 4) + 16 - PH;
    } else {
        px = ((unsigned int)lvl_spawn_col << 4) + 2;
        py = ((int)lvl_spawn_row << 4) + 16 - PH;
    }
    pxs = 0;
    pys = 0;
    vx = 0;
    vy = 0;
    grounded = 0;
    coyote = 0;
    jbuf = 0;
    jumping = 0;
    dj_used = 0;
    climbing = 0;
    iframes = 0;
    hp = T_HP;
    facing_left = 0;

    // camera and first screen + the next one
    if (px > CAM_LEAD) cam_x = px - CAM_LEAD;
    else cam_x = 0;
    if (cam_x > cam_max) cam_x = cam_max;
    k = (unsigned char)(cam_x >> 4);
    right_col = k + 31;
    if (right_col >= lvl_width) right_col = lvl_width - 1;
    for (draw_col = (right_col > 31) ? right_col - 31 : 0; ; ++draw_col) {
        draw_column_now(draw_col);
        if (draw_col == right_col) break;
    }
    attr_pending = 0xFF;

    // state and stage song first: a boss in the first screen (4-F, or a checkpoint at the arena) is spawned
    // by spawn_enemies and posts ST_BOSS and its own song after them (BLUM-FIX3)
    game_state = ST_PLAY;
    music_play(lvl_song);
    reset_actors();
    spawn_enemies();

    // HUD split: HUD/font bank on top, world bank and scroll from scanline 32 (PLAN 5.4)
    // Order matters (timed on Mesen, see tests/mesen): the IRQ fires at the end of line 29; $2000 and
    // $2005 land before line 31's dot 257 (horizontal copy for line 32); three short waits put the CHR
    // switch in line 31's hblank, after its last fetch and before line 32's prefetch. HUD lines 30-31
    // are uniform, so the early scroll writes do not show.
    // The NMI rewrites [3], [6] and [8] on finished frames (neslib.s): keep these offsets.
    irq_array[0] = 0xF7;           // CHR mode 0 (BG $0000) before the frame: HUD/font bank
    irq_array[1] = CHR_FONT;
    irq_array[2] = 0xF9;           // CHR mode 2 (sprites $1000) before the frame: player animation bank
    irq_array[3] = CHR_PLAYER;
    irq_array[4] = HUD_SPLIT_LINE; // IRQ after the HUD rows; latch never 0
    irq_array[5] = 0xF0;           // $2000: nametable of the playfield
    irq_array[6] = 0x88 | ((cam_x >> 8) & 1);
    irq_array[7] = 0xF5;           // $2005: playfield scroll x
    irq_array[8] = (unsigned char)cam_x;
    irq_array[9] = 0xFD;           // short waits (about 36 dots each)
    irq_array[10] = 0xFD;
    irq_array[11] = 0xFD;
    irq_array[12] = 0xF7;          // world BG bank
    irq_array[13] = lvl_chr_bg;
    irq_array[14] = 0xFF;
    set_chr_mode_0(CHR_FONT);
    scroll(0, 0);
    set_irq_ptr(irq_array);
    nbf_player_chr = CHR_PLAYER;
    nbf_split_ctrl = irq_array[6];
    nbf_split_x = irq_array[8];
    nbf_split_on = 1;

    text_kind = TS_NONE;
    event_code = respawn ? EV_RESPAWN : EV_NONE;
    hud_dirty = 1;
    ppu_on_all();
}

// The next stage: its world's intro text first when it opens a world (PLAN 5.9).
void begin_level(void) {
    set_prg_8000(level_bank[level_index]);
    b1 = level_ptr[level_index][LH_WORLD];
    if (level_first[level_index] && world_intro[b1] != 0xFF) {
        show_text(world_intro[b1], ST_STORY, TS_INTRO);
        music_stop();
    } else {
        load_level(0);
    }
}

void start_game(void) {
    lives = START_LIVES;
    collected = 0;
    kills = 0;
    cp_id = 0;
    level_index = START_LEVEL;
    begin_level();
}

// Continue after a game over (PLAN 5.9): the first stage of the current world, full lives.
void continue_game(void) {
    lives = START_LIVES;
    cp_id = 0;
    while (level_index && !level_first[level_index]) --level_index;
    begin_level();
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

void kill_player(unsigned char cause) {
#ifdef NBF_TEST_CHEATS
    if ((PROBE[PR_CHEATS] & CHEAT_INVINCIBLE) && cause != EV_DEATH_PIT) return;
#endif
    game_state = ST_DYING;
    state_timer = 60;
    event_code = cause;
    vx = 0;
    vy = -(T_JUMPVEL >> 1);
    music_stop();
}

// Damage from an enemy, a shot or the boss: hurt_dmg hp, knockback away from hurt_from, iframes.
void hurt_player(void) {
#ifdef NBF_TEST_CHEATS
    if (PROBE[PR_CHEATS] & CHEAT_INVINCIBLE) return;
#endif
    if (iframes || (game_state != ST_PLAY && game_state != ST_BOSS)) return;
    if (hp > hurt_dmg) {
        hp -= hurt_dmg;
        iframes = T_IFRAMES;
        sfx_play(SFX_HURT);
        event_code = EV_HURT;
        hud_dirty = 1;
        vy = -T_KNOCKY;
        vx = (px + (PW / 2) < hurt_from) ? -T_KNOCKX : T_KNOCKX;
        grounded = 0;
        jumping = 0;
        climbing = 0;
    } else {
        hp = 0;
        hud_dirty = 1;
        kill_player(EV_DEATH_ENEMY);
    }
}

void move_player_x(void) {
    t16 = (unsigned int)pxs + (unsigned char)vx;
    pxs = (unsigned char)t16;
    dx = (signed char)((unsigned int)vx >> 8) + (t16 >> 8);
    if (dx > 0) {
        cx = px + dx + PW - 1;
        cy = py;
        if (solid_at()) goto hit_r;
        cy = py + (PH / 2);
        if (solid_at()) goto hit_r;
        cy = py + PH - 1;
        if (solid_at()) goto hit_r;
        px += dx;
        return;
    hit_r:
        px = (cx & 0xFFF0) - PW;
        pxs = 0;
        vx = 0;
    } else if (dx < 0) {
        cx = px + dx;
        cy = py;
        if (solid_at()) goto hit_l;
        cy = py + (PH / 2);
        if (solid_at()) goto hit_l;
        cy = py + PH - 1;
        if (solid_at()) goto hit_l;
        px += dx;
        return;
    hit_l:
        px = (cx & 0xFFF0) + 16;
        pxs = 0;
        vx = 0;
    }
}

void move_player_y(void) {
    t16 = (unsigned int)pys + (unsigned char)vy;
    pys = (unsigned char)t16;
    dy = (signed char)((unsigned int)vy >> 8) + (t16 >> 8);
    if (dy > 0) {
        cy = py + dy + PH - 1;          // new foot
        cx = px + 2;
        b1 = beh_at();
        cx = px + PW - 3;
        b2 = beh_at();
        if (b1 == BEH_SOLID || b2 == BEH_SOLID) goto land;
        if ((b1 == BEH_ONEWAY || b2 == BEH_ONEWAY) && !climbing && py + PH - 1 < (cy & 0xFFF0)) goto land;
        py += dy;
        return;
    land:
        py = (cy & 0xFFF0) - PH;
        pys = 0;
        vy = 0;
    } else if (dy < 0) {
        cy = py + dy;
        cx = px + 2;
        if (solid_at()) goto bonk;
        cx = px + PW - 3;
        if (solid_at()) goto bonk;
        py += dy;
        return;
    bonk:
        py = (cy & 0xFFF0) + 16;
        pys = 0;
        vy = 0;
    }
}

unsigned char check_ground(void) {
    if (vy < 0) return 0;
    cy = py + PH;
    if ((cy & 15) != 0) return 0;
    cx = px + 2;
    if (floor_beh(beh_at())) return 1;
    cx = px + PW - 3;
    return floor_beh(beh_at());
}

// Behaviour under the player's centre (ladders, pickups, checkpoints, exits).
void touch_tiles(void) {
    // hazards: hitbox shrunk by 2 px
    cx = px + 2;
    cy = py + 2;
    if (beh_at() == BEH_HAZARD) goto hazard;
    cx = px + PW - 3;
    if (beh_at() == BEH_HAZARD) goto hazard;
    cy = py + PH - 2;
    if (beh_at() == BEH_HAZARD) goto hazard;
    cx = px + 2;
    if (beh_at() == BEH_HAZARD) goto hazard;

    cx = px + (PW / 2);
    cy = py + (PH / 2);
    b1 = beh_at();
    if (b1 == BEH_COLLECT) {
        i = (unsigned char)(cx >> 4);
        j = (unsigned char)cy >> 4;
        levelbuf[((unsigned int)i << 4) | j] = lvl_empty_mt;
        queue_cell(i, j);
        if (collected < 99) ++collected;
        event_code = EV_PICKUP;
        hud_dirty = 1;
        sfx_play(SFX_PICKUP);
    } else if (b1 == BEH_CHECKPOINT) {
        i = (unsigned char)(cx >> 4);
        j = (unsigned char)cy >> 4;
        if (i != cp_col || j != cp_row || !cp_id) {
            cp_col = i;
            cp_row = j;
            ++cp_id;
            event_code = EV_CHECKPOINT;
            sfx_play(SFX_ONEUP);
        }
    } else if (b1 == BEH_EXIT && !b_on) {
        stage_clear(EV_EXIT);
    }
    return;
hazard:
    kill_player(EV_DEATH_HAZARD);
}

void update_player(void) {
    // ladders: centre on a ladder tile + up/down starts climbing
    cx = px + (PW / 2);
    cy = py + (PH / 2);
    b1 = beh_at();
    if (!climbing && b1 == BEH_LADDER && (pad1 & (PAD_UP | PAD_DOWN))) {
        climbing = 1;
        jumping = 0;
        vx = 0;
    }
    if (climbing) {
        if (b1 != BEH_LADDER) {
            cy = py + PH - 1;
            if (beh_at() != BEH_LADDER) climbing = 0;
        }
    }

    if (climbing) {
        dj_used = 0;
        vx = 0;
        vy = 0;
        if (pad1 & PAD_UP) vy = -T_CLIMB;
        else if (pad1 & PAD_DOWN) vy = T_CLIMB;
        if (pad1 & PAD_LEFT) vx = -(T_CLIMB >> 1);
        else if (pad1 & PAD_RIGHT) vx = T_CLIMB >> 1;
        if ((pad1_new & PAD_A) && T_CANJUMPOFF) {
            climbing = 0;
            vy = -T_JUMPVEL;
            jumping = 1;
            sfx_play(SFX_JUMP);
        }
    } else {
        // horizontal
        acc = T_WALKACCEL;
        if (!grounded) acc = (acc * T_AIRCONTROL) >> 8;
        if (pad1 & PAD_RIGHT) {
            facing_left = 0;
            if (vx < 0) vx += T_TURNBOOST;
            vx += acc;
            if (vx > T_RUNMAX) vx = T_RUNMAX;
        } else if (pad1 & PAD_LEFT) {
            facing_left = 1;
            if (vx > 0) vx -= T_TURNBOOST;
            vx -= acc;
            if (vx < -T_RUNMAX) vx = -T_RUNMAX;
        } else if (grounded) {
            if (vx > 0) {
                vx -= T_FRICTION;
                if (vx < 0) vx = 0;
            } else if (vx < 0) {
                vx += T_FRICTION;
                if (vx > 0) vx = 0;
            }
        }

        // jump: buffer + coyote time + variable height (PLAN 5.5); double jump on a fresh press in the air
        if (pad1_new & PAD_A) jbuf = T_JUMPBUF + 1;
        if (jbuf) {
            if (grounded || coyote) {
                vy = -T_JUMPVEL;
                grounded = 0;
                coyote = 0;
                jbuf = 0;
                jumping = 1;
                sfx_play(SFX_JUMP);
            } else if ((pad1_new & PAD_A) && T_DJ_ON && !dj_used) {
                vy = -T_DJ_VEL;
                dj_used = 1;
                jbuf = 0;
                jumping = 1;
                sfx_play(SFX_JUMP);
            } else {
                --jbuf;
            }
        }
        if (jumping && vy < 0 && !(pad1 & PAD_A)) {
            if (vy < -T_JUMPCUT) vy = -T_JUMPCUT;
            jumping = 0;
        }
        if (vy >= 0) jumping = 0;

        // gravity
        if (!grounded) {
            vy += T_GRAVITY;
            if (vy > T_MAXFALL) vy = T_MAXFALL;
        }
    }

    // projectile attack on B (PLAN 5.5 floor)
    if (shot_cd) --shot_cd;
    if (pad1_new & PAD_B) fire_shot();

    move_player_x();
    move_player_y();
    // boss arena: the player stays on screen
    if (cam_locked) {
        if (px < cam_x) px = cam_x;
        else if (px > cam_x + 256 - PW) px = cam_x + 256 - PW;
    }
    if (climbing) grounded = 0;
    else grounded = check_ground();
    if (grounded) {
        coyote = T_COYOTE;
        vy = 0;
        dj_used = 0;
    } else if (coyote) {
        --coyote;
    }

    if (iframes) --iframes;

    // pit: below the playfield
    if (py > LEVEL_ROWS * 16) {
        kill_player(EV_DEATH_PIT);
        return;
    }
    touch_tiles();
}

// ---------------------------------------------------------------------------------------------
// Sprites. OAM cycling (PLAN 5.4): the player always first, then shots and the boss; enemies forward
// on even frames, backward on odd frames, so with up to 6 enemies on one line each is drawn at least
// every second frame instead of vanishing.
// ---------------------------------------------------------------------------------------------

void draw_enemy(unsigned char e) {
    t16 = e_x[e] - cam_x;
    if (t16 > 248) return;
    if (e_hit[e] & 2) return;
    k = e_kind[e];
    b1 = kind_ms[k] + ((frame16 >> 3) & 1) + (e_left[e] ? 2 : 0);
    oam_meta_spr((unsigned char)t16, (unsigned char)(e_y[e] + 31), ms_table[b1]);
}

void draw_sprites(void) {
    oam_clear();
    // player
    if (!(iframes & 2)) {
        t16 = px - cam_x;
        if (game_state == ST_DYING) b1 = MS_PLAYER_JUMP;
        else if (climbing) b1 = MS_PLAYER_IDLE;
        else if (!grounded) b1 = MS_PLAYER_JUMP;
        else if (vx != 0) b1 = ((frame16 >> 3) & 1) ? MS_PLAYER_RUN1 : MS_PLAYER_RUN2;
        else b1 = MS_PLAYER_IDLE;
        if (facing_left) b1 += MS_PLAYER_LEFT;
        nbf_player_chr = CHR_PLAYER + player_ms_bank[b1]; // R2 per animation group (PLAN 5.4)
        if (py > -24 && py < LEVEL_ROWS * 16) {
            oam_meta_spr((unsigned char)t16, (unsigned char)(py + 31), ms_table[b1]);
        }
    }
    draw_shots();
    draw_boss();
    frame_parity ^= 1;
    if (frame_parity) {
        for (j = 0; j < MAX_ENEMIES; ++j) if (e_active[j]) draw_enemy(j);
    } else {
        j = MAX_ENEMIES;
        while (j) {
            --j;
            if (e_active[j]) draw_enemy(j);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Camera and column streaming
// ---------------------------------------------------------------------------------------------

void update_camera(void) {
    if (cam_locked) {
        if (cam_x + 2 < cam_lock) cam_x += 2;
        else cam_x = cam_lock;
    } else {
        if (px > CAM_LEAD) cam_x = px - CAM_LEAD;
        else cam_x = 0;
        if (cam_x > cam_max) cam_x = cam_max;
    }

    if (attr_pending != 0xFF) {
        queue_attrs();
    } else {
        k = (unsigned char)(cam_x >> 4);
        if ((unsigned int)k + 17 > right_col && right_col + 1 < lvl_width) {
            ++right_col;
            queue_column(right_col);
        } else if (right_col > 31 && k < right_col - 31) {
            --right_col;
            queue_column(right_col - 31);
        }
    }
    // playfield scroll for the IRQ split, applied by the NMI once this frame is finished
    nbf_split_ctrl = 0x88 | ((cam_x >> 8) & 1);
    nbf_split_x = (unsigned char)cam_x;
}

// ---------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------

void main(void) {
    set_vram_buffer();
    enter_title();

    while (1) {
        ppu_wait_nmi();
        clear_vram_buffer();
        ++frame16;
        pad1 = pad_poll(0);
        pad1_new = get_pad_new(0);

        switch (game_state) {
        case ST_TITLE:
            update_title();
            if (pad1_new & PAD_START) start_game();
            break;
        case ST_STORY:
            if (state_timer < 255) ++state_timer;
            if (state_timer > 30 && (pad1_new & (PAD_START | PAD_A))) load_level(0);
            break;
        case ST_ENDING:
            if (state_timer < 255) ++state_timer;
            if (state_timer > 30 && (pad1_new & (PAD_START | PAD_A))) {
                if (text_kind == TS_ENDING) show_text(TEXT_CREDITS, ST_ENDING, TS_CREDITS);
                else enter_title();
            }
            break;
        case ST_PLAY:
        case ST_BOSS:
#ifdef NBF_TEST_CHEATS
            if (PROBE[PR_CHEATS] & CHEAT_SKIP) {
                PROBE[PR_CHEATS] &= ~CHEAT_SKIP;
                stage_clear(EV_EXIT);
                break;
            }
#endif
            update_player();
            if (game_state == ST_PLAY || game_state == ST_BOSS || game_state == ST_CLEAR) {
                spawn_enemies();
                update_enemies();
                update_shots();
                if (b_on) update_boss();
            }
            update_camera();
            if (hud_dirty) hud_values();
            draw_sprites();
            break;
        case ST_DYING:
            vy += T_GRAVITY;
            if (vy > T_MAXFALL) vy = T_MAXFALL;
            t16 = (unsigned int)pys + (unsigned char)vy;
            pys = (unsigned char)t16;
            py += (signed char)((unsigned int)vy >> 8) + (t16 >> 8);
            if (py > 240) py = 240;
            draw_sprites();
            if (--state_timer == 0) {
                if (lives) --lives;
                if (lives == 0) {
                    game_state = ST_GAMEOVER;
                    state_timer = 0;
                    music_play(SONG_GAMEOVER);
                    hud_values();
                    hud_text(text_gameover, TEXT_HUD_COL);
                } else {
                    load_level(1);
                }
            }
            break;
        case ST_CLEAR:
            draw_sprites();
            ++state_timer;
            if (state_timer >= 120) {
                if (level_index + 1 < LEVEL_COUNT) {
                    ++level_index;
                    cp_id = 0;
                    begin_level();
                } else {
#if TEXT_ENDING != 255
                    show_text(TEXT_ENDING, ST_ENDING, TS_ENDING);
#else
                    show_text(TEXT_CREDITS, ST_ENDING, TS_CREDITS);
#endif
                }
            }
            break;
        case ST_GAMEOVER:
            if (state_timer < 255) ++state_timer;
            if (state_timer > 30) {
                if (pad1_new & PAD_START) continue_game();
                else if (pad1_new & PAD_SELECT) enter_title();
            }
            break;
        }
        probe_update();
    }
}
