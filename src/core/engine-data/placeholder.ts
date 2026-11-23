// The placeholder art set every new project starts with (PLAN §6 "the app ships an original placeholder
// set", MILESTONES M3): hero (3 CHR banks), items, 4 world tilesets, 4 enemy sheets, 5 bosses ≤ 32 px
// wide, from the BLUMA sample game. The hero is wired in (actors/player.json); the rest waits in the
// graphics library for TABLEAU (levels) and the sample game (M6). HUD/font is the engine's own bank.
import { renderGraphics } from '../convert/render.js';
import type { Tileset } from '../schema/engine-docs.js';
import type { PlayerActor } from '../schema/graphics.js';
import type { Json } from '../util/json-pointer.js';
import { encodePng } from '../util/png.js';
import { PLACEHOLDER_ART } from './art/placeholder-art.js';
import { BEHAVIOUR, type BehaviourName } from './contract.js';

const BEHAVIOUR_NAME = Object.fromEntries(Object.entries(BEHAVIOUR).map(([k, v]) => [v, k])) as Record<number, BehaviourName>;

export const PLACEHOLDER_HERO = 'graphics/heros-blum.json';

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function placeholderProject(): { docs: Record<string, Json>; assets: Record<string, Uint8Array> } {
  const docs: Record<string, Json> = {};
  const assets: Record<string, Uint8Array> = {};
  for (const art of PLACEHOLDER_ART) {
    const doc = structuredClone(art.doc);
    const chr = fromBase64(art.chr);
    docs[`graphics/${doc.id}.json`] = doc as unknown as Json;
    assets[doc.chr] = chr;
    const img = renderGraphics(doc, chr, null);
    assets[doc.preview!] = encodePng(img.data, img.width, img.height);
    if (art.behaviours && doc.metatiles) {
      const tileset: Tileset = {
        schemaVersion: 1,
        id: doc.id,
        chr: doc.chr,
        empty: 0,
        metatiles: doc.metatiles.map((m) => {
          const [name, b] = art.behaviours![String(m.id)] ?? ['bloc', 1];
          return { id: m.id, name: name.slice(0, 24), tiles: m.tiles, palette: m.palette, behaviour: BEHAVIOUR_NAME[b] ?? 'solid' };
        }),
      };
      docs[`tilesets/${doc.id}.json`] = tileset as unknown as Json;
    }
  }
  const hero: PlayerActor = { schemaVersion: 1, kind: 'player', name: { fr: 'Blum', en: 'Blum' }, graphics: PLACEHOLDER_HERO };
  docs['actors/player.json'] = hero as unknown as Json;
  return { docs, assets };
}
