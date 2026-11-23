; THE LEGEND OF BLUM engine: the event script VM. Scripts are bytecode in BANK_TEXT (gen/text.s, compiled
; from rpg/legend/scripts.json). Instant ops run in a loop; blocking ops hand the frame to a state (dialogue,
; battle, loader, card, class choice) that calls vm_run again when it is done. An op that needs the map
; (text) after a full-screen op (battle, card, class choice) first reloads the map; an op that needs the
; whole screen (battle, warp, card) first closes the dialogue window. Both re-run the same op afterwards.
.segment "CODE"

; vm_start: A = script id
vm_start:
    tax
    lda scrp_lo,x
    sta vm_pc
    lda scrp_hi,x
    sta vm_pc+1
    lda #1
    sta vm_on
    lda #0
    sta vm_need_map
    sta d_owner
    sta ch_n
    ; fall through
vm_run:
    lda #OWNER_VM
    sta d_owner
    ldy #0
    lda (vm_pc),y
    cmp #OP_GIVECOL+1
    bcc :+
    lda #OP_END
:   asl
    tax
    lda vm_ops+1,x
    pha
    lda vm_ops,x
    pha
    rts
vm_ops:
    .word op_end-1, op_say-1, op_choice-1, op_jmp-1, op_ifflag-1, op_ifnflag-1, op_ifitem-1, op_ifnitem-1
    .word op_ifchoice-1, op_set-1, op_clr-1, op_give-1, op_battle-1, op_warp-1, op_classsel-1, op_card-1
    .word op_save-1, op_heal-1, op_levelup-1, op_music-1, op_sfx-1, op_chapter-1, op_theend-1, op_sayclass-1
    .word op_givecol-1

; vm_skip: A = op length -> pc += A, then run on
vm_skip:
    clc
    adc vm_pc
    sta vm_pc
    bcc :+
    inc vm_pc+1
:   jmp vm_run
; vm_arg: Y = offset -> A = byte
vm_arg:
    lda (vm_pc),y
    rts
; vm_jump_at: Y = offset of a 16-bit address -> pc = it
vm_jump_at:
    lda (vm_pc),y
    tax
    iny
    lda (vm_pc),y
    sta vm_pc+1
    stx vm_pc
    jmp vm_run

; needs_map: carry set (and the map reload started) when a full-screen op left the map off
needs_map:
    lda vm_need_map
    beq @ok
    lda screen
    jsr load_map
    sec
    rts
@ok:
    clc
    rts
; needs_screen: carry set (and the window closing) when the dialogue window is open
needs_screen:
    lda win_open
    beq @ok
    jsr dialog_close
    sec
    rts
@ok:
    clc
    rts

op_end:
    jsr needs_map
    bcs @wait
    jsr needs_screen
    bcs @wait
    lda #0
    sta vm_on
    lda #ST_MAP
    sta state
@wait:
    rts

op_say:
    jsr needs_map
    bcs @wait
    ldy #1
    lda (vm_pc),y
    pha
    iny
    lda (vm_pc),y
    tax
    lda #3
    jsr pc_add
    pla
    jmp dialog_block
@wait:
    rts
pc_add:
    clc
    adc vm_pc
    sta vm_pc
    bcc :+
    inc vm_pc+1
:   rts

; CHOICE addr16 n col0..col(n-1) id
op_choice:
    jsr needs_map
    bcs @wait
    ldy #3
    lda (vm_pc),y
    sta ch_n
    ldx #0
:   iny
    lda (vm_pc),y
    sta ch_cols,x
    inx
    cpx ch_n
    bne :-
    iny
    lda (vm_pc),y
    sta ch_id
    ldy #1
    lda (vm_pc),y
    pha
    iny
    lda (vm_pc),y
    tax
    lda ch_n
    clc
    adc #5
    jsr pc_add
    pla
    jmp dialog_block
@wait:
    rts

op_jmp:
    ldy #1
    jmp vm_jump_at

; IFFLAG f addr: jump when the flag is set
op_ifflag:
    ldy #1
    lda (vm_pc),y
    jsr flag_test
    bne vm_take
vm_not:
    lda #4
    jmp vm_skip
vm_take:
    ldy #2
    jmp vm_jump_at
op_ifnflag:
    ldy #1
    lda (vm_pc),y
    jsr flag_test
    beq vm_take
    bne vm_not
op_ifitem:
    ldy #1
    lda (vm_pc),y
    jsr item_test
    bne vm_take
    beq vm_not
op_ifnitem:
    ldy #1
    lda (vm_pc),y
    jsr item_test
    beq vm_take
    bne vm_not
op_ifchoice:
    ldy #1
    lda (vm_pc),y
    cmp choice
    beq vm_take
    bne vm_not

op_set:
    ldy #1
    lda (vm_pc),y
    jsr flag_set
    lda #2
    jmp vm_skip
op_clr:
    ldy #1
    lda (vm_pc),y
    jsr flag_clr
    lda #2
    jmp vm_skip
op_give:
    ldy #1
    lda (vm_pc),y
    jsr item_set
    lda #2
    jmp vm_skip
op_givecol:
    ldy #1
    lda (vm_pc),y
    clc
    adc gs_col
    cmp #COLLATION_MAX+1
    bcc :+
    lda #COLLATION_MAX
:   sta gs_col
    ldy #1
    lda (vm_pc),y
    sta numv
    lda #2
    jmp vm_skip

op_battle:
    jsr needs_screen
    bcs @wait
    ldy #1
    lda (vm_pc),y
    pha
    lda #2
    jsr pc_add
    pla
    jmp battle_start
@wait:
    rts

; WARP screen x y facing
op_warp:
    jsr needs_screen
    bcs @wait
    ldy #2
    lda (vm_pc),y
    sta px
    iny
    lda (vm_pc),y
    sta py
    iny
    lda (vm_pc),y
    sta facing
    ldy #1
    lda (vm_pc),y
    pha
    lda #5
    jsr pc_add
    lda #0
    sta vm_need_map
    pla
    jmp load_map
@wait:
    rts

op_classsel:
    jsr needs_screen
    bcs @wait
    lda #1
    jsr pc_add
    jmp classsel_start
@wait:
    rts

op_card:
    jsr needs_screen
    bcs @wait
    ldy #1
    lda (vm_pc),y
    pha
    lda #2
    jsr pc_add
    pla
    ldx #LT_CARD
    jmp card_start
@wait:
    rts

op_theend:
    jsr needs_screen
    bcs @wait
    ldy #1
    lda (vm_pc),y
    pha
    lda #0
    sta vm_on
    pla
    ldx #LT_END
    jmp card_start
@wait:
    rts

op_save:
    jsr save_game
    lda #1
    jmp vm_skip
op_heal:
    jsr heal_full
    lda #1
    jmp vm_skip
op_levelup:
    lda gs_level
    cmp #LEVEL_MAX
    bcs :+
    inc gs_level
:   jsr heal_full
    lda gs_level
    sta numv
    lda #1
    jmp vm_skip
op_music:
    ldy #1
    lda (vm_pc),y
    jsr play_song
    lda #2
    jmp vm_skip
op_sfx:
    ldy #1
    lda (vm_pc),y
    jsr sfx
    lda #2
    jmp vm_skip
op_chapter:
    ldy #1
    lda (vm_pc),y
    sta gs_chapter
    lda #2
    jmp vm_skip
; SAYCLASS addr16 x 5: the line of the chosen class
op_sayclass:
    jsr needs_map
    bcs @wait
    lda gs_class
    asl
    tay
    iny
    lda (vm_pc),y
    pha
    iny
    lda (vm_pc),y
    tax
    lda #11
    jsr pc_add
    pla
    jmp dialog_block
@wait:
    rts
