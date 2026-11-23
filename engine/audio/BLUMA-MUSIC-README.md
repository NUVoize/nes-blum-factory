# BLUM — bande sonore et effets (BLUM-A4)

Musique et effets originaux pour le jeu exemple « BLUM », composés pour le vrai APU de la NES (2 ondes carrées,
triangle, bruit ; pas de DPCM) et livrés dans le format que la chaîne son de l'app consomme (M2, `scripts/music/export.mjs`).
Tout est écrit pour ce projet : aucune mélodie d'un jeu ou d'une chanson existante, y compris le thème de fin
(ce n'est pas « Bonne fête à toi »). Droits : Fred (NUVoize) 2026, offert à Blum.

> English: original NES chiptune soundtrack (11 songs) + 10 SFX for BLUM, as FamiStudio text projects, exported
> to FamiStudio-sound-engine ca65 data, with WAV previews rendered by FamiStudio. See "Import" below.

## Contenu

| Dossier / fichier | Quoi | Généré ? |
|---|---|---|
| `tools/songs.py`, `tools/sfx.py` | **la partition** : chaque chanson et chaque effet, en notation compacte | non (source) |
| `tools/famitxt.py` | notation compacte → projet texte FamiStudio | non |
| `tools/compose.py` | écrit `src/music.txt`, `src/sfx.txt`, `index.json` | non |
| `tools/export.py` | FamiStudio CLI → `export/music.s`, `export/sfx.s` (ca65) + `preview/*.wav` | non |
| `tools/validate.py` | vérifie tout (voir « Validation ») et écrit `BUDGET.md` / `budget.json` | non |
| `tools/check_pitch.py` | preuve par le son : rend la voix principale seule et compare les notes à la partition | non |
| `tools/build_all.py` | compose → export → validate | non |
| `src/music.txt` | projet FamiStudio « BLUM music », 11 chansons (format texte 4.5.3) | oui |
| `src/sfx.txt` | projet FamiStudio « BLUM sfx », 10 effets (un « morceau » chacun) | oui |
| `export/music.s`, `export/sfx.s` | données du FamiStudio sound engine pour ca65, prêtes pour la banque SOUND | oui |
| `preview/song-NN-id.wav`, `preview/sfx-NN-id.wav` | aperçus 44,1 kHz mono 16 bits rendus par FamiStudio (moteur APU exact) | oui |
| `index.json` | ordre des chansons/effets (le contrat d'index), durées, suggestion par monde | oui |
| `BUDGET.md`, `budget.json` | octets par chanson / effet contre la banque SOUND de 8 Kio | oui |

## Les chansons (index = ordre dans `music.s`)

| # | Id | Titre | Où | Caractère |
|---|---|---|---|---|
| 0 | `title` | Bourgeon | écran titre | sol majeur, 6/8 léger, un matin de printemps ; boucle 21,6 s |
| 1 | `stage` | Ça pousse | monde 1, Le Potager | do majeur, sautillant, accords en arpège sur la 2e onde ; 14,9 s |
| 2 | `cabane` | La gigue de la cabane | monde 2, La Cabane à sucre | ré majeur, gigue 6/8, violon (vibrato d'enveloppe), podorythmie au bruit ; 16 s |
| 3 | `chantier` | Marteau-piqueur | monde 3, Le Chantier | mi mineur, riff triangle + onde, rafales de marteau-piqueur en bruit périodique ; 12,8 s |
| 4 | `tempete` | Le Verglas | monde 4, La Tempête | la mineur, lent, mélodie clairsemée avec écho, vent au bruit ; 21,3 s |
| 5 | `boss` | Frette ! | boss (mondes 1-3) | mi mineur, rapide, chromatique, accords diminués ; 10,6 s |
| 6 | `final` | Le Frigo | Le Gros Frette (4-F) + boss du monde 4 | do mineur, lourd et large ; 12,8 s |
| 7 | `clear` | Stage terminé | fin de stage | fanfare en do, une fois (3,2 s), s'arrête seule |
| 8 | `gameover` | Oups | game over | la mineur, petit soupir comique, une fois (4,3 s) |
| 9 | `ending` | Bonne fête Blum | écran de fin | fa majeur, 16 mesures A+B, chanson d'anniversaire **originale** ; 34,1 s |
| 10 | `pressstart` | Appuie sur START | au START du titre | sting de 0,8 s, une fois |

`title` reste à l'index 0 et `stage` à l'index 1 : les ids de M2 (`SONG_TITLE`, `"music": "stage"` dans les cartes) restent valides.
Suggestion par monde (`index.json` → `worlds`) : monde 1 `stage`, 2 `cabane`, 3 `chantier`, 4 `tempete` ; boss `boss`, monde 4 et 4-F `final`.

## Les effets (index = ordre dans `sfx.s`)

| # | Id | Effet | Canaux | Images |
|---|---|---|---|---|
| 0 | `jump` | saut (balayage montant) | onde 1 | 14 |
| 1 | `pickup` | graine / fleur ramassée | onde 2 | 16 |
| 2 | `land` | atterrissage | bruit + triangle | 6 |
| 3 | `stomp` | ennemi écrasé | onde 1 + bruit | 16 |
| 4 | `hurt` | Blum touché | onde 2 + bruit périodique | 24 |
| 5 | `oneup` | vie en plus | onde 2 | 32 |
| 6 | `door` | porte / tuyau (glissando triangle + souffle) | triangle + bruit | 16 |
| 7 | `wallgrab` | mur agrippé | bruit + onde 1 | 6 |
| 8 | `bosshit` | boss touché (grognement + boum) | onde 1 + bruit | 20 |
| 9 | `pause` | pause (deux bips) | onde 2 | 20 |

`jump` reste 0 et `pickup` 1 (ids de M2). Le pilote n'a **qu'un flux d'effets** : un nouvel effet remplace celui qui joue,
et un effet ne couvre la musique sur un canal que tant que son volume est plus fort (`famistudio_ca65.s`, mixage sfx).

## Import dans l'app (chaîne principale, M-étapes)

1. Copier `src/music.txt` → `engine/audio/src/music.txt` et `src/sfx.txt` → `engine/audio/src/sfx.txt`
   (ou remplacer `scripts/music/compose.mjs` par ces fichiers : ils sont déjà au format que `music:export` lit).
2. Soit lancer `npm run music:export` (FamiStudio CLI, même résultat), soit copier directement
   `export/music.s` → `engine/audio/music.s` et `export/sfx.s` → `engine/audio/sfx.s`. Les étiquettes attendues par
   `crt0.s` (`music_data_blum_music`, `sounds`) sont celles-ci.
3. Dans `src/core/engine-data/emit.ts`, étendre les listes dans **cet ordre** (voir `index.json`) :
   `SONG_LIBRARY = ['title','stage','cabane','chantier','tempete','boss','final','clear','gameover','ending','pressstart']`
   et `SFX_LIBRARY = ['jump','pickup','land','stomp','hurt','oneup','door','wallgrab','bosshit','pause']`.
4. `audio/library.json` par défaut : voir `index.json` → `worlds` et `jingles`.
5. Attribution : « Musique et effets : BLUM-A4 (muse-ui), dépôt NES-BLUM-FACTORY-ASSETS, commit … » dans `ASSETS.md`.

Aucun drapeau `FAMISTUDIO_USE_*` n'est requis (le commentaire « Required flags » de `music.s` est vide) : la build du
pilote dans `crt0.s` (NTSC, 1 flux SFX, DPCM désactivé, aucun USE_) joue tout tel quel. Le validateur relit `crt0.s`
quand le dépôt de l'app est présent.

## Budget

Tout tient dans la banque SOUND unique de **8 192 octets** (PLAN §5.3, ADR-8) : voir `BUDGET.md` (chiffres exacts par
chanson, par effet, partagés, et la vérification par `ld65`). Il reste plus de 3,8 Kio pour des ajouts.

## Validation (`py -3.12 tools/validate.py`, exit 1 si un point échoue)

1. `src/*.txt` et `index.json` sont exactement ce que `tools/compose.py` produit (rien de périmé).
2. Seulement ce que la build du pilote sait jouer : tempo FamiStudio, canaux 2A03, pas de DPCM, enveloppes d'instrument
   (Volume, DutyCycle, Pitch, Arpeggio) seulement, pas de pistes d'effets, pas de « release ».
3. `export/*.s` existent, viennent des sources courantes (noms et ordre), ne demandent aucun `FAMISTUDIO_USE_*` que
   `crt0.s` n'active pas, ne contiennent ni échantillon ni chemin local.
4. Budget : octets par chanson / effet / partagés comptés dans le ca65, total ≤ 8 192, et le total **assemblé et lié
   avec le ca65/ld65 épinglé de l'app** est identique au compte.
5. Un aperçu WAV par chanson et par effet, de la bonne durée, non muet, sans écrêtage ; les morceaux « une fois »
   s'arrêtent à leur fin (l'opcode de fin de morceau est bien exporté).

`tools/check_pitch.py` rend en plus la voix principale seule de chaque chanson et compare les premières notes
rendues à la partition (preuve que ce qui sort du moteur est bien ce qui est écrit).

## Reconstruire

```
py -3.12 tools/build_all.py            # compose + export (FamiStudio CLI) + validate --write-budget
py -3.12 tools/compose.py              # seulement les textes FamiStudio
py -3.12 tools/export.py [--no-wav]    # seulement l'export ca65 (+ WAV)
py -3.12 tools/validate.py [--write-budget]
```

Outils requis pour `export` (non livrés, mêmes variables que l'app) : FamiStudio 4.5.x (MIT) dans `NBF_FAMISTUDIO`
(défaut : `NES-BLUM-FACTORY\.tmp\dl\famistudio`) et un runtime .NET 8 dans `NBF_DOTNET_ROOT`
(défaut : `NES-BLUM-FACTORY\.tmp\dl\dotnet`). La CLI tourne sans fenêtre et se termine seule.

## Conventions mesurées (à savoir avant de composer)

- **Octaves.** Dans un fichier texte FamiStudio, « A4 » rend 880 Hz : les noms sont une octave au-dessus de la
  notation scientifique. La partition (`songs.py`, `sfx.py`) est écrite en notation scientifique et chaque morceau porte
  `transpose = -12`, appliqué aux ondes et au triangle à l'export ; le bruit n'est jamais transposé. `check_pitch.py`
  vérifie que le rendu est bien à la hauteur écrite.
- **Triangle.** Sonne une octave sous sa hauteur écrite : une basse écrite `C3` sonne à 65 Hz.
- **Bruit.** Le pilote prend les 4 bits bas de la note comme index de période. Mesuré au rendu : `C4` = grondement le plus
  grave (caisse claire grave / kick), la hauteur monte jusqu'à `C5` = souffle le plus clair (hi-hat) ; `D#5` retombe sur
  une période aliasée, à éviter. Instruments : Kick sur `C4`, Snare sur `A4`, Hat sur `C5`, vent sur `G4`.
  `DutyCycle = 1` sur le bruit = bruit périodique (bourdonnant), utilisé pour le marteau-piqueur et `hurt`.
- **Enveloppe de pitch.** Valeurs négatives (relatives) = la hauteur **monte** (`jump`), positives = elle descend (`bosshit`).
- **Accords.** Une seule note avec une enveloppe d'arpège en boucle (`0,4,7` / `0,3,7` / `0,3,6`) joue un accord
  entier sur une seule onde : c'est ce que font `ChordMaj`, `ChordMin`, `ChordDim` (très économe en octets).

## Notation compacte (`famitxt.py`)

Un jeton par pas : `C5` commence une note (dièses seulement), `C5:Inst` change d'instrument pour cette note,
`-` tient, `.` coupe, `|` est ignoré. Un morceau = `note_len` (images par pas), `pattern_len` (pas par motif),
`order` (motifs dans l'ordre), `loop` (motif de reprise, `None` = une fois), et par canal un instrument par défaut,
ses motifs et, au besoin, son propre `order` (pour réutiliser des motifs : chaque motif réutilisé ne coûte presque rien).

## Licences

- Le pilote (FamiStudio sound engine, MIT, déjà dans l'app) et la CLI FamiStudio (MIT) ne sont pas copiés ici ;
  seuls nos fichiers texte et leurs exports le sont.
- Partition, exports et WAV : œuvre originale, Fred (NUVoize) 2026, offerte à Blum. Même attribution que `ASSETS.md` de l'app.
