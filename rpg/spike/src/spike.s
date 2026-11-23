; LEGEND OF BLUM engine spike (BLUMZ-PLAN, docs/RPG-PLAN.md section 2). ca65, MMC3, our code.
; Top-down 16x16 metatile map, one screen per room, a horizontal scroll transition between two rooms
; (vertical mirroring: the next room is written into the other nametable, then X scrolls 4 px per
; frame), an NPC dialogue window with French accents, one turn-based battle drawn in the other
; nametable. Data (rooms, text, battle) comes from rpg/spike/data/world.json via gen/world*.inc.
; One frame:
;   NMI   if the main thread finished its frame: VRAM buffer -> PPU (<= ~70 bytes), OAM DMA, scroll
;         values for the next frame; else count a lag frame. Then scroll + PPUCTRL, music would go here.
;   main  pad, state update (writes the VRAM buffer, never the PPU), OAM, probe, then idle (counted).

.include "world.inc"

PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016

OAM       = $0200
PROBE     = $7F00
PROBE_LAG = $7F14

CTRL_VAL  = %10001000       ; NMI on, sprites $1000, BG $0000, +1 increment, nametable bits from scroll_nt
MASK_VAL  = %00011110

BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10
BTN_UP = $08
BTN_DOWN = $04
BTN_LEFT = $02
BTN_RIGHT = $01

ST_BOOT = 0
ST_MAP = 1
ST_SCROLL = 2
ST_DIALOG = 3
ST_BATTLE = 4

FACE_DOWN = 0
FACE_UP = 1
FACE_LEFT = 2
FACE_RIGHT = 3

; dialogue sub-states (also used by the battle message window)
DS_BOX = 0
DS_TYPE = 1
DS_WAIT = 2
DS_CLOSE = 3

; battle sub-states and what follows a message
BS_IN = 0
BS_MSG = 1
BS_WAIT = 2
BS_MENU = 3
BS_OUT = 4
AF_MENU = 0
AF_ENEMY = 1
AF_WIN = 2
AF_EXIT = 3
AF_LOSE = 4

FLAG_CLOCHE = $01           ; ITEM_CLOCHE received
FLAG_CRAYONS = $02          ; BOSS_CRAYONS beaten

SCROLL_STEP = 4
STREAM_STEPS = 16           ; 15 metatile rows (2 tile rows each) + attributes

.segment "HEADER"
    .incbin "header.bin"

.segment "ZEROPAGE"
nmi_count:   .res 1
frame_ready: .res 1
idle:        .res 2
idle_min:    .res 2
frame:       .res 2
pad:         .res 1
pad_prev:    .res 1
pad_new:     .res 1
tmp:         .res 4
ptr:         .res 2
src:         .res 2
vlen:        .res 1
vpeak:       .res 1
cnt:         .res 1
ri:          .res 1
row_i:       .res 1
nthi:        .res 1         ; PPU address high byte of the nametable being written ($20 or $24)
; scroll: next (main) and live (NMI)
n_scroll_x:  .res 1
n_scroll_nt: .res 1
scroll_x:    .res 1
scroll_nt:   .res 1
; world
state:       .res 1
room:        .res 1
px:          .res 1
py:          .res 1
facing:      .res 1
moving:      .res 1
walk_ctr:    .res 1
cur_nt:      .res 1
flags:       .res 1
items:       .res 1
xp:          .res 1
talked:      .res 1
; transition
t_dir:       .res 1         ; 0 right, 1 left
t_target:    .res 1
t_step:      .res 1
t_off:       .res 1
t_cnt:       .res 1
; dialogue window / typing
d_sub:       .res 1
d_step:      .res 1
d_row:       .res 1         ; first tile row of the window
d_nt:        .res 1         ; nametable high byte the window lives in
d_page:      .res 1
d_left:      .res 1
d_i:         .res 1
d_blink:     .res 1
; battle
b_sub:       .res 1
b_step:      .res 1
b_after:     .res 1
ehp:         .res 1
blum_hp:         .res 1
cursor:      .res 1
turn:        .res 1
defending:   .res 1
; OAM building
oam_i:       .res 1
sattr:       .res 1
sx:          .res 1
sy:          .res 1

.segment "BSS"
vbuf:        .res 160

; ---------------------------------------------------------------------------------------------------
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

; writes the buffer to the PPU (NMI, or boot with rendering off), then empties it
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

; ---- room drawing -----------------------------------------------------------------------------------
; set_room_ptr: A = room -> ptr = metatile grid, src = attribute table
set_room_ptr:
    tax
    lda room_mt_lo,x
    sta ptr
    lda room_mt_hi,x
    sta ptr+1
    lda room_attr_lo,x
    sta src
    lda room_attr_hi,x
    sta src+1
    rts

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

; emit_room_row: A = tile row (0-29) of the room at ptr, into the nametable nthi (35 buffer bytes)
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
    lda cnt
    and #1
    bne @bottom
@top:
    ldy ri
    lda (ptr),y
    tax
    ldy vlen
    lda mt_tl,x
    sta vbuf,y
    iny
    lda mt_tr,x
    sta vbuf,y
    iny
    sty vlen
    inc ri
    dec tmp+2
    bne @top
    rts
@bottom:
    ldy ri
    lda (ptr),y
    tax
    ldy vlen
    lda mt_bl,x
    sta vbuf,y
    iny
    lda mt_br,x
    sta vbuf,y
    iny
    sty vlen
    inc ri
    dec tmp+2
    bne @bottom
    rts

; emit_attr: Y = first attribute byte (0-63), X = count; copies from src into the nametable nthi.
; tmp+3 = AND mask applied to the first 8 bytes (window rows), $FF = plain copy, second 8 use tmp+2
emit_attr_rows:
    stx cnt
    sty ri
    lda nthi
    clc
    adc #3
    sta tmp+1
    tya
    clc
    adc #$C0
    sta tmp
    txa
    jsr vb_hdr
@l:
    ldy ri
    lda (src),y
    pha
    lda cnt
    cmp #9
    bcc @m2                 ; second attribute row of a 16-byte window update
    pla
    and tmp+3
    jmp @put
@m2:
    pla
    and tmp+2
@put:
    jsr vb_put
    inc ri
    dec cnt
    bne @l
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

; ---- collision ----------------------------------------------------------------------------------
; solid_at: tmp = x, tmp+1 = y -> Z clear (bne) when the metatile there is solid
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
    lda (ptr),y
    tax
    lda mt_solid,x
    rts

; box_hit: player hitbox at new position (tmp+2 = nx, tmp+3 = ny) against the 16x16 box at X = bx, Y = by
; (box inset by 1 px each side). Carry set = overlap.
box_hit:
    ; player x range [nx+3, nx+12], box [bx+1, bx+14]
    stx sx
    sty sy
    lda tmp+2
    clc
    adc #12
    sec
    sbc #1
    cmp sx                  ; nx+11 < bx  -> no  (nx+12 <= bx+1 - 1 ... i.e. nx+12 < bx+1)
    bcc @no
    lda sx
    clc
    adc #14
    sta ri
    lda tmp+2
    clc
    adc #3
    cmp ri                  ; nx+3 > bx+14 -> no
    beq @xy
    bcs @no
@xy:
    ; player y range [ny+8, ny+15], box [by+1, by+15]
    lda tmp+3
    clc
    adc #15
    sec
    sbc #1
    cmp sy                  ; ny+14 < by -> no
    bcc @no
    lda sy
    clc
    adc #15
    sta ri
    lda tmp+3
    clc
    adc #8
    cmp ri                  ; ny+8 > by+15 -> no
    beq @yes
    bcs @no
@yes:
    sec
    rts
@no:
    clc
    rts

; try_move: tmp+2 = new x, tmp+3 = new y (one pixel from px/py). Commits, blocks, exits or starts a battle.
try_move:
    ; corners of the feet box: (x+3,y+8) (x+12,y+8) (x+3,y+15) (x+12,y+15)
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
    ; NPC
    lda room
    cmp #NPC0_ROOM
    bne @enemy
    ldx #NPC0_X
    ldy #NPC0_Y
    jsr box_hit
    bcs @blocked
@enemy:
    lda room
    cmp #ENEMY_ROOM
    bne @ok
    lda flags
    and #FLAG_CRAYONS
    bne @ok
    ldx #ENEMY_X
    ldy #ENEMY_Y
    jsr box_hit
    bcc @ok
    jmp start_battle
@ok:
    lda tmp+2
    sta px
    lda tmp+3
    sta py
    lda #1
    sta moving
@blocked:
    rts

; ---- map state ------------------------------------------------------------------------------------
map_update:
    lda #0
    sta moving
    lda pad_new
    and #BTN_A
    beq @move
    jsr try_talk
    bcc @move
    rts
@move:
    lda room
    jsr set_room_ptr
    lda px
    sta tmp+2
    lda py
    sta tmp+3
    lda pad
    and #BTN_UP
    beq @down
    lda #FACE_UP
    sta facing
    lda py
    beq @done
    dec tmp+3
    jmp try_move
@down:
    lda pad
    and #BTN_DOWN
    beq @left
    lda #FACE_DOWN
    sta facing
    lda py
    cmp #224
    bcs @done
    inc tmp+3
    jmp try_move
@left:
    lda pad
    and #BTN_LEFT
    beq @right
    lda #FACE_LEFT
    sta facing
    lda px
    bne :+
    ldx room
    lda room_exit_l,x
    bmi @done
    sta t_target
    lda #1
    jmp start_scroll
:   dec tmp+2
    jmp try_move
@right:
    lda pad
    and #BTN_RIGHT
    beq @done
    lda #FACE_RIGHT
    sta facing
    lda px
    cmp #240
    bcc :+
    ldx room
    lda room_exit_r,x
    bmi @done
    sta t_target
    lda #0
    jmp start_scroll
:   inc tmp+2
    jmp try_move
@done:
    rts

; try_talk: the point just in front of the player inside the NPC's 16x16 box -> dialogue (carry set)
try_talk:
    lda room
    cmp #NPC0_ROOM
    bne @no
    lda px
    clc
    adc #8
    sta tmp
    lda py
    clc
    adc #12
    sta tmp+1
    lda facing
    cmp #FACE_UP
    bne :+
    lda py
    clc
    adc #4
    sta tmp+1
    jmp @test
:   cmp #FACE_DOWN
    bne :+
    lda py
    clc
    adc #19
    sta tmp+1
    jmp @test
:   cmp #FACE_LEFT
    bne :+
    lda px
    sec
    sbc #1
    sta tmp
    jmp @test
:   lda px
    clc
    adc #16
    sta tmp
@test:
    lda tmp
    sec
    sbc #NPC0_X
    cmp #16
    bcs @no
    lda tmp+1
    sec
    sbc #NPC0_Y
    cmp #16
    bcs @no
    ; start the dialogue
    inc talked
    lda #ST_DIALOG
    sta state
    lda #DS_BOX
    sta d_sub
    lda #0
    sta d_step
    lda #NPC0_DLG_FIRST
    sta d_page
    lda #NPC0_DLG_COUNT
    sta d_left
    jsr cur_nthi
    sta d_nt
    lda #BOX_BOTTOM
    ldx py
    cpx #120
    bcc :+
    lda #BOX_TOP
:   sta d_row
    sec
    rts
@no:
    clc
    rts

; cur_nthi: A = $20 or $24 for the nametable on screen (cur_nt)
cur_nthi:
    lda cur_nt
    asl
    asl
    ora #$20
    rts
; other_nthi: the nametable off screen
other_nthi:
    lda cur_nt
    eor #1
    asl
    asl
    ora #$20
    rts

; ---- dialogue window --------------------------------------------------------------------------------
; emit_window_row: A = row inside the window (0-5); d_row/d_nt give the place (35 buffer bytes)
emit_window_row:
    pha
    clc
    adc d_row
    ldx d_nt
    stx nthi
    jsr row_addr
    lda #32
    jsr vb_hdr
    pla
    tax
    lda #T_SPACE            ; middle rows
    sta tmp+2
    lda #T_LEFT
    sta tmp
    lda #T_RIGHT
    sta tmp+1
    cpx #0
    bne :+
    lda #T_TOP
    sta tmp+2
    lda #T_TL
    sta tmp
    lda #T_TR
    sta tmp+1
:   cpx #5
    bne :+
    lda #T_BOTTOM
    sta tmp+2
    lda #T_BL
    sta tmp
    lda #T_BR
    sta tmp+1
:   ldy vlen
    lda #0
    sta vbuf,y
    iny
    lda tmp
    sta vbuf,y
    iny
    lda tmp+2
    ldx #28
:   sta vbuf,y
    iny
    dex
    bne :-
    lda tmp+1
    sta vbuf,y
    iny
    lda #0
    sta vbuf,y
    iny
    sty vlen
    rts

; window attribute rows: first row of the window is a lower half (mask $0F), the next row is whole ($00)
; (both window places are 2 + 4k tile rows: BOX_TOP = 2, BOX_BOTTOM = 22)
emit_window_attr:
    lda d_nt
    sta nthi
    lda room
    jsr set_room_ptr
    lda d_row
    lsr
    lsr
    asl
    asl
    asl                     ; (d_row / 4) * 8
    tay
    ldx #16
    lda #$0F
    sta tmp+3
    lda #$00
    sta tmp+2
    jmp emit_attr_rows

restore_window_attr:
    lda d_nt
    sta nthi
    lda room
    jsr set_room_ptr
    lda d_row
    lsr
    lsr
    asl
    asl
    asl
    tay
    ldx #16
    lda #$FF
    sta tmp+3
    sta tmp+2
    jmp emit_attr_rows

; type_step: 2 characters of page d_page at d_i. Carry set when the page is complete.
type_step:
    ldx d_page
    lda page_lo,x
    sta src
    lda page_hi,x
    sta src+1
    ; row = d_row + 1 (+2 for the second line), col = TEXT_COL + i % 28
    lda d_i
    ldx #1
    cmp #TEXT_W
    bcc :+
    sbc #TEXT_W
    ldx #3
:   clc
    adc #TEXT_COL
    sta tmp+2               ; column
    txa
    clc
    adc d_row
    ldx d_nt
    stx nthi
    jsr row_addr
    lda tmp
    ora tmp+2
    sta tmp
    lda #2
    jsr vb_hdr
    ldy d_i
    lda (src),y
    jsr vb_put
    ldy d_i
    iny
    lda (src),y
    jsr vb_put
    lda d_i
    clc
    adc #2
    sta d_i
    cmp #PAGE_BYTES
    rts                     ; carry set when d_i >= PAGE_BYTES

; arrow_tile: A = tile at the prompt place (window row 4, column 29)
arrow_tile:
    pha
    lda d_row
    clc
    adc #4
    ldx d_nt
    stx nthi
    jsr row_addr
    lda tmp
    ora #29
    sta tmp
    lda #1
    jsr vb_hdr
    pla
    jmp vb_put

blink_step:
    inc d_blink
    lda d_blink
    and #15
    bne @no
    lda d_blink
    and #16
    beq :+
    lda #T_ARROW
    jmp arrow_tile
:   lda #T_SPACE
    jmp arrow_tile
@no:
    rts

dialog_update:
    lda d_sub
    cmp #DS_BOX
    bne @type
    lda d_step
    cmp #3
    bcs @battr
    asl
    jsr emit_window_row
    lda d_step
    asl
    clc
    adc #1
    jsr emit_window_row
    inc d_step
    rts
@battr:
    jsr emit_window_attr
    lda #DS_TYPE
    sta d_sub
    lda #0
    sta d_i
    rts
@type:
    cmp #DS_TYPE
    bne @wait
    jsr type_step
    bcc :+
    lda #DS_WAIT
    sta d_sub
    lda #15
    sta d_blink
:   rts
@wait:
    cmp #DS_WAIT
    bne @close
    lda pad_new
    and #BTN_A
    bne :+
    jmp blink_step
:   lda #T_SPACE
    jsr arrow_tile
    dec d_left
    beq :+
    inc d_page
    lda #0
    sta d_i
    lda #DS_TYPE
    sta d_sub
    rts
:   lda #DS_CLOSE
    sta d_sub
    lda #0
    sta d_step
    rts
@close:
    lda d_step
    cmp #3
    bcs @cattr
    lda room
    jsr set_room_ptr
    lda d_nt
    sta nthi
    lda d_step
    asl
    clc
    adc d_row
    pha
    jsr emit_room_row
    pla
    clc
    adc #1
    jsr emit_room_row
    inc d_step
    rts
@cattr:
    jsr restore_window_attr
    lda #ST_MAP
    sta state
.if NPC0_GIVES
    lda flags
    ora #FLAG_CLOCHE
    sta flags
    lda #1
    sta items
.endif
    rts

; ---- screen transition ---------------------------------------------------------------------------
; start_scroll: A = direction (0 right, 1 left), t_target set
start_scroll:
    sta t_dir
    lda #ST_SCROLL
    sta state
    lda #0
    sta t_step
    sta t_off
    sta t_cnt
    rts

scroll_update:
    lda t_step
    cmp #STREAM_STEPS
    bcs @scroll
    ; stream the target room into the other nametable: 2 tile rows per frame, then the attributes
    jsr other_nthi
    sta nthi
    lda t_target
    jsr set_room_ptr
    lda t_step
    cmp #STREAM_STEPS-1
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
    ldy #0
    ldx #64
    lda #$FF
    sta tmp+3
    sta tmp+2
    jsr emit_attr_rows
    inc t_step
    rts
@scroll:
    lda t_off
    clc
    adc #SCROLL_STEP
    sta t_off
    ; player rides the scroll: 4 px per frame, 1 px every 8th frame -> 232 px in 64 frames
    ldx #SCROLL_STEP
    lda t_cnt
    and #7
    bne :+
    ldx #1
:   inc t_cnt
    stx tmp
    lda t_dir
    bne @left
    lda px
    sec
    sbc tmp
    sta px
    jmp @where
@left:
    lda px
    clc
    adc tmp
    sta px
@where:
    lda t_off
    beq @done               ; wrapped to 256: the move is complete
    lda t_dir
    bne @lx
    lda t_off
    sta n_scroll_x
    lda cur_nt
    sta n_scroll_nt
    rts
@lx:
    lda #0
    sec
    sbc t_off
    sta n_scroll_x
    lda cur_nt
    eor #1
    sta n_scroll_nt
    rts
@done:
    lda cur_nt
    eor #1
    sta cur_nt
    sta n_scroll_nt
    lda #0
    sta n_scroll_x
    lda t_target
    sta room
    lda #ST_MAP
    sta state
    rts

; ---- battle -----------------------------------------------------------------------------------------
start_battle:
    lda #ST_BATTLE
    sta state
    lda #BS_IN
    sta b_sub
    lda #0
    sta b_step
    sta cursor
    sta turn
    sta defending
    lda #ENEMY_HP
    sta ehp
    rts

; emit_palette: src = 32 bytes
emit_palette:
    lda #$3F
    sta tmp+1
    lda #0
    sta tmp
    lda #32
    jsr vb_hdr
    ldy #0
:   lda (src),y
    sty ri
    jsr vb_put
    ldy ri
    iny
    cpy #32
    bne :-
    rts

emit_black:
    lda #$3F
    sta tmp+1
    lda #0
    sta tmp
    lda #32
    jsr vb_hdr
    ldx #32
    lda #$0F
:   jsr vb_put
    dex
    bne :-
    rts

; emit_num: A = value 0-99, tmp+1/tmp = PPU address -> 2 tiles (space for a leading zero)
emit_num:
    ldx #0
@d: cmp #10
    bcc @u
    sbc #10
    inx
    bne @d
@u: sta ri
    lda #2
    jsr vb_hdr
    txa
    beq @sp
    clc
    adc #DIGIT0
    jmp @t
@sp:
    lda #T_SPACE
@t: jsr vb_put
    lda ri
    clc
    adc #DIGIT0
    jmp vb_put

emit_hps:
    jsr other_nthi
    clc
    adc #>B_PHP_ADDR
    sta tmp+1
    lda #<B_PHP_ADDR
    sta tmp
    lda blum_hp
    jsr emit_num
    jsr other_nthi
    clc
    adc #>B_EHP_ADDR
    sta tmp+1
    lda #<B_EHP_ADDR
    sta tmp
    lda ehp
    jmp emit_num

; battle_msg: A = page -> typed into the battle message window
battle_msg:
    sta d_page
    lda #0
    sta d_i
    lda #BS_MSG
    sta b_sub
    rts

battle_update:
    lda b_sub
    cmp #BS_IN
    beq :+
    jmp @msg
:   lda b_step
    bne :+
    jsr emit_black
    inc b_step
    rts
:   cmp #17
    bcs @shown
    ; copy 64 bytes of the battle nametable per frame into the other nametable
    sec
    sbc #1
    sta ri                  ; chunk 0-15
    jsr other_nthi
    sta tmp+1
    lda ri
    lsr
    lsr
    clc
    adc tmp+1
    sta tmp+1
    lda ri
    and #3
    asl
    asl
    asl
    asl
    asl
    asl
    sta tmp
    lda ri
    lsr
    lsr
    clc
    adc #>battle_nt
    sta src+1
    lda #<battle_nt
    clc
    adc tmp
    sta src
    bcc :+
    inc src+1
:   lda #64
    jsr vb_hdr
    ldy #0
:   lda (src),y
    sty cnt
    jsr vb_put
    ldy cnt
    iny
    cpy #64
    bne :-
    inc b_step
    rts
@shown:
    lda #<pal_battle
    sta src
    lda #>pal_battle
    sta src+1
    jsr emit_palette
    jsr emit_hps
    lda cur_nt
    eor #1
    sta n_scroll_nt
    lda #0
    sta n_scroll_x
    jsr other_nthi
    sta d_nt
    lda #BOX_TOP
    sta d_row
    lda #AF_MENU
    sta b_after
    lda #PG_B_INTRO
    jmp battle_msg
@msg:
    cmp #BS_MSG
    bne @wait
    jsr type_step
    bcc :+
    lda #BS_WAIT
    sta b_sub
    lda #15
    sta d_blink
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
    jmp @out
:   lda pad_new
    and #BTN_DOWN
    beq :+
    lda cursor
    clc
    adc #1
    and #3
    sta cursor
:   lda pad_new
    and #BTN_UP
    beq :+
    lda cursor
    sec
    sbc #1
    and #3
    sta cursor
:   lda pad_new
    and #BTN_A
    bne :+
    rts
:   inc turn
    lda cursor
    bne @c1
    lda ehp
    sec
    sbc #ATTACK_DMG
    bcs :+
    lda #0
:   sta ehp
    lda #PG_B_ATTACK
    jmp @acted
@c1:
    cmp #1
    bne @c2
    lda ehp
    sec
    sbc #POWER_DMG
    bcs :+
    lda #0
:   sta ehp
    lda #PG_B_POWER
    jmp @acted
@c2:
    cmp #2
    bne @c3
    lda blum_hp
    clc
    adc #ITEM_HEAL
    cmp #START_HP
    bcc :+
    lda #START_HP
:   sta blum_hp
    lda #PG_B_ITEM
    jmp @acted
@c3:
    lda #1
    sta defending
    lda #PG_B_DEFEND
@acted:
    pha
    jsr emit_hps
    lda #AF_ENEMY
    ldx ehp
    bne :+
    lda #AF_WIN
:   sta b_after
    pla
    jmp battle_msg
@out:
    lda b_step
    bne :+
    jsr emit_black
    lda cur_nt
    sta n_scroll_nt
    lda #0
    sta n_scroll_x
    inc b_step
    rts
:   lda #<pal_world
    sta src
    lda #>pal_world
    sta src+1
    jsr emit_palette
    lda flags
    ora #FLAG_CRAYONS
    sta flags
    lda #ST_MAP
    sta state
    rts

battle_after:
    lda b_after
    cmp #AF_MENU
    bne :+
    lda #BS_MENU
    sta b_sub
    rts
:   cmp #AF_ENEMY
    bne @win
    ldx #ENEMY_ATK
    lda defending
    beq :+
    ldx #ENEMY_ATK_DEF
:   stx tmp+3
    lda blum_hp
    sec
    sbc tmp+3
    bcs :+
    lda #0
:   sta blum_hp
    jsr emit_hps
    lda #AF_MENU
    ldx blum_hp
    bne :+
    lda #AF_LOSE
:   sta b_after
    lda #PG_B_ENEMY
    ldx defending
    beq :+
    lda #PG_B_ENEMY_DEF
:   ldx #0
    stx defending
    jmp battle_msg
@win:
    cmp #AF_WIN
    bne @lose
    lda xp
    clc
    adc #BATTLE_XP
    sta xp
    lda #AF_EXIT
    sta b_after
    lda #PG_B_WIN
    jmp battle_msg
@lose:
    cmp #AF_LOSE
    bne @exit
    lda #START_HP
    sta blum_hp
    jsr emit_hps
    lda #AF_MENU
    sta b_after
    lda #PG_B_LOSE
    jmp battle_msg
@exit:
    lda #BS_OUT
    sta b_sub
    lda #0
    sta b_step
    rts

; ---- sprites ----------------------------------------------------------------------------------------
; meta16: A = first tile (TL TR BL BR), sx/sy = screen position, sattr = palette | $40 flip
meta16:
    sta tmp
    ldx oam_i
    lda sy
    sec
    sbc #1
    sta OAM,x
    sta OAM+4,x
    clc
    adc #8
    sta OAM+8,x
    sta OAM+12,x
    lda sattr
    sta OAM+2,x
    sta OAM+6,x
    sta OAM+10,x
    sta OAM+14,x
    lda sx
    sta OAM+3,x
    sta OAM+11,x
    clc
    adc #8
    sta OAM+7,x
    sta OAM+15,x
    lda sattr
    and #$40
    bne @flip
    lda tmp
    sta OAM+1,x
    clc
    adc #1
    sta OAM+5,x
    adc #1
    sta OAM+9,x
    adc #1
    sta OAM+13,x
    jmp @next
@flip:
    lda tmp
    sta OAM+5,x
    clc
    adc #1
    sta OAM+1,x
    adc #1
    sta OAM+13,x
    adc #1
    sta OAM+9,x
@next:
    txa
    clc
    adc #16
    sta oam_i
    rts

; hidden_by_window: sy = sprite top -> carry set if the 16 lines touch the open dialogue window
hidden_by_window:
    lda state
    cmp #ST_DIALOG
    bne @no
    lda d_row
    asl
    asl
    asl
    sta tmp+3               ; window top y
    lda sy
    clc
    adc #16
    cmp tmp+3
    bcc @no                 ; sprite bottom above the window
    beq @no
    lda tmp+3
    clc
    adc #48
    cmp sy
    bcc @no                 ; window bottom above the sprite
    beq @no
    sec
    rts
@no:
    clc
    rts

build_oam:
    lda #0
    sta oam_i
    lda state
    cmp #ST_BATTLE
    bne @map
    lda b_sub
    cmp #BS_IN
    beq @clear_far
    cmp #BS_OUT
    bne :+
@clear_far:
    jmp @clear
:   lda #184
    sta sx
    lda #96
    sta sy
    lda #$40
    sta sattr
    lda #SPR_BLUM_SIDE0
    jsr meta16
    lda b_sub
    cmp #BS_MENU
    bne @clear_far
    ldx oam_i
    ldy cursor
    lda menu_y,y
    sta OAM,x
    lda #SPR_CURSOR
    sta OAM+1,x
    lda #3
    sta OAM+2,x
    lda #B_CURSOR_X
    sta OAM+3,x
    txa
    clc
    adc #4
    sta oam_i
    jmp @clear
@map:
    ; Blum
    lda px
    sta sx
    lda py
    sta sy
    jsr hidden_by_window
    bcs @npc
    lda #0
    sta sattr
    ldx facing
    lda moving
    beq :+
    lda walk_ctr
    and #8
    beq :+
    inx
    inx
    inx
    inx
:   lda facing
    cmp #FACE_LEFT
    bne :+
    lda #$40
    sta sattr
:   lda blum_frames,x
    jsr meta16
@npc:
    lda state
    cmp #ST_SCROLL
    beq @clear
    lda room
    cmp #NPC0_ROOM
    bne @enemy
    lda #NPC0_X
    sta sx
    lda #NPC0_Y
    sta sy
    jsr hidden_by_window
    bcs @enemy
    lda #1
    sta sattr
    lda #SPR_BELANGER
    jsr meta16
@enemy:
    lda room
    cmp #ENEMY_ROOM
    bne @clear
    lda flags
    and #FLAG_CRAYONS
    bne @clear
    lda #ENEMY_X
    sta sx
    lda #ENEMY_Y
    sta sy
    jsr hidden_by_window
    bcs @clear
    lda #2
    sta sattr
    lda frame
    and #16
    beq :+
    lda #SPR_CRAYON1
    bne :++
:   lda #SPR_CRAYON0
:   jsr meta16
@clear:
    ldx oam_i
    lda #$F8
:   sta OAM,x
    inx
    inx
    inx
    inx
    bne :-
    rts

blum_frames:                ; by facing (down, up, left, right), +4 = walk frame
    .byte SPR_BLUM_DOWN0, SPR_BLUM_UP0, SPR_BLUM_SIDE0, SPR_BLUM_SIDE0
    .byte SPR_BLUM_DOWN1, SPR_BLUM_UP1, SPR_BLUM_SIDE1, SPR_BLUM_SIDE1
menu_y:
    .byte B_MENU_Y0, B_MENU_Y1, B_MENU_Y2, B_MENU_Y3

; ---- probe ($7F00, docs/RPG-PLAN.md section 8) -------------------------------------------------------
write_probe:
    lda state
    sta PROBE+$05
    lda room
    sta PROBE+$06
    lda px
    sta PROBE+$07
    lda frame
    sta PROBE+$08
    lda frame+1
    sta PROBE+$09
    lda py
    sta PROBE+$0A
    lda facing
    sta PROBE+$0B
    lda cur_nt
    sta PROBE+$0C
    lda t_off
    sta PROBE+$0D
    lda d_page
    sta PROBE+$0E
    lda d_i
    sta PROBE+$0F
    lda b_sub
    sta PROBE+$10
    lda ehp
    sta PROBE+$11
    lda blum_hp
    sta PROBE+$12
    lda cursor
    sta PROBE+$13
    lda flags
    sta PROBE+$15
    lda xp
    sta PROBE+$1A
    lda turn
    sta PROBE+$1B
    lda d_sub
    sta PROBE+$1C
    lda vpeak
    sta PROBE+$1D
    lda items
    sta PROBE+$1E
    lda talked
    sta PROBE+$1F
    lda n_scroll_x
    sta PROBE+$20
    lda n_scroll_nt
    sta PROBE+$21
    lda d_row
    sta PROBE+$22
    lda t_step
    sta PROBE+$23
    rts

; ---- main loop ------------------------------------------------------------------------------------
main:
    lda #0
    sta idle
    sta idle+1
    lda #$FF
    sta idle_min
    sta idle_min+1
@loop:
    lda nmi_count           ; idle until the next NMI, 14 cycles per iteration
@wait:
    inc idle
    bne :+
    inc idle+1
:   cmp nmi_count
    beq @wait
    lda idle
    sta PROBE+$16
    lda idle+1
    sta PROBE+$17
    lda frame+1
    bne :+
    lda frame
    cmp #4
    bcc @nomin
:   lda idle+1
    cmp idle_min+1
    bcc @setmin
    bne @nomin
    lda idle
    cmp idle_min
    bcs @nomin
@setmin:
    lda idle
    sta idle_min
    sta PROBE+$18
    lda idle+1
    sta idle_min+1
    sta PROBE+$19
@nomin:
    lda #0
    sta idle
    sta idle+1
    inc frame
    bne :+
    inc frame+1
:   lda #0
    sta vlen
    jsr read_pad
    lda state
    cmp #ST_MAP
    bne :+
    jsr map_update
    jmp @after
:   cmp #ST_SCROLL
    bne :+
    jsr scroll_update
    jmp @after
:   cmp #ST_DIALOG
    bne :+
    jsr dialog_update
    jmp @after
:   jsr battle_update
@after:
    lda moving
    beq :+
    inc walk_ctr
:   jsr build_oam
    ldy vlen
    cpy vpeak
    bcc :+
    sty vpeak
:   lda #$FF
    sta vbuf,y
    jsr write_probe
    lda #1
    sta frame_ready
    jmp @loop

.segment "RODATA"
.include "world-data.inc"

; ---------------------------------------------------------------------------------------------------
.segment "STARTUP"
reset:
    sei
    cld
    ldx #$40
    stx $4017
    ldx #$FF
    txs
    inx
    stx PPUCTRL
    stx PPUMASK
    stx $4010
    stx $E000               ; MMC3 IRQ off
    ; MMC3 first, before anything leaves $E000-$FFFF: PRG mode 0, CHR mode 0
    lda #6
    sta $8000
    lda #0
    sta $8001
    lda #7
    sta $8000
    lda #1
    sta $8001
    lda #0
    sta $8000
    lda #0
    sta $8001               ; R0 BG $0000-$07FF = CHR units 0-1
    lda #1
    sta $8000
    lda #2
    sta $8001               ; R1 BG $0800-$0FFF = units 2-3
    ldx #2
    ldy #4
:   stx $8000
    sty $8001               ; R2-R5 sprites $1000-$1FFF = units 4-7
    iny
    inx
    cpx #6
    bne :-
    lda #0
    sta $A000               ; vertical mirroring: nametables side by side (horizontal transitions)
    lda #$80
    sta $A001               ; PRG-RAM on (probe; flags + save in the full game)
    bit PPUSTATUS
:   bit PPUSTATUS
    bpl :-
    lda #0
    tax
:   sta $00,x
    sta $0100,x
    sta $0300,x
    sta $0400,x
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne :-
    lda #$F8
:   sta OAM,x
    inx
    bne :-
    lda #0
:   sta PROBE,x
    inx
    bne :-
:   bit PPUSTATUS
    bpl :-
    ; world state
    lda #START_ROOM
    sta room
    lda #START_X
    sta px
    lda #START_Y
    sta py
    lda #START_FACE
    sta facing
    lda #START_HP
    sta blum_hp
    ; palette + room 0 into nametable 0, through the VRAM buffer code (rendering is off)
    lda #<pal_world
    sta src
    lda #>pal_world
    sta src+1
    lda #0
    sta vlen
    jsr emit_palette
    lda #$FF
    ldy vlen
    sta vbuf,y
    jsr vbuf_flush
    lda #$20
    sta nthi
    lda #0
    sta row_i
@rows:
    lda #0
    sta vlen
    lda room
    jsr set_room_ptr
    lda row_i
    jsr emit_room_row
    ldy vlen
    lda #$FF
    sta vbuf,y
    jsr vbuf_flush
    inc row_i
    lda row_i
    cmp #30
    bne @rows
    lda #0
    sta vlen
    lda room
    jsr set_room_ptr
    ldy #0
    ldx #64
    lda #$FF
    sta tmp+3
    sta tmp+2
    jsr emit_attr_rows
    ldy vlen
    lda #$FF
    sta vbuf,y
    jsr vbuf_flush
    lda #0
    sta vlen
    lda #$FF
    sta vbuf
    ; probe magic
    lda #'B'
    sta PROBE
    lda #'L'
    sta PROBE+1
    lda #'M'
    sta PROBE+2
    lda #'Z'
    sta PROBE+3
    lda #1
    sta PROBE+4
    lda #ST_MAP
    sta state
    jsr build_oam
    jsr write_probe
    lda #1
    sta frame_ready         ; the first NMI finds a finished frame (no boot lag frame)
:   bit PPUSTATUS
    bpl :-
    lda #CTRL_VAL
    sta PPUCTRL
    lda #MASK_VAL
    sta PPUMASK
    jmp main

nmi:
    pha
    txa
    pha
    tya
    pha
    lda frame_ready
    beq @lag
    jsr vbuf_flush
    lda #0
    sta OAMADDR
    lda #>OAM
    sta OAMDMA
    lda n_scroll_x
    sta scroll_x
    lda n_scroll_nt
    sta scroll_nt
    lda #0
    sta frame_ready
    jmp @scroll
@lag:
    inc PROBE_LAG
@scroll:
    bit PPUSTATUS
    lda scroll_x
    sta PPUSCROLL
    lda #0
    sta PPUSCROLL
    lda scroll_nt
    ora #CTRL_VAL
    sta PPUCTRL
    inc nmi_count
    pla
    tay
    pla
    tax
    pla
    rti

irq:
    rti

.segment "VECTORS"
    .word nmi, reset, irq

.segment "CHARS"
    .incbin "chr.bin"
