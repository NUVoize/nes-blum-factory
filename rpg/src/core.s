; THE LEGEND OF BLUM engine: core services. VRAM buffer, pad, banks, flags and items, numbers, palettes and
; fades, nametable page addressing (both mirrorings), the screen loader (fade out, banks, stream, fade in).
.segment "CODE"

; ---- VRAM buffer: [hi][lo][len][bytes...] ... [$FF] -------------------------------------------------
; vb_hdr: tmp+1 = address high, tmp = address low, A = length
vb_hdr:
    ldy vlen
    pha
    lda tmp+1
    sta vbuf,y
    iny
    lda tmp
    sta vbuf,y
    iny
    pla
    sta vbuf,y
    iny
    sty vlen
    rts

; vb_put: A -> buffer
vb_put:
    ldy vlen
    sta vbuf,y
    iny
    sty vlen
    rts

; writes the buffer to the PPU (NMI), then empties it
vbuf_flush:
    ldx #0
@ent:
    lda vbuf,x
    bmi @done
    sta PPUADDR
    lda vbuf+1,x
    sta PPUADDR
    ldy vbuf+2,x
    inx
    inx
    inx
@cp:
    lda vbuf,x
    sta PPUDATA
    inx
    dey
    bne @cp
    beq @ent
@done:
    rts

; ---- input ------------------------------------------------------------------------------------------
read_pad:
    lda #1
    sta JOY1
    lda #0
    sta JOY1
    ldx #8
:   lda JOY1
    lsr
    rol pad
    dex
    bne :-
    lda pad_prev
    eor #$FF
    and pad
    sta pad_new
    lda pad
    sta pad_prev
    rts

; ---- banks ------------------------------------------------------------------------------------------
; set_r6: A = PRG bank at $8000
set_r6:
    pha
    lda #6
    sta $8000
    pla
    sta $8001
    rts
text_bank:
    lda #BANK_TEXT
    jmp set_r6
; set_chr: X = register (0-5), A = CHR unit
set_chr:
    stx $8000
    sta $8001
    rts

; ---- flags (256) and quest items (32) in gs ----------------------------------------------------------
bit_tab:
    .byte $01, $02, $04, $08, $10, $20, $40, $80
; flag_bit: A = id -> X = byte, A = mask
flag_bit:
    pha
    lsr
    lsr
    lsr
    tax
    pla
    and #7
    tay
    lda bit_tab,y
    rts
; flag_test: A = id -> Z clear (bne) when set
flag_test:
    jsr flag_bit
    and gs_flags,x
    rts
flag_set:
    jsr flag_bit
    ora gs_flags,x
    sta gs_flags,x
    rts
flag_clr:
    jsr flag_bit
    eor #$FF
    and gs_flags,x
    sta gs_flags,x
    rts
item_test:
    jsr flag_bit
    and gs_items,x
    rts
item_set:
    jsr flag_bit
    ora gs_items,x
    sta gs_items,x
    rts

; ---- player numbers -----------------------------------------------------------------------------------
; A = level table value for the current level: X = 0 hp, 1 atk, 2 def, 3 energy
max_hp:
    ldx gs_level
    lda lvl_hp-1,x
    rts
max_en:
    ldx gs_level
    lda lvl_en-1,x
    rts
heal_full:
    jsr max_hp
    sta gs_hp
    jsr max_en
    sta gs_energy
    rts

; 8-bit LFSR (rnd never 0)
rand:
    lda rnd
    asl
    bcc :+
    eor #$1D
:   sta rnd
    rts
; roll: A = 0, 1 or 2 (the +-1 of the damage formula, +1)
roll:
    jsr rand
@m: cmp #3
    bcc @d
    sbc #3
    jmp @m
@d: rts

; ---- numbers on screen --------------------------------------------------------------------------------
; digits3: A = value -> tmp+2 hundreds, tmp+3 tens, A units (0-9 each)
digits3:
    ldx #0
@h: cmp #100
    bcc @t0
    sbc #100
    inx
    bne @h
@t0:
    stx tmp+2
    ldx #0
@t: cmp #10
    bcc @u
    sbc #10
    inx
    bne @t
@u: stx tmp+3
    rts
; emit_num3: A = value, tmp+1/tmp = PPU address -> 3 tiles, right aligned (spaces for leading zeros)
emit_num3:
    jsr digits3
    pha
    lda #3
    jsr vb_hdr
    lda tmp+2
    beq @sp1
    clc
    adc #DIGIT0
    jsr vb_put
    lda tmp+3
    clc
    adc #DIGIT0
    jsr vb_put
    jmp @last
@sp1:
    lda #T_SPACE
    jsr vb_put
    lda tmp+3
    beq @sp2
    clc
    adc #DIGIT0
    jsr vb_put
    jmp @last
@sp2:
    lda #T_SPACE
    jsr vb_put
@last:
    pla
    clc
    adc #DIGIT0
    jmp vb_put

; ---- nametable pages (physical page 0/1 -> address / PPUCTRL bits for the current mirroring) -----------
page_hi:
    tax
    lda n_mirror
    bne :+
    lda pg_v,x
    rts
:   lda pg_h,x
    rts
pg_v: .byte $20, $24
pg_h: .byte $20, $28
page_ctrl:
    tax
    lda n_mirror
    bne :+
    txa
    rts
:   txa
    asl
    rts
cur_hi:
    lda cur_nt
    jmp page_hi
other_hi:
    lda cur_nt
    eor #1
    jmp page_hi

; row_addr: A = tile row -> tmp+1/tmp = nthi page + row * 32
row_addr:
    pha
    lsr
    lsr
    lsr
    clc
    adc nthi
    sta tmp+1
    pla
    and #7
    asl
    asl
    asl
    asl
    asl
    sta tmp
    rts

; ---- map rows from the working copy ---------------------------------------------------------------
; emit_room_row: A = tile row (0-29) of the current screen copy into the page nthi (35 buffer bytes)
emit_room_row:
    sta cnt
    jsr row_addr
    lda #32
    jsr vb_hdr
    lda cnt
    and #$FE
    asl
    asl
    asl
    sta ri                  ; (row / 2) * 16
    lda #16
    sta tmp+2
    ldy vlen
    lda cnt
    and #1
    bne @bottom
@top:
    sty tmp+3
    ldy ri
    ldx scr_grid,y
    ldy tmp+3
    lda mt_tl,x
    sta vbuf,y
    iny
    lda mt_tr,x
    sta vbuf,y
    iny
    inc ri
    dec tmp+2
    bne @top
    sty vlen
    rts
@bottom:
    sty tmp+3
    ldy ri
    ldx scr_grid,y
    ldy tmp+3
    lda mt_bl,x
    sta vbuf,y
    iny
    lda mt_br,x
    sta vbuf,y
    iny
    inc ri
    dec tmp+2
    bne @bottom
    sty vlen
    rts

; emit_attr_all: the 64 attribute bytes of the working copy into page nthi (67 buffer bytes)
emit_attr_all:
    lda nthi
    clc
    adc #3
    sta tmp+1
    lda #$C0
    sta tmp
    lda #64
    jsr vb_hdr
    ldx #0
    ldy vlen
:   lda scr_attr,x
    sta vbuf,y
    iny
    inx
    cpx #64
    bne :-
    sty vlen
    rts

; ---- screen data: world bank -> WRAM working copy -------------------------------------------------------
; load_screen_data: A = screen. Sets screen, area; copies grid, attributes, metatile table, entities.
load_screen_data:
    sta screen
    tax
    lda scr_area,x
    sta area
    lda #BANK_WORLD
    jsr set_r6
    ldx screen
    lda scr_grid_lo,x
    sta src
    lda scr_grid_hi,x
    sta src+1
    ldy #0
:   lda (src),y
    sta scr_grid,y
    iny
    cpy #240
    bne :-
    ldx screen
    lda scr_attr_lo,x
    sta src
    lda scr_attr_hi,x
    sta src+1
    ldy #63
:   lda (src),y
    sta scr_attr,y
    dey
    bpl :-
    ldx area
    lda area_mt_lo,x
    sta src
    lda area_mt_hi,x
    sta src+1
    ldy #0
:   lda (src),y
    sta mt_tl,y
    iny
    bne :-
    inc src+1
:   lda (src),y
    sta mt_tl+256,y
    iny
    cpy #64
    bne :-
    ldx screen
    lda scr_ents_lo,x
    sta src
    lda scr_ents_hi,x
    sta src+1
    ldy #0
    lda (src),y
    sta ent_n
    ldx #0
@copy:
    cpx #72
    beq @copied
    iny
    lda (src),y
    sta ents,x
    inx
    bne @copy
@copied:
    ldx #0                  ; initial facing of each entity
@face:
    cpx ent_n
    beq @done
    ldy ent_off,x
    lda ents+3,y
    sta ent_face,x
    inx
    bne @face
@done:
    jmp text_bank
ent_off:
    .byte 0, 9, 18, 27, 36, 45, 54, 63

; ---- palettes and fades -------------------------------------------------------------------------------
; set_pal_target: src = 32 bytes -> pal_cur (shown at the current fade level)
set_pal_target:
    ldy #31
:   lda (src),y
    sta pal_cur,y
    dey
    bpl :-
    rts
; emit_pal: pal_cur darkened by pal_level steps (0 = full, 4 = black), 35 buffer bytes
emit_pal:
    lda #$3F
    sta tmp+1
    lda #0
    sta tmp
    lda #32
    jsr vb_hdr
    lda pal_level
    asl
    asl
    asl
    asl
    sta tmp+2               ; amount to subtract
    ldx #0
    ldy vlen
@l: lda pal_cur,x
    cmp #$0F
    beq @put
    and #$30
    cmp tmp+2
    bcc @black
    lda pal_cur,x
    sec
    sbc tmp+2
    jmp @put
@black:
    lda #$0F
@put:
    sta vbuf,y
    iny
    inx
    cpx #32
    bne @l
    sty vlen
    rts

; ---- sound ------------------------------------------------------------------------------------------
play_song:
    cmp cur_song
    beq :+
    sta cur_song
    jmp famistudio_music_play
:   rts
sfx:
    ldx #FAMISTUDIO_SFX_CH0
    jmp famistudio_sfx_play

; ---- screen loader (ST_LOAD) ------------------------------------------------------------------------
; Callers set ld_kind (0 map screen = `screen`, 1 full nametable ld_nt), src = target palette, ld_r1 = CHR
; unit for R1 (full nametables), ld_then = what follows (LT_*), then jsr load_begin.
LS_FADEOUT = 0
LS_SETUP = 1
LS_STREAM = 2
LS_FADEIN = 3
LT_MAP = 0
LT_BATTLE = 1
LT_TITLE = 2
LT_CARD = 3
LT_CLASSES = 4
LT_END = 5

load_begin:
    lda src
    sta ptr
    lda src+1
    sta ptr+1               ; the target palette, applied once black
    lda #LS_FADEOUT
    sta ld_step
    lda #0
    sta ld_wait
    lda #ST_LOAD
    sta state
    rts

; load_map: A = screen -> loads it (fade), then LT_MAP
load_map:
    sta screen
    lda #0
    sta ld_kind
    lda #LT_MAP
    sta ld_then
    jmp load_begin

load_update:
    lda ld_step
    cmp #LS_FADEOUT
    bne @setup
    lda pal_level
    cmp #4
    bcs @black
    inc ld_wait
    lda ld_wait
    and #1
    bne :+
    inc pal_level
    jsr emit_pal
:   rts
@black:
    lda #LS_SETUP
    sta ld_step
    rts
@setup:
    cmp #LS_SETUP
    bne @stream
    ; rendering shows black: banks, mirroring, scroll, data
    lda #0
    sta n_mirror
    sta n_scroll_x
    sta n_scroll_y
    sta cur_nt
    sta n_scroll_nt
    sta t_step
    lda ptr
    sta src
    lda ptr+1
    sta src+1
    jsr set_pal_target
    lda ld_kind
    bne @full
    lda screen
    jsr load_screen_data
    ldx area
    lda area_r1,x
    ldx #1
    jsr set_chr
    lda #CHR_NPC_CH01
    ldx #5
    jsr set_chr
    ldx area
    lda area_pal_lo,x
    sta src
    lda area_pal_hi,x
    sta src+1
    jsr set_pal_target
    jmp @go
@full:
    lda ld_r1
    ldx #1
    jsr set_chr
@go:
    lda #LS_STREAM
    sta ld_step
    rts
@stream:
    cmp #LS_STREAM
    beq :+
    jmp @fadein
:   lda #$20
    sta nthi
    lda ld_kind
    bne @fullrows
    lda t_step
    cmp #15
    beq @attr
    asl
    pha
    jsr emit_room_row
    pla
    clc
    adc #1
    jsr emit_room_row
    inc t_step
    rts
@attr:
    jsr emit_attr_all
    jmp @streamed
@fullrows:
    ; 64 bytes of the 1 KiB nametable per frame
    ldx ld_nt
    lda nt_bank,x
    jsr set_r6
    ldx ld_nt
    lda t_step
    lsr
    lsr
    clc
    adc nt_hi,x
    sta src+1
    lda t_step
    and #3
    asl
    asl
    asl
    asl
    asl
    asl
    sta src
    lda t_step
    lsr
    lsr
    clc
    adc #$20
    sta tmp+1
    lda src
    sta tmp
    lda #64
    jsr vb_hdr
    ldy #0
    ldx vlen
:   lda (src),y
    sta vbuf,x
    inx
    iny
    cpy #64
    bne :-
    stx vlen
    jsr text_bank
    inc t_step
    lda t_step
    cmp #16
    beq @streamed
    rts
@streamed:
    lda #LS_FADEIN
    sta ld_step
    lda #0
    sta ld_wait
    rts
@fadein:
    lda pal_level
    beq @done
    inc ld_wait
    lda ld_wait
    and #1
    bne :+
    dec pal_level
    jsr emit_pal
:   rts
@done:
    lda ld_then
    asl
    tax
    lda load_then+1,x
    pha
    lda load_then,x
    pha
    rts
load_then:
    .word map_entered-1, battle_entered-1, title_entered-1, card_entered-1, classes_entered-1, end_entered-1
