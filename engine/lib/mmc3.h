// MMC3 helpers from nesdoug 33_MMC3 mmc3_code.asm (MIT, Doug Fraker). NES BLUM FACTORY keeps only
// the routines it uses; banked_call is not used in v1 (all engine code is in the fixed banks).

// Switch the bank at $8000-$9FFF (shadowed: safe against NMI/IRQ).
void __fastcall__ set_prg_8000(unsigned char bank_id);
unsigned char __fastcall__ get_prg_8000(void);

// A12 not inverted (PLAN 5.4): mode 0/1 = BG 2 KiB at $0000/$0800, mode 2-5 = sprites 1 KiB at $1000-$1C00.
// Values are 1 KiB bank numbers (even for modes 0/1).
void __fastcall__ set_chr_mode_0(unsigned char chr_id);
void __fastcall__ set_chr_mode_1(unsigned char chr_id);
void __fastcall__ set_chr_mode_2(unsigned char chr_id);
void __fastcall__ set_chr_mode_3(unsigned char chr_id);
void __fastcall__ set_chr_mode_4(unsigned char chr_id);
void __fastcall__ set_chr_mode_5(unsigned char chr_id);

#define MIRROR_VERTICAL 0
#define MIRROR_HORIZONTAL 1
void __fastcall__ set_mirroring(unsigned char mirroring);

// Turns off the MMC3 IRQ and points the IRQ system at an empty array.
void disable_irq(void);
// Points the IRQ system at a command array (see nesdoug README) and turns it on.
void __fastcall__ set_irq_ptr(unsigned char * address);
unsigned char is_irq_done(void);
