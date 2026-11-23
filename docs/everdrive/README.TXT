BLUM'S 3 GAMES ON A REAL NES, WITH AN EVERDRIVE
================================================

(En français : voir LISEZMOI.TXT.)

What is in this folder
----------------------

  BLUM\BLUM.nes              BLUM (the platformer)
  BLUM\SEBRING.nes           SEBRING : DE L'ANJOU AU CENTRE-VILLE (the racer)
  BLUM\LEGEND.nes            THE LEGEND OF BLUM (the beginning), the game with saves
  BLUM\MUSIQUE\AWAITS.NSF    "Adventure Awaits", versions A and B (2 tracks)
  BLUM\MUSIQUE\LEGEND.NSF    all the music of THE LEGEND OF BLUM (7 tracks)
  LISEZMOI.TXT, README.TXT   this text, in French and in English

These are the same games as in the NES BLUM FACTORY app. Only the file header (the first 16 bytes)
uses the old "iNES 1.0" form, which every EverDrive reads the same way, old or new.

Copy to the SD card (once)
--------------------------

1. Take the micro SD card out of the EverDrive and put it in the computer.
2. Copy the BLUM folder to the root of the card (next to the EDN8 or EDFC folder already there).
   Do not put it inside EDN8 or EDFC.
3. Eject the card properly (right click, Eject) and put it back in the EverDrive.
4. Turn the NES on: in the EverDrive menu, open BLUM, pick a game, press A.

Which EverDrive, which version
------------------------------

  EverDrive N8 (the older one, NES or Famicom; Joel's): the 3 games work. The .NSF files do not play
      on this model (it has no music player); the music is in the game, and as MP3 in the gift's
      "Bande sonore" folder. Use the latest system (OS v1.26 on krikzz.com, EDFC folder at the root
      of the card).
  EverDrive N8 Pro (NES or Famicom): everything works, including the two .NSF music files (the N8 Pro
      has an NSF player). System 2.15 or newer (carts sold since January 2025 already have it).

Saves (THE LEGEND OF BLUM)
--------------------------

THE thing to know: save in the game (Start, then "Sauvegarder", or talk to a shining star), wait for
"Partie sauvegardée.", then press RESET to go back to the EverDrive menu before you turn the NES off. (If Reset restarts the game instead of opening the menu, the N8 Pro
"Reset Delay" option is on: hold Reset for about 2 seconds.)

Why: the save first goes to the EverDrive's battery memory (it stays when the NES is off), then the
EverDrive copies it to the SD card by itself (EDFC or EDN8 folder). On the older N8, the maker says no
reset is needed. Pressing Reset before turning off costs nothing and works on both models: it is the
safest habit, above all before taking the SD card out to put it in the computer.
The game keeps two copies of the save; if one is damaged it uses the other.
BLUM and SEBRING have no save.

If a game stays black or acts up
--------------------------------

  1. Update the EverDrive system (see above). This is the most common cause.
  2. Check that the system folder is there: EDN8 (N8 Pro) or EDFC with its MAPS folder (N8).
  3. Copy the .nes file again from the gift (a damaged copy gives a black screen).
  4. SD card: formatted FAT32 (a 32 GB card or smaller is simplest).
  5. Turn off, wait 5 seconds, turn on again (not just Reset).
  6. European NES (PAL): the games are made for a North American NES (NTSC). On a PAL NES the music
     plays slower and the picture can be off (above all the SEBRING road). On a North American NES, no
     problem.
  7. Famicom (Japanese): you need the Famicom version of the EverDrive (60 pins), or an adapter.
  8. N8 Pro: if the red light blinks at start-up on a grey NES, press Reset 7 times (lockout chip
     setup, only once).

Have fun, Blum!
