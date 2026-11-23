# NES BLUM FACTORY

*(English below)*

## En français

Un studio pour créer de **vrais jeux NES**, en jasant avec cinq directeurs :

- **PLUME** écrit l'histoire ;
- **CHROMA** transforme tes images en vrais graphismes NES ;
- **REBOND** règle les sauts et les ennemis ;
- **TABLEAU** dessine les niveaux ;
- **BOULON** fabrique la ROM.

Ils proposent, tu approuves. À la fin, tu obtiens un fichier `.nes` prêt à flasher sur une cartouche (MMC3, mapper 4, avec 8 Ko de PRG-RAM obligatoires), avec sa fiche technique.

Un cadeau de Fred pour Blum. Le « NES » du titre est un jeu de mots (BLUM = *bloom*). Ce projet n'a aucun lien avec Nintendo.

### État

**Version 1.0.0 (M6).** Tout le studio : les cinq directeurs avec leurs éditeurs, la ROM construite avec cc65 et testée, l'émulateur intégré, l'export (`.nes`, `-PRG.bin`, `-CHR.bin`, fiche cartouche), « Ta première cartouche » (cinq étapes, sans clé ni Internet), l'aide (graver une cartouche, « Débloquer » le zip, SmartScreen, Mesen) et le **jeu d'exemple BLUM** (4 mondes, 9 niveaux, 5 boss, 11 musiques), fait dans l'app proposition par proposition. Le plan est dans `docs/PLAN.md`, les étapes dans `docs/MILESTONES.md`, le suivi dans `RUNNER-BLUM.md`, le guide pour Blum dans `docs/GUIDE-BLUM.html`.

### Pour les développeurs

Il faut Node 24 et npm (Windows). Tout se fait depuis la racine du dépôt.

| Commande | Effet |
|---|---|
| `npm install` | installe les dépendances |
| `npm run build` | vérification TypeScript, puis compilation de l'interface |
| `npm test` | tests unitaires (vitest) |
| `npm run typecheck` | vérification TypeScript seule |
| `npm run smoke` | ouvre l'app dans une fenêtre cachée, parcourt tous les écrans (`--locale=` fr, en ou both ; `--routes=` liste), une capture par écran dans `.tmp/smoke/`, puis vérifie qu'aucun processus ne reste |
| `npm start` | compile et ouvre l'app |
| `npm run dev:renderer` | serveur Vite de l'interface seule, port 5181 |
| `npm run fetch:toolchain` | télécharge cc65 (vérifié par SHA-256) dans `resources/toolchain` |
| `npm run test:engine` | tests des ROM : vraies constructions cc65 + émulateur sans fenêtre |
| `npm run package` | fabrique `release\NES-BLUM-FACTORY-<version>-win-x64.zip` (dossier portable, sans installateur) |
| `npm run test:package` | extrait ce zip dans un dossier avec espaces et accents, vérifie son contenu et lance l'exe en mode essai |
| `npm run sample` | refait le jeu d'exemple BLUM (`resources/samples/BLUM.blum`) en rejouant ses propositions |
| `npm run test:mesen` | rejoue les ROM dans Mesen (outil de développement, jamais livré) |

Règles du dépôt :
- **Dépôt local seulement**, jamais poussé.
- Aucun emoji ni pictogramme dans l'interface.
- Aucun élément Nintendo.
- Chaque composant tiers est inscrit dans `THIRD_PARTY.md`, chaque image ou son dans `ASSETS.md`.

---

## English

A studio to make **real NES games** by chatting with five directors: story (PLUME), graphics (CHROMA), movement (REBOND), levels (TABLEAU) and build (BOULON). They propose, you approve. The output is a `.nes` ROM ready to flash on an MMC3 (mapper 4) cartridge, plus a cartridge sheet.

A gift from Fred to Blum. "NES" in the title is a pun (BLUM = bloom). This project is not affiliated with Nintendo.

**Version 1.0.0 (M6):** the full studio (5 directors and their editors, cc65 builds with headless checks, in-app emulator, export with cartridge sheet), the offline 5-step tour « Ta première cartouche », Help, and the sample game BLUM (4 worlds, 9 stages, 5 bosses, 11 songs) made in the app as a replay of hand-authored proposals. See `docs/PLAN.md`, `docs/MILESTONES.md`, `docs/TEST-STRATEGY.md`, `THIRD_PARTY.md` and `RUNNER-BLUM.md`.

Commands: `npm install`, `npm run build`, `npm test`, `npm run smoke`, `npm start`.
