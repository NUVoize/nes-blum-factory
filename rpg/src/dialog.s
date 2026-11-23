; THE LEGEND OF BLUM engine: windows and text. A window is drawn over the map 2 tile rows per frame (then its
; attribute rows set to palette 0, the UI palette), and closed by redrawing the map rows from the working copy.
; A text block = [pages] then per page [speaker][line 1][$FE][line 2][$FF] (gen/text.s); a page is decoded
; into lbuf (numbers from numv), its lines cleared, then typed 2 tiles per frame (8 while B is held).
.segment "CODE"

DS_OPEN = 0
DS_PAGE = 1
DS_CLEAR2 = 2
DS_TYPE = 3
DS_WAIT = 4
DS_CHOICE = 5
DS_CLOSE = 6
OWNER_VM = 0
OWNER_MENU = 1

; ---- window drawing ---------------------------------------------------------------------------------
; emit_window_row: A = row inside the window (0 .. win_h-1), into the page on screen (35 buffer bytes)
emit_window_row:
    pha
    jsr cur_hi
    sta nthi
    pla
    pha
    clc
    adc win_row
    jsr row_addr
    lda #32
    jsr vb_hdr
    pla
    tax
    lda #T_SPACE
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
:   inx
    cpx win_h
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

; win_attr: A = 1 window palette (mask the covered halves), 0 restore. Attribute rows of [win_row, +win_h).
win_attr:
    sta tmp+3
    jsr cur_hi
    clc
    adc #3
    sta nthi
    lda win_row
    lsr
    lsr
    sta cnt                 ; first block row
@row:
    lda cnt
    asl
    asl
    sta ri                  ; first tile row of the block
    lda #$FF
    sta tmp+2
    lda tmp+3
    beq @emit
    lda ri
    jsr win_covers
    bcc :+
    lda tmp+2
    and #$F0
    sta tmp+2
:   lda ri
    clc
    adc #2
    jsr win_covers
    bcc @emit
    lda tmp+2
    and #$0F
    sta tmp+2
@emit:
    lda nthi
    sta tmp+1
    lda cnt
    asl
    asl
    asl
    pha
    clc
    adc #$C0
    sta tmp
    lda #8
    jsr vb_hdr
    pla
    tax
    ldy vlen
    lda #8
    sta ri
:   lda scr_attr,x
    and tmp+2
    sta vbuf,y
    iny
    inx
    dec ri
    bne :-
    sty vlen
    lda cnt
    asl
    asl
    clc
    adc #4
    sta ri
    lda win_row
    clc
    adc win_h
    cmp ri
    beq @done
    bcc @done
    inc cnt
    jmp @row
@done:
    rts
; win_covers: A = tile row -> carry set when inside [win_row, win_row + win_h)
win_covers:
    cmp win_row
    bcc @no
    sec
    sbc win_row
    cmp win_h
    bcs @no
    sec
    rts
@no:
    clc
    rts

; win_open_step: draws the next 2 rows, then the attributes. Carry set when the window is complete.
win_open_step:
    lda win_step
    asl
    cmp win_h
    bcs @attr
    jsr emit_window_row
    lda win_step
    asl
    clc
    adc #1
    jsr emit_window_row
    inc win_step
    clc
    rts
@attr:
    lda #1
    jsr win_attr
    sec
    rts

; win_close_step: redraws the next 2 map rows under the window, then the attributes. Carry set when done.
win_close_step:
    lda win_step
    asl
    cmp win_h
    bcs @attr
    jsr cur_hi
    sta nthi
    lda win_step
    asl
    clc
    adc win_row
    pha
    jsr emit_room_row
    pla
    clc
    adc #1
    jsr emit_room_row
    inc win_step
    clc
    rts
@attr:
    lda #0
    jsr win_attr
    sec
    rts

; ---- pages ------------------------------------------------------------------------------------------
; page_decode: the page at t_ptr -> lbuf (line 1 at 0, line 2 at 28), d_len1, d_len2, d_spk; t_ptr moves past it
page_decode:
    ldx #55
    lda #T_SPACE
:   sta lbuf,x
    dex
    bpl :-
    lda #0
    sta num_i
    sta d_len2
    ldy #0
    lda (t_ptr),y
    sta d_spk
    ldx #0
@l: iny
    lda (t_ptr),y
    cmp #CODE_END
    beq @end
    cmp #CODE_LINE
    bne :+
    stx d_len1
    ldx #28
    jmp @l
:   cmp #CODE_NUM
    beq @num
    sta lbuf,x
    inx
    jmp @l
@num:
    sty ri
    stx cnt
    ldx num_i
    inc num_i
    lda numv,x
    jsr digits3
    ldx cnt
    pha
    lda tmp+2
    beq :+
    clc
    adc #DIGIT0
    sta lbuf,x
    inx
    lda tmp+3
    jmp @tens
:   lda tmp+3
    beq @units
@tens:
    clc
    adc #DIGIT0
    sta lbuf,x
    inx
@units:
    pla
    clc
    adc #DIGIT0
    sta lbuf,x
    inx
    ldy ri
    jmp @l
@end:
    txa
    sec
    sbc #28
    bcs :+
    lda #0
:   sta d_len2
    iny
    tya
    clc
    adc t_ptr
    sta t_ptr
    bcc :+
    inc t_ptr+1
:   lda #0
    sta d_i
    rts

; clear_line: A = tile row -> 28 spaces from TEXT_COL in the page on screen (31 buffer bytes)
clear_line:
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
    ldy vlen
    lda #T_SPACE
    ldx #TEXT_W
:   sta vbuf,y
    iny
    dex
    bne :-
    sty vlen
    rts

; type_chars: A = most tiles this frame -> carry set when the page is fully typed
type_chars:
    sta cnt
@more:
    lda cnt
    bne :+
    jmp @check
:
    lda d_i
    cmp d_len1
    bcs @line2
    sta tmp+2               ; index in lbuf
    clc
    adc #TEXT_COL
    sta ri                  ; column
    lda d_len1
    sec
    sbc d_i
    sta tmp+3               ; left on this line
    lda d_row
    clc
    adc #1
    jmp @run
@line2:
    sec
    sbc d_len1
    cmp d_len2
    bcs @done
    sta tmp+2
    clc
    adc #TEXT_COL
    sta ri
    lda d_len2
    sec
    sbc tmp+2
    sta tmp+3
    lda tmp+2
    clc
    adc #28
    sta tmp+2
    lda d_row
    clc
    adc #3
@run:
    pha
    jsr cur_hi
    sta nthi
    pla
    jsr row_addr
    lda tmp
    ora ri
    sta tmp
    lda tmp+3
    cmp cnt
    bcc :+
    lda cnt
:   sta tmp+3               ; tiles this run
    jsr vb_hdr
    ldx tmp+2
    ldy vlen
    lda tmp+3
    sta ri
:   lda lbuf,x
    sta vbuf,y
    iny
    inx
    dec ri
    bne :-
    sty vlen
    lda d_i
    clc
    adc tmp+3
    sta d_i
    lda cnt
    sec
    sbc tmp+3
    sta cnt
    jmp @more
@check:
    lda d_len1
    clc
    adc d_len2
    cmp d_i
    beq @done
    bcs @notyet
@done:
    sec
    rts
@notyet:
    clc
    rts

; arrow_tile: A = tile at the prompt place (window row 4, column 29)
arrow_tile:
    pha
    jsr cur_hi
    sta nthi
    lda d_row
    clc
    adc #4
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

; type_speed: 2 tiles per frame, 8 while B is held
type_speed:
    lda pad
    and #BTN_B
    beq :+
    lda #8
    rts
:   lda #2
    rts

; ---- dialogue state (ST_DIALOG) ---------------------------------------------------------------------
; dialog_block: A/X = block address (lo/hi), d_owner set -> shows the block (opens the window if needed)
dialog_block:
    sta t_ptr
    stx t_ptr+1
    ldy #0
    lda (t_ptr),y
    sec
    sbc #1
    sta d_page
    inc t_ptr
    bne :+
    inc t_ptr+1
:   lda #ST_DIALOG
    sta state
    lda win_open
    beq :+
    lda #DS_PAGE
    sta d_sub
    rts
:   lda #BOX_BOTTOM
    ldx d_owner
    bne :+
    ldx py
    cpx #120
    bcc :+
    lda #BOX_TOP
:   sta d_row
    sta win_row
    lda #6
    sta win_h
    lda #0
    sta win_step
    lda #DS_OPEN
    sta d_sub
    rts

; dialog_close: closes the open window, then dialog_closed
dialog_close:
    lda d_row
    sta win_row
    lda #6
    sta win_h
    lda #0
    sta win_step
    lda #DS_CLOSE
    sta d_sub
    lda #ST_DIALOG
    sta state
    rts

dialog_update:
    lda d_sub
    cmp #DS_OPEN
    bne @page
    jsr win_open_step
    bcc :+
    lda #1
    sta win_open
    lda #DS_PAGE
    sta d_sub
:   rts
@page:
    cmp #DS_PAGE
    bne @clear2
    jsr page_decode
    jsr emit_top
    lda d_row
    clc
    adc #1
    jsr clear_line
    lda #DS_CLEAR2
    sta d_sub
    rts
@clear2:
    cmp #DS_CLEAR2
    bne @type
    lda d_row
    clc
    adc #3
    jsr clear_line
    lda #DS_TYPE
    sta d_sub
    rts
@type:
    cmp #DS_TYPE
    bne @wait
    jsr type_speed
    jsr type_chars
    bcc :+
    lda #15
    sta d_blink
    lda #DS_WAIT
    sta d_sub
    lda d_page
    bne :+
    lda ch_n
    beq :+
    lda #0
    sta ch_cur
    jsr choice_draw
    lda #DS_CHOICE
    sta d_sub
:   rts
@wait:
    cmp #DS_WAIT
    bne @choice
    lda pad_new
    and #BTN_A
    bne :+
    jmp blink_step
:   lda #T_SPACE
    jsr arrow_tile
    lda d_page
    beq :+
    dec d_page
    lda #DS_PAGE
    sta d_sub
    rts
:   jmp block_done
@choice:
    cmp #DS_CHOICE
    bne @close
    lda pad_new
    and #BTN_LEFT|BTN_UP
    beq :+
    lda #SFX_MENU
    jsr sfx
    ldx ch_cur
    dex
    bpl @set
    ldx ch_n
    dex
    jmp @set
:   lda pad_new
    and #BTN_RIGHT|BTN_DOWN|BTN_SELECT
    beq :+
    lda #SFX_MENU
    jsr sfx
    ldx ch_cur
    inx
    cpx ch_n
    bcc @set
    ldx #0
@set:
    stx ch_cur
    jmp choice_draw
:   lda pad_new
    and #BTN_A
    beq :+
    lda ch_cur
    jmp @chosen
:   lda pad_new
    and #BTN_B
    beq @nochoice
    ldx ch_n
    dex
    txa
@chosen:
    sta choice
    lda #0
    sta ch_n
    jmp block_done
@nochoice:
    rts
@close:
    jsr win_close_step
    bcc :+
    lda #0
    sta win_open
    jmp dialog_closed
:   rts

; emit_top: the window's top border, with the speaker's name at column 3 when the page has one
emit_top:
    lda vlen
    pha
    lda d_row
    sta win_row
    lda #6
    sta win_h
    lda #0
    jsr emit_window_row
    pla
    clc
    adc #3+3
    sta ri                  ; buffer index of column 3
    ldx d_spk
    beq @no
    lda spk_lo,x
    sta src
    lda spk_hi,x
    sta src+1
    ldy #0
    lda (src),y
    sta cnt
    ldx ri
:   iny
    lda (src),y
    sta vbuf,x
    inx
    dec cnt
    bne :-
@no:
    rts

; choice_draw: the cursor in front of the chosen option, spaces in front of the others
choice_draw:
    ldx #0
@l: cpx ch_n
    beq @done
    stx cnt
    jsr cur_hi
    sta nthi
    lda d_row
    clc
    adc #3
    jsr row_addr
    ldx cnt
    lda tmp
    ora ch_cols,x
    sta tmp
    lda #1
    jsr vb_hdr
    ldx cnt
    lda #T_SPACE
    cpx ch_cur
    bne :+
    lda #T_CURSOR
:   jsr vb_put
    ldx cnt
    inx
    bne @l
@done:
    rts

block_done:
    lda d_owner
    beq :+
    jmp menu_dialog_done
:   jmp vm_run

dialog_closed:
    lda d_owner
    beq :+
    jmp menu_dialog_closed
:   jmp vm_run
