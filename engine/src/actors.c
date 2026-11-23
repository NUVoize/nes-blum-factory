// Enemies (walker, hopper, flyer, shooter) and shots (PLAN 5.5 / 5.7, M4a). Included by game.c:
// shares its globals. Patterns are data: kind_ai / kind_speed / kind_p1 / kind_p2 from gen/data.s.
// Size matters here (fixed banks are full): the enemy being updated is copied to zero-page scalars
// (ex, ey, ...) and written back once, instead of indexing the slot arrays on every access.

void kill_player(unsigned char cause);
void hurt_player(void);
void spawn_boss(unsigned char col, unsigned char row);
void hit_boss(void);

// 64-step sine, -64..64 (flyer waves)
const signed char sine64[64] = {
    0, 6, 12, 19, 24, 30, 36, 41, 45, 49, 53, 56, 59, 61, 63, 64, 64, 64, 63, 61, 59, 56, 53, 49, 45, 41, 36, 30, 24, 19, 12, 6,
    0, -6, -12, -19, -24, -30, -36, -41, -45, -49, -53, -56, -59, -61, -63, -64, -64, -64, -63, -61, -59, -56, -53, -49, -45, -41, -36, -30, -24, -19, -12, -6,
};

void reset_actors(void) {
    for (i = 0; i < MAX_ENEMIES; ++i) e_active[i] = 0;
    for (i = 0; i < MAX_SHOTS; ++i) s_on[i] = 0;
    for (i = 0; i < MAX_ESHOTS; ++i) es_on[i] = 0;
    ent_next = 0;
    shot_cd = 0;
    b_on = 0;
    b_phase = 0;
    b_x = 0;
}

// Enemy slot i <- kind k at (a_x, a_y), facing b2.
void init_enemy(void) {
    e_active[i] = 1;
    e_kind[i] = k;
    e_x[i] = a_x;
    e_xs[i] = 0;
    e_y[i] = a_y;
    e_by[i] = a_y;
    e_ys[i] = 0;
    e_vy[i] = 0;
    e_left[i] = b2;
    e_hp[i] = kind_hp[k];
    e_t[i] = kind_ai[k] == AI_FLYER ? 0 : kind_p1[k];
    e_gnd[i] = 0;
    e_hit[i] = 0;
}

unsigned char free_enemy_slot(void) {
    for (i = 0; i < MAX_ENEMIES; ++i) {
        if (!e_active[i]) return 1;
    }
    return 0;
}

void spawn_enemies(void) {
    // Entities are sorted by column. Spawn every entity whose column is inside the camera + 2 columns.
    t16 = (cam_x >> 4) + 18;
    while (ent_next < ent_count && ent_col[ent_next] <= t16) {
        k = ent_kind[ent_next];
        if (k >= BOSS_KIND_BASE) {
            if (bblk && !b_on) spawn_boss(ent_col[ent_next], ent_row[ent_next]);
            ++ent_next;
            continue;
        }
        if (!free_enemy_slot()) return;
        a_x = (unsigned int)ent_col[ent_next] << 4;
        a_y = (int)ent_row[ent_next] << 4;
        b2 = ent_flags[ent_next] & 1;
        init_enemy();
        e_ent[i] = ent_next;
        ++ent_next;
    }
}

// Horizontal walk of the current enemy at kind speed: turn at a wall (and at a ledge if flagged).
void walk_enemy(void) {
    t16 = kind_speed[k];
    if (!t16) return;
    b1 = exs;
    if (eleft) {
        exs = b1 - (unsigned char)t16;
        dx = (t16 >> 8) + (exs > b1 ? 1 : 0);
        cx = ex - dx;
    } else {
        exs = b1 + (unsigned char)t16;
        dx = (t16 >> 8) + (exs < b1 ? 1 : 0);
        cx = ex + dx + 15;
    }
    cy = ey + 8;
    b2 = solid_at();
    if (!b2 && (kind_flags[k] & 1) && evy == 0) {
        cy = ey + 16;
        if (!floor_beh(beh_at())) b2 = 1;
    }
    if (b2) eleft ^= 1;
    else if (eleft) ex -= dx;
    else ex += dx;
}

// Gravity for the current enemy: fall until on a floor, land, bonk on a ceiling when rising.
void fall_enemy(void) {
    cx = ex + 8;
    cy = ey + 16;
    if (evy >= 0 && (cy & 15) == 0 && floor_beh(beh_at())) {
        egnd = 1;
        return;
    }
    egnd = 0;
    evy += T_GRAVITY;
    if (evy >= 0 && (unsigned int)evy > (unsigned int)T_MAXFALL) evy = T_MAXFALL;
    m_sub = eys;
    m_v = evy;
    step88();
    eys = m_sub;
    if (m_d > 0) {
        cy = ey + m_d + 15;
        if (floor_beh(beh_at())) {
            ey = (cy & 0xFFF0) - 16;
            evy = 0;
            eys = 0;
            egnd = 1;
            return;
        }
    } else if (m_d < 0) {
        cy = ey + m_d;
        if (solid_at()) {
            evy = 0;
            return;
        }
    }
    ey += m_d;
}

void spawn_eshot(void) {
    for (n = 0; n < MAX_ESHOTS; ++n) {
        if (es_on[n]) continue;
        es_on[n] = 1;
        es_x[n] = a_x;
        es_xs[n] = 0;
        es_y[n] = a_y;
        es_ys[n] = 0;
        es_vx[n] = a_vx;
        es_vy[n] = a_vy;
        return;
    }
}

void update_enemies(void) {
    for (i = 0; i < MAX_ENEMIES; ++i) {
        if (!e_active[i]) continue;
        k = e_kind[i];
        ex = e_x[i];
        exs = e_xs[i];
        ey = e_y[i];
        eys = e_ys[i];
        evy = e_vy[i];
        eleft = e_left[i];
        et = e_t[i];
        egnd = e_gnd[i];
        if (e_hit[i]) --e_hit[i];
        b1 = kind_ai[k];
        if (b1 == AI_FLYER) {
            // sine wave of kind_p2 px around its start height, kind_p1 phase steps per frame; no gravity
            walk_enemy();
            et += kind_p1[k];
            ey = e_by[i] + (((int)sine64[et >> 2] * (int)kind_p2[k]) >> 6);
        } else {
            if (b1 == AI_HOPPER && egnd) {
                // waits on the ground kind_p1 frames, then jumps at kind_p2; walks while in the air
                if (et) --et;
                else {
                    evy = -(int)kind_p2[k];
                    et = kind_p1[k];
                }
            } else {
                walk_enemy();
            }
            fall_enemy();
            if (b1 == AI_SHOOTER) {
                // fires at the player's side every kind_p1 frames while on screen, shot speed kind_p2
                b2 = (px + (PW / 2) < ex + 8);
                if (!kind_speed[k]) eleft = b2;
                if (et) --et;
                else {
                    et = kind_p1[k];
                    if (ex + 16 > cam_x && ex < cam_x + 240) {
                        a_vx = kind_p2[k];
                        if (b2) a_vx = -a_vx;
                        a_x = ex + 4;
                        a_y = ey + 4;
                        a_vy = 0;
                        spawn_eshot();
                    }
                }
            }
        }
        // despawn when far behind the camera or fallen out
        if ((ey > 0 && (unsigned int)ey > LEVEL_ROWS * 16) || (ex + 80 < cam_x)) {
            e_active[i] = 0;
            continue;
        }
        // player shots
        for (j = 0; j < MAX_SHOTS; ++j) {
            if (!s_on[j]) continue;
            if (IN_RANGE(s_x[j], ex, -6, 21)) {
                if (IN_RANGE(s_y[j], ey, -7, 23)) {
                    s_on[j] = 0;
                    if (e_hp[i] > 1) {
                        --e_hp[i];
                        e_hit[i] = 8;
                    } else {
                        e_active[i] = 0;
                        if (kills < 255) ++kills;
                        event_code = EV_KILL;
                        sfx_play(SFX_STOMP);
                    }
                    break;
                }
            }
        }
        if (!e_active[i]) continue;
        // contact with the player (14x14 box)
        if (IN_RANGE(px, ex, 2 - PW, 13 + PW) && IN_RANGE(py, ey, 3 - PH, 13 + PH)) {
            hurt_dmg = kind_dmg[k];
            hurt_from = ex + 8;
            hurt_player();
        }
        e_x[i] = ex;
        e_xs[i] = exs;
        e_y[i] = ey;
        e_ys[i] = eys;
        e_vy[i] = evy;
        e_left[i] = eleft;
        e_t[i] = et;
        e_gnd[i] = egnd;
    }
}

// ---------------------------------------------------------------------------------------------
// Player shots (B) and enemy shots
// ---------------------------------------------------------------------------------------------

void fire_shot(void) {
    if (!T_SHOT_ON || shot_cd || climbing) return;
    b2 = 0;
    for (n = 0; n < MAX_SHOTS; ++n) if (s_on[n]) ++b2;
    if (b2 >= (unsigned char)T_SHOT_MAX) return;
    for (n = 0; n < MAX_SHOTS; ++n) {
        if (s_on[n]) continue;
        s_on[n] = 1;
        s_left[n] = facing_left;
        s_sub[n] = 0;
        s_x[n] = facing_left ? px - 6 : px + PW - 2;
        s_y[n] = (py < 0) ? 0 : (unsigned char)(py + 5);
        shot_cd = (unsigned char)T_SHOT_COOLDOWN;
        event_code = EV_SHOT;
        sfx_play(SFX_JUMP);
        return;
    }
}

void update_shots(void) {
    for (j = 0; j < MAX_SHOTS; ++j) {
        if (!s_on[j]) continue;
        m_sub = s_sub[j];
        m_v = T_SHOT_SPEED;
        if (s_left[j]) m_v = -m_v;
        step88();
        s_sub[j] = m_sub;
        ex = s_x[j] + m_d;
        s_x[j] = ex;
        ey = s_y[j];
        cx = ex + 4;
        cy = ey + 4;
        if (ex + 8 < cam_x || ex >= cam_x + 256 || ex >= lvl_px_width || solid_at()) {
            s_on[j] = 0;
            continue;
        }
        if (b_on && IN_RANGE(ex, b_x, -5, b_w + 3) && IN_RANGE(ey, b_y, -5, b_h + 5)) {
            s_on[j] = 0;
            if (b_vuln) hit_boss();
        }
    }
    for (j = 0; j < MAX_ESHOTS; ++j) {
        if (!es_on[j]) continue;
        m_sub = es_xs[j];
        m_v = es_vx[j];
        step88();
        es_xs[j] = m_sub;
        ex = es_x[j] + m_d;
        es_x[j] = ex;
        m_sub = es_ys[j];
        m_v = es_vy[j];
        step88();
        es_ys[j] = m_sub;
        ey = es_y[j] + m_d;
        es_y[j] = ey;
        cx = ex + 4;
        cy = ey + 4;
        if (!IN_RANGE(ex, cam_x, -8, 264) || !IN_RANGE(ey, 0, -8, LEVEL_ROWS * 16 + 8) || solid_at()) {
            es_on[j] = 0;
            continue;
        }
        if (IN_RANGE(px, ex, 3 - PW, PW + 3) && IN_RANGE(py, ey, 3 - PH, PH + 3)) {
            es_on[j] = 0;
            hurt_dmg = 1;
            hurt_from = ex + 4;
            hurt_player();
        }
    }
}

void draw_shots(void) {
    for (j = 0; j < MAX_ESHOTS; ++j) {
        if (!es_on[j]) continue;
        t16 = es_x[j] - cam_x;
        if (t16 < 256) oam_spr((unsigned char)t16, (unsigned char)(es_y[j] + 31), TILE_ESHOT, 1);
    }
    for (j = 0; j < MAX_SHOTS; ++j) {
        if (!s_on[j]) continue;
        t16 = s_x[j] - cam_x;
        if (t16 < 256) oam_spr((unsigned char)t16, s_y[j] + 31, TILE_SHOT, 1);
    }
}
