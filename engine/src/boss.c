// Boss script interpreter (PLAN 5.7, M4a). Included by game.c. The script is compiled by core
// (src/core/engine-data/boss-dsl.ts) into the stage's data bank: phases chosen by hp thresholds, each a
// looped list of 3-byte steps [op, a, b] from 8 ops. The interpreter never jumps anywhere the data says:
// unknown ops are skipped, every value is clamped by the compiler, steps loop inside their phase.

void stage_clear(unsigned char ev);

void boss_load_phase(void) {
    wptr = (unsigned char *)bblk + BB_PHASE_TABLE + b_phase * BB_PHASE_SIZE;
    b_nsteps = wptr[1];
    bsteps = (const unsigned char *)(wptr[2] | (wptr[3] << 8));
    b_step = 0;
    b_started = 0;
}

void spawn_boss(unsigned char col, unsigned char row) {
    b_on = 1;
    b_hp = bblk[BB_HP];
    b_w = bblk[BB_W];
    b_h = bblk[BB_H];
    b_x = (unsigned int)col << 4;
    b_xs = 0;
    b_y = ((int)row << 4) + 16 - b_h;
    b_ys = 0;
    b_vx = 0;
    b_vy = 0;
    b_vuln = 0;
    b_flash = 0;
    b_left = 1;
    b_gnd = 0;
    b_phase = 0;
    boss_load_phase();
    // arena: the camera glides to just past the boss (update_camera) and stays there
    t16 = b_x + b_w + 16;
    t16 = (t16 > 256) ? t16 - 256 : 0;
    if (t16 < cam_x) t16 = cam_x;
    if (t16 > cam_max) t16 = cam_max;
    cam_lock = t16;
    cam_locked = 1;
    game_state = ST_BOSS;
    hud_dirty = 1;
    music_play(lvl_boss_song);
}

void boss_next(void) {
    b_started = 0;
    ++b_step;
    if (b_step >= b_nsteps) b_step = 0;
}

void boss_shoot(unsigned char pattern, unsigned char speed) {
    a_vx = (int)speed << 4;
    if (pattern == 2) {
        // rain: three seeds falling around the player
        a_vy = a_vx;
        a_vx = 0;
        a_y = 0;
        a_x = (px > cam_x + 24) ? px - 24 : cam_x;
        spawn_eshot();
        a_x = px + 4;
        spawn_eshot();
        a_x = px + 32;
        spawn_eshot();
        return;
    }
    a_x = b_x + (b_w >> 1) - 4;
    a_y = b_y + b_h - 14;
    if (px + (PW / 2) < b_x + (b_w >> 1)) a_vx = -a_vx;
    a_vy = 0;
    spawn_eshot();
    if (pattern == 1) {
        // spread: one up and one down at half speed
        a_vy = (int)speed << 3;
        spawn_eshot();
        a_vy = -a_vy;
        spawn_eshot();
    }
}

void boss_spawn_enemy(unsigned char kind) {
    // at most 2 called enemies alive
    b2 = 0;
    for (i = 0; i < MAX_ENEMIES; ++i) if (e_active[i] && e_ent[i] == 0xFF) ++b2;
    if (b2 >= 2 || !free_enemy_slot()) return;
    k = kind;
    a_x = b_left ? ((b_x > 16) ? b_x - 16 : 0) : b_x + b_w;
    a_y = b_y + b_h - 16;
    b2 = b_left;
    init_enemy();
    e_ent[i] = 0xFF;
}

void boss_defeated(void) {
    b_on = 0;
    for (i = 0; i < MAX_ENEMIES; ++i) e_active[i] = 0;
    for (i = 0; i < MAX_ESHOTS; ++i) es_on[i] = 0;
    stage_clear(EV_BOSS_DEFEATED);
}

void hit_boss(void) {
    if (b_hp) --b_hp;
    b_flash = 8;
    hud_dirty = 1;
    sfx_play(SFX_BOSSHIT);
    if (b_hp == 0) {
        boss_defeated();
        return;
    }
    if (b_phase + 1 < bblk[BB_PHASES] && b_hp <= bblk[BB_PHASE_TABLE + (b_phase + 1) * BB_PHASE_SIZE]) {
        ++b_phase;
        boss_load_phase();
        event_code = EV_BOSS_PHASE;
    }
}

// Horizontal move b_vx and gravity; b_wall is set when a wall or the arena edge stops the boss.
void boss_physics(void) {
    b_wall = 0;
    if (b_vx) {
        m_sub = b_xs;
        m_v = b_vx;
        step88();
        b_xs = m_sub;
        cy = b_y + b_h - 8;
        if (m_d < 0) {
            cx = b_x + m_d;
            if ((int)b_x + m_d < (int)cam_x || solid_at()) b_wall = 1;
            else b_x += m_d;
        } else if (m_d > 0) {
            cx = b_x + b_w - 1 + m_d;
            if (b_x + b_w + m_d > cam_x + 256 || solid_at()) b_wall = 1;
            else b_x += m_d;
        }
    }
    cx = b_x + (b_w >> 1);
    cy = b_y + b_h;
    if (b_vy >= 0 && (cy & 15) == 0 && floor_beh(beh_at())) {
        b_gnd = 1;
        b_vy = 0;
        return;
    }
    b_gnd = 0;
    b_vy += T_GRAVITY;
    if (b_vy >= 0 && (unsigned int)b_vy > (unsigned int)T_MAXFALL) b_vy = T_MAXFALL;
    m_sub = b_ys;
    m_v = b_vy;
    step88();
    b_ys = m_sub;
    if (m_d > 0) {
        cy = b_y + b_h - 1 + m_d;
        if (floor_beh(beh_at())) {
            b_y = (cy & 0xFFF0) - b_h;
            b_vy = 0;
            b_ys = 0;
            b_gnd = 1;
            return;
        }
    }
    b_y += m_d;
    if (b_y > LEVEL_ROWS * 16) boss_defeated(); // fell into a pit
}

void update_boss(void) {
    if (b_flash) --b_flash;
    wptr = (unsigned char *)bsteps + b_step * 3;
    b1 = wptr[1];
    b2 = wptr[2];
    switch (wptr[0]) {
    case OP_MOVE_TO:
        t16 = (unsigned int)b1 << 4;
        if (b_x + b2 < t16) {
            b_x += b2;
            b_left = 0;
        } else if (b_x > t16 + b2) {
            b_x -= b2;
            b_left = 1;
        } else {
            b_x = t16;
            boss_next();
        }
        break;
    case OP_WAIT:
        if (!b_started) {
            b_timer = b1;
            b_started = 1;
        }
        if (b_timer) --b_timer;
        if (!b_timer) boss_next();
        break;
    case OP_JUMP:
        if (!b_started) {
            b_vx = (int)(signed char)b1 << 4;
            b_vy = -((int)b2 << 4);
            if (b_vx) b_left = b_vx < 0;
            b_gnd = 0;
            b_started = 1;
        } else if (b_gnd) {
            b_vx = 0;
            boss_next();
        }
        break;
    case OP_SHOOT:
        boss_shoot(b1, b2);
        boss_next();
        break;
    case OP_SPAWN:
        boss_spawn_enemy(b1);
        boss_next();
        break;
    case OP_CHARGE:
        if (!b_started) {
            b_left = (px + (PW / 2) < b_x + (b_w >> 1));
            b_vx = (int)b1 << 4;
            if (b_left) b_vx = -b_vx;
            b_started = 1;
        } else if (b_wall) {
            b_vx = 0;
            boss_next();
        }
        break;
    case OP_VULNERABLE:
        b_vuln = b1;
        boss_next();
        break;
    case OP_FLASH:
        if (!b_started) {
            b_timer = b1;
            b_started = 1;
        }
        if (!b_flash) b_flash = 4;
        if (b_timer) --b_timer;
        if (!b_timer) boss_next();
        break;
    default:
        boss_next();
        break;
    }
    boss_physics();
    if (!b_on) return;
    // contact with the player
    if (IN_RANGE(px, b_x, 3 - PW, b_w - 5 + PW) && IN_RANGE(py, b_y, 3 - PH, b_h - 3 + PH)) {
        hurt_dmg = bblk[BB_DMG];
        hurt_from = b_x + (b_w >> 1);
        hurt_player();
    }
}

void draw_boss(void) {
    if (!b_on || (b_flash & 2)) return;
    t16 = b_x - cam_x;
    if (t16 > 256 - b_w) return;
    b1 = ((frame16 >> 4) & 1) + (b_left ? 2 : 0);
    wptr = (unsigned char *)bblk + BB_MS + (b1 << 1);
    oam_meta_spr((unsigned char)t16, (unsigned char)(b_y + 31), (const unsigned char *)(wptr[0] | (wptr[1] << 8)));
}
