; THE LEGEND OF BLUM engine: the map. Walking (1 px per frame, feet box against solid metatiles and entities),
; talking (A, the tile in front, across a counter), touching (enemies, doors), screen edges (slide inside an
; area, fade to another area), the slide itself (horizontal like the spike, vertical with the MMC3 mirroring
; switched to horizontal for the slide), and the sprites (Blum, entities, battle).
.segment "CODE"

; ---- entities -----------------------------------------------------------------------------------------
; Entity record (9 bytes, ents + ent_off[i]): 0 x, 1 y (metatiles), 2 sprite set ($FF none), 3 facing,
; 4 if-flag, 5 unless-flag ($FF none), 6 talk script, 7 touch script ($FF none), 8 animated.
; ent_visible: X = entity index -> carry set when shown (flags allow it). Keeps X.
ent_visible:
    stx ev_x
    ldy ent_off,x
    lda ents+4,y
    cmp #$FF
    beq @unless
    jsr flag_test
    beq @no
@unless:
    ldx ev_x
    ldy ent_off,x
    lda ents+5,y
    cmp #$FF
    beq @yes
    jsr flag_test
    bne @no
@yes:
    ldx ev_x
    sec
    rts
@no:
    ldx ev_x
    clc
    rts

; ---- collision --------------------------------------------------------------------------------------
; solid_at: tmp = x, tmp+1 = y (pixels) -> Z clear (bne) when the metatile there is solid
solid_at:
    lda tmp+1
    and #$F0
    sta ri
    lda tmp
    lsr
    lsr
    lsr
    lsr
    ora ri
    tay
    ldx scr_grid,y
    lda mt_attr,x
    and #MT_SOLID
    rts

; ent_hit: player feet box at (tmp+2, tmp+3) against entity X's 16x16 tile box (inset 1 px). Carry = overlap.
ent_hit:
    ldy ent_off,x
    lda ents,y
    asl
    asl
    asl
    asl
    sta sx
    lda ents+1,y
    asl
    asl
    asl
    asl
    sta sy
    ; player x range [nx+3, nx+12] against [bx+1, bx+14]
    lda tmp+2
    clc
    adc #11
    cmp sx
    bcc @no
    lda sx
    clc
    adc #14
    sta ri
    lda tmp+2
    clc
    adc #3
    cmp ri
    beq @y
    bcs @no
@y: ; player y range [ny+8, ny+15] against [by+1, by+15]
    lda tmp+3
    clc
    adc #14
    cmp sy
    bcc @no
    lda sy
    clc
    adc #15
    sta ri
    lda tmp+3
    clc
    adc #8
    cmp ri
    beq @yes
    bcs @no
@yes:
    sec
    rts
@no:
    clc
    rts

; try_move: tmp+2 = new x, tmp+3 = new y (one pixel away). Commits, blocks, or touches an entity.
try_move:
    lda tmp+2
    clc
    adc #3
    sta tmp
    lda tmp+3
    clc
    adc #8
    sta tmp+1
    jsr solid_at
    bne @blocked
    lda tmp+2
    clc
    adc #12
    sta tmp
    jsr solid_at
    bne @blocked
    lda tmp+3
    clc
    adc #15
    sta tmp+1
    jsr solid_at
    bne @blocked
    lda tmp+2
    clc
    adc #3
    sta tmp
    jsr solid_at
    bne @blocked
    ldx #0
@ent:
    cpx ent_n
    beq @ok
    jsr ent_visible
    bcc @next
    stx cnt
    jsr ent_hit
    ldx cnt
    bcs @touch
@next:
    inx
    bne @ent
@ok:
    lda tmp+2
    sta px
    lda tmp+3
    sta py
    lda #1
    sta moving
    lda #0
    sta touch_lock
@blocked:
    rts
@touch:
    lda touch_lock
    bne @blocked
    ldy ent_off,x
    lda ents+7,y
    cmp #$FF
    beq @blocked
    pha
    lda #1
    sta touch_lock
    pla
    jmp vm_start

; ---- map state ----------------------------------------------------------------------------------
map_update:
    lda #0
    sta moving
    lda pad
    and #$0F
    bne :+
    sta touch_lock          ; d-pad released: a touched entity can trigger again
:   lda pad_new
    and #BTN_START
    beq :+
    jmp menu_start
:   lda pad_new
    and #BTN_A
    beq @move
    jsr try_talk
    bcc @move
    rts
@move:
    lda px
    sta tmp+2
    lda py
    sta tmp+3
    lda pad
    and #BTN_UP
    beq @down
    ldx #FACE_UP
    jsr turn_check
    bcc :+
    rts
:
    lda py
    bne :+
    ldx screen
    lda scr_exit_u,x
    cmp #$FF
    beq @done
    ldy #3
    jmp leave_screen
:   dec tmp+3
    jmp try_move
@down:
    lda pad
    and #BTN_DOWN
    beq @left
    ldx #FACE_DOWN
    jsr turn_check
    bcc :+
    rts
:
    lda py
    cmp #224
    bcc :+
    ldx screen
    lda scr_exit_d,x
    cmp #$FF
    beq @done
    ldy #2
    jmp leave_screen
:   inc tmp+3
    jmp try_move
@left:
    lda pad
    and #BTN_LEFT
    beq @right
    ldx #FACE_LEFT
    jsr turn_check
    bcc :+
    rts
:
    lda px
    bne :+
    ldx screen
    lda scr_exit_l,x
    cmp #$FF
    beq @done
    ldy #1
    jmp leave_screen
:   dec tmp+2
    jmp try_move
@right:
    lda pad
    and #BTN_RIGHT
    beq @done
    ldx #FACE_RIGHT
    jsr turn_check
    bcc :+
    rts
:
    lda px
    cmp #240
    bcc :+
    ldx screen
    lda scr_exit_r,x
    cmp #$FF
    beq @done
    ldy #0
    jmp leave_screen
:   inc tmp+2
    jmp try_move
@done:
    rts

; turn_check: X = facing of the pressed direction. A fresh press in a new direction only turns Blum
; (carry set: no step this frame); holding it walks. Lets the player (and the bot) face a neighbour.
turn_check:
    cpx facing
    beq @move
    stx facing
    lda pad_new
    and #$0F
    beq @move
    sec
    rts
@move:
    clc
    rts

; leave_screen: A = target screen, Y = direction (0 right, 1 left, 2 down, 3 up). Same area: slide;
; another area: fade, Blum enters on the opposite edge.
leave_screen:
    sta t_target
    sty t_dir
    tax
    lda scr_area,x
    cmp area
    bne @fade
    jmp start_scroll
@fade:
    ldx t_dir
    lda edge_pos,x
    cpx #2
    bcs :+
    sta px
    jmp @go
:   sta py
@go:
    lda t_target
    jmp load_map
edge_pos:
    .byte 0, 240, 0, 224

; try_talk: the tile in front of Blum (beyond a counter) holds a visible entity with a talk script ->
; runs it (carry set).
try_talk:
    lda px
    clc
    adc #8
    lsr
    lsr
    lsr
    lsr
    sta tmp                 ; tile x
    lda py
    clc
    adc #8
    lsr
    lsr
    lsr
    lsr
    sta tmp+1               ; tile y
    jsr front_tile
    bcc @no
    ; a counter in front: talk across it
    lda tmp+1
    asl
    asl
    asl
    asl
    ora tmp
    tay
    ldx scr_grid,y
    lda mt_attr,x
    and #MT_COUNTER
    beq @find
    jsr front_tile
    bcc @no
@find:
    ldx #0
@l: cpx ent_n
    beq @no
    jsr ent_visible
    bcc @next
    ldy ent_off,x
    lda ents,y
    cmp tmp
    bne @next
    lda ents+1,y
    cmp tmp+1
    bne @next
    lda ents+6,y
    cmp #$FF
    beq @next
    pha
    lda facing              ; the entity turns to face Blum
    eor #1
    sta ent_face,x
    inc talks
    pla
    jsr vm_start
    sec
    rts
@next:
    inx
    bne @l
@no:
    clc
    rts

; front_tile: tmp/tmp+1 = tile -> moved one step in the facing direction; carry clear when off screen
front_tile:
    lda facing
    cmp #FACE_UP
    bne :+
    lda tmp+1
    beq @off
    dec tmp+1
    sec
    rts
:   cmp #FACE_DOWN
    bne :+
    lda tmp+1
    cmp #14
    bcs @off
    inc tmp+1
    sec
    rts
:   cmp #FACE_LEFT
    bne :+
    lda tmp
    beq @off
    dec tmp
    sec
    rts
:   lda tmp
    cmp #15
    bcs @off
    inc tmp
    sec
    rts
@off:
    clc
    rts

; map_entered: the loader finished a map screen
map_entered:
    ldx area
    lda area_song,x
    jsr play_song
    lda #ST_MAP
    sta state
    lda vm_on
    beq :+
    lda #0
    sta vm_need_map
    jmp vm_run
:   rts

; ---- screen slide (ST_SCROLL) -------------------------------------------------------------------------
SCROLL_STEP = 4
start_scroll:
    lda #ST_SCROLL
    sta state
    lda #0
    sta t_step
    sta t_off
    sta t_k
    lda t_dir
    cmp #2
    bcc :+
    lda #1                  ; vertical slide: nametables stacked
    sta n_mirror
    lda cur_nt
    jsr page_ctrl
    sta n_scroll_nt
:   lda t_target
    jmp load_screen_data    ; the target's working copy (the screen on view needs no redraw while sliding)

scroll_update:
    lda t_step
    cmp #16
    bcs @slide
    ; stream the target into the other page: 2 tile rows per frame, then the attributes
    jsr other_hi
    sta nthi
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
    inc t_step
    ldx area
    lda area_song,x
    jmp play_song
@slide:
    inc t_k
    lda t_off
    clc
    adc #SCROLL_STEP
    sta t_off
    lda t_dir
    cmp #2
    bcs @vert
    ; horizontal: 64 frames, Blum carried from one edge to the other (240 px)
    ldx t_k
    lda hcarry,x
    ldy t_dir
    bne :+
    sta tmp                 ; right: px = 240 - carry
    lda #240
    sec
    sbc tmp
:   sta px
    lda t_off
    beq @hdone
    lda t_dir
    bne @hl
    lda t_off
    sta n_scroll_x
    lda cur_nt
    sta n_scroll_nt
    rts
@hl:
    lda #0
    sec
    sbc t_off
    sta n_scroll_x
    lda cur_nt
    eor #1
    sta n_scroll_nt
    rts
@hdone:
    lda #0
    sta n_scroll_x
    jmp @finish
@vert:
    ; vertical: 60 frames of 4 px (240 lines), Blum carried 224 px
    ldx t_k
    lda vcarry,x
    ldy t_dir
    cpy #2
    bne :+
    sta tmp                 ; down: py = 224 - carry
    lda #224
    sec
    sbc tmp
:   sta py
    lda t_off
    cmp #240
    bcs @vdone
    lda t_dir
    cmp #2
    bne @vu
    lda t_off
    sta n_scroll_y
    lda cur_nt
    jsr page_ctrl
    sta n_scroll_nt
    rts
@vu:
    lda #240
    sec
    sbc t_off
    sta n_scroll_y
    lda cur_nt
    eor #1
    jsr page_ctrl
    sta n_scroll_nt
    rts
@vdone:
    lda #0
    sta n_scroll_y
    sta n_mirror            ; back to side by side
@finish:
    lda cur_nt
    eor #1
    sta cur_nt
    jsr page_ctrl
    sta n_scroll_nt
    lda #ST_MAP
    sta state
    rts

; hcarry[k] = k * 240 / 64, vcarry[k] = k * 224 / 60 (pixels carried after k frames)
hcarry:
.repeat 65, K
    .byte (K * 240) / 64
.endrep
vcarry:
.repeat 61, K
    .byte (K * 224) / 60
.endrep

; ---- sprites ----------------------------------------------------------------------------------------
; draw_ms: A = metasprite id, sx/sy = anchor, sflip = 1 mirrors (16 px wide). Clips sprites off the
; bottom of the screen; stops when OAM is full.
draw_ms:
    tax
    lda ms_lo,x
    sta src
    lda ms_hi,x
    sta src+1
    ldy #0
    lda (src),y
    sta cnt
    iny
@l: lda cnt
    beq @done
    ldx oam_i
    beq @done               ; wrapped: OAM full
    lda (src),y             ; dy
    clc
    adc sy
    sec
    sbc #1
    sta OAM,x
    iny
    lda (src),y             ; dx
    sta tmp
    iny
    lda (src),y             ; tile
    sta OAM+1,x
    iny
    lda (src),y             ; attr
    eor sflip
    sta OAM+2,x
    iny
    lda sflip
    beq :+
    lda #8
    sec
    sbc tmp
    sta tmp
:   lda tmp
    clc
    adc sx
    sta OAM+3,x
    txa
    clc
    adc #4
    sta oam_i
    dec cnt
    jmp @l
@done:
    rts

; hidden: sy = sprite top -> carry set when its 16 lines touch an open window
hidden:
    lda win_open
    beq @menu
    lda d_row
    ldx #48
    jsr band
    bcs @yes
@menu:
    lda menu_open
    beq @no
    lda #MENU_ROW
    ldx #MENU_H*8
    jsr band
    rts
@no:
    clc
@yes:
    rts
; band: A = window first tile row, X = height in pixels -> carry set when [sy, sy+16) meets it
band:
    asl
    asl
    asl
    sta tmp+2
    stx tmp+3
    lda sy
    clc
    adc #16
    cmp tmp+2
    bcc @no
    beq @no
    lda tmp+2
    clc
    adc tmp+3
    bcs @yes                ; window reaches the bottom
    cmp sy
    bcc @no
    beq @no
@yes:
    sec
    rts
@no:
    clc
    rts

build_oam:
    lda #4                  ; OAM slot 0 left empty: oam_i = 0 means "full" in draw_ms
    sta oam_i
    lda state
    cmp #ST_BATTLE
    bne :+
    jsr battle_oam
    jmp @clear
:   cmp #ST_MAP
    beq @map
    cmp #ST_DIALOG
    beq @map
    cmp #ST_MENU
    beq @map
    cmp #ST_SCROLL
    beq @map
    jmp @clear
@map:
    ; Blum
    lda px
    sta sx
    lda py
    sta sy
    jsr hidden
    bcs @ents
    lda #0
    sta sflip
    lda facing
    asl
    tax                     ; down 0, up 2, left 4, right 6 -> frame pairs
    cpx #6
    bne :+
    ldx #4
:   cpx #4
    bne :+
    lda facing
    cmp #FACE_LEFT
    bne :+
    lda #$40
    sta sflip
:   lda moving
    beq :+
    lda walk_ctr
    and #8
    beq :+
    inx
:   lda blum_frame,x
    tax
    lda blum_ms,x
    jsr draw_ms
@ents:
    lda state
    cmp #ST_SCROLL
    beq @clear
    ldx #0
@e: cpx ent_n
    beq @clear
    stx oam_e
    jsr ent_visible
    bcc @enext
    ldy ent_off,x
    lda ents+2,y
    cmp #$FF
    beq @enext
    sta cnt
    lda ents,y
    asl
    asl
    asl
    asl
    sta sx
    lda ents+1,y
    asl
    asl
    asl
    asl
    sta sy
    jsr hidden
    bcs @enext
    ldx oam_e
    ldy ent_off,x
    lda #0
    sta sflip
    lda ents+8,y
    beq @face
    lda frame               ; animated: 2 frames
    lsr
    lsr
    lsr
    lsr
    and #1
    jmp @pick
@face:
    lda ent_face,x
    cmp #FACE_LEFT
    bne :+
    lda #$40
    sta sflip
    lda #3
    bne @pick
:   cmp #FACE_RIGHT
    bne :+
    lda #3
    bne @pick
:   cmp #FACE_UP
    bne :+
    lda #2
    bne @pick
:   lda #0
@pick:
    sta tmp
    lda cnt
    asl
    asl
    clc
    adc tmp
    tax
    lda set_frames,x
    jsr draw_ms
@enext:
    ldx oam_e
    inx
    bne @e
@clear:
    ldx oam_i
    beq @full
    lda #$F8
:   sta OAM,x
    inx
    inx
    inx
    inx
    bne :-
@full:
    lda #$F8
    sta OAM
    rts

; Blum map frame index per (facing*2 + step): blum_ms order down0 down1 up0 up1 side0 side1
blum_frame:
    .byte 0, 1, 2, 3, 4, 5, 4, 5
