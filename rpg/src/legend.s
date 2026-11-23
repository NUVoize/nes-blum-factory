; THE LEGEND OF BLUM (BLUMZ-M1) RPG engine, docs/RPG-PLAN.md section 2. ca65, MMC3, our code.
; Grown from the BLUMZ-PLAN spike (rpg/spike/src/spike.s): same VRAM buffer + NMI, metatile rows, collision,
; window and typewriter, battle in a nametable. Everything the player sees comes from rpg/legend/*.json
; (maps, entities, scripts, French text, battles, classes) and the BLUMZ-A1 kit (rpg/kit/), compiled by
; src/core/rpg/legend/compile.ts into gen/*.s. Story logic lives in data: an event script VM (vm.s) runs the
; bytecode of gen/text.s.
; One frame:
;   NMI   if the main thread finished its frame: mirroring, VRAM buffer -> PPU (<= ~80 bytes), OAM DMA, scroll
;         values for the next frame; else count a lag frame. Then scroll + PPUCTRL.
;   main  FamiStudio, pad, state update (writes the VRAM buffer, never the PPU), OAM, probe, then idle.
; Banks: R6 ($8000) = BANK_TEXT except while a screen loads (BANK_WORLD, screen banks), R7 ($A000) = SOUND.

.include "legend.inc"

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

; WRAM ($6000-$7FFF, battery-backed): two save slots, then the current screen's working copy
SLOT_A    = $6000
SLOT_B    = $6100
scr_grid  = $6300           ; 240 metatile indices
mt_tl     = $6400           ; metatile table of the current area, 5 x 64
mt_tr     = $6440
mt_bl     = $6480
mt_br     = $64C0
mt_attr   = $6500
scr_attr  = $6540           ; 64 attribute bytes

CTRL_VAL  = %10001000       ; NMI on, sprites $1000, BG $0000, +1 increment
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
ST_MENU = 5
ST_TITLE = 6
ST_CARD = 7
ST_LOAD = 8
ST_CLASSSEL = 9
ST_END = 10

FACE_DOWN = 0
FACE_UP = 1
FACE_LEFT = 2
FACE_RIGHT = 3

MT_SOLID = $04
MT_COUNTER = $08

SAVE_VERSION = 1
GS_SIZE = 47

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
dst:         .res 2
vlen:        .res 1
vpeak:       .res 1
cnt:         .res 1
ri:          .res 1
nthi:        .res 1
; scroll: next (main) and live (NMI)
n_scroll_x:  .res 1
n_scroll_y:  .res 1
n_scroll_nt: .res 1
n_mirror:    .res 1         ; 0 vertical (side by side), 1 horizontal (stacked)
scroll_x:    .res 1
scroll_y:    .res 1
scroll_nt:   .res 1
state:       .res 1
cur_nt:      .res 1         ; physical nametable page on screen (0/1)
cur_song:    .res 1
; map
screen:      .res 1
area:        .res 1
px:          .res 1
py:          .res 1
facing:      .res 1
moving:      .res 1
walk_ctr:    .res 1
touch_lock:  .res 1
talks:       .res 1
ent_n:       .res 1
; screen transition
t_dir:       .res 1         ; 0 right, 1 left, 2 down, 3 up
t_target:    .res 1
t_step:      .res 1
t_off:       .res 1
t_k:         .res 1
; windows, dialogue
win_row:     .res 1
win_h:       .res 1
win_step:    .res 1
win_open:    .res 1         ; dialogue window drawn on the map
menu_open:   .res 1
d_sub:       .res 1
d_row:       .res 1
d_page:      .res 1         ; pages left after the current one
d_i:         .res 1
d_blink:     .res 1
d_len1:      .res 1
d_len2:      .res 1
d_spk:       .res 1
d_owner:     .res 1         ; 0 script VM, 1 menu
t_ptr:       .res 2
numv:        .res 4
num_i:       .res 1
ch_n:        .res 1         ; options of the open choice (0 = plain text)
ch_cur:      .res 1
ch_id:       .res 1
choice:      .res 1
ch_cols:     .res 4
; script VM
vm_pc:       .res 2
vm_on:       .res 1
vm_need_map: .res 1
; screen loader
ld_step:     .res 1
ld_kind:     .res 1         ; 0 map screen, 1 full nametable
ld_nt:       .res 1
ld_then:     .res 1
ld_r1:       .res 1
pal_level:   .res 1
ld_wait:     .res 1
; battle
b_id:        .res 1
b_sub:       .res 1
b_after:     .res 1
ehp:         .res 1
cursor:      .res 1
turn:        .res 1
defending:   .res 1
charge:      .res 1
stunned:     .res 1
helper:      .res 1
stolen:      .res 1
rnd:         .res 1
b_pat_i:     .res 1
b_pose:      .res 1
b_pose_t:    .res 1
b_fx_a:      .res 1
b_fx_b:      .res 1
b_fx_t:      .res 1
b_result:    .res 1
b_dmg:       .res 1
; menu, title, class choice
m_sub:       .res 1
m_cur:       .res 1
m_i:         .res 1
sel_cur:     .res 1
saves:       .res 1
load_ok:     .res 1
; OAM building
oam_i:       .res 1
sattr:       .res 1
sx:          .res 1
sy:          .res 1
sflip:       .res 1
oam_e:       .res 1
ev_x:        .res 1

.segment "BSS"
vbuf:        .res 160
lbuf:        .res 56        ; decoded page: line 1 (28) + line 2 (28)
pal_cur:     .res 32        ; palette being shown (fades read it)
ents:        .res 72        ; current screen entities, 9 bytes each (x y set face if unless talk touch anim)
ent_face:    .res 8
; game state (the save slot payload, GS_SIZE bytes, order frozen)
gs:
gs_class:    .res 1
gs_level:    .res 1
gs_hp:       .res 1
gs_energy:   .res 1
gs_xp:       .res 1
gs_col:      .res 1
gs_chapter:  .res 1
gs_screen:   .res 1
gs_px:       .res 1
gs_py:       .res 1
gs_face:     .res 1
gs_items:    .res 4
gs_flags:    .res 32

.include "core.s"
.include "map.s"
.include "dialog.s"
.include "vm.s"
.include "menu.s"
.include "battle.s"
.include "probe.s"

; ---- main loop ------------------------------------------------------------------------------------
.segment "CODE"
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
    jsr famistudio_update
    jsr read_pad
    jsr state_dispatch
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

state_dispatch:
    lda state
    asl
    tax
    lda state_table+1,x
    pha
    lda state_table,x
    pha
    rts
state_table:
    .word nothing-1, map_update-1, scroll_update-1, dialog_update-1, battle_update-1, menu_update-1
    .word title_update-1, card_update-1, load_update-1, classsel_update-1, end_update-1
nothing:
    rts

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
    lda #BANK_TEXT
    sta $8001               ; R6 $8000 = text + scripts
    lda #7
    sta $8000
    lda #BANK_SOUND
    sta $8001               ; R7 $A000 = sound, never swapped
    lda #0
    sta $8000
    lda #CHR_UI
    sta $8001               ; R0 BG $0000 = UI bank (font, window frame)
    lda #1
    sta $8000
    lda #CHR_TITLE
    sta $8001
    lda #2
    sta $8000
    lda #CHR_BLUM
    sta $8001
    lda #3
    sta $8000
    lda #CHR_NPC_CH00
    sta $8001
    lda #4
    sta $8000
    lda #CHR_MAP
    sta $8001
    lda #5
    sta $8000
    lda #CHR_NPC_CH01
    sta $8001
    lda #0
    sta $A000               ; vertical mirroring
    lda #$80
    sta $A001               ; PRG-RAM on, writable (save slots, working copy, probe)
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
    ; the whole palette black, then both nametables cleared (rendering is off)
    lda #$3F
    sta PPUADDR
    lda #0
    sta PPUADDR
    ldx #32
    lda #$0F
:   sta PPUDATA
    sta pal_cur-1,x
    dex
    bne :-
    lda #$20
    sta PPUADDR
    lda #0
    sta PPUADDR
    ldy #8
    tax
:   sta PPUDATA
    inx
    bne :-
    dey
    bne :-
:   bit PPUSTATUS
    bpl :-
    lda #'B'
    sta PROBE
    lda #'L'
    sta PROBE+1
    lda #'M'
    sta PROBE+2
    lda #'Z'
    sta PROBE+3
    lda #2
    sta PROBE+4
    lda #4
    sta pal_level           ; black
    lda #$FF
    sta cur_song
    ldx #<music_data_blum_music
    ldy #>music_data_blum_music
    lda #1                  ; NTSC
    jsr famistudio_init
    ldx #<sounds
    ldy #>sounds
    jsr famistudio_sfx_init
    jsr title_start
    jsr write_probe
    lda #$FF
    sta vbuf
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
    lda n_mirror
    sta $A000
    jsr vbuf_flush
    lda #0
    sta OAMADDR
    lda #>OAM
    sta OAMDMA
    lda n_scroll_x
    sta scroll_x
    lda n_scroll_y
    sta scroll_y
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
    lda scroll_y
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

; FamiStudio sound engine 4.5.0 (BleuBleu, MIT notice kept in the file), code in the fixed bank
FAMISTUDIO_CFG_EXTERNAL     = 1
FAMISTUDIO_CFG_NTSC_SUPPORT = 1
FAMISTUDIO_CFG_SFX_SUPPORT  = 1
FAMISTUDIO_CFG_SFX_STREAMS  = 1
FAMISTUDIO_CFG_DPCM_SUPPORT = 0
.define FAMISTUDIO_CA65_ZP_SEGMENT   ZEROPAGE
.define FAMISTUDIO_CA65_RAM_SEGMENT  BSS
.define FAMISTUDIO_CA65_CODE_SEGMENT FSCODE
    .include "famistudio_ca65.s"

.segment "SOUND"
    .include "music.s"
    .include "sfx.s"

.include "fixed.s"
.include "world.s"
.include "text.s"
.include "screens.s"

.segment "VECTORS"
    .word nmi, reset, irq

.segment "CHARS"
    .incbin "chr.bin"
