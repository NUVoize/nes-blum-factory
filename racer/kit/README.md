# sebring — art et musique de « SEBRING » (BLUM jeu 2), kit BLUMR-A1

Tout ici est original et écrit par code (agent muse-ui, 2026-10-21) : pixel art placé à la main dans des
scripts Python, musique composée dans la notation compacte FamiStudio du kit BLUM. Aucune image générée
par IA, aucun logo, aucune marque, aucune police tierce, aucun emoji. Droits : Fred (NUVoize) 2026, offert
à Blum, même attribution que `ASSETS.md` de l'app.

> English: original NES pixel art (car, BLUM driver, traffic, 5 Montréal backdrops, title / ending screens)
> and an original chiptune set (3 radio songs, title, jingles, 10 SFX) for the SEBRING racer, delivered in the
> racer engine's own binary layout plus indexed PNG / JSON sources. See « Branchement » for M2.

## Régénérer et vérifier

```
cd sebring
py -3.12 tools/build_all.py          # dessins -> banques CHR / nametables / écrans, maquettes, planche contact, validation
py -3.12 tools/validate.py           # vérification seule (code 1 si une règle NES ou un budget est dépassé)
node tools/engine-check.mjs          # contre le vrai moteur et le convertisseur CHROMA de l'app (vitest de l'app)
py -3.12 music/tools/build_all.py    # partition -> FamiStudio texte -> ca65 + WAV -> validation (ld65)
```

Dépendances : Python 3.12 + Pillow ; pour `engine-check`, le dépôt de l'app (`NBF_APP`, défaut
`C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY`) ; pour la musique, FamiStudio 4.5 et .NET 8 dans `.tmp\dl` de l'app
(mêmes variables que `music/`). Aucun GPU, rien ne tourne en fond.

## Arborescence

```
palettes.json            les 5 jeux de palettes (crépuscule -> nuit) + sprites + écrans, octets prêts
manifest.json            tout ce que M2 doit brancher : index de tuiles, banques, sons (RACER_SOUND proposé)
budget.json              tuiles par banque, Kio CHR (écrit par validate.py --write-budget)
gfx/sprites/sprites.png|json     planche des sprites (PNG indexé NES) + chaque index de tuile
gfx/backdrops/<etape>.png|json   ciel + skyline 512 x 96 par étape, nombre de tuiles, colonne de la carte
gfx/screens/{title,ending,gameover,credits}.png|json   écrans 256 x 240 rendus + nametable / attributs
engine/chr/sprites.chr           4 Kio, 188 / 256 tuiles (CHR_SPRITES, R2-R5)
engine/chr/backdrop-N.chr        2 Kio par étape : police ROM (63) + tuiles de l'étape (<= 65), R1
engine/chr/{title,ending}-r{0,1}.chr   banques des écrans (R0 : route 0-55 + grosses lettres ; R1 : police + décor)
engine/stages/stageN.bin         banque d'étape 4 Kio, exactement stageBank() : nametables @0, palette @$800, carte @$C00
engine/stages/stageN-card-palette.bin  palette de la carte (HUD couleur 3 = noir)
engine/screens.bin               4 x 1 Kio : titre, fin de partie, fin, générique (ordre du moteur)
engine/{title,ending}-palette.bin      32 octets
preview/                         maquettes mock-*.png (2x), bg-*.png (1x, sans sprites, pour CHROMA), planche contact
music/                           partition (tools/songs.py, sfx.py), src/*.txt, export/*.s, preview/*.wav, BUDGET.md
tools/                           générateurs, validateur, maquettes, engine-check
```

## Ce qui est dessiné

| Quoi | Taille | Palette | Détails |
|---|---|---|---|
| Voiture du joueur | 32 x 24, 8 poses de 12 tuiles | sprite 0 `$0F $16 $30` | décapotable fin 90 vue arrière : coffre arrondi, bandeau de feux pleine largeur avec plaque vide au centre, arceau de pare-brise, deux appuie-têtes. Poses : droit, virage doux, virage serré (droite = miroir), tête-à-queue 3/4 arrière, profil, 3/4 avant, avant, tonneau |
| Blum au volant | 8 x 16, 2 images | sprite 1 `$0F $36 $29` (palette du héros BLUM) | tuque verte avec la pousse, chemise à carreaux vue de dos ; la pousse bouge au vent |
| Trafic | 8x8, 16x8, 24x16 | 2 (auto, autobus) / 3 (cône, déneigeuse, nid-de-poule) | auto bleue, autobus blanc à bande bleue (style STM, sans logo), déneigeuse orange à lame blanche, cônes, nids-de-poule ; 3 tailles dessinées à la main |
| Décor de bord de route | mêmes 3 tailles | 3 lampadaire, 1 arbre, 2 enseigne | sorte 5 du moteur (libre) : lampadaire au sodium, érable rond, pylône d'enseigne (forme seulement) |
| Effets | 8x8 / 16x16 | 3 ou 0 | feux d'artifice (2 tailles x 2 images), fumée, trace de dérapage, drapeau à damier, marque de klaxon |
| 5 horizons | 512 x 48 skyline + 512 x 48 ciel | palettes 1-2 de l'étape | Galeries d'Anjou (centre commercial bas, pylône d'enseigne, bungalows, soleil couchant) ; Métropolitaine (tablier de béton gris sur piliers, lampadaires, portique, boîtes industrielles, château d'eau) ; Sherbrooke Est (tour inclinée du Stade et son bol, câbles, arbres du Jardin botanique) ; Plateau (mont Royal, croix allumée, triplex gris aux escaliers extérieurs, église, lune) ; Centre-ville (mur de tours, tour cruciforme au phare tournant, toit pointu) |
| Écrans | 256 x 240 | palettes propres | titre (logo SEBRING en grosses lettres, ciel du soir, route, la voiture en sprites), fin « BONNE FÊTE BLUM ! » (nuit, feux d'artifice en sprites, banderole d'arrivée à damier), fin de partie, générique |
| Cartes d'étape | 1 Kio par étape | palette de l'étape (carte) | « ÉTAPE n / 5 », carte postale de 32 colonnes du décor, nom FR (et EN quand il diffère), « START : DÉPART » |

Palettes (jamais `$0D`, ni `$xE/$xF`, ni `$20`) : couleur universelle `$00` (asphalte, aussi béton et
nuages), 4 fonds [route, ciel, skyline, HUD] par étape avec `skyline[0] == sky[2]` et HUD couleur 3 = haut du
ciel (ligne de partage invisible), exactement `stagePalette()` du moteur.

## Musique (`music/`, index = contrat proposé)

| # | Id | Titre | Caractère |
|---|---|---|---|
| 0 | `title` | Décapotable | do majeur, 128 BPM, basse marchante, boucle 15 s |
| 1 | `anjou` | Radio Anjou 104,5 | pop-rock, sol majeur, 150 BPM, boucle 19 s |
| 2 | `metro` | Métropolitaine FM | synthé, la mineur, 150 BPM, arpèges en doubles croches, boucle 13 s |
| 3 | `nuit` | Centre-ville Nuit | funk de nuit, ré mineur, accords de septième, boucle 15 s |
| 4 | `clear` | Étape réussie | fanfare 3 s, une fois |
| 5 | `gameover` | Panne sèche | soupir comique 4 s, une fois |
| 6 | `ending` | Bonne fête Blum (arrivée) | chanson d'anniversaire **originale**, fa majeur, boucle 17 s |

Effets : 0 `crash`, 1 `checkpoint`, 2 `bump` (nid-de-poule), 3 `honk` (klaxon deux tons), 4 `timeover`,
5 `card`, 6 `pause`, 7 `rev` (passage de régime), 8 `skid`, 9 `start`. Banque SOUND : 2 799 / 8 192 octets
(vérifié par ld65). Noms de stations inventés. **Décision moteur** (laissée à A1 par RACER-PLAN 9.1) : pas de
boucle moteur continue (elle occuperait un canal de musique et le seul flux SFX la couperait à chaque effet) ;
à la place `rev` aux paliers 60 / 120 / 180 km/h et `skid` dans les virages serrés.

## Branchement dans le moteur (pour BLUMR-M2)

Le contrat `racer-assets.ts` est respecté à l'octet ; tout est dans `manifest.json`.

1. **Sprites** : `engine/chr/sprites.chr` à la place de `spriteArt().chr` (CHR_SPRITES). Constantes :
   `SPR_CAR0`, `SPR_CAR_L` = `soft-left`, `SPR_CAR_R` = `soft-left` avec attribut `$40` (miroir), `SPR_DRIVER`
   (tête, 8x8 ; la tuile suivante = épaules à `dy -4`, la tête à `dy -12`), `spin_tile` / `spin_attr`,
   `kind_tile` / `kind_attr` (sorte 5 = décor de bord de route, un look par étape proposé), tuiles d'effets.
2. **Étapes** : `engine/stages/stageN.bin` = `stageBank()` tel quel (nametables, palette, carte) et
   `engine/chr/backdrop-N.chr` dans l'unité `CHR_BACKDROP0 + 2 i`. La carte attend `stageN-card-palette.bin`
   (ou la palette de l'étape, au prix d'un trait de la couleur du ciel sous chaque ligne de texte).
3. **Écrans** : `engine/screens.bin` (même ordre) et, pour le titre / fin de partie / générique, R0 =
   `title-r0.chr`, R1 = `title-r1.chr`, palette `title-palette.bin` ; pour la fin, `ending-*`. Le M1 dessine les
   écrans texte avec R0 = route A et R1 = décor de l'étape 0 : il faut ajouter ces 4 Kio de CHR (unités libres,
   par ex. 20-23) et les mapper dans `show_screen`. Le titre place déjà la voiture (sprites) sur la route.
4. **Son** : `music/export/music.s` et `sfx.s` remplacent les copies de `engine/audio` (mêmes étiquettes
   `music_data_blum_music`, `sounds`, aucun drapeau `FAMISTUDIO_USE_*`) ; `RACER_SOUND` passe à
   `{SONG_TITLE 0, RADIO_SONGS [1,2,3], SONG_CLEAR 4, SONG_GAMEOVER 5, SONG_ENDING 6, SFX_CRASH 0, SFX_CP 1,
   SFX_BUMP 2, SFX_HONK 3, SFX_TIMEOVER 4, SFX_CARD 5, SFX_PAUSE 6, SFX_REV 7, SFX_SKID 8, SFX_START 9}`.
5. **Palettes** : `racerAssetsPALETTES` de `palettes.json` remplace `PALETTES` de `racer-assets.ts`
   (ids `coucher-de-soleil`, `crepuscule`, `soir`, `nuit-tombante`, `nuit` inchangés) ; `SPRITE_PALETTES`
   = `sprites`.
6. Budget CHR : route 4 + décors 10 + sprites 4 + écrans 8 = 26 Kio sur 128.

## Vérifications

`tools/validate.py` : fichiers générés à jour (build déterministe), couleurs permises, 3 couleurs + fond par
cellule de sprite dans sa palette, banques (police ROM identique, route 0-55, <= 65 tuiles d'étape, <= 128
par banque, 256 sprites), nametables (toutes les tuiles existent, attributs = `palOfRow` du moteur), lignes
de texte <= 30 glyphes, 8 sprites par ligne au pire (4 voiture + 1 Blum + 3 objet proche), aucun emoji.
`tools/engine-check.mjs` (vitest de l'app, lecture seule) : tuiles de route = `buildRoadTiles()`, police =
`glyphPixels()`, table de couleurs = `NES_PALETTE`, chaque écran et chaque fond d'étape passe par
`convertImage` (CHROMA, palettes verrouillées) sans perte de couleur ni fusion de tuiles, la planche de la
voiture se convertit en sprite joueur. `music/tools/validate.py` : comme BLUM-A4 (sources à jour, fonctions du
pilote, export, budget ld65, WAV non muets, sans écrêtage).
