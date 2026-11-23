; SEBRING racer (BLUMR-M1, docs/RACER-PLAN.md). ca65, MMC3, our code. Built by src/core/racer/build-racer.ts.
; Pure assembly: the per-scanline road kernel and the CPU budget leave no room for a C runtime.
; One race frame (same as the spike, racer/spike/src/spike.s):
;   NMI      live <- next (finished frames only), OAM DMA, HUD row, grass colour, HUD scroll, IRQ #1 armed
;   IRQ #1   line 15: backdrop X/Y (parallax, hill shift), arms IRQ #2
;   IRQ #2   line hy-3: the road kernel, cycle-timed, one iteration per scanline down to line 239
;   main     music, game logic for the next frame, then idle (counted: free CPU per frame)
; Text screens (title, stage card, ending, credits, game over): NMI does OAM DMA + scroll 0, no IRQ.
; Bank rules: R7 ($A000) = SOUND, set once. R6 ($8000) = a road bank while racing (the kernel writes it,
; the main thread only reads the hill tables there, present in both road banks). Stage and screen banks
; are mapped only by the loaders, with rendering, NMI and IRQs off. The main thread never writes PPU
; registers while rendering is on.

.include "racer.inc"

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

CTRL_VAL  = %10001000       ; NMI on, sprites $1000, BG $0000, nametable 0
MASK_VAL  = %00011110

ROAD_BANK0   = 0            ; PRG banks 0-1: curve tables (32 levels each) + all hill tables
STAGE_BANK0  = 2
SCREENS_BANK = 7
SOUND_BANK   = 29

BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10
BTN_LEFT = $02
BTN_RIGHT = $01

; probe states (docs/RACER-PLAN.md 6.2) + 9 game over
ST_BOOT = 0
ST_TITLE = 1
ST_INTRO = 2
ST_DRIVE = 3
ST_CRASH = 4
ST_CP = 5
ST_TIMEOVER = 6
ST_ENDING = 7
ST_CREDITS = 8
ST_GAMEOVER = 9

NMI_OFF = 0
NMI_STATIC = 1
NMI_RACE = 2

MAX_SPEED   = 220
GRASS_SPEED = 80
CAR_Y       = 188
NSLOTS      = 8
SPAWN_Z     = 210
MAX_RANDOM  = 5
COLL_ZMIN   = 9
COLL_ZMAX   = 13
FLIP_SPEED  = 180           ; hitting a vehicle at this speed or more flips the car
OFFROAD_SPIN_SPEED = 170    ; leaving the road this fast spins it
SPIN_FRAMES = 72
FLIP_FRAMES = 110
CP_FRAMES   = 90
FINISH_FRAMES = 100
KIND_CONE = 2
KIND_BUS = 3
KIND_POTHOLE = 5

.ifndef KERNEL_PAD0
KERNEL_PAD0 = 99
.endif
.ifndef LATCH1
LATCH1 = 16
.endif
.ifndef LATCH2_SUB
LATCH2_SUB = 19
.endif
.ifndef START_STAGE
START_STAGE = 0
.endif
.ifndef TIME_OVERRIDE
TIME_OVERRIDE = 0           ; test builds: every stage starts with this many seconds (0 = track value)
.endif
.ifndef TEST_CHEATS
TEST_CHEATS = 0             ; test builds: $7F40 bit 0 freezes the timer, bit 1 finishes the stage
.endif

.macro delay_short n
  .if (n) & 1
    bit $00
    .repeat ((n) - 3) / 2
      nop
    .endrepeat
  .else
    .repeat (n) / 2
      nop
    .endrepeat
  .endif
.endmacro

.macro delay n
  .if (n) >= 20
    ldx #(((n) - 3) / 5)
:   dex
    bne :-
    delay_short ((n) - ((((n) - 3) / 5) * 5 + 1))
  .else
    delay_short n
  .endif
.endmacro

.segment "HEADER"
    .incbin "header.bin"

.segment "ZEROPAGE"
nmi_count:   .res 1
irq_vec:     .res 2
frame_ready: .res 1
skip_lag:    .res 1
nmi_mode:    .res 1
idle:        .res 2
idle_min:    .res 2
meas_skip:   .res 1
frame:       .res 2
pad:         .res 1
pad_prev:    .res 1
pad_new:     .res 1
state:       .res 1
entered:     .res 1
timer:       .res 2
speed:       .res 1
dist_lo:     .res 1
dist_hi:     .res 2
seg_ptr:     .res 2
seg_index:   .res 1
seg_left:    .res 2
curve:       .res 1
curve_tgt:   .res 1
hill:        .res 1
hill_tgt:    .res 1
traffic:     .res 1
scenery:     .res 1
car_xs:      .res 1
car_x:       .res 1
lean:        .res 1
offroad:     .res 1
phase_lo:    .res 1
phase:       .res 1
bd_xs:       .res 1
bd_x:        .res 1
bd_nt:       .res 1
hy:          .res 1
prod:        .res 2
tmp:         .res 4
ptr:         .res 2
stage:       .res 1
continues:   .res 1
crashes:     .res 1
time_s:      .res 1
time_f:      .res 1
cp_ptr:      .res 2
cp_index:    .res 1
cp_pos:      .res 2
cp_add:      .res 1
obj_ptr:     .res 2
obj_pos:     .res 2
spawn_timer: .res 1
rng:         .res 2
radio:       .res 1
paused:      .res 1
msg_timer:   .res 1
hud_dirty:   .res 1
grass:       .res 1
grass_base:  .res 1
pal_dirty:   .res 1
crash_kind:  .res 1
crash_timer: .res 1
finish_timer: .res 1
penalty:     .res 1
centre_car:  .res 1
collide_ok:  .res 1
stage_clears: .res 1
titles:      .res 1
cont_used:   .res 1
snow:        .res 1         ; snow storm mode (secret: 3 honks then Select on the title)
honks:       .res 1
slide:       .res 1         ; snow: sideways speed (signed, 1/4 px per frame)
scr_pal:     .res 2         ; load_screen: palette address, CHR units for R0 / R1
scr_r0:      .res 1
scr_r1:      .res 1
; projection scratch
pj_n:        .res 1
inv_ptr:     .res 2
pj_row:      .res 1
pj_lo:       .res 1
pj_hi:       .res 1
m_a:         .res 1
m_b:         .res 1
m_lo:        .res 1
; OAM build scratch
oam_x:       .res 2
oam_y:       .res 1
oam_t:       .res 1
oam_a:       .res 1
oam_cols:    .res 1
oam_rows:    .res 1
oam_off:     .res 1
; next frame's kernel values (main writes) and live ones (NMI copies, IRQs read): same layout
next:
n_curve_ptr: .res 2
n_hill_ptr:  .res 2
n_bank:      .res 1
n_lines:     .res 1
n_latch2:    .res 1
n_bd_row:    .res 1
n_bd_x:      .res 1
n_bd_hi:     .res 1
n_bd_lo:     .res 1
n_phase:     .res 1
NEXT_SIZE = * - next
live:
curve_ptr:   .res 2
hill_ptr:    .res 2
k_bank:      .res 1
k_lines:     .res 1
k_latch2:    .res 1
k_bd_row:    .res 1
k_bd_x:      .res 1
k_bd_hi:     .res 1
k_bd_lo:     .res 1
k_phase:     .res 1
; kernel scratch
kidx:        .res 1
cnt:         .res 1
nx:          .res 1
nlo:         .res 1
nbank:       .res 1
frac:        .res 1

.segment "BSS"
hud_buf:     .res 32
o_kind:      .res NSLOTS
o_lane:      .res NSLOTS
o_zl:        .res NSLOTS
o_zh:        .res NSLOTS
o_spd:       .res NSLOTS
o_x:         .res NSLOTS
o_xh:        .res NSLOTS
o_y:         .res NSLOTS
o_size:      .res NSLOTS
o_vis:       .res NSLOTS

.segment "ROAD0"
    .incbin "road0.bin"
.segment "ROAD1"
    .incbin "road1.bin"
.segment "STAGE0"
    .incbin "stage0.bin"
.segment "STAGE1"
    .incbin "stage1.bin"
.segment "STAGE2"
    .incbin "stage2.bin"
.segment "STAGE3"
    .incbin "stage3.bin"
.segment "STAGE4"
    .incbin "stage4.bin"
.segment "SCREENS"
screens_bin:
    .incbin "screens.bin"
STAGE_NT  = $8000           ; inside a stage bank (racer-assets.ts)
STAGE_PAL = $8800
STAGE_CARD = $8C00
STAGE_CARD_PAL = $8820
SCREEN_PALS = $1000         ; offset of the 4 screen palettes in the screens bank
SNOW_FLAKES = 8

.segment "ROWTABS"
z_tab:    .incbin "rowtabs.bin", 0, 256
hi_tab:   .incbin "rowtabs.bin", 256, 256
lo_tab:   .incbin "rowtabs.bin", 512, 256
mask_tab: .incbin "rowtabs.bin", 768, 256

; ---------------------------------------------------------------------------------------------------
.segment "KERNEL"
; IRQ #2, on line hy-3. Every iteration of kloop is one scanline: 113 or 114 cycles (frac adds 2/3 of a
; cycle per line on average: 341 dots / 3 = 113.67 cycles). Copied from the spike, timing unchanged.
irq_kernel:
    pha                     ; 3
    txa                     ; 2
    pha                     ; 3
    tya                     ; 2
    pha                     ; 3
    sta $E000               ; 4  acknowledge + disable
    lda #6                  ; 2
    sta $8000               ; 4
    lda k_bank              ; 3
    sta $8001               ; 4  R6 = road bank (curve + hill tables at $8000)
    lda #0                  ; 2
    sta $8000               ; 4  select R0: the loop writes $8001 = stripe bank
    lda k_lines             ; 3
    sta cnt                 ; 3
    lda #0                  ; 2
    sta kidx                ; 3
    tay                     ; 2
    lda (hill_ptr),y        ; 5
    tay                     ; 2
    lda hi_tab,y            ; 4
    sta PPUADDR             ; 4  W1 (t only)
    sty PPUSCROLL           ; 4  W2 (t only)
    lda (curve_ptr),y       ; 5
    sta nx                  ; 3
    lsr                     ; 2
    lsr                     ; 2
    lsr                     ; 2
    ora lo_tab,y            ; 4
    sta nlo                 ; 3
    lda z_tab,y             ; 4
    clc                     ; 2
    adc k_phase             ; 3
    and mask_tab,y          ; 4
    sta nbank               ; 3
    delay KERNEL_PAD0
    ldx nx                  ; 3
    ldy nlo                 ; 3
    lda nbank               ; 3
kloop:                      ; X = X scroll, Y = $2006 low, A = R0 bank, for the next line
    stx PPUSCROLL           ; 4  W3 (fine X now, coarse X in t)
    sty PPUADDR             ; 4  W4 (v = t: next line starts here)
    sta $8001               ; 4  R0 = stripe bank
    inc kidx                ; 5
    ldy kidx                ; 3
    lda (hill_ptr),y        ; 5  nametable row for this line (hills)
    tay                     ; 2
    lda hi_tab,y            ; 4
    sta PPUADDR             ; 4  W1
    sty PPUSCROLL           ; 4  W2 (Y = row)
    lda (curve_ptr),y       ; 5  X scroll for this row (curves)
    sta nx                  ; 3
    lsr                     ; 2
    lsr                     ; 2
    lsr                     ; 2
    ora lo_tab,y            ; 4
    sta nlo                 ; 3
    lda z_tab,y             ; 4  depth of this row
    clc                     ; 2
    adc k_phase             ; 3  + distance travelled
    and mask_tab,y          ; 4  -> 0 (A) or 2 (B), far rows frozen
    sta nbank               ; 3
    lda frac                ; 3
    clc                     ; 2
    adc #$AB                ; 2
    sta frac                ; 3
    bcs :+                  ; 2 / 3 (taken on 2 lines of 3)
:   delay 8
    ldx nx                  ; 3
    ldy nlo                 ; 3
    lda nbank               ; 3
    dec cnt                 ; 5
    bne kloop               ; 3   = 113 / 114
kloop_end:
    .assert >kloop = >kloop_end, error, "kernel loop crosses a page"
    pla
    tay
    pla
    tax
    pla
    rti

; IRQ #1, line 15 (last HUD line, a plain sky line): backdrop scroll for lines 16+, arm IRQ #2.
irq_hud:
    pha
    sta $E000
    lda k_bd_hi
    sta PPUADDR
    lda k_bd_row
    sta PPUSCROLL
    lda k_bd_x
    sta PPUSCROLL
    lda k_bd_lo
    sta PPUADDR
    lda k_latch2
    sta $C000
    sta $C001
    sta $E001
    lda #<irq_kernel
    sta irq_vec
    lda #>irq_kernel
    sta irq_vec+1
    pla
    rti

irq_none:
    sta $E000
    rti

; ---------------------------------------------------------------------------------------------------
.segment "CODE"

main:
    lda #0
    sta idle
    sta idle+1
@loop:
    lda nmi_count           ; idle until the next NMI, 14 cycles per iteration
@wait:
    inc idle
    bne :+
    inc idle+1
:   cmp nmi_count
    beq @wait
    lda idle                ; free cycles of the frame that just ended = idle * 14
    sta PROBE+$16
    lda idle+1
    sta PROBE+$17
    jsr track_min_idle
    lda #0
    sta idle
    sta idle+1
    jsr frame_logic
    lda #1
    sta frame_ready
    jmp @loop

; minimum idle over race frames only (loads and text screens are not game frames)
track_min_idle:
    lda meas_skip
    beq :+
    dec meas_skip
    rts
:   lda nmi_mode
    cmp #NMI_RACE
    bne @no
    lda idle+1
    cmp idle_min+1
    bcc @set
    bne @no
    lda idle
    cmp idle_min
    bcs @no
@set:
    lda idle
    sta idle_min
    sta PROBE+$18
    lda idle+1
    sta idle_min+1
    sta PROBE+$19
@no:
    rts

frame_logic:
    inc frame
    bne :+
    inc frame+1
:   jsr famistudio_update   ; music data in R7 ($A000), never swapped
    jsr read_pad
    lda state
    asl
    tax
    lda state_table+1,x
    pha
    lda state_table,x
    pha
    rts                     ; -> handler, which returns to write_probe's caller below
state_done:
    jmp write_probe

state_table:
    .word st_boot-1, st_title-1, st_intro-1, st_race-1, st_race-1, st_race-1, st_race-1
    .word st_ending-1, st_credits-1, st_gameover-1

read_pad:
    lda pad
    sta pad_prev
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
    rts

goto_state:                 ; A = state; the handler runs its entry code next frame
    sta state
    lda #0
    sta entered
    rts

; ---------------------------------------------------------------------------------------------------
; text screens

st_boot:
    lda #ST_TITLE
    jsr goto_state
    jmp state_done

st_title:
    lda entered
    bne @run
    inc entered
    inc titles
    lda #SCR_TITLE
    jsr show_screen
    lda #SONG_TITLE
    jsr famistudio_music_play
    jmp state_done
@run:
    jsr title_extras
    lda pad_new
    and #BTN_START
    beq @out
    lda #3
    sta continues
    lda #0
    sta crashes
    sta stage_clears
    sta cont_used
    sta penalty
    lda #START_STAGE
    sta stage
    lda #ST_INTRO
    jsr goto_state
@out:
    jmp state_done

st_intro:
    lda entered
    bne @run
    inc entered
    jsr screen_off
    lda #<STAGE_CARD_PAL
    sta scr_pal
    lda #>STAGE_CARD_PAL
    sta scr_pal+1
    lda #CHR_ROAD_A
    sta scr_r0
    lda stage
    asl
    clc
    adc #CHR_BACKDROP0
    sta scr_r1
    lda stage
    clc
    adc #STAGE_BANK0
    ldx #>STAGE_CARD
    jsr load_screen
    jsr oam_clear
    lda #NMI_STATIC
    jsr screen_on
    jsr famistudio_music_stop
    lda #SFX_CARD
    jsr sfx
    lda #150
    sta timer
    jmp state_done
@run:
    dec timer
    beq @go
    lda timer
    cmp #130
    bcs @out
    lda pad_new
    and #BTN_START
    beq @out
@go:
    lda #ST_DRIVE
    jsr goto_state
@out:
    jmp state_done

st_ending:
    lda entered
    bne @run
    inc entered
    lda #SCR_ENDING
    jsr show_screen
    lda #SONG_ENDING
    jsr famistudio_music_play
    lda #<600
    sta timer
    lda #>600
    sta timer+1
    jmp state_done
@run:
    jsr fireworks
    jsr dec_timer16
    beq @go
    lda timer+1
    bne @out
    lda timer
    cmp #<(600-90)
    bcs @out                ; Start counts after 1.5 s
    lda pad_new
    and #BTN_START
    beq @out
@go:
    lda #ST_CREDITS
    jsr goto_state
@out:
    jmp state_done

st_credits:
    lda entered
    bne @run
    inc entered
    lda #SCR_CREDITS
    jsr show_screen
    lda #<1200
    sta timer
    lda #>1200
    sta timer+1
    jmp state_done
@run:
    jsr dec_timer16
    beq @go
    lda timer+1
    cmp #>(1200-60)
    bcs @out
    lda pad_new
    and #BTN_START
    beq @out
@go:
    lda #ST_TITLE
    jsr goto_state
@out:
    jmp state_done

st_gameover:
    lda entered
    bne @run
    inc entered
    lda #SCR_GAMEOVER
    jsr show_screen
    lda #SONG_GAMEOVER
    jsr famistudio_music_play
    lda #240
    sta timer
    jmp state_done
@run:
    dec timer
    beq @go
    lda timer
    cmp #200
    bcs @out
    lda pad_new
    and #BTN_START
    beq @out
@go:
    lda #ST_TITLE
    jsr goto_state
@out:
    jmp state_done

dec_timer16:                ; timer -= 1, Z set when it reaches 0
    lda timer
    bne :+
    dec timer+1
:   dec timer
    lda timer
    ora timer+1
    rts

; A = screen index in the SCREENS bank (1 KiB each). Title shows the car.
show_screen:
    pha
    jsr screen_off
    pla
    tay
    lda screen_r0,y
    sta scr_r0
    lda screen_r1,y
    sta scr_r1
    tya
    asl
    asl
    asl
    asl
    asl                     ; 32 bytes per palette
    clc
    adc #<(screens_bin+SCREEN_PALS)
    sta scr_pal
    lda #>(screens_bin+SCREEN_PALS)
    adc #0
    sta scr_pal+1
    tya
    asl
    asl
    clc
    adc #>screens_bin
    tax
    lda #SCREENS_BANK
    jsr load_screen
    jsr oam_clear
    lda state
    cmp #ST_TITLE
    bne :+
    lda #0
    sta lean
    sta crash_kind
    lda #128
    sta car_x
    jsr oam_player
:   lda #NMI_STATIC
    jmp screen_on

sfx:                        ; A = sound effect
    ldx #FAMISTUDIO_SFX_CH0
    jmp famistudio_sfx_play

; ---------------------------------------------------------------------------------------------------
; the race: states 3 (drive), 4 (crash), 5 (checkpoint banner), 6 (time over)

st_race:
    lda entered
    bne @run
    inc entered
    jsr race_start
    jmp state_done
@run:
    lda state
    cmp #ST_TIMEOVER
    bne :+
    jmp timeover
:   cmp #ST_CRASH
    beq @noinput
    lda finish_timer
    bne @noinput
    ; pause (Start) and radio (Select)
    lda pad_new
    and #BTN_START
    beq @nopause
    lda paused
    eor #1
    sta paused
    jsr famistudio_music_pause
    lda #SFX_PAUSE
    jsr sfx
    lda paused
    beq @unpause
    lda #MSG_PAUSE
    ldx #255
    jsr show_msg
    jmp state_done
@unpause:
    lda #1
    sta msg_timer
@nopause:
    lda paused
    beq :+
    jmp state_done          ; paused: the picture and the HUD stay as they are
:   lda pad_new
    and #BTN_SELECT
    beq @noinput
    jsr radio_next
@noinput:
    jsr update_speed
    jsr update_track
    jsr update_car
    jsr update_scroll
    jsr update_traffic
    jsr spawn
    jsr tick
    lda state
    cmp #ST_CP
    bne :+
    dec timer
    bne :+
    lda #ST_DRIVE
    sta state
:   lda state
    cmp #ST_CRASH
    bne :+
    jsr crash_step
:   jsr build_oam
    jsr hud_update
    lda finish_timer
    beq @out
    dec finish_timer
    bne @out
    ; stage over: next card or the ending
    inc stage_clears
    inc stage
    lda stage
    cmp #STAGE_COUNT
    bcc :+
    lda #ST_ENDING
    jsr goto_state
    jmp state_done
:   lda #ST_INTRO
    jsr goto_state
@out:
    jmp state_done

radio_next:
    ldx radio
    inx
    cpx #3
    bcc :+
    ldx #0
:   stx radio
radio_play:
    ldx radio
    lda radio_song,x
    jsr famistudio_music_play
    lda radio
    clc
    adc #MSG_RADIO0
    ldx #90
    jmp show_msg

; time over: the car rolls to a stop; Start uses a continue (same stage from the start)
timeover:
    jsr update_speed
    jsr update_track
    jsr update_car
    jsr update_scroll
    jsr update_traffic
    jsr build_oam
    lda continues
    beq @final
    jsr dec_timer16
    bne :+
    lda #ST_GAMEOVER
    jsr goto_state
    jmp state_done
:   lda timer
    and #63
    bne @input
    lda timer
    and #64
    beq @prompt
    lda #MSG_TIMEOVER
    ldx #255
    jsr show_msg
    jmp @input
@prompt:
    lda #MSG_CONTINUE
    ldx #255
    jsr show_msg
    lda continues
    clc
    adc #HUD_DIGIT0
    sta hud_buf+MSG_CONT_COL
@input:                     ; Start counts once timer < 600-30 (16-bit: the guard is the first 0.5 s only)
    lda timer+1
    cmp #>(600-30)
    bcc @ok
    bne @out
    lda timer
    cmp #<(600-30)
    bcs @out
@ok:
    lda pad_new
    and #BTN_START
    beq @out
    dec continues
    inc cont_used
    lda #ST_DRIVE
    jsr goto_state
@out:
    jmp state_done
@final:
    jsr dec_timer16
    bne @out
    lda #ST_GAMEOVER
    jsr goto_state
    jmp state_done

enter_timeover:
    lda #ST_TIMEOVER
    sta state
    lda #0
    sta paused
    lda #<600
    sta timer
    lda #>600
    sta timer+1
    jsr famistudio_music_stop
    lda #SFX_TIMEOVER
    jsr sfx
    lda continues
    bne :+
    lda #180
    sta timer
    lda #0
    sta timer+1
    lda #MSG_GAMEOVER
    ldx #255
    jmp show_msg
:   lda #MSG_TIMEOVER
    ldx #255
    jmp show_msg

; stage start (also after a continue): load the stage, reset the car, the clock and the traffic
race_start:
    jsr screen_off
    lda stage
    clc
    adc #STAGE_BANK0
    jsr set_r6
    lda #$20
    sta PPUADDR
    lda #$00
    sta PPUADDR
    lda #<STAGE_NT
    sta ptr
    lda #>STAGE_NT
    sta ptr+1
    ldx #8
    jsr copy_pages
    lda #<STAGE_PAL
    sta ptr
    lda #>STAGE_PAL
    sta ptr+1
    jsr load_palette
    lda STAGE_PAL+1
    sta grass_base
    sta grass
    lda snow
    beq :+
    lda #SNOW_GRASS         ; snow storm: white roadside (PPU still off: write the colour now)
    sta grass_base
    sta grass
    ldx #$3F
    stx PPUADDR
    ldx #$01
    stx PPUADDR
    sta PPUDATA
:   lda #0
    sta $8000
    lda #CHR_ROAD_A
    sta $8001               ; R0 = road A (the kernel alternates A / B under the horizon)
    lda #1
    sta $8000
    lda stage
    asl
    clc
    adc #CHR_BACKDROP0
    sta $8001               ; R1 = the stage's backdrop + HUD font
    lda #ROAD_BANK0
    jsr set_r6
    lda #0
    sta $8000
    ; race variables
    ldx #0
    stx speed
    stx dist_lo
    stx dist_hi
    stx dist_hi+1
    stx car_xs
    stx curve
    stx hill
    stx lean
    stx offroad
    stx phase_lo
    stx phase
    stx paused
    stx msg_timer
    stx crash_kind
    stx crash_timer
    stx finish_timer
    stx cp_index
    stx seg_index
    stx pal_dirty
    stx scenery
    stx frac
    stx slide
:   lda #0
    sta o_kind,x
    sta o_vis,x
    inx
    cpx #NSLOTS
    bne :-
    lda #128
    sta car_x
    lda #60
    sta spawn_timer
    sta time_f
    lda stage
    asl
    asl
    asl
    eor #$A5
    sta rng
    lda #$1D
    sta rng+1
.if TIME_OVERRIDE
    lda #TIME_OVERRIDE
.else
    ldx stage
    lda stage_time,x
.endif
    sta time_s
    ldx stage
    lda stage_segs_lo,x
    sta seg_ptr
    lda stage_segs_hi,x
    sta seg_ptr+1
    lda stage_cps_lo,x
    sta cp_ptr
    lda stage_cps_hi,x
    sta cp_ptr+1
    lda stage_objs_lo,x
    sta obj_ptr
    lda stage_objs_hi,x
    sta obj_ptr+1
    jsr load_segment
    lda curve_tgt           ; a stage starts at its first segment's geometry
    sta curve
    lda hill_tgt
    sta hill
    jsr load_cp
    jsr load_obj
    lda #1
    sta hud_dirty
    jsr hud_update
    jsr update_scroll
    ldx #NEXT_SIZE-1
:   lda next,x
    sta live,x
    dex
    bpl :-
    lda k_bank
    jsr set_r6
    lda #0
    sta $8000
    jsr update_traffic      ; sets inv_ptr for the first spawns
    jsr oam_clear
    jsr build_oam
    lda #ST_DRIVE
    sta state
    lda #3
    sta meas_skip
    jsr radio_play
    lda #SFX_START
    jsr sfx
    lda #NMI_RACE
    jmp screen_on

; ---------------------------------------------------------------------------------------------------
; driving

update_speed:
    lda state
    cmp #ST_DRIVE
    beq @drive
    cmp #ST_CP
    beq @drive
    ; crash or time over: brake hard
    lda speed
    sec
    sbc #3
    bcs :+
    lda #0
:   sta speed
    rts
@drive:
    lda pad
    and #BTN_B
    beq @nobrake
    lda speed
    sec
    sbc #4
    bcs :+
    lda #0
:   sta speed
    jmp @cap
@nobrake:
    lda pad
    and #BTN_A
    beq @coast
    lda frame
    and #1
    bne @cap
    lda speed
    cmp #MAX_SPEED
    bcs @cap
    inc speed
    lda speed
    cmp #60
    beq @rev
    cmp #120
    beq @rev
    cmp #180
    bne @cap
@rev:
    lda #SFX_REV
    jsr sfx
    jmp @cap
@coast:
    lda frame
    and #3
    bne @cap
    lda speed
    beq @cap
    dec speed
@cap:
    lda offroad
    beq @done
    lda speed
    cmp #GRASS_SPEED
    bcc @done
    sbc #2
    sta speed
@done:
    rts

update_track:
    lda dist_lo
    clc
    adc speed
    sta dist_lo
    bcc @smooth
    inc dist_hi
    bne :+
    inc dist_hi+1
:   lda seg_left
    bne :+
    dec seg_left+1
:   dec seg_left
    lda seg_left
    ora seg_left+1
    bne @cp
    jsr next_segment
@cp:
    jsr check_cp
@smooth:
    lda frame               ; curve: one level every 2 frames toward the target
    and #1
    bne @hill
    lda curve
    cmp curve_tgt
    beq @hill
    bmi @cup                ; signed compare is safe: both in -32..31
    dec curve
    jmp @hill
@cup:
    inc curve
@hill:
    lda frame               ; hill: one level every 4 frames
    and #3
    bne @done
    lda hill
    cmp hill_tgt
    beq @done
    bmi @hup
    dec hill
    rts
@hup:
    inc hill
@done:
    rts

; segments: length (2), curve, hill, traffic, scenery (6 bytes); length 0 = end of the track
next_segment:
    ldy #0
    lda (seg_ptr),y
    iny
    ora (seg_ptr),y
    beq @last
    lda seg_ptr
    clc
    adc #6
    sta seg_ptr
    bcc :+
    inc seg_ptr+1
:   inc seg_index
    jmp load_segment
@last:
    lda #$FF                ; past the last segment: keep its geometry (the finish line ends the stage)
    sta seg_left
    sta seg_left+1
    rts

load_segment:
    ldy #0
    lda (seg_ptr),y
    sta seg_left
    iny
    lda (seg_ptr),y
    sta seg_left+1
    ora seg_left
    bne :+
    lda #$FF
    sta seg_left
    sta seg_left+1
    rts
:   iny
    lda (seg_ptr),y
    sta curve_tgt
    iny
    lda (seg_ptr),y
    sta hill_tgt
    iny
    lda (seg_ptr),y
    sta traffic
    iny
    lda (seg_ptr),y
    cmp scenery
    beq @same
    sta scenery
    tax
    lda scenery_grass,x
    ldx snow
    bne :+
    cmp #0
    bne :++
:   lda grass_base
:   sta grass
    lda #1
    sta pal_dirty
@same:
    rts

; checkpoints: pos (2), addTime; addTime 0 = the finish line
load_cp:
    ldy #0
    lda (cp_ptr),y
    sta cp_pos
    iny
    lda (cp_ptr),y
    sta cp_pos+1
    iny
    lda (cp_ptr),y
    sta cp_add
    rts

check_cp:
    lda finish_timer
    bne @no
.if TEST_CHEATS
    lda PROBE+$40
    and #2
    beq :+
    lda #0
    sta PROBE+$40
    lda cp_pos              ; cheat: jump to the next checkpoint / the finish
    sta dist_hi
    lda cp_pos+1
    sta dist_hi+1
:
.endif
    lda dist_hi+1
    cmp cp_pos+1
    bcc @no
    bne @reached
    lda dist_hi
    cmp cp_pos
    bcc @no
@reached:
    lda cp_add
    beq @finish
    clc
    adc time_s
    cmp #100
    bcc :+
    lda #99
:   sta time_s
    inc cp_index
    lda cp_ptr
    clc
    adc #3
    sta cp_ptr
    bcc :+
    inc cp_ptr+1
:   jsr load_cp
    lda state
    cmp #ST_CRASH
    beq :+
    lda #ST_CP
    sta state
    lda #CP_FRAMES
    sta timer
:   lda #MSG_CP
    ldx #CP_FRAMES
    jsr show_msg
    lda #SFX_CP
    jmp sfx
@finish:
    lda #FINISH_FRAMES
    sta finish_timer
    lda #$FF
    sta cp_pos
    sta cp_pos+1
    inc cp_index
    lda #SONG_CLEAR
    jsr famistudio_music_play
    lda #MSG_FINISH
    ldx #255
    jmp show_msg
@no:
    rts

update_car:
    ; prod = curve * (speed >> 4), signed 16-bit
    lda #0
    sta prod
    sta prod+1
    lda speed
    lsr
    lsr
    lsr
    lsr
    tax
    beq @steer
@mul:
    lda curve
    clc
    adc prod
    sta prod
    lda curve
    and #$80
    beq :+
    lda #$FF
:   adc prod+1
    sta prod+1
    dex
    bne @mul
@steer:
    ; car_x16 -= prod (the curve pushes the car outward)
    lda car_xs
    sec
    sbc prod
    sta car_xs
    lda car_x
    sbc prod+1
    sta car_x
    lda state
    cmp #ST_CRASH
    bne :+
    jmp @clamp              ; no steering while spinning
:   lda #0
    sta lean
    lda speed
    bne :+
    jmp @clamp
:
    lsr
    lsr
    lsr
    lsr
    lsr
    lsr
    lsr
    clc
    adc #1
    sta tmp                 ; 1 or 2 px per frame
    lda snow
    bne @slide
    lda pad
    and #BTN_LEFT
    beq :+
    lda car_x
    sec
    sbc tmp
    sta car_x
    lda #$FF
    sta lean
:   lda pad
    and #BTN_RIGHT
    beq @skid
    lda car_x
    clc
    adc tmp
    sta car_x
    lda #1
    sta lean
    jmp @skid
@slide:                     ; snow: slide += 1 toward the pad every frame (max 2 px / frame), eases back
    lda pad
    and #BTN_LEFT
    beq :+
    lda #$FF
    sta lean
    lda slide
    cmp #$F8                ; -8
    beq @move
    dec slide
    jmp @move
:   lda pad
    and #BTN_RIGHT
    beq :+
    lda #1
    sta lean
    lda slide
    cmp #8
    beq @move
    inc slide
    jmp @move
:   lda frame               ; no steering: back toward 0 every 4 frames
    and #3
    bne @move
    lda slide
    beq @move
    bmi :+
    dec slide
    jmp @move
:   inc slide
@move:
    lda slide               ; car_x += slide / 4 (signed)
    cmp #$80
    ror
    cmp #$80
    ror
    clc
    adc car_x
    sta car_x
@skid:                      ; tyres squeal in hard curves at speed
    lda frame
    and #31
    bne @clamp
    lda speed
    cmp #160
    bcc @clamp
    lda curve
    bpl :+
    eor #$FF
    clc
    adc #1
:   cmp #20
    bcc @clamp
    lda #SFX_SKID
    jsr sfx
@clamp:
    lda car_x
    cmp #24
    bcs :+
    lda #24
:   cmp #233
    bcc :+
    lda #232
:   sta car_x
    ldx #0
    cmp #36
    bcc @off
    cmp #221
    bcc :+
@off:
    ldx #1
:   lda offroad
    stx offroad
    bne @done               ; already off the road
    cpx #0
    beq @done
    lda state               ; just left the road: spin if fast
    cmp #ST_DRIVE
    beq :+
    cmp #ST_CP
    bne @done
:   lda finish_timer
    bne @done
    lda speed
    cmp #OFFROAD_SPIN_SPEED
    bcc @done
    lda #0
    jmp crash
@done:
    rts

; the clock: one second every 60 frames; the finish banner and the cheat freeze it
tick:
    lda finish_timer
    bne @out
    lda state
    cmp #ST_TIMEOVER
    beq @out
.if TEST_CHEATS
    lda PROBE+$40
    and #1
    bne @out
.endif
    dec time_f
    bne @out
    lda #60
    sta time_f
    lda time_s
    beq :+
    dec time_s
    rts
:   jmp enter_timeover
@out:
    rts

; A = kind that was hit (0 = off-road). Spin, or flip when a vehicle is hit fast.
crash:
    pha
    inc crashes
    lda time_s
    sec
    sbc #CRASH_PENALTY
    bcs :+
    lda #0
:   sta time_s
    lda penalty
    clc
    adc #CRASH_PENALTY
    sta penalty
    pla
    beq @spin
    cmp #KIND_CONE
    beq @spin
    lda speed
    cmp #FLIP_SPEED
    bcc @spin
    lda #2
    sta crash_kind
    lda #FLIP_FRAMES
    bne @set
@spin:
    lda #1
    sta crash_kind
    lda #SPIN_FRAMES
@set:
    sta crash_timer
    lda #ST_CRASH
    sta state
    lda #SFX_CRASH
    jmp sfx

crash_step:
    dec crash_timer
    bne @out
    ; recovery: back on the road at the car's line, standing start
    lda centre_car
    sta car_x
    lda #0
    sta crash_kind
    sta lean
    sta speed
    sta car_xs
    sta offroad
    lda #ST_DRIVE
    sta state
@out:
    rts

; ---------------------------------------------------------------------------------------------------
; next frame's road (spike update_scroll) + the road centre at the car's line

update_scroll:
    lda phase_lo            ; stripes: phase += speed / 256 depth units per frame
    clc
    adc speed
    sta phase_lo
    bcc :+
    inc phase
:   lda phase
    sta n_phase
    ; parallax: backdrop x (9 bits) += prod / 256
    lda bd_xs
    clc
    adc prod
    sta bd_xs
    lda bd_x
    adc prod+1
    sta bd_x
    lda prod+1
    and #$80
    beq :+
    lda #$FF
:   adc bd_nt
    and #1
    sta bd_nt
    ; curve table: level + 32 = 0..63 -> bank (n >> 5), page n & 31, pointer at page + 16
    lda curve
    clc
    adc #32
    tax
    and #31
    ora #$80
    sta n_curve_ptr+1
    lda #16
    sta n_curve_ptr
    txa
    lsr
    lsr
    lsr
    lsr
    lsr
    clc
    adc #ROAD_BANK0
    sta n_bank
    ; hill table: level + 10 -> page (present in both road banks)
    lda hill
    sec
    sbc #HILL_MIN
    ora #$80
    sta n_hill_ptr+1
    lda #0
    sta n_hill_ptr
    ; horizon hy = 120 - max(hill, 0)
    lda hill
    bpl :+
    lda #0
:   sta tmp
    lda #120
    sec
    sbc tmp
    sta hy
    lda #240
    sec
    sbc hy
    sta n_lines
    lda hy
    sec
    sbc #LATCH2_SUB
    sta n_latch2
    lda #136                ; backdrop row on line 16 = 136 - hy (16..36, plain sky above 36)
    sec
    sbc hy
    sta n_bd_row
    asl
    asl
    and #$E0
    sta tmp
    lda bd_x
    sta n_bd_x
    lsr
    lsr
    lsr
    ora tmp
    sta n_bd_lo
    lda bd_nt
    asl
    asl
    sta n_bd_hi
    ; road centre at the car's line (row CAR_J)
    ldy #CAR_J
    jsr curve_offset
    clc
    adc #128
    sta centre_car
    rts

; A = curve * offtab[Y] / 32 (signed px, road centre shift at road row Y). Uses m_a, m_b, m_lo.
curve_offset:
    lda offtab,y
    sta m_b
    lda curve
    bpl :+
    eor #$FF
    clc
    adc #1
:   sta m_a                 ; |curve| <= 32: 6 bits
    lda #0
    sta m_lo
    ldy #6
@bit:
    lsr m_a
    bcc :+
    clc
    adc m_b
:   ror
    ror m_lo
    dey
    bne @bit
    asl m_lo                ; A:m_lo = product * 4 -> product / 32 = A * 2 + bit 7 of m_lo
    rol
    ldy curve
    bpl :+
    eor #$FF
    clc
    adc #1
:   rts

; ---------------------------------------------------------------------------------------------------
; traffic: 8 slots. z = depth in road units (8.8), 1 unit = 1 distance unit = 1 stripe depth unit.

update_traffic:
    lda hill                ; inverse hill table of this frame (row -> first kernel line)
    sec
    sbc #HILL_MIN
    tay
    lda inv_lo,y
    sta inv_ptr
    lda inv_hi,y
    sta inv_ptr+1
    lda #0
    sta collide_ok
    lda finish_timer
    bne :+
    lda state
    cmp #ST_DRIVE
    beq @ok
    cmp #ST_CP
    bne :+
@ok:
    inc collide_ok
:   ldx #NSLOTS-1
@slot:
    lda o_kind,x
    bne :+
    jmp @next
:   lda speed               ; z -= speed - object speed (in 1/256 units)
    sec
    sbc o_spd,x
    bcc @faster
    sta tmp
    lda o_zl,x
    sec
    sbc tmp
    sta o_zl,x
    lda o_zh,x
    sbc #0
    sta o_zh,x
    bcs @moved
    jmp @remove             ; passed behind the car
@faster:
    eor #$FF
    adc #1                  ; carry clear here: A = object speed - speed
    clc
    adc o_zl,x
    sta o_zl,x
    lda o_zh,x
    adc #0
    sta o_zh,x
    bcs @remove
    cmp #250
    bcs @remove
@moved:
    lda collide_ok
    beq @proj
    lda o_zh,x
    cmp #COLL_ZMIN
    bcc @proj
    cmp #COLL_ZMAX+1
    bcs @proj
    ; lateral test at the car's line: object centre = centre_car + lane * LANE_CAR
    lda centre_car
    ldy o_lane,x
    beq @dx
    bmi :+
    clc
    adc #LANE_CAR
    jmp @dx
:   sec
    sbc #LANE_CAR
@dx:
    sec
    sbc car_x
    bcs :+
    eor #$FF
    adc #1
:   ldy o_kind,x
    cmp kind_hit,y
    bcs @proj
    lda o_kind,x            ; hit
    pha
    lda #0
    sta o_kind,x
    sta o_vis,x
    pla
    cmp #KIND_POTHOLE
    bne :+
    lda speed               ; a pothole only shakes the car and costs speed
    sec
    sbc #50
    bcs @slow
    lda #0
@slow:
    sta speed
    lda #SFX_BUMP
    stx tmp+3
    jsr sfx
    ldx tmp+3
    jmp @next
:   stx tmp+3
    jsr crash
    ldx tmp+3
    lda #0                  ; one crash per frame
    sta collide_ok
    jmp @next
@proj:
    jsr project
    jmp @next
@remove:
    lda #0
    sta o_kind,x
    sta o_vis,x
@next:
    dex
    bmi :+
    jmp @slot
:   rts

; slot X: screen line (o_y = bottom), centre x (o_x/o_xh, 16-bit), size, visibility. Needs inv_ptr
; (set by update_traffic) and R6 = the live road bank (the NMI maps it with the live copy, before the kernel
; does): x comes from the live curve table.
project:
    ldy o_zh,x
    lda ntab,y              ; n = lines below the horizon on flat ground (1000 / z)
    cmp #4
    bcc @hide
    cmp #120
    bcs @hide
    sta pj_n
    tay
    dey                     ; road row - 120
    lda (inv_ptr),y         ; first kernel line showing that row (255: behind a crest)
    cmp #255
    beq @hide
    clc
    adc hy
    sta o_y,x
    ; x centre = road centre at that row (live curve table: 256 - X scroll) + lane offset, 16-bit
    tya
    clc
    adc #120
    tay
    lda (curve_ptr),y
    eor #$FF
    clc
    adc #1
    sta o_x,x
    lda #0
    sta tmp
    ldy pj_n
    lda o_lane,x
    beq @xdone
    bmi @left
    lda lanetab-1,y
    clc
    adc o_x,x
    sta o_x,x
    bcc @xdone
    inc tmp
    bcs @xdone
@left:
    lda o_x,x
    sec
    sbc lanetab-1,y
    sta o_x,x
    bcs @xdone
    dec tmp
@xdone:
    lda tmp
    sta o_xh,x
    ldy #0
    lda pj_n
    cmp #16
    bcc :+
    iny
    cmp #48
    bcc :+
    iny
:   tya
    sta o_size,x
    lda #1
    sta o_vis,x
    rts
@hide:
    lda #0
    sta o_vis,x
    rts

; placed objects from the track, then random traffic from the segment's density
spawn:
    lda finish_timer
    beq @placed
    rts
@placed:
    lda obj_pos+1
    cmp #$FF
    bne :+
    lda obj_pos
    cmp #$FF
    beq @random
:   lda obj_pos             ; d = pos - distance
    sec
    sbc dist_hi
    sta tmp
    lda obj_pos+1
    sbc dist_hi+1
    bcc @skip               ; already behind (after a continue the list restarts anyway)
    bne @random             ; >= 256 units away
    lda tmp
    cmp #SPAWN_Z
    bcs @random
    jsr free_slot
    bmi @skip
    ldy #2
    lda (obj_ptr),y
    sta o_kind,x
    tay
    lda kind_speed,y
    sta o_spd,x
    ldy #3
    lda (obj_ptr),y
    sta o_lane,x
    lda tmp                 ; z = d * 256 - dist_lo
    sta o_zh,x
    lda #0
    sec
    sbc dist_lo
    sta o_zl,x
    bcs :+
    dec o_zh,x
:   jsr project
@skip:
    jsr next_obj
    jmp @placed
@random:
    lda traffic
    beq @out0
    ldx #NSLOTS-1           ; at most MAX_RANDOM objects on the road before a new random car
    ldy #0
:   lda o_kind,x
    beq :+
    iny
:   dex
    bpl :--
    cpy #MAX_RANDOM
    bcs @out0
    dec spawn_timer
    beq :+
@out0:
    rts
:   jsr rand
    and #31
    ldx traffic
    clc
    adc spawn_gap,x
    sta spawn_timer
    jsr rand
    and #3
    cmp #3
    bne :+
    lda #1
:   sec
    sbc #1
    sta tmp                 ; lane -1..1
    ; lanes taken near the spawn point: never the same lane, never a wall of three
    lda #0
    sta tmp+1
    ldx #NSLOTS-1
@scan:
    lda o_kind,x
    beq :+
    lda o_zh,x
    cmp #SPAWN_Z-60
    bcc :+
    ldy o_lane,x
    iny
    lda lane_bit,y
    ora tmp+1
    sta tmp+1
:   dex
    bpl @scan
    ldy tmp
    iny
    lda lane_bit,y
    sta tmp+2
    and tmp+1
    bne @retry
    lda tmp+1
    ora tmp+2
    cmp #7
    beq @retry
    jsr free_slot
    bmi @out
    lda tmp
    sta o_lane,x
    lda #1
    sta o_kind,x
    jsr rand
    and #63
    clc
    adc #60
    sta o_spd,x
    lda traffic
    cmp #2
    bcc :+
    jsr rand
    and #7
    bne :+
    lda #KIND_BUS
    sta o_kind,x
    lda #55
    sta o_spd,x
:   lda #SPAWN_Z
    sta o_zh,x
    lda #0
    sta o_zl,x
    jmp project
@retry:
    lda #20
    sta spawn_timer
@out:
    rts

next_obj:
    lda obj_ptr
    clc
    adc #4
    sta obj_ptr
    bcc load_obj
    inc obj_ptr+1
load_obj:
    ldy #0
    lda (obj_ptr),y
    sta obj_pos
    iny
    lda (obj_ptr),y
    sta obj_pos+1
    rts

free_slot:                  ; X = a free slot, N set when none
    ldx #NSLOTS-1
:   lda o_kind,x
    beq :+
    dex
    bpl :-
:   txa
    rts

rand:                       ; 16-bit Galois LFSR, 8 steps; A = new low byte
    ldy #8
    lda rng
:   asl
    rol rng+1
    bcc :+
    eor #$39
:   dey
    bne :--
    sta rng
    rts

; ---------------------------------------------------------------------------------------------------
; sprites: player (driver + 12 car tiles) first, then traffic in an order that rotates every frame so
; an overflowing line flickers instead of always hiding the same object

oam_clear:
    ldx #0
    lda #$F0
:   sta OAM,x
    inx
    bne :-
    rts

build_oam:
    jsr oam_player
    jsr oam_snow
    lda frame
    and #NSLOTS-1
    sta tmp+2
    lda #NSLOTS
    sta tmp+3
@obj:
    ldy tmp+2
    lda o_vis,y
    beq @skip
    lda o_kind,y
    beq @skip
    jsr oam_object
@skip:
    lda tmp+2
    clc
    adc #1
    and #NSLOTS-1
    sta tmp+2
    dec tmp+3
    bne @obj
    ldx oam_off             ; hide the rest (0 = OAM full)
    beq @done
    lda #$F0
:   sta OAM,x
    inx
    inx
    inx
    inx
    bne :-
@done:
    rts

; oam_off <- OAM offset after the player. Lean: 5 poses (hard / soft left, straight, soft / hard right; right
; = left mirrored). Spin: 8 poses of 4 frames. Flip: arc up, the roll pose at both ends, upside down mid-air.
; Sprite offsets come from car_dx/car_dy (12 per variant: 0 normal, 12 mirrored, 24 upside down).
oam_player:
    lda #CAR_Y-1
    sta oam_y
    lda #0
    sta pj_hi               ; offset table variant
    lda crash_kind
    beq @lean
    cmp #2
    beq @flip
    lda crash_timer         ; spin: 8 poses of 4 frames
    lsr
    lsr
    and #7
    tax
    lda spin_tile,x
    tay
    lda spin_attr,x
    jmp @pose
@flip:
    ldy #SPR_CAR0
    lda #0
    sta oam_a
    lda #FLIP_FRAMES
    sec
    sbc crash_timer         ; t = frames since the hit
    cmp #64
    bcs @tiles              ; landed
    tax
    lda oam_y
    sec
    sbc flip_arc,x
    sta oam_y
.if FLIP_ROLL <> 255
    cpx #8
    bcc @tiles
    cpx #56
    bcs @tiles
    ldy #FLIP_ROLL
.endif
    cpx #16
    bcc @tiles
    cpx #48
    bcs @tiles
    ldy #SPR_CAR0
    lda #$80                ; upside down
    sta oam_a
    lda #24
    sta pj_hi
    bne @tiles
@lean:
    ldx #2                  ; lean index: 2 straight, 1 / 3 soft, 0 / 4 hard (steering in a strong curve)
    lda lean
    beq @leanset
    bmi :+
    ldx #3
    bne @hard
:   ldx #1
@hard:
    lda curve
    bpl :+
    eor #$FF
    clc
    adc #1
:   cmp #16
    bcc @leanset
    lda lean
    bmi :+
    inx
    bne @leanset
:   dex
@leanset:
    lda lean_tile,x
    tay
    lda lean_attr,x
@pose:
    sta oam_a
    and #$40
    beq @tiles
    lda #12                 ; mirrored offsets
    sta pj_hi
@tiles:
    sty oam_t
    ldx #0
    ; driver head + shoulders (hidden upside down); the sprout sways every 16 frames when moving
    lda oam_a
    bmi @car
    ldy #0
    lda speed
    beq :+
    lda frame
    and #16
    beq :+
    ldy #2
:   lda oam_y
    sec
    sbc #12
    sta OAM,x
    clc
    adc #8
    sta OAM+4,x
    lda driver_tile,y
    sta OAM+1,x
    lda driver_tile+1,y
    sta OAM+5,x
    lda #1
    sta OAM+2,x
    sta OAM+6,x
    lda car_x
    sec
    sbc #9
    clc
    adc lean
    sta OAM+3,x
    sta OAM+7,x
    ldx #8
@car:
    ldy pj_hi
    lda #12
    sta tmp
@spr:
    lda car_dy,y
    clc
    adc oam_y
    sta OAM,x
    lda oam_t
    sta OAM+1,x
    inc oam_t
    lda oam_a
    sta OAM+2,x
    lda car_dx,y
    clc
    adc car_x
    sta OAM+3,x
    inx
    inx
    inx
    inx
    iny
    dec tmp
    bne @spr
    stx oam_off
    rts

; snow storm mode: 8 flakes falling across the sky (lines 24-95, above any traffic), from oam_off
oam_snow:
    lda snow
    beq @out
    ldy #0
@flake:
    ldx oam_off
    beq @out                ; OAM full
    tya                     ; 8 lines apart (one flake per line), falling 1 line per frame
    asl
    asl
    asl
    clc
    adc frame
    and #63
    clc
    adc #24
    sta OAM,x
    lda #SPR_FLAKE
    sta OAM+1,x
    lda #3
    sta OAM+2,x
    lda frame               ; drift left 1 px every 2 frames
    lsr
    eor #$FF
    clc
    adc snow_x0,y
    sta OAM+3,x
    txa
    clc
    adc #4
    sta oam_off
    iny
    cpy #SNOW_FLAKES
    bne @flake
@out:
    rts

; slot Y -> sprites from oam_off. Box = size cols x rows tiles, bottom at o_y, centred on o_x.
oam_object:
    lda oam_off
    bne :+
    rts                     ; OAM full
:   ldx o_size,y
    lda size_cols,x
    sta oam_cols
    lda size_rows,x
    sta oam_rows
    asl
    asl
    asl
    sta tmp
    lda o_y,y               ; OAM Y = top line - 1
    sec
    sbc tmp
    sta oam_y
    dec oam_y
    lda oam_cols            ; left x (16-bit) = centre - cols * 4
    asl
    asl
    sta tmp
    lda o_x,y
    sec
    sbc tmp
    sta oam_x
    lda o_xh,y
    sbc #0
    sta oam_x+1
    lda o_kind,y
    tax
    lda kind_attr,x
    sta oam_a
    txa
    asl
    adc o_kind,y            ; kind * 3 (carry clear: kind < 6)
    adc o_size,y
    tax
    lda kind_tile,x
    sta oam_t
    ldx oam_off
@rows:
    lda oam_x
    sta tmp
    lda oam_x+1
    sta tmp+1
    lda oam_cols
    sta pj_lo
@cols:
    lda tmp+1
    bne @next               ; off screen left or right: no sprite
    lda oam_y
    sta OAM,x
    lda oam_t
    sta OAM+1,x
    lda oam_a
    sta OAM+2,x
    lda tmp
    sta OAM+3,x
    inx
    inx
    inx
    inx
    beq @full
@next:
    inc oam_t
    lda tmp
    clc
    adc #8
    sta tmp
    bcc :+
    inc tmp+1
:   dec pj_lo
    bne @cols
    lda oam_y
    clc
    adc #8
    sta oam_y
    dec oam_rows
    bne @rows
@full:
    stx oam_off
    rts

; ---------------------------------------------------------------------------------------------------
; HUD row (NT0 row 1, copied by the NMI every race frame)

; A = message, X = frames (255 = until replaced)
show_msg:
    stx msg_timer
    tax
    lda msg_lo,x
    sta ptr
    lda msg_hi,x
    sta ptr+1
    ldy #31
:   lda (ptr),y
    sta hud_buf,y
    dey
    bpl :-
    rts

hud_update:
    lda msg_timer
    beq @normal
    cmp #255
    beq @out0
    dec msg_timer
    beq :+
@out0:
    rts
:   inc hud_dirty
@normal:
    lda hud_dirty
    beq @fields
    lda #0
    sta hud_dirty
    ldy #31
:   lda hud_template,y
    sta hud_buf,y
    dey
    bpl :-
    lda stage
    clc
    adc #HUD_DIGIT0+1
    sta hud_buf+HUD_STAGE_COL
@fields:
    ; time: 2 digits
    lda time_s
    ldy #0
:   cmp #10
    bcc :+
    sbc #10
    iny
    bne :-
:   clc
    adc #HUD_DIGIT0
    sta hud_buf+HUD_TIME_COL+1
    tya
    adc #HUD_DIGIT0
    sta hud_buf+HUD_TIME_COL
    ; speed: 3 digits
    lda speed
    ldy #0
:   cmp #100
    bcc :+
    sbc #100
    iny
    bne :-
:   sty tmp
    ldy #0
:   cmp #10
    bcc :+
    sbc #10
    iny
    bne :-
:   clc
    adc #HUD_DIGIT0
    sta hud_buf+HUD_SPEED_COL+2
    tya
    adc #HUD_DIGIT0
    sta hud_buf+HUD_SPEED_COL+1
    lda tmp
    adc #HUD_DIGIT0
    sta hud_buf+HUD_SPEED_COL
    ; distance to the next checkpoint / the finish: 4 digits, every other frame
    lda frame
    and #1
    bne @out
    jsr cp_distance
    ldx #0
@digit:
    ldy #0
@sub:
    lda tmp
    sec
    sbc pow10_lo,x
    sta tmp+2
    lda tmp+1
    sbc pow10_hi,x
    bcc :+
    sta tmp+1
    lda tmp+2
    sta tmp
    iny
    bne @sub
:   tya
    clc
    adc #HUD_DIGIT0
    sta hud_buf+HUD_DIST_COL,x
    inx
    cpx #3
    bne @digit
    lda tmp
    clc
    adc #HUD_DIGIT0
    sta hud_buf+HUD_DIST_COL+3
@out:
    rts

; tmp/tmp+1 <- units to the next checkpoint or the finish (0 after the finish), max 9999
cp_distance:
    lda finish_timer
    bne @zero
    lda cp_pos
    sec
    sbc dist_hi
    sta tmp
    lda cp_pos+1
    sbc dist_hi+1
    sta tmp+1
    bcc @zero
    cmp #>10000
    bcc @ok
    bne @cap
    lda tmp
    cmp #<10000
    bcc @ok
@cap:
    lda #<9999
    sta tmp
    lda #>9999
    sta tmp+1
@ok:
    rts
@zero:
    lda #0
    sta tmp
    sta tmp+1
    rts

; title: B honks (and shows the honk mark over the car); 3 honks then Select toggles the snow storm
; (a chime and the flakes say so). Any other button resets the count.
title_extras:
    lda pad_new
    and #BTN_B
    beq @nohonk
    inc honks
    lda #SFX_HONK
    jsr sfx
    lda #20
    sta msg_timer           ; honk mark frames
@nohonk:
    lda pad_new
    and #BTN_SELECT
    beq @nosel
    lda honks
    cmp #3
    bcc @reset
    lda snow
    eor #1
    sta snow
    lda #SFX_CP
    jsr sfx
@reset:
    lda #0
    sta honks
@nosel:
    lda pad_new
    and #BTN_A|BTN_LEFT|BTN_RIGHT
    beq :+
    lda #0
    sta honks
:   ; the car (fixed) + the honk mark + the flakes
    jsr oam_player
.if HAS_FX
    lda msg_timer
    beq :+
    dec msg_timer
    ldx oam_off
    lda #CAR_Y-26
    sta OAM,x
    lda #SPR_HONK
    sta OAM+1,x
    lda #3
    sta OAM+2,x
    lda car_x
    clc
    adc #12
    sta OAM+3,x
    txa
    clc
    adc #4
    sta oam_off
:
.endif
    jsr oam_snow
    ldx oam_off
    beq @done
    lda #$F0
:   sta OAM,x
    inx
    inx
    inx
    inx
    bne :-
@done:
    rts

; ending: 8 bursts, each 48 frames of every 128 (small, small, large, large), palettes 0 / 3 alternating
fireworks:
.if HAS_FX
    ldx #0                  ; OAM offset
    ldy #0                  ; burst
@burst:
    tya
    lsr
    lda #0
    bcc :+
    lda #3
:   sta oam_a
    lda frame
    clc
    adc fw_phase,y
    and #127
    cmp #48
    bcc :+
    jmp @hide
:   cmp #24
    bcc :+
    jmp @large
:
    lsr
    lsr
    lsr
    lsr                     ; 0 for t < 16, 1 after
    sty tmp
    tay
    lda fw_small,y
    ldy tmp
    sta OAM+1,x
    lda fw_y,y
    clc
    adc #4
    sta OAM,x
    lda oam_a
    sta OAM+2,x
    lda fw_x,y
    clc
    adc #4
    sta OAM+3,x
    lda #$F0
    sta OAM+4,x
    sta OAM+8,x
    sta OAM+12,x
    jmp @next
@large:
    sty tmp
    ldy #0
    cmp #36
    bcc :+
    iny
:   lda fw_large,y
    ldy tmp
    sta OAM+1,x
    clc
    adc #1
    sta OAM+5,x
    adc #1
    sta OAM+9,x
    adc #1
    sta OAM+13,x
    lda fw_y,y
    sta OAM,x
    sta OAM+4,x
    clc
    adc #8
    sta OAM+8,x
    sta OAM+12,x
    lda fw_x,y
    sta OAM+3,x
    sta OAM+11,x
    clc
    adc #8
    sta OAM+7,x
    sta OAM+15,x
    lda oam_a
    sta OAM+2,x
    sta OAM+6,x
    sta OAM+10,x
    sta OAM+14,x
    jmp @next
@hide:
    lda #$F0
    sta OAM,x
    sta OAM+4,x
    sta OAM+8,x
    sta OAM+12,x
@next:
    txa
    clc
    adc #16
    tax
    iny
    cpy #8
    beq :+
    jmp @burst
:
.endif
    rts

; ---------------------------------------------------------------------------------------------------
; probe $7F00 (docs/RACER-PLAN.md 6.2, M1 layout). Bots read only what is written here, at the end of
; the frame logic, and the pad is read at its start: jsnes and Mesen bots see the same values.
write_probe:
    lda state
    sta PROBE+$05
    lda seg_index
    sta PROBE+$06
    lda curve
    sta PROBE+$07
    lda frame
    sta PROBE+$08
    lda frame+1
    sta PROBE+$09
    lda speed
    sta PROBE+$0A
    lda car_x
    sta PROBE+$0B
    lda hill
    sta PROBE+$0C
    lda hy
    sta PROBE+$0D
    lda phase
    sta PROBE+$0E
    lda offroad
    sta PROBE+$0F
    lda dist_hi
    sta PROBE+$10
    lda dist_hi+1
    sta PROBE+$11
    lda bd_x
    sta PROBE+$12
    lda bd_nt
    sta PROBE+$13
    lda time_s
    sta PROBE+$1A
    lda continues
    sta PROBE+$1B
    lda crashes
    sta PROBE+$1C
    lda stage
    sta PROBE+$1D
    lda cp_index
    sta PROBE+$1E
    lda radio
    sta PROBE+$1F
    ldx #NSLOTS-1
@slot:
    lda o_kind,x
    sta PROBE+$38,x
    beq @empty
    lda o_lane,x
    sta PROBE+$20,x
    lda o_zh,x
    sta PROBE+$28,x
    dex
    bpl @slot
    bmi @rest
@empty:
    lda #$80
    sta PROBE+$20,x
    lda #0
    sta PROBE+$28,x
    dex
    bpl @slot
@rest:
    lda centre_car
    sta PROBE+$30
    lda paused
    sta PROBE+$31
    jsr cp_distance
    lda tmp
    sta PROBE+$32
    lda tmp+1
    sta PROBE+$33
    lda crash_kind
    sta PROBE+$34
    lda time_f
    sta PROBE+$35
    lda stage_clears
    sta PROBE+$36
    lda finish_timer
    sta PROBE+$37
    lda penalty
    sta PROBE+$41
    lda nmi_mode
    sta PROBE+$43
    lda titles
    sta PROBE+$44
    lda cont_used
    sta PROBE+$45
    lda snow
    sta PROBE+$46
    lda honks
    sta PROBE+$47
    rts

.include "tables.s"
.include "tracks.s"

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
    ; MMC3 first, before anything leaves $E000-$FFFF: PRG mode 0, CHR mode 0 (A12 not inverted)
    lda #6
    sta $8000
    lda #ROAD_BANK0
    sta $8001
    lda #7
    sta $8000
    lda #SOUND_BANK
    sta $8001               ; R7 $A000 = SOUND, never changed
    lda #0
    sta $8000
    lda #CHR_ROAD_A
    sta $8001               ; R0 BG $0000 = road A
    lda #1
    sta $8000
    lda #CHR_BACKDROP0
    sta $8001               ; R1 BG $0800 = backdrop + HUD font
    ldx #2
    ldy #CHR_SPRITES
:   stx $8000
    sty $8001               ; R2-R5 sprites $1000-$1FFF
    iny
    inx
    cpx #6
    bne :-
    lda #0
    sta $8000               ; leave R0 selected (the kernel writes $8001 only)
    sta $A000               ; vertical mirroring
    lda #$80
    sta $A001               ; PRG-RAM on (probe)
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
    lda #$F0
:   sta OAM,x
    inx
    bne :-
    lda #0
:   sta PROBE,x
    inx
    bne :-
:   bit PPUSTATUS
    bpl :-
    lda #'S'
    sta PROBE
    lda #'B'
    sta PROBE+1
    lda #'R'
    sta PROBE+2
    lda #'G'
    sta PROBE+3
    lda #2
    sta PROBE+4
    lda #$FF
    sta idle_min
    sta idle_min+1
    lda #<irq_none
    sta irq_vec
    lda #>irq_none
    sta irq_vec+1
    ldx #<music_data_blum_music
    ldy #>music_data_blum_music
    lda #1                  ; NTSC
    jsr famistudio_init
    ldx #<sounds
    ldy #>sounds
    jsr famistudio_sfx_init
    cli
    lda #ST_BOOT
    sta state
    lda #1
    sta frame_ready
    lda #NMI_OFF
    sta nmi_mode
    lda #CTRL_VAL           ; NMI on, rendering off until the first screen is loaded
    sta PPUCTRL
    jmp main

; wait for the NMI (vblank), then blank the screen: the main thread owns the PPU until screen_on
screen_off:
    lda #1
    sta skip_lag            ; the frame cut short by the load is not a lag frame
    lda nmi_count
:   cmp nmi_count
    beq :-
    lda #NMI_OFF
    sta nmi_mode
    lda #0
    sta PPUMASK
    lda #CTRL_VAL & $7F
    sta PPUCTRL             ; NMI off while loading
    sta $E000               ; IRQ off
    rts

; A = NMI mode; rendering and NMI back on at the next vblank (that frame does not count as lag)
screen_on:
    sta nmi_mode
    lda #1
    sta skip_lag
    bit PPUSTATUS
:   bit PPUSTATUS
    bpl :-
    lda #0
    sta PPUSCROLL
    sta PPUSCROLL
    lda #CTRL_VAL
    sta PPUCTRL
    lda #MASK_VAL
    sta PPUMASK
    rts

set_r6:                     ; A = PRG bank at $8000 (loaders only: IRQs off)
    ldx #6
    stx $8000
    sta $8001
    rts

copy_pages:                 ; X pages from (ptr) to PPUDATA
    ldy #0
:   lda (ptr),y
    sta PPUDATA
    iny
    bne :-
    inc ptr+1
    dex
    bne :-
    rts

load_palette:               ; 32 bytes at (ptr)
    lda #$3F
    sta PPUADDR
    lda #$00
    sta PPUADDR
    ldy #0
:   lda (ptr),y
    sta PPUDATA
    iny
    cpy #32
    bne :-
    rts

; A = bank, X = high byte of a 1 KiB screen in it -> NT0; palette at scr_pal (same bank);
; CHR units scr_r0 / scr_r1 for R0 / R1
load_screen:
    stx ptr+1
    jsr set_r6
    lda #0
    sta ptr
    lda #$20
    sta PPUADDR
    lda #$00
    sta PPUADDR
    ldx #4
    jsr copy_pages
    lda scr_pal
    sta ptr
    lda scr_pal+1
    sta ptr+1
    jsr load_palette
    lda #0
    sta $8000
    lda scr_r0
    sta $8001
    lda #1
    sta $8000
    lda scr_r1
    sta $8001
    lda #ROAD_BANK0
    jsr set_r6
    lda #0
    sta $8000
    rts

nmi:
    pha
    txa
    pha
    tya
    pha
    lda nmi_mode
    bne :+
    jmp @out
:   lda frame_ready
    bne @ready
    lda skip_lag
    bne @ready
    inc PROBE_LAG
    jmp @scroll
@ready:
    lda #0
    sta skip_lag
    sta OAMADDR
    lda #>OAM
    sta OAMDMA
    lda nmi_mode
    cmp #NMI_RACE
    beq :+
    jmp @frame_done
:   ldx #NEXT_SIZE-1
:   lda next,x
    sta live,x
    dex
    bpl :-
    lda #6                  ; R6 = the live road bank now: the main thread projects traffic from the live
    sta $8000               ; curve table before IRQ #2 maps it (no IRQ inside the NMI; main never selects
    lda k_bank              ; a register while racing)
    sta $8001
    lda #0
    sta $8000               ; leave R0 selected for the kernel
    lda #$20                ; HUD row (NT0 row 1)
    sta PPUADDR
    lda #$20
    sta PPUADDR
    .repeat 32, i
    lda hud_buf+i
    sta PPUDATA
    .endrepeat
    lda pal_dirty
    beq @frame_done
    lda #0
    sta pal_dirty
    lda #$3F
    sta PPUADDR
    lda #$01
    sta PPUADDR
    lda grass
    sta PPUDATA
@frame_done:
    lda #0
    sta frame_ready
@scroll:
    bit PPUSTATUS
    lda #0
    sta PPUSCROLL
    sta PPUSCROLL
    lda #CTRL_VAL
    sta PPUCTRL
    lda nmi_mode
    cmp #NMI_RACE
    bne @out
    sta $E000
    lda #LATCH1
    sta $C000
    sta $C001
    sta $E001
    lda #<irq_hud
    sta irq_vec
    lda #>irq_hud
    sta irq_vec+1
@out:
    inc nmi_count
    pla
    tay
    pla
    tax
    pla
    rti

irq:
    jmp (irq_vec)

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

.segment "VECTORS"
    .word nmi, reset, irq

.segment "CHARS"
    .incbin "chr.bin"
