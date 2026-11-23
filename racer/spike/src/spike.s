; SEBRING engine spike (BLUMR-PLAN, docs/RACER-PLAN.md section 4). ca65, MMC3, our code.
; Pseudo-3D road: per screen line the kernel sets X and Y scroll (curves, hills) and swaps CHR R0
; (stripes A/B). One frame:
;   NMI      HUD scroll (lines 0-15), IRQ #1 armed, live <- next values (finished frames only)
;   IRQ #1   line 15: backdrop X/Y (parallax, hill shift) with the 4-write $2006/$2005/$2005/$2006
; IRQ #2   line hy-3: the kernel, cycle-timed, one iteration per scanline down to line 239
;   main     game logic in the rest of the frame, then idle (counted: free CPU per frame)
; Timing rules (kernel): the $2005 X write, the $2006 low write and the R0 write land in the
; horizontal blank of the line before the one they are for (dots 257-320); the $2006 high and $2005 Y
; writes only touch t and may land anywhere in the visible line.

.include "spike.inc"

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
MASK_VAL  = %00011110       ; BG + sprites, left column shown (honest view of the kernel)

ROAD_BANK0 = 1              ; PRG banks 1-2: curve tables (32 levels each) + all hill tables
CHR_BACKDROP = 4
CHR_SPRITES  = 8

BTN_A = $80
BTN_B = $40
BTN_SELECT = $20
BTN_START = $10
BTN_UP = $08
BTN_DOWN = $04
BTN_LEFT = $02
BTN_RIGHT = $01

MAX_SPEED  = 220
GRASS_SPEED = 80
CAR_Y      = 188

.ifndef KERNEL_PAD0
KERNEL_PAD0 = 99            ; cycles between the first line set-up and the loop (calibrated on Mesen)
.endif
.ifndef LATCH1
LATCH1 = 16                 ; IRQ #1 on line 15 (reload at the pre-render line, then 16 clocks)
.endif
.ifndef LATCH2_SUB
LATCH2_SUB = 19             ; IRQ #2 latch = hy - LATCH2_SUB (fires on line hy - 3)
.endif

; delay n cycles (n >= 2). Short form: nops (+ bit $00 for odd n, changes N V Z). Long form (n >= 20)
; also uses X: ldx #k / dex / bne = 5k + 1 cycles, then 2-6 cycles of short delay.
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
idle:        .res 2
frame:       .res 2
pad:         .res 1
pad_prev:    .res 1
speed:       .res 1
dist_lo:     .res 1
dist_hi:     .res 2
seg_ofs:     .res 1
seg_left:    .res 2
curve:       .res 1
curve_tgt:   .res 1
hill:        .res 1
hill_tgt:    .res 1
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
tmp:         .res 2
idle_min:    .res 2
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

.segment "ROAD0"
    .incbin "road0.bin"
.segment "ROAD1"
    .incbin "road1.bin"

.segment "ROWTABS"
z_tab:    .incbin "rowtabs.bin", 0, 256
hi_tab:   .incbin "rowtabs.bin", 256, 256
lo_tab:   .incbin "rowtabs.bin", 512, 256
mask_tab: .incbin "rowtabs.bin", 768, 256

; ---------------------------------------------------------------------------------------------------
.segment "KERNEL"
; IRQ #2, on line hy-3 (MMC3 counter clock near dot 260). Every iteration of kloop is one scanline:
; 113 or 114 cycles (frac adds 2/3 of a cycle per line on average: 341 dots / 3 = 113.67 cycles).
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

; IRQ #1, line 15 (last HUD line, a plain sky-blue line): backdrop scroll for lines 16+, arm IRQ #2.
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
    lda idle                ; free cycles of the frame that just ended = idle * 14
    sta PROBE+$16
    lda idle+1
    sta PROBE+$17
    lda frame+1             ; ignore the first 4 frames for the minimum
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
    jsr frame_logic
    lda #1
    sta frame_ready
    jmp @loop

frame_logic:
    inc frame
    bne :+
    inc frame+1
:   jsr read_pad
    jsr update_speed
    jsr update_track
    jsr update_car
    jsr update_scroll
    jsr build_oam
    jmp write_probe

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
    rts

update_speed:
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
    bne @smooth
    jsr next_segment
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

; segments: length (2 bytes, units of 256 distance), curve target, hill target; length 0 = loop
next_segment:
    lda seg_ofs
    clc
    adc #4
    tay
    lda track,y
    ora track+1,y
    bne :+
    ldy #0
:   sty seg_ofs
load_segment:
    lda track,y
    sta seg_left
    lda track+1,y
    sta seg_left+1
    lda track+2,y
    sta curve_tgt
    lda track+3,y
    sta hill_tgt
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
    lda #0
    sta lean
    lda speed
    beq @clamp
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
    beq @clamp
    lda car_x
    clc
    adc tmp
    sta car_x
    lda #1
    sta lean
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
:   stx offroad
    rts

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
    ; curve table: level + 32 = 0..63 -> bank 1 + (n >> 5), page n & 31, pointer at page + 16
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
    sta n_bd_hi             ; row < 64: coarse Y bits 3-4 are 0
    rts

; OAM: driver head, car (12 sprites), speed digits (3 sprites)
build_oam:
    ldx #0
    lda #CAR_Y-4
    sta OAM,x
    lda #SPR_DRIVER
    sta OAM+1,x
    lda #1
    sta OAM+2,x
    lda car_x
    sec
    sbc #9
    clc
    adc lean
    sta OAM+3,x
    ldx #4
    lda #SPR_CAR0
    ldy lean
    beq :+
    lda #SPR_CAR_R
    cpy #1
    beq :+
    lda #SPR_CAR_L
:   sta tmp                 ; first tile
    ldy #0                  ; tile row
@row:
    lda car_x
    sec
    sbc #16
    sta tmp+1               ; x
    lda #4
    sta prod                ; columns left
@col:
    tya
    asl
    asl
    asl
    clc
    adc #CAR_Y-1
    sta OAM,x
    lda tmp
    sta OAM+1,x
    inc tmp
    lda #0
    sta OAM+2,x
    lda tmp+1
    sta OAM+3,x
    clc
    adc #8
    sta tmp+1
    inx
    inx
    inx
    inx
    dec prod
    bne @col
    iny
    cpy #3
    bne @row
    ; speed digits at x 176, line 8
    lda speed
    ldy #0
:   cmp #100
    bcc :+
    sbc #100
    iny
    bne :-
:   sty tmp                 ; hundreds
    ldy #0
:   cmp #10
    bcc :+
    sbc #10
    iny
    bne :-
:   sty tmp+1               ; tens
    sta prod                ; units
    lda tmp
    ldy #176
    jsr put_digit
    lda tmp+1
    ldy #184
    jsr put_digit
    lda prod
    ldy #192
    jsr put_digit
    lda #$F0                ; hide the rest
:   sta OAM,x
    inx
    inx
    inx
    inx
    bne :-
    rts

put_digit:                  ; A = digit, Y = x, X = OAM offset
    clc
    adc #SPR_DIGITS
    sta OAM+1,x
    lda #7
    sta OAM,x
    lda #2
    sta OAM+2,x
    tya
    sta OAM+3,x
    inx
    inx
    inx
    inx
    rts

; probe $7F00 (spike layout, docs/RACER-PLAN.md section 6.2)
write_probe:
    lda #3
    sta PROBE+$05
    lda seg_ofs
    lsr
    lsr
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
    rts

.segment "RODATA"
track:
    .word 120
    .byte 0, 0              ; 0 straight (Galeries d'Anjou)
    .word 220
    .byte <-24, 0           ; 1 left curve
    .word 80
    .byte 0, 0              ; 2 straight
    .word 220
    .byte 24, 0             ; 3 right curve
    .word 60
    .byte 0, 0              ; 4 straight
    .word 180
    .byte 0, 15             ; 5 uphill
    .word 140
    .byte 0, <-10           ; 6 crest
    .word 80
    .byte 0, 0              ; 7 straight
    .word 110
    .byte <-32, 0           ; 8 hard left
    .word 110
    .byte 31, 0             ; 9 hard right
    .word 0
    .byte 0, 0

palette:
    .incbin "palette.bin"

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
    lda #29
    sta $8001
    lda #0
    sta $8000
    lda #0
    sta $8001               ; R0 BG $0000 = road A
    lda #1
    sta $8000
    lda #CHR_BACKDROP
    sta $8001               ; R1 BG $0800 = backdrop + HUD
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
    ; palette
    lda #$3F
    sta PPUADDR
    lda #0
    sta PPUADDR
    ldx #0
:   lda palette,x
    sta PPUDATA
    inx
    cpx #32
    bne :-
    ; nametables 0 and 1 ($2000-$27FF) from the generated file, through R6 = bank 0 is not needed:
    ; the 2 KiB live in the fixed bank (see below)
    lda #$20
    sta PPUADDR
    lda #0
    sta PPUADDR
    lda #<nametables
    sta tmp
    lda #>nametables
    sta tmp+1
    ldx #8
    ldy #0
:   lda (tmp),y
    sta PPUDATA
    iny
    bne :-
    inc tmp+1
    dex
    bne :-
    ; probe magic
    lda #'S'
    sta PROBE
    lda #'B'
    sta PROBE+1
    lda #'R'
    sta PROBE+2
    lda #'G'
    sta PROBE+3
    lda #1
    sta PROBE+4
    ; game state
    lda #128
    sta car_x
    ldy #0
    jsr load_segment
    jsr update_scroll       ; valid next values, copied as live by hand for the first frame
    ldx #NEXT_SIZE-1
:   lda next,x
    sta live,x
    dex
    bpl :-
    lda #1
    sta frame_ready         ; the first NMI finds a finished frame (no boot lag frame)
    lda #<irq_none
    sta irq_vec
    lda #>irq_none
    sta irq_vec+1
    cli
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
    ldx #NEXT_SIZE-1
:   lda next,x
    sta live,x
    dex
    bpl :-
    lda #0
    sta OAMADDR
    lda #>OAM
    sta OAMDMA
    lda #0
    sta frame_ready
    jmp @scroll
@lag:
    inc PROBE_LAG
@scroll:
    bit PPUSTATUS
    lda #0
    sta PPUSCROLL
    sta PPUSCROLL
    lda #CTRL_VAL
    sta PPUCTRL
    sta $E000
    lda #LATCH1
    sta $C000
    sta $C001
    sta $E001
    lda #<irq_hud
    sta irq_vec
    lda #>irq_hud
    sta irq_vec+1
    inc nmi_count
    pla
    tay
    pla
    tax
    pla
    rti

irq:
    jmp (irq_vec)

nametables:
    .incbin "nametables.bin"

.segment "VECTORS"
    .word nmi, reset, irq

.segment "CHARS"
    .incbin "chr.bin"
