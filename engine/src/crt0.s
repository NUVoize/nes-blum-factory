; NES BLUM FACTORY engine: startup code for cc65 + neslib on MMC3.
; Forked from nesdoug 33_MMC3 crt0.s (MIT, Doug Fraker), itself based on code by Groepaz/Hitmen and
; Ullrich von Bassewitz. Changes (PLAN 5.3, hardware boot rules):
; - NES 2.0 header generated from cartridge.json (gen/header.inc);
; - PRG R6/R7 and the six CHR registers set before anything leaves $E000-$FFFF;
; - WRAM enabled ($A001 = $80), then cleared; the live tuning block is copied from ROM defaults
;   unless it already holds a valid magic + version (soft reset keeps live tuning);
; - C stack in WRAM ($7000-$77FF), probe block initialised at $7F00;
; - FamiStudio sound engine (SOUND bank) instead of FamiTone2.

.include "../gen/config.inc"

    .export _exit,__STARTUP__:absolute=1
    .export NBF_IN_FRAME
    .import push0,popa,popax,_main,zerobss,copydata
    .import __STACK_START__, __STACKSIZE__
    .import _tuning_defaults


    .include "zeropage.inc"

PPU_CTRL    =$2000
PPU_MASK    =$2001
PPU_STATUS  =$2002
PPU_OAM_ADDR=$2003
PPU_OAM_DATA=$2004
PPU_SCROLL  =$2005
PPU_ADDR    =$2006
PPU_DATA    =$2007
PPU_OAM_DMA =$4014
PPU_FRAMECNT=$4017
DMC_FREQ    =$4010
CTRL_PORT1  =$4016
CTRL_PORT2  =$4017

OAM_BUF     =$0200
VRAM_BUF    =$0700

TUNE_BASE   =$7E00
PROBE_BASE  =$7F00
PROBE_LAG   =$7F14

.segment "BSS"
PAL_BUF: .res 32
.ifdef NBF_TEST_BANKSTRESS
NBF_STRESS_FC: .res 1
.endif

.segment "ZEROPAGE"

NTSC_MODE:          .res 1
FRAME_CNT1:         .res 1
FRAME_CNT2:         .res 1
VRAM_UPDATE:        .res 1
NAME_UPD_ADR:       .res 2
NAME_UPD_ENABLE:    .res 1
PAL_UPDATE:         .res 1
PAL_BG_PTR:         .res 2
PAL_SPR_PTR:        .res 2
SCROLL_X:           .res 1
SCROLL_Y:           .res 1
SCROLL_X1:          .res 1
SCROLL_Y1:          .res 1
PAD_STATE:          .res 2
PAD_STATEP:         .res 2
PAD_STATET:         .res 2
PPU_CTRL_VAR:       .res 1
PPU_CTRL_VAR1:      .res 1
PPU_MASK_VAR:       .res 1
RAND_SEED:          .res 2
NBF_IN_FRAME:       .res 1   ; 1 while the main loop is working on a frame (lag counter, PLAN 5.8)
NBF_MUSIC_REQ:      .res 1   ; $FF none, $FE stop, else song index (handled in the NMI)
NBF_SFX_REQ:        .res 1   ; $FF none, else sfx index (handled in the NMI)
NBF_SPLIT_ON:       .res 1   ; 1 while the HUD split array (game.c irq_array) is active
NBF_SPLIT_CTRL:     .res 1   ; next frame's playfield $2000 value, copied by the NMI
NBF_SPLIT_X:        .res 1   ; next frame's playfield scroll x, copied by the NMI
NBF_PLAYER_CHR:     .res 1   ; next frame's player CHR bank (R2, per animation group, PLAN 5.4), copied by the NMI

TEMP:               .res 11
SPRID:              .res 1

PAD_BUF     =TEMP+1

PTR         =TEMP   ;word
LEN         =TEMP+2 ;word
NEXTSPR     =TEMP+4
SCRX        =TEMP+5
SCRY        =TEMP+6
SRC         =TEMP+7 ;word
DST         =TEMP+9 ;word

RLE_LOW     =TEMP
RLE_HIGH    =TEMP+1
RLE_TAG     =TEMP+2
RLE_BYTE    =TEMP+3

;nesdoug code requires
VRAM_INDEX:         .res 1
META_PTR:           .res 2
DATA_PTR:           .res 2

.exportzp NBF_MUSIC_REQ, NBF_SFX_REQ
_nbf_split_on = NBF_SPLIT_ON
_nbf_split_ctrl = NBF_SPLIT_CTRL
_nbf_split_x = NBF_SPLIT_X
_nbf_player_chr = NBF_PLAYER_CHR
.exportzp _nbf_split_on, _nbf_split_ctrl, _nbf_split_x, _nbf_player_chr

.segment "HEADER"
    .include "../gen/header.inc"

; the linker wants at least one mention of the always-present banks
.segment "ONCE"
.segment "BANK0"

.segment "STARTUP"
; mapped to the last PRG bank ($E000-$FFFF)

start:
_exit:
    sei
    cld
    ldx #$40
    stx CTRL_PORT2
    ldx #$ff
    txs
    inx
    stx PPU_MASK
    stx DMC_FREQ
    stx PPU_CTRL        ;no NMI

    ; MMC3 registers are unspecified at power-on: set them first, before any jsr leaves $E000.
    jsr _disable_irq
    lda #0
    jsr _set_prg_8000   ; R6 = bank 0 at $8000 (also sets PRG mode 0: $C000 = bank 30)
    lda #FIXED_A000_BANK
    jsr _set_prg_a000   ; R7 = bank 29 at $A000, once
    lda #CHR_FONT
    jsr _set_chr_mode_0 ; BG $0000-$07FF
    lda #CHR_FONT+2
    jsr _set_chr_mode_1 ; BG $0800-$0FFF
    lda #CHR_PLAYER
    jsr _set_chr_mode_2 ; sprites $1000
    lda #CHR_COMMON
    jsr _set_chr_mode_3 ; sprites $1400
    lda #CHR_ENEMIES
    jsr _set_chr_mode_4 ; sprites $1800
    lda #CHR_BOSS
    jsr _set_chr_mode_5 ; sprites $1C00
    lda #0
    jsr _set_mirroring  ; vertical mirroring: horizontal scrolling
    lda #$80            ; WRAM_ON (nesdoug _set_wram_mode). Keep: stack, level and probe live there.
    jsr _set_wram_mode

    ldx #0
initPPU:
    bit PPU_STATUS
@1:
    bit PPU_STATUS
    bpl @1

clearRAM:
    txa
@1:
    sta $000,x
    sta $100,x
    sta $200,x
    sta $300,x
    sta $400,x
    sta $500,x
    sta $600,x
    sta $700,x
    inx
    bne @1

; WRAM: never trust it at power-on. Clear $6000-$7DFF and $7F00-$7FFF.
clearWRAM:
    lda #$60
    sta ptr1+1
    lda #0
    sta ptr1
    tay
@page:
    lda #0
@1:
    sta (ptr1),y
    iny
    bne @1
    inc ptr1+1
    lda ptr1+1
    cmp #$7E
    bne @page
    lda #$7F
    sta ptr1+1
    lda #0
@2:
    sta (ptr1),y
    iny
    bne @2

; Live tuning block: keep it only if magic + version are valid, else copy the ROM defaults.
tuningGuard:
    ldx #4
@chk:
    lda TUNE_BASE,x
    cmp _tuning_defaults,x
    bne @copy
    dex
    bpl @chk
    jmp @done
@copy:
    ldx #0
@cp:
    lda _tuning_defaults,x
    sta TUNE_BASE,x
    inx
    bne @cp
@done:

@vbl2:
    bit PPU_STATUS
    bpl @vbl2

clearPalette:
    ldx #0
    lda #$3f
    sta PPU_ADDR
    stx PPU_ADDR
    lda #$0f
    ldx #$20
@1:
    sta PPU_DATA
    dex
    bne @1

clearVRAM:
    txa
    ldy #$20
    sty PPU_ADDR
    sta PPU_ADDR
    ldy #$10
@1:
    sta PPU_DATA
    inx
    bne @1
    dey
    bne @1

; Probe block (PLAN 5.8): magic "BLUM", engine data version, state 0 = boot.
initProbe:
    lda #'B'
    sta PROBE_BASE
    lda #'L'
    sta PROBE_BASE+1
    lda #'U'
    sta PROBE_BASE+2
    lda #'M'
    sta PROBE_BASE+3
    lda #ENGINE_DATA_VERSION
    sta PROBE_BASE+4

    lda #$ff
    sta NBF_MUSIC_REQ
    sta NBF_SFX_REQ

    cli                 ; the MMC3 IRQ stays off until set_irq_ptr

    lda #4
    jsr _pal_bright
    jsr _pal_clear
    jsr _oam_clear

    jsr zerobss
    jsr copydata

    lda #<(__STACK_START__+__STACKSIZE__)
    sta c_sp
    lda #>(__STACK_START__+__STACKSIZE__)
    sta c_sp+1

    lda #%10001000      ; NMI on, BG $0000, sprites $1000 (standard MMC3 A12 layout, PLAN 5.4)
    sta <PPU_CTRL_VAR
    sta PPU_CTRL
    lda #%00000110
    sta <PPU_MASK_VAR

waitSync3:
    lda <FRAME_CNT1
@1:
    cmp <FRAME_CNT1
    beq @1

detectNTSC:
    ldx #52             ;blargg's code
    ldy #24
@1:
    dex
    bne @1
    dey
    bne @1

    lda PPU_STATUS
    and #$80
    sta <NTSC_MODE

    jsr _ppu_off

    lda #0
    ldx #0
    jsr _set_vram_update

    lda #$fd
    sta <RAND_SEED
    sta <RAND_SEED+1

    lda #0
    sta PPU_SCROLL
    sta PPU_SCROLL

; FamiStudio init with the SOUND bank in place (shadowed swap), then back to bank 0.
    lda #SOUND_BANK
    jsr _set_prg_8000
    ldx #<music_data_blum_music
    ldy #>music_data_blum_music
    lda #1              ; NTSC
    jsr famistudio_init
    ldx #<sounds
    ldy #>sounds
    jsr famistudio_sfx_init
    lda #0
    jsr _set_prg_8000

    jmp _main

    .include "../lib/mmc3_code.asm"
    .include "../lib/neslib.s"
    .include "../lib/nesdoug.s"
    .include "hot.s"

; FamiStudio sound engine 4.5.0 (MIT-style notice kept in the file), code in the fixed CODE segment.
FAMISTUDIO_CFG_EXTERNAL     = 1
FAMISTUDIO_CFG_NTSC_SUPPORT = 1
FAMISTUDIO_CFG_SFX_SUPPORT  = 1
FAMISTUDIO_CFG_SFX_STREAMS  = 1
FAMISTUDIO_CFG_DPCM_SUPPORT = 0
.define FAMISTUDIO_CA65_ZP_SEGMENT   ZEROPAGE
.define FAMISTUDIO_CA65_RAM_SEGMENT  BSS
.define FAMISTUDIO_CA65_CODE_SEGMENT CODE
    .include "../audio/famistudio_ca65.s"

.segment "SOUND"
    .include "../audio/music.s"
    .include "../audio/sfx.s"

.segment "VECTORS"
    .word nmi   ;$fffa vblank nmi
    .word start ;$fffc reset
    .word irq   ;$fffe irq / brk

.segment "CHARS"
    .incbin "../gen/chr.bin"
