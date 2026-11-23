// Text screens (PLAN 5.9, M4a): world intros, ending, credits. Included by game.c. The screens are
// draw lists in a data bank (gen/data.s text_N), drawn with rendering off in the font bank.

void stage_clear(unsigned char ev) {
    game_state = ST_CLEAR;
    state_timer = 0;
    event_code = ev;
    b_on = 0;
    for (i = 0; i < MAX_SHOTS; ++i) s_on[i] = 0;
    for (i = 0; i < MAX_ESHOTS; ++i) es_on[i] = 0;
    music_play(SONG_CLEAR);
    hud_text(text_clear, TEXT_HUD_COL);
}

void show_text(unsigned char id, unsigned char state, unsigned char kind) {
    ppu_off();
    nbf_split_on = 0;
    disable_irq();
    oam_clear();
    set_chr_mode_0(CHR_FONT);
    set_chr_mode_1(CHR_TITLE);
    pal_bg(title_palette);
    pal_spr(title_palette + 16);
    vram_adr(NAMETABLE_A);
    vram_fill(TEXT_BLANK, 960);
    vram_fill(0, 64);
    set_prg_8000(text_bank[id]);
    draw_list(text_ptr[id]);
    scroll(0, 0);
    // the ending song runs on under the credits; an intro is silent (PLAN 5.9)
    if (kind == TS_ENDING || (kind == TS_CREDITS && text_kind != TS_ENDING)) music_play(SONG_ENDING);
    game_state = state;
    text_kind = kind;
    state_timer = 0;
    ppu_on_all();
}
