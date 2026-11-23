; THE LEGEND OF BLUM engine: turn-based battles (docs/RPG-PLAN.md 2.7). The battle screen is one compiled
; nametable (backdrop strip from the kit, enemy art in BG tiles, message / command / status windows). Blum
; acts (Attaque, Pouvoir de classe, Objet, Défense, Fuite), then the enemy plays the next move of its
; pattern (attack, multi, warn + blast, heal, stun). Damage: base + roll(0..2) - (defence + 1), minimum 1;
; Défense halves it (the battle simulator in src/core/rpg/legend/sim.ts uses the same formula).
.segment "CODE2"

BS_INTRO = 0
BS_CLEAR = 1
BS_TYPE = 2
BS_WAIT = 3
BS_MENU = 4
BS_OUT = 5

AF_MENU = 0
AF_ENEMY = 1
AF_ENEMY2 = 2
AF_WIN = 3
AF_LOSE = 4
AF_FLEE = 5
AF_EXITWIN = 6
AF_EXITLOSE = 7
AF_STUN = 8
AF_STEAL = 9

POSE_IDLE = 0
POSE_ATTACK = 1
POSE_HURT = 2
POSE_WIN = 3

; battle_start: A = battle id
battle_start:
    sta b_id
    tax
    lda bat_hp,x
    sta ehp
    lda #0
    sta turn
    sta cursor
    sta defending
    sta charge
    sta stunned
    sta helper
    sta stolen
    sta b_pat_i
    sta b_pose
    sta b_fx_t
    sta b_result
    lda frame
    ora #1
    sta rnd
    lda #CHR_FX
    ldx #5
    jsr set_chr
    ldx b_id
    lda bat_r1,x
    sta ld_r1
    lda bat_pal_lo,x
    sta src
    lda bat_pal_hi,x
    sta src+1
    lda bat_nt,x
    ldx #LT_BATTLE
    jmp full_load

battle_entered:
    lda #ST_BATTLE
    sta state
    ldx b_id
    lda bat_song,x
    jsr play_song
    lda #0
    sta d_row
    jsr battle_status
    ldx b_id
    lda #AF_MENU
    sta b_after
    lda bat_intro_lo,x
    ldy bat_intro_hi,x
    jmp battle_msg

; battle_status: Blum's PV / max, Énergie / max, the enemy's PV (30 buffer bytes)
battle_status:
    jsr cur_hi
    sta nthi
    lda #B_HPROW
    ldx #B_HPCOL
    ldy gs_hp
    jsr num_at
    jsr max_hp
    tay
    lda #B_HPROW
    ldx #B_MAXCOL
    jsr num_at
    lda #B_ENROW
    ldx #B_ENCOL
    ldy gs_energy
    jsr num_at
    jsr max_en
    tay
    lda #B_ENROW
    ldx #B_ENMAXCOL
    jsr num_at
    lda #B_EHPROW
    ldx #B_EHPCOL
    ldy ehp
    jmp num_at
; num_at: A = row, X = first column, Y = value -> 3 tiles right aligned
num_at:
    stx ri
    sty cnt
    jsr row_addr
    lda tmp
    ora ri
    sta tmp
    lda cnt
    jmp emit_num3

; battle_msg: A/Y = block (lo/hi): its single page into the message window, then b_after
battle_msg:
    clc
    adc #1
    sta t_ptr
    tya
    adc #0
    sta t_ptr+1
    jsr page_decode
    lda #1
    jsr clear_line
    lda #BS_CLEAR
    sta b_sub
    rts

battle_update:
    lda b_pose_t
    beq :+
    dec b_pose_t
    bne :+
    lda b_pose
    cmp #POSE_WIN
    beq :+
    lda #POSE_IDLE
    sta b_pose
:   lda b_fx_t
    beq :+
    dec b_fx_t
:   lda b_sub
    cmp #BS_CLEAR
    bne @type
    lda #3
    jsr clear_line
    lda #BS_TYPE
    sta b_sub
    rts
@type:
    cmp #BS_TYPE
    bne @wait
    jsr type_speed
    jsr type_chars
    bcc :+
    lda #15
    sta d_blink
    lda #BS_WAIT
    sta b_sub
:   rts
@wait:
    cmp #BS_WAIT
    bne @menu
    lda pad_new
    and #BTN_A
    bne :+
    jmp blink_step
:   lda #T_SPACE
    jsr arrow_tile
    jmp battle_after
@menu:
    cmp #BS_MENU
    beq :+
    rts
:   lda pad_new
    and #BTN_UP|BTN_DOWN|BTN_SELECT
    beq @act
    jsr cursor_off
    lda pad_new
    and #BTN_UP
    beq @dn
    ldx cursor
    dex
    bpl @set
    ldx #4
    bne @set
@dn:
    ldx cursor
    inx
    cpx #5
    bcc @set
    ldx #0
@set:
    stx cursor
    lda #SFX_MENU
    jsr sfx
    jmp cursor_on
@act:
    lda pad_new
    and #BTN_A
    bne :+
    rts
:   jsr cursor_off
    lda cursor
    asl
    tax
    lda act_table+1,x
    pha
    lda act_table,x
    pha
    rts
act_table:
    .word act_attack-1, act_power-1, act_item-1, act_defend-1, act_flee-1

cursor_off:
    ldy #T_SPACE
    bne cursor_tile
cursor_on:
    ldy #T_CURSOR
cursor_tile:
    jsr cur_hi
    sta nthi
    lda cursor
    clc
    adc #B_CMDROW0
    ldx #B_CURSORCOL
    jmp put_cursor

; dmg_calc: A = attack base, X = defence -> b_dmg = base + roll - (def + 1), minimum 1
dmg_calc:
    sta tmp+2
    inx
    stx tmp+3
    jsr roll
    clc
    adc tmp+2
    cmp tmp+3
    beq @one
    bcc @one
    sec
    sbc tmp+3
    sta b_dmg
    rts
@one:
    lda #1
    sta b_dmg
    rts

; hurt_enemy: b_dmg off the enemy's PV
hurt_enemy:
    lda ehp
    sec
    sbc b_dmg
    bcs :+
    lda #0
:   sta ehp
    lda b_dmg
    sta numv
    rts

; after_player: the enemy plays next, or the battle is won
after_player:
    lda #AF_ENEMY
    ldx ehp
    bne :+
    lda #AF_WIN
:   sta b_after
    jmp battle_status

act_attack:
    inc turn
    ldx gs_level
    lda lvl_atk-1,x
    ldx b_id
    pha
    lda bat_def,x
    tax
    pla
    jsr dmg_calc
    jsr hurt_enemy
    lda #POSE_ATTACK
    jsr set_pose
    lda #MS_FX_HIT0
    ldx #MS_FX_HIT1
    jsr set_fx
    lda #SFX_HIT
    jsr sfx
    jsr after_player
    lda #<txt_attack
    ldy #>txt_attack
    jmp battle_msg

act_power:
    ldx gs_class
    lda gs_energy
    cmp cls_cost,x
    bcs :+
    lda #AF_MENU
    sta b_after
    lda #SFX_CANCEL
    jsr sfx
    lda #<txt_noEnergy
    ldy #>txt_noEnergy
    jmp battle_msg
:   inc turn
    sec
    sbc cls_cost,x
    sta gs_energy
    lda gs_level
    asl
    clc
    adc cls_power,x
    pha
    lda cls_effect,x
    ldx #0                  ; pierce: no defence
    cmp #EFF_PIERCE
    beq :+
    ldx b_id
    lda bat_def,x
    tax
:   pla
    jsr dmg_calc
    jsr hurt_enemy
    ldx gs_class
    lda cls_effect,x
    cmp #EFF_SUMMON
    bne :+
    lda #HELPER_TURNS
    sta helper
:   lda #POSE_ATTACK
    jsr set_pose
    ldx gs_class
    lda cls_fx0,x
    pha
    lda cls_fx1,x
    tax
    pla
    jsr set_fx
    lda #SFX_HIT
    jsr sfx
    jsr after_player
    ; the thief steals a collation once per battle (when the enemy is still standing)
    ldx gs_class
    lda cls_effect,x
    cmp #EFF_STEAL
    bne :+
    lda stolen
    bne :+
    lda ehp
    beq :+
    lda #AF_STEAL
    sta b_after
:   ldx gs_class
    lda cls_text_lo,x
    ldy cls_text_hi,x
    jmp battle_msg

act_item:
    lda gs_col
    bne :+
    lda #AF_MENU
    sta b_after
    lda #SFX_CANCEL
    jsr sfx
    lda #<txt_noCollation
    ldy #>txt_noCollation
    jmp battle_msg
:   inc turn
    dec gs_col
    lda #COLLATION_HEAL
    sta numv
    jsr max_hp
    sta tmp
    lda gs_hp
    clc
    adc #COLLATION_HEAL
    cmp tmp
    bcc :+
    lda tmp
:   sta gs_hp
    lda #SFX_ITEM
    jsr sfx
    lda #AF_ENEMY
    sta b_after
    jsr battle_status
    lda #<txt_collation
    ldy #>txt_collation
    jmp battle_msg

act_defend:
    inc turn
    lda #1
    sta defending
    lda #AF_ENEMY
    sta b_after
    lda #<txt_defend
    ldy #>txt_defend
    jmp battle_msg

act_flee:
    ldx b_id
    lda bat_flags,x
    and #1
    bne :+
    lda #AF_MENU
    sta b_after
    lda #SFX_CANCEL
    jsr sfx
    lda #<txt_noFlee
    ldy #>txt_noFlee
    jmp battle_msg
:   inc turn
    lda #AF_FLEE
    sta b_after
    lda #<txt_flee
    ldy #>txt_flee
    jmp battle_msg

set_pose:
    sta b_pose
    lda #24
    sta b_pose_t
    rts
; set_fx: A = first frame, X = second frame (16 frames)
set_fx:
    sta b_fx_a
    stx b_fx_b
    lda #16
    sta b_fx_t
    rts

battle_after:
    lda b_after
    asl
    tax
    lda after_table+1,x
    pha
    lda after_table,x
    pha
    rts
after_table:
    .word af_menu-1, af_enemy-1, af_enemy2-1, af_win-1, af_lose-1, af_flee-1, af_exitwin-1, af_exitlose-1
    .word af_stun-1, af_steal-1

af_menu:
    lda #BS_MENU
    sta b_sub
    jmp cursor_on

af_steal:
    lda #1
    sta stolen
    lda gs_col
    cmp #COLLATION_MAX
    bcs :+
    inc gs_col
:   lda #SFX_ITEM
    jsr sfx
    lda #AF_ENEMY
    sta b_after
    lda #<txt_steal
    ldy #>txt_steal
    jmp battle_msg

; af_enemy: the necromancer's helper hits first, then the enemy's move
af_enemy:
    lda helper
    beq af_enemy2
    dec helper
    lda #HELPER_DMG
    sta b_dmg
    jsr hurt_enemy
    lda #SFX_HIT
    jsr sfx
    lda #AF_ENEMY2
    ldx ehp
    bne :+
    lda #AF_WIN
:   sta b_after
    jsr battle_status
    lda #<txt_helper
    ldy #>txt_helper
    jmp battle_msg

af_enemy2:
    ; the next move of the pattern
    ldx b_id
    lda bat_pat_lo,x
    sta src
    lda bat_pat_hi,x
    sta src+1
    ldy #0
    lda (src),y
    sta tmp+1               ; pattern length
    ldy b_pat_i
    iny
    lda (src),y
    sta tmp                 ; move index
    inc b_pat_i
    lda b_pat_i
    cmp tmp+1
    bcc :+
    lda #0
    sta b_pat_i
:   ldx tmp
    stx m_i                 ; (m_i is free during a battle)
    lda #0
    sta b_dmg
    lda mv_kind,x
    asl
    tay
    lda move_table+1,y
    pha
    lda move_table,y
    pha
    rts
move_table:
    .word mv_attack-1, mv_multi-1, mv_warn-1, mv_blast-1, mv_heal-1, mv_stun-1

mv_attack:
    ldx b_id
    lda bat_atk,x
    pha
    ldx gs_level
    lda lvl_def-1,x
    tax
    pla
    jsr dmg_calc
    jsr halve_if_defending
    jmp enemy_hits
mv_multi:
    ldx m_i
    lda #0
    ldy mv_p1,x
:   clc
    adc mv_p2,x
    dey
    bne :-
    sta b_dmg
    jsr halve_if_defending
    jmp enemy_hits
mv_warn:
    lda #1
    sta charge
    jmp enemy_text
mv_blast:
    lda #0
    sta charge
    ldx m_i
    lda defending
    bne :+
    lda mv_p1,x
    sta b_dmg
    jmp enemy_hits
:   lda mv_p2,x
    sta b_dmg
    jmp enemy_hits_alt
mv_heal:
    ldx m_i
    lda mv_p1,x
    sta numv
    clc
    adc ehp
    ldx b_id
    cmp bat_hp,x
    bcc :+
    lda bat_hp,x
:   sta ehp
    jmp enemy_text
mv_stun:
    lda defending
    bne :+
    lda #1
    sta stunned
    jmp enemy_text
:   jmp enemy_text_alt

halve_if_defending:
    lda defending
    beq :+
    lda b_dmg
    clc
    adc #1
    lsr
    sta b_dmg
:   rts

; enemy_hits: b_dmg off Blum's PV, the move's text (enemy_hits_alt: its blocked text)
enemy_hits_alt:
    lda #1
    bne eh
enemy_hits:
    lda #0
eh: pha
    lda gs_hp
    sec
    sbc b_dmg
    bcs :+
    lda #0
:   sta gs_hp
    lda b_dmg
    sta numv
    beq :+
    lda #POSE_HURT
    jsr set_pose
    lda #SFX_HIT
    jsr sfx
:   pla
    beq enemy_text
    bne enemy_text_alt
enemy_text_alt:
    ldx m_i
    lda mv_t2_lo,x
    ldy mv_t2_hi,x
    jmp enemy_msg
enemy_text:
    ldx m_i
    lda mv_t_lo,x
    ldy mv_t_hi,x
enemy_msg:
    pha
    tya
    pha
    lda #0
    sta defending
    lda #AF_MENU
    ldx stunned
    beq :+
    lda #AF_STUN
:   ldx gs_hp
    bne :+
    lda #AF_LOSE
:   sta b_after
    jsr battle_status
    pla
    tay
    pla
    jmp battle_msg

af_stun:
    lda #0
    sta stunned
    lda #AF_ENEMY
    sta b_after
    lda #<txt_stunned
    ldy #>txt_stunned
    jmp battle_msg

af_win:
    ldx b_id
    lda bat_xp,x
    sta numv
    clc
    adc gs_xp
    bcc :+
    lda #255
:   sta gs_xp
    lda #POSE_WIN
    sta b_pose
    lda #SONG_VICTORY
    jsr play_song
    lda #AF_EXITWIN
    sta b_after
    lda #<txt_win
    ldy #>txt_win
    jmp battle_msg

af_lose:
    lda #AF_EXITLOSE
    sta b_after
    lda #<txt_lose
    ldy #>txt_lose
    jmp battle_msg

af_flee:
    lda #3
    sta b_result
    bne battle_leave
af_exitwin:
    lda #1
    sta b_result
    bne battle_leave
af_exitlose:
    lda #2
    sta b_result
    jsr heal_full
battle_leave:
    lda #BS_OUT
    sta b_sub
    lda #$FF
    sta cur_song            ; the map song starts again
    lda b_result
    cmp #1
    beq :+
    lda #0                  ; lost or fled: the script stops, the enemy stays
    sta vm_on
    lda #1
    sta touch_lock
:   lda screen
    jmp load_map

; ---- battle sprites -----------------------------------------------------------------------------------
battle_oam:
    lda b_sub
    cmp #BS_OUT
    beq @done
    lda #B_BLUMX
    sta sx
    lda #B_BLUMY
    sta sy
    lda #0
    sta sflip
    ldx b_pose
    lda blumb_ms,x
    jsr draw_ms
    lda defending
    beq :+
    lda #B_BLUMX+8
    sta sx
    lda #B_BLUMY+12
    sta sy
    lda #MS_FX_SHIELD
    jsr draw_ms
:   lda b_fx_t
    beq @done
    ldx b_id
    lda bat_fxx,x
    sta sx
    lda bat_fxy,x
    sta sy
    lda b_fx_a
    ldx b_fx_t
    cpx #9
    bcs :+
    lda b_fx_b
:   jmp draw_ms
@done:
    rts
