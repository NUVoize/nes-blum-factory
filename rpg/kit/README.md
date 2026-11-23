# legend — art et musique de « THE LEGEND OF BLUM » (BLUM jeu 3, RPG), kit de la tranche verticale (BLUMZ-A1)

Tout ici est original et écrit par code (agent muse-ui, 2026-10-21) : pixel art placé à la main ou dessiné par
fonctions dans des scripts Python, musique composée dans la notation compacte FamiStudio du kit BLUM. Les photos
du dossier de références (`_source-v1\`, jamais commité, jamais livré) ont servi de modèles de formes et de
couleurs seulement : rien n'est tracé ni intégré, aucune adresse, aucun numéro, aucun nom de rue, aucune carte.
Aucun logo, aucune marque, aucune police tierce, aucun emoji. Droits : Fred (NUVoize) 2026, offert à Blum.

> English: original NES pixel art (Blum child set, 6 NPCs with portraits, 4 enemies on the map and in battle,
> 5 class effects, 4 area tilesets, 3 battle backdrops, title + class choice screens) and an original chiptune set
> (5 songs + 8 SFX) for the LEGEND OF BLUM vertical slice (CH00 + CH01 maternelle/1re), delivered as 1 KiB / 2 KiB
> CHR banks, metatile tables, nametables and palette files that follow RPG-PLAN sections 2-3. See « Branchement ».

## Régénérer et vérifier

```
cd legend
py -3.12 tools/build_all.py          # dessins -> banques CHR / tables / nametables, maquettes, planche contact, validation
py -3.12 tools/validate.py           # vérification seule (code 1 si une règle NES, un budget ou la vie privée est violée)
py -3.12 music/tools/build_all.py    # partition -> FamiStudio texte -> ca65 + WAV -> validation (ld65)
py -3.12 music/tools/check_pitch.py  # preuve par le son : les notes rendues sont celles de la partition
```

Dépendances : Python 3.12 + Pillow ; l'app (`NBF_APP`, défaut `C:\DEV\CODEGOD\apps\NES-BLUM-FACTORY`) pour
comparer la police avec `font.ts` + `spike-art.ts` et lier la banque son avec ca65/ld65 ; pour la musique,
FamiStudio 4.5 et .NET 8 dans `.tmp\dl` de l'app (mêmes variables que `sebring/music/`). Aucun GPU, rien ne
tourne en fond. Le build est déterministe (validate.py refuse un fichier généré qui ne serait plus à jour).

## Arborescence

```
manifest.json                 tout ce que M1/M2 doivent brancher (banques, index de tuiles, palettes, sons), généré
budget.json                   tuiles par banque et Kio CHR de la tranche (validate.py --write-budget)
palettes : tools/legpal.py    la source ; engine/palettes/*.bin = 32 octets prêts pour $3F00
engine/chr/ui.chr             R0, 2 Kio : vide + 102 glyphes (police RPG : majuscules BLUM + minuscules accentuées du spike) + cadre 9 + 16 communes
engine/chr/<aire>.chr         R1, 2 Kio par aire : appartement, anjou, chenier-ext, chenier-int (<= 64 métatuiles, <= 128 tuiles)
engine/metatiles/<aire>.bin   64 x 5 octets : tl tr bl br attr (bits 0-1 palette 1-3, 4 solide, 8 comptoir, 16 déclencheur)
engine/screens/sample-*.bin   5 écrans d'exemple 16 x 15 (nametable 1 Kio) : salon, rue, ecole, couloir, classe (M2 écrit les vrais)
engine/chr/blum-enfant.chr    R2, 1 Kio : Blum enfant (carte 6 images, combat 4 poses, portrait)
engine/chr/npcs-ch00.chr      R3 : Madame Bélanger, Magdi, Nivoix      engine/chr/npcs-ch01.chr : Maxi, Paul, Marie-Claude
engine/chr/enemies-map.chr    R4 : ennemis visibles sur la carte (2 images) + objets (billet, clochette, cartable, marqueurs)
engine/chr/fx.chr             R5 : 5 pouvoirs palier 1 x 2 images, coup, bouclier, curseur
engine/chr/battle-bg-*.chr    moitié basse de R1 en combat (<= 64 tuiles) : classe, cour, salon  + engine/battle/bg-*.bin (nametable)
engine/chr/enemy-*.chr        moitié haute de R1 en combat : crayon 48x48, marie-claude 48x56, mouton 32x32, boulette 32x32
engine/chr/title.chr          R1 de l'écran titre + engine/screens/title.bin ; engine/screens/classes.bin (banque UI seule)
gfx/                          sources PNG indexés NES (index = couleur NES, 64 = transparent) + JSON (métasprites, grilles, index)
preview/                      mock-*.png (2x), bg-*.png (1x, sans sprites, pour CHROMA), contact-sheet.png
music/                        partition (tools/songs.py, sfx.py), src/*.txt, export/*.s, preview/*.wav, BUDGET.md
tools/                        générateurs, maquettes, planche contact, validateur, manifest
```

## Ce qui est dessiné

| Quoi | Taille | Palette | Détails |
|---|---|---|---|
| Blum enfant (production) | 16 x 16 carte (bas x2, haut x2, côté x2 ; gauche = miroir), 16 x 24 combat (repos, attaque, touché, victoire), portrait 16 x 16 | tête sprite 0 `$0F $36 $29` (héros BLUM), corps sprite 1 `$0F $36 $16` | redessiné : mains libres, aucun objet, tenue simple (tuque verte avec la pousse, chemise à carreaux rouge, pantalon noir). 48 / 64 tuiles |
| Plan des époques (maquette) | 16 x 16 repos | corps par époque (`legpal.BLUM_BODY`) | enfant, primaire (bleu, sangles de sac), secondaire (cardigan rouge + pantalon gris, obligatoire), étudiant (hoodie vert, lunettes), adulte (veston marine, sans pousse) ; seul l'enfant est en production |
| PNJ | 16 x 16 x 4 (bas x2, haut, côté) + portrait | une palette par personnage | Madame Bélanger (chignon, lunettes, robe longue), Magdi (casquette), Nivoix (cheveux en pics, vert), Maxi (grosse tignasse), Paul (casquette à l'envers, taches), Marie-Claude (chignon serré, lunettes pointues, règle) : caricature par rôle et attitude seulement |
| Ennemis de carte | 16 x 16 x 2 | palette 3 de l'aire | Terreur des Crayons (jaune, mine rouge), Mouton de poussière (gris), Boulette de papier (blanc) ; objets 8 x 8 / 16 x 16 : billet, clochette, cartable, « ! », étoile de sauvegarde, flèche |
| Art de combat (BG) | 48 x 48, 48 x 56, 32 x 32, 32 x 32 | BG 3 = palette de l'ennemi | Terreur des Crayons furieux, Marie-Claude (contour marine `$01` pour que chignon et règle ressortent sur le noir), Mouton, Boulette ; 26 / 31 / 17 / 17 tuiles |
| Effets palier 1 | 16 x 16 x 2 | sprites 2-3 du combat (orange/jaune, blanc/cyan), 0 pour l'insecte | Coup de cartable, Étincelle, Vol de gomme, Projectile de papier, Insecte réanimé + coup reçu, bouclier (Défense), curseur |
| Tilesets | 16 x 16, 19 à 23 métatuiles | 3 palettes BG par aire (la 0 = UI) | appartement (murs crème, plancher brun, tapis rouge, cuisine blanche, petit tableau, horloge), anjou (gazon, érables 2x2, haie, trottoir, rue, bungalow de brique, garage, clôture blanche, boîte aux lettres **sans numéro**), chenier-ext (façade : piliers de brique brune, panneaux beiges, bandes de fenêtres, double porte ; cour : asphalte, lignes jaunes, marelle, panier, banc, grillage, mât sans drapeau), chenier-int (plancher carrelé, casiers, portes, pupitres, bureau, tableau vert 2 largeurs, affiche, fontaine, poubelle, crochets, escalier) |
| Fonds de combat | bande 256 x 48 (rangées 6-11) + ligne de sol (rangée 12) | BG 1-2 | classe (tableau vert, rangée de pupitres), cour (ciel, érables, grillage, asphalte), salon (papier peint, fenêtre, plantes) ; le champ sous la bande reste noir (style de l'époque), l'ennemi s'y tient |
| Écrans | 256 x 240 | propres | titre « THE LEGEND OF BLUM » : lettrage maison (BLUM en blocs 4x avec ombre et rehaut, THE LEGEND OF en police UI), ciel étoilé, lune, silhouette bungalow + école **sans enseigne**, menu COMMENCER / CONTINUER ; choix de classe : 5 fenêtres (nom, pouvoir palier 1, une ligne) |

Palettes (jamais `$0D`, ni `$xE/$xF`, ni `$20`) : couleur universelle `$0F`, BG 0 = UI `[$0F $02 $30 $27]` partout,
sprite 0 = tête de Blum, sprite 1 = corps de Blum (partagés par Nivoix et le cartable), sprites 2-3 à l'aire.
Détail dans `tools/legpal.py` et `manifest.json`.

## Musique (`music/`, index = contrat proposé `LEGEND_SOUND`)

| # | Id | Titre | Caractère |
|---|---|---|---|
| 0 | `title` | La légende | ré majeur, 100 BPM, thème héroïque lent, nappes, boucle 19 s |
| 1 | `anjou` | Rue d'Anjou | sol majeur, 126 BPM, marche sautillante vers l'école (carte CH00 + CH01), boucle 15 s |
| 2 | `battle` | Récré de combat | la mineur, 160 BPM, combat normal, boucle 11 s |
| 3 | `boss` | Dictée mortelle | ré mineur, 140 BPM, marche menaçante, boucle 13 s |
| 4 | `victory` | Victoire ! | fanfare 3 s, une fois |
| 5 | `awaits_a` | Adventure Awaits, version A | **chanson de Fred** arrangée pour la NES (BLUMS-M) : ré, intro mineure puis le refrain héroïque si b - do - ré, 4/4, 113 BPM ; écran titre + la rue ; boucle 51 s |
| 6 | `awaits_b` | Adventure Awaits, version B | **chanson de Fred** arrangée pour la NES (BLUMS-M) : fa, galop 12/8, 139 BPM (groove 9-9-8), passage mineur ; l'école Chénier ; boucle 66 s |

Les chansons 5 et 6 ne sont pas des compositions originales du kit : ce sont les deux chansons « Adventure Awaits »
que Fred a générées (son compte Suno, son prompt, gardé en tête de `music/tools/songs_awaits.py`), relevées
(Demucs + basic-pitch, puis à la main mesure par mesure) et arrangées pour 2 ondes carrées + triangle + bruit.
Les mp3 d'origine restent à la racine du dépôt d'assets (`Adventure Awaits.mp3` = A, `Adventure Awaits (1).mp3` = B),
non versionnés. Détails et preuves : rapport `runs/reports/BLUMS-M.md`.

Effets : 0 `menu`, 1 `text` (clic de la machine à écrire), 2 `hit`, 3 `item`, 4 `bell` (clochette = ITEM_CLOCHE,
sonnerie claire avec partiel aigu), 5 `cancel`, 6 `levelup`, 7 `door`. Banque SOUND : 4 661 / 8 192 octets
(vérifié par ld65). `check_pitch.py` prouve que les 7 chansons rendent les notes écrites (groove compris).

## Branchement dans le moteur (pour BLUMZ-M1 / M2)

Tout est dans `manifest.json` ; les fichiers `engine/` sont prêts à l'octet.

1. **Banque UI (R0)** : `engine/chr/ui.chr` tel quel. Tuile 0 vide, police `FONT_FIRST + index` dans
   `RPG_FONT_ORDER` (identique à `spike-art.ts`), cadre `tl tr bl br top bottom left right arrow` et tuiles
   communes (curseur, barre de PV, marqueurs) aux index de `gfx/ui/ui.json`. Palette BG 0 = UI.
2. **Aires (R1)** : `engine/chr/<aire>.chr` + `engine/metatiles/<aire>.bin` (format de RPG-PLAN 2.3) +
   `engine/palettes/<aire>.bin` (32 octets : 4 BG + 4 sprites). Les écrans du jeu s'écrivent avec les caractères
   de `gfx/tilesets/<aire>.json` (`chars` du manifest) ; `gfx/screens/sample-*.txt` sont des exemples.
3. **Sprites** : R2 `blum-enfant.chr` (métasprites, hotspot pieds ; gauche = côté avec attribut `$40` et x inversé
   par cellule ; cellules du haut palette 0, du bas palette 1), R3 `npcs-ch00.chr` à l'appartement, `npcs-ch01.chr`
   à Anjou / Chénier, R4 `enemies-map.chr` partout, R5 `fx.chr` en combat (et le curseur).
4. **Combat** : R1 = `battle-bg-<fond>.chr` (tuiles `$80-$BF`) + `enemy-<id>.chr` (tuiles `$C0-$FF`) ;
   nametable de base `engine/battle/bg-<fond>.bin` (bande + ligne de sol, attributs complets), puis l'ennemi
   (grille de `gfx/enemies/<id>.json`, + `$C0`, palette 3, pieds rangée 19), puis les fenêtres ; palette
   `engine/palettes/battle-<fond>-<ennemi>.bin`. Blum = sprite 16 x 24 à droite (200, 128). Appariements de la
   tranche : classe+crayon, classe+marie-claude, cour+boulette, salon+mouton.
5. **Écrans** : titre = R0 UI + R1 `title.chr`, `engine/screens/title.bin`, `engine/palettes/title.bin`
   (curseur rangée 24 / 26) ; choix de classe = `engine/screens/classes.bin` sur la banque UI seule, icônes = `fx`.
6. **Son** : `music/export/music.s` et `sfx.s` (mêmes étiquettes `music_data_blum_music`, `sounds`, aucun drapeau
   `FAMISTUDIO_USE_*`) ; `LEGEND_SOUND` = `{SONG_TITLE 5, SONG_LEGENDE 0, SONG_ANJOU 1, SONG_BATTLE 2, SONG_BOSS 3,
   SONG_VICTORY 4, SONG_AWAITS_A 5, SONG_AWAITS_B 6, SFX_MENU 0, SFX_TEXT 1, SFX_HIT 2, SFX_ITEM 3, SFX_BELL 4,
   SFX_CANCEL 5, SFX_LEVELUP 6, SFX_DOOR 7}` ; musique par aire (`areaMusic`, BLUMS-M) : titre et rue = `awaits_a`,
   toute l'école (cour et intérieur) = `awaits_b`, chez Madame Bélanger = `legende` (l'ancien thème titre) ;
   « Rue d'Anjou » (`anjou`) reste dans la banque, sans aire dans la tranche.
7. **Budget CHR de la tranche** : UI 2 + aires 8 + fonds 3 + ennemis 4 + Blum 1 + PNJ 2 + carte 1 + FX 1 +
   titre 2 = 24 Kio sur 128 (`budget.json`).

## Décisions prises ici (à confirmer par Fred ou M1)

- **Champ de combat noir sous la bande de décor** (comme les RPG NES de l'époque) : l'ennemi est en tuiles BG avec
  sa propre palette, un décor derrière lui exigerait une composition par blocs de 16 px ; la bande de 48 px en haut
  suffit à situer le lieu. Un motif de sol pourrait s'ajouter plus tard.
- **Marie-Claude en combat** : contour `$01` (marine) au lieu de noir, sinon chignon et règle disparaissent sur le
  champ noir ; sur la carte elle garde le contour noir comme tout le monde.
- **Nivoix** utilise la palette tête de Blum (chemise verte) et le **cartable** la palette corps (rouge) : trois
  PNJ et un objet tiennent dans les deux palettes libres de l'aire.
- **Titre** : « THE LEGEND OF » en police UI blanche au-dessus de « BLUM » en gros blocs orange / jaune (ombre dans
  le bleu du ciel) ; si Fred choisit « LA LÉGENDE DE BLUM » (RPG-PLAN 10.1), seule la ligne de texte change.
- Un 3e fond de combat « salon » a été ajouté pour le mini-combat du prologue (Mouton de poussière) ; 3 effets
  sonores de plus (cancel, levelup, door) pour atteindre les 8 que la tranche prévoit.

## Vérifications

`tools/validate.py` : fichiers générés à jour (build déterministe), couleurs permises, palette 0 = UI partout et
jamais sur la carte, PNG indexés NES, 3 couleurs + transparent par cellule de sprite dans sa palette, tailles et
capacités des banques, banque UI = police du spike (comparée à `font.ts` + `spike-art.ts` quand l'app est là),
tables de métatuiles cohérentes (tuiles existantes, palette 1-3, drapeaux), nametables (toutes les tuiles existent,
attributs, lignes de texte <= 28), 2 sprites par ligne par métasprite, et la vie privée : aucun code postal,
aucun numéro + rue, aucune URL ni lien de carte, aucune graphie refusée des noms, aucun emoji, aucune photo dans
`gfx/`, dossier de références ignoré par git. `music/tools/validate.py` : comme BLUM-A4 / SEBRING (sources à jour,
fonctions du pilote, export, budget ld65, WAV non muets, sans écrêtage) ; `check_pitch.py` : notes rendues = partition.
