; THE LEGEND OF BLUM engine: title screen (Commencer / Continuer), full-screen cards, the class choice, the
; Start menu (status, Objets, Classe, Sauvegarder) and the battery save (2 slots + checksum, docs/RPG-PLAN.md
; 2.8: the newest valid slot wins, a power cut during a save never loses both).
.segment "CODE"

; ---- full-screen loads -----------------------------------------------------------------------------
; full_load: A = nametable index, X = then (LT_*), src = palette, ld_r1 = CHR unit for R1
full_load:
    sta ld_nt
    stx ld_then
    lda #1
    sta ld_kind
    jmp load_begin

; put_cursor: A = tile row, X = column, Y = tile (into the page on screen)
put_cursor:
    sty cnt
    stx ri
    pha
    jsr cur_hi
    sta nthi
    pla
    jsr row_addr
    lda tmp
    ora ri
    sta tmp
    lda #1
    jsr vb_hdr
    lda cnt
    jmp vb_put

; ---- title ----------------------------------------------------------------------------------------
title_start:
    lda #<pal_title
    sta src
    lda #>pal_title
    sta src+1
    lda #CHR_TITLE
    sta ld_r1
    lda #NT_TITLE
    ldx #LT_TITLE
    jmp full_load

title_entered:
    lda #ST_TITLE
    sta state
    lda #0
    sta sel_cur
    lda #SONG_TITLE
    jsr play_song
    jmp title_cursor

title_cursor:
    lda sel_cur
    beq :+
    lda #TITLE_CURSOR_ROW
    ldx #TITLE_COL
    ldy #TITLE_BLANK0
    jsr put_cursor
    lda #TITLE_CURSOR_ROW+2
    ldx #TITLE_COL
    ldy #T_CURSOR
    jmp put_cursor
:   lda #TITLE_CURSOR_ROW+2
    ldx #TITLE_COL
    ldy #TITLE_BLANK1
    jsr put_cursor
    lda #TITLE_CURSOR_ROW
    ldx #TITLE_COL
    ldy #T_CURSOR
    jmp put_cursor

title_update:
    lda pad_new
    and #BTN_UP|BTN_DOWN|BTN_SELECT
    beq :+
    lda sel_cur
    eor #1
    sta sel_cur
    lda #SFX_MENU
    jsr sfx
    jmp title_cursor
:   lda pad_new
    and #BTN_A|BTN_START
    beq @no
    lda sel_cur
    bne @continue
    jsr new_game
    lda #START_SCRIPT
    jmp vm_start
@continue:
    jsr load_game
    bcs :+
    lda #SFX_CANCEL
    jmp sfx
:   lda #SFX_MENU
    jsr sfx
    lda #0
    sta vm_on
    lda screen
    jmp load_map
@no:
    rts

new_game:
    ldx #GS_SIZE-1
    lda #0
:   sta gs,x
    dex
    bpl :-
    lda #START_LEVEL
    sta gs_level
    jsr heal_full
    lda #START_COLLATIONS
    sta gs_col
    lda #START_SCREEN
    sta screen
    lda #START_X
    sta px
    lda #START_Y
    sta py
    lda #START_FACE
    sta facing
    rts

; ---- cards ------------------------------------------------------------------------------------------
; card_start: A = card, X = then (LT_CARD or LT_END)
card_start:
    tay
    lda #<pal_card
    sta src
    lda #>pal_card
    sta src+1
    lda #CHR_TITLE
    sta ld_r1
    lda card_nt,y
    jmp full_load

card_entered:
    lda #ST_CARD
    sta state
    rts
end_entered:
    lda #ST_END
    sta state
    lda #SONG_TITLE
    jmp play_song

; BLUMZ-F2 (BLUMZ-W P3-2): START on « À SUIVRE » goes back to the title (it was a dead end until Reset)
end_update:
    lda pad_new
    and #BTN_START
    beq :+
    lda #SFX_MENU
    jsr sfx
    jmp title_start
:   rts

card_update:
    lda pad_new
    and #BTN_A|BTN_START
    beq :+
    lda #1
    sta vm_need_map
    jmp vm_run
:   rts

; ---- class choice ------------------------------------------------------------------------------------
CLASS_COL = 3
classsel_start:
    lda #<pal_classes
    sta src
    lda #>pal_classes
    sta src+1
    lda #CHR_TITLE
    sta ld_r1
    lda #NT_CLASSES
    ldx #LT_CLASSES
    jmp full_load

classes_entered:
    lda #ST_CLASSSEL
    sta state
    lda gs_class
    sta sel_cur
    tax
    lda class_rows,x
    ldx #CLASS_COL
    ldy #T_CURSOR
    jmp put_cursor

classsel_update:
    lda pad_new
    and #BTN_UP|BTN_DOWN|BTN_SELECT
    beq @a
    ldx sel_cur
    lda class_rows,x
    ldx #CLASS_COL
    ldy #T_SPACE
    jsr put_cursor
    lda pad_new
    and #BTN_UP
    beq @down
    ldx sel_cur
    dex
    bpl @set
    ldx #CLASS_COUNT-1
    bne @set
@down:
    ldx sel_cur
    inx
    cpx #CLASS_COUNT
    bcc @set
    ldx #0
@set:
    stx sel_cur
    lda #SFX_MENU
    jsr sfx
    ldx sel_cur
    lda class_rows,x
    ldx #CLASS_COL
    ldy #T_CURSOR
    jmp put_cursor
@a:
    lda pad_new
    and #BTN_A|BTN_START
    beq :+
    lda sel_cur
    sta gs_class
    lda #SFX_ITEM
    jsr sfx
    lda #1
    sta vm_need_map
    jmp vm_run
:   rts

; ---- Start menu (ST_MENU) ------------------------------------------------------------------------------
MS_OPEN = 0
MS_PRINT = 1
MS_SELECT = 2
MS_ITEMS = 3
MS_WAIT = 4
MS_CLOSE = 5
MENU_OPT_ROW = 9

menu_start:
    lda #SFX_MENU
    jsr sfx
    lda #ST_MENU
    sta state
    lda #MS_OPEN
    sta m_sub
    lda #0
    sta m_cur
    sta m_i
    sta win_step
    lda #MENU_ROW
    sta win_row
    lda #MENU_H
    sta win_h
    rts

menu_update:
    lda m_sub
    cmp #MS_OPEN
    bne @print
    jsr win_open_step
    bcc :+
    lda #1
    sta menu_open
    lda #MS_PRINT
    sta m_sub
    lda #0
    sta m_i
    ; the class's status block (3 pages of 2 lines)
    ldx gs_class
    lda cls_menu_lo,x
    clc
    adc #1
    sta t_ptr
    lda cls_menu_hi,x
    adc #0
    sta t_ptr+1
:   rts
@print:
    cmp #MS_PRINT
    bne @select
    ; numbers of this page: 0 level, xp / 1 hp, max, energy, max
    lda m_i
    bne :+
    lda gs_level
    sta numv
    lda gs_xp
    sta numv+1
    jmp @dec
:   cmp #1
    bne @dec
    lda gs_hp
    sta numv
    jsr max_hp
    sta numv+1
    lda gs_energy
    sta numv+2
    jsr max_en
    sta numv+3
@dec:
    jsr page_decode
    ; lines on rows 3 + 4i and 5 + 4i
    lda m_i
    asl
    asl
    clc
    adc #MENU_ROW+1
    pha
    ldx #0
    jsr print_lbuf
    pla
    clc
    adc #2
    ldx #28
    jsr print_lbuf
    inc m_i
    lda m_i
    cmp #3
    bcc :+
    lda #MS_SELECT
    sta m_sub
    jsr menu_cursor
:   rts
@select:
    cmp #MS_SELECT
    beq :+
    jmp @items
:   lda pad_new
    and #BTN_UP|BTN_DOWN|BTN_SELECT
    beq @act
    lda m_cur
    asl
    clc
    adc #MENU_OPT_ROW
    ldx #TEXT_COL
    ldy #T_SPACE
    jsr put_cursor
    lda pad_new
    and #BTN_UP
    beq @dn
    ldx m_cur
    dex
    bpl @mset
    ldx #2
    bne @mset
@dn:
    ldx m_cur
    inx
    cpx #3
    bcc @mset
    ldx #0
@mset:
    stx m_cur
    lda #SFX_MENU
    jsr sfx
    jmp menu_cursor
@act:
    lda pad_new
    and #BTN_B|BTN_START
    beq :+
    lda #SFX_CANCEL
    jsr sfx
    jmp menu_close
:   lda pad_new
    and #BTN_A
    bne :+
    rts
:   lda #SFX_MENU
    jsr sfx
    lda m_cur
    bne @cls
    lda #0
    sta m_i
    lda #MS_ITEMS
    sta m_sub
    rts
@cls:
    cmp #1
    bne @save
    ldx gs_class
    lda cls_info_lo,x
    pha
    lda cls_info_hi,x
    tax
    pla
    jmp menu_text
@save:
    jsr save_game
    lda #<txt_saved
    ldx #>txt_saved
    jmp menu_text
@items:
    cmp #MS_ITEMS
    bne @close
    ; the next owned quest item, then the collations
@next:
    lda m_i
    cmp #ITEM_COUNT
    bcs @col
    pha
    inc m_i
    pla
    jsr item_test
    beq @next
    ldx m_i
    lda item_text_lo-1,x
    pha
    lda item_text_hi-1,x
    tax
    pla
    jmp menu_text
@col:
    lda gs_col
    sta numv
    lda #MS_SELECT
    sta m_sub
    lda #<txt_collation_info
    ldx #>txt_collation_info
    jmp menu_text_last
@close:
    cmp #MS_CLOSE
    bne @wait
    jsr win_close_step
    bcc :+
    lda #0
    sta menu_open
    lda #ST_MAP
    sta state
:   rts
@wait:
    rts

; print_lbuf: A = tile row, X = 0 line 1 / 28 line 2 of lbuf -> 28 tiles at TEXT_COL
print_lbuf:
    stx ri
    pha
    jsr cur_hi
    sta nthi
    pla
    jsr row_addr
    lda tmp
    ora #TEXT_COL
    sta tmp
    lda #TEXT_W
    jsr vb_hdr
    ldx ri
    ldy vlen
    lda #TEXT_W
    sta cnt
:   lda lbuf,x
    sta vbuf,y
    iny
    inx
    dec cnt
    bne :-
    sty vlen
    rts

menu_cursor:
    lda m_cur
    asl
    clc
    adc #MENU_OPT_ROW
    ldx #TEXT_COL
    ldy #T_CURSOR
    jmp put_cursor

; menu_text: A/X = block -> shown in the bottom window; back to the item list or the options
menu_text:
    pha
    lda #OWNER_MENU
    sta d_owner
    pla
    jmp dialog_block
menu_text_last:
    pha
    lda #OWNER_MENU
    sta d_owner
    pla
    jmp dialog_block

menu_dialog_done:
    jmp dialog_close
menu_dialog_closed:
    lda #ST_MENU
    sta state
    rts

menu_close:
    lda #MS_CLOSE
    sta m_sub
    lda #MENU_ROW
    sta win_row
    lda #MENU_H
    sta win_h
    lda #0
    sta win_step
    rts

; ---- battery save --------------------------------------------------------------------------------------
; slot layout: 0-3 "LGBZ", 4 version, 5 sequence, 6.. game state (GS_SIZE), then the 16-bit sum of bytes 0..
SLOT_SUM = 6 + GS_SIZE
slot_ptr:                   ; X = 0 slot A, 1 slot B -> dst
    lda #<SLOT_A
    sta dst
    lda #>SLOT_A
    cpx #0
    beq :+
    lda #>SLOT_B
:   sta dst+1
    rts
; slot_sum: dst = slot -> tmp/tmp+1 = sum of bytes 0 .. SLOT_SUM-1
slot_sum:
    lda #0
    sta tmp
    sta tmp+1
    ldy #0
:   lda (dst),y
    clc
    adc tmp
    sta tmp
    bcc :+
    inc tmp+1
:   iny
    cpy #SLOT_SUM
    bne :--
    rts
; slot_valid: X = slot -> carry set when magic, version and sum are right
slot_valid:
    jsr slot_ptr
    ldy #3
:   lda (dst),y
    cmp save_magic,y
    bne @no
    dey
    bpl :-
    ldy #4
    lda (dst),y
    cmp #SAVE_VERSION
    bne @no
    jsr slot_sum
    ldy #SLOT_SUM
    lda (dst),y
    cmp tmp
    bne @no
    iny
    lda (dst),y
    cmp tmp+1
    bne @no
    sec
    rts
@no:
    clc
    rts
save_magic:
    .byte "LGBZ"

; newest_slot: -> X = newest valid slot, carry clear when none
newest_slot:
    ldx #0
    jsr slot_valid
    rol cnt                 ; bit 0 = A valid
    ldx #1
    jsr slot_valid
    lda cnt
    rol
    and #3                  ; bit 1 = A valid, bit 0 = B valid
    sta cnt
    cmp #0
    beq @none
    cmp #2
    beq @a
    cmp #1
    beq @b
    ; both: B wins when (seqB - seqA) is 1..127
    lda SLOT_B+5
    sec
    sbc SLOT_A+5
    beq @a
    bmi @a
@b: ldx #1
    sec
    rts
@a: ldx #0
    sec
    rts
@none:
    clc
    rts

save_game:
    lda screen
    sta gs_screen
    lda px
    sta gs_px
    lda py
    sta gs_py
    lda facing
    sta gs_face
    jsr newest_slot
    lda #0
    sta tmp+2               ; sequence
    bcc @slotA
    txa
    pha
    jsr slot_ptr
    ldy #5
    lda (dst),y
    clc
    adc #1
    sta tmp+2
    pla
    eor #1                  ; the other slot
    tax
    jmp @write
@slotA:
    ldx #0
@write:
    jsr slot_ptr
    ldy #3
:   lda save_magic,y
    sta (dst),y
    dey
    bpl :-
    ldy #4
    lda #SAVE_VERSION
    sta (dst),y
    iny
    lda tmp+2
    sta (dst),y
    ldx #0
:   lda gs,x
    iny
    sta (dst),y
    inx
    cpx #GS_SIZE
    bne :-
    jsr slot_sum
    ldy #SLOT_SUM
    lda tmp
    sta (dst),y
    iny
    lda tmp+1
    sta (dst),y
    inc saves
    rts

; load_game: carry set when a valid slot was loaded into gs (and screen, px, py, facing)
load_game:
    jsr newest_slot
    bcc @no
    jsr slot_ptr
    ldy #6
    ldx #0
:   lda (dst),y
    sta gs,x
    iny
    inx
    cpx #GS_SIZE
    bne :-
    lda gs_screen
    cmp #SCREEN_COUNT
    bcs @no
    sta screen
    lda gs_px
    sta px
    lda gs_py
    sta py
    lda gs_face
    and #3
    sta facing
    lda gs_level
    beq @no
    cmp #LEVEL_MAX+1
    bcs @no
    lda gs_class
    cmp #CLASS_COUNT
    bcs @no
    lda #1
    sta load_ok
    sec
    rts
@no:
    lda #2
    sta load_ok
    clc
    rts
