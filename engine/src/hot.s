; NES BLUM FACTORY engine: hot paths in assembly (M4a). Included by crt0.s. cc65's C version of beh_at()
; was 7 % of a frame with 6 enemies (profiled on the M4-T10 stress level).

.importzp _cx, _cy
.import _lvl_px_width, _levelbuf, _mt_beh
.export _beh_at

.segment "CODE"

; unsigned char beh_at(void): behaviour (PLAN 5.6) at level pixel (cx, cy).
; Outside the level: solid left/right of the level, empty above and below the playfield (13 rows).
_beh_at:
    lda _cy+1
    bne @empty          ; cy < 0 or cy >= 256
    lda _cy
    cmp #208            ; LEVEL_ROWS * 16
    bcs @empty
    lda _cx+1
    cmp _lvl_px_width+1
    bcc @inside
    bne @solid
    lda _cx
    cmp _lvl_px_width
    bcs @solid
@inside:
    ; levelbuf[(cx & $FFF0) | (cy >> 4)]
    lda _cy
    lsr a
    lsr a
    lsr a
    lsr a
    sta ptr1
    lda _cx
    and #$F0
    ora ptr1
    clc
    adc #<_levelbuf
    sta ptr1
    lda _cx+1
    adc #>_levelbuf
    sta ptr1+1
    ldy #0
    lda (ptr1),y
    tay
    lda _mt_beh,y
    ldx #0
    rts
@empty:
    lda #0
    ldx #0
    rts
@solid:
    lda #1
    ldx #0
    rts
