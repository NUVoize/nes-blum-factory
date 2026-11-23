import { useEffect, useMemo, useRef, useState } from 'react';
import { LEVEL_ROWS } from '../../core/engine-data/contract';
import { NES_RGB } from '../../core/nes/palette';
import { validateLevel } from '../../core/nes/levels';
import type { Proposal } from '../../core/project/proposal';
import type { Level, Tileset } from '../../core/schema/engine-docs';
import type { Palettes } from '../../core/schema/misc';
import type { Physics } from '../../core/schema/physics';
import type { Story } from '../../core/schema/story';
import type { MessageKey } from '../../shared/i18n';
import { useApp } from '../app-context';
import { metatileCanvases, tilesetChr, builtinFrame, drawMetasprite, type Triple } from '../nes-draw';
import { play } from '../sounds';
import { Button, Frame, Radio, SliderPixel, Toggle } from '../ui';

// TABLEAU's grid editor (MILESTONES M4b): paint metatiles, see the tile behaviours, place enemies, the
// boss and the start, with the level validator live (size, spawn, enemies per screen, reachability
// warning). "Proposer" goes through propose_level, like the AI.

type Tool = 'paint' | 'entity' | 'spawn' | 'erase';
const CELL = 16;
const SCALE = 2;

/** Overlay colour per behaviour (CSS, drawn translucent over the tiles). */
const BEH_COLOR: Record<string, string> = {
  solid: '#f8f8f8',
  oneWay: '#58d8f8',
  ladder: '#f8b800',
  hazard: '#f83800',
  collectible: '#f878f8',
  checkpoint: '#58f898',
  exit: '#00e8d8',
};
const BEH_LETTER: Record<string, string> = { solid: '#', oneWay: '=', ladder: 'H', hazard: '^', collectible: '*', checkpoint: 'F', exit: 'E' };

export function LevelPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { t, pick, toast, project, info } = useApp();
  const docs = project?.docs ?? {};
  const story = docs['story.json'] as Story | undefined;
  const stageIds = story?.worlds.flatMap((w) => w.stages.map((s) => s.id)) ?? [];
  const [stage, setStage] = useState(stageIds[0] ?? 'niveau-1');
  const current = docs[`levels/${stage}.json`] as Level | undefined;
  const [draft, setDraft] = useState<Level | null>(current ? structuredClone(current) : null);
  useEffect(() => setDraft(current ? structuredClone(current) : null), [current]);

  const tilesetIds = Object.keys(docs)
    .filter((p) => /^tilesets\/[a-z0-9-]+\.json$/.test(p))
    .map((p) => p.slice(9, -5));
  const tileset = draft ? (docs[`tilesets/${draft.tileset}.json`] as Tileset | undefined) : undefined;
  const palettes = docs['graphics/palettes.json'] as Palettes | undefined;
  const set = palettes?.sets.find((s) => s.id === draft?.world) ?? palettes?.sets[0];
  const actors = Object.entries(docs)
    .filter(([p, v]) => /^actors\/[a-z0-9-]+\.json$/.test(p) && p !== 'actors/player.json' && (v as { kind?: string }).kind)
    .map(([p, v]) => ({ id: p.slice(7, -5), kind: (v as { kind: string }).kind, name: (v as { name: { fr: string } }).name.fr, graphics: (v as { graphics: string }).graphics }));

  const [tool, setTool] = useState<Tool>('paint');
  const [brush, setBrush] = useState<number>(1);
  const [actor, setActor] = useState(actors[0]?.id ?? '');
  const [overlay, setOverlay] = useState(true);
  const [tiles, setTiles] = useState<Map<number, HTMLCanvasElement> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef(false);

  // metatile graphics of the stage's tileset
  useEffect(() => {
    setTiles(null);
    if (!tileset) return;
    let live = true;
    void tilesetChr(tileset, (p) => window.blum.chroma.asset(p)).then((chr) => {
      if (live && chr) setTiles(metatileCanvases(tileset, chr, set));
    });
    return () => {
      live = false;
    };
  }, [tileset, set]);

  const sprites = useMemo(() => {
    const pals = (set?.sprites ?? [[0x0f, 0x16, 0x30]]) as readonly Triple[];
    const out = new Map<string, HTMLCanvasElement>();
    for (const a of actors) {
      const f = builtinFrame(a.graphics.startsWith('builtin:') ? a.graphics : a.kind === 'boss' ? 'builtin:boss' : 'builtin:walker');
      if (!f) continue;
      const c = document.createElement('canvas');
      c.width = f.w;
      c.height = f.h;
      drawMetasprite(c, f.entries, f.tile, pals);
      out.set(a.id, c);
    }
    return out;
    // actors is derived from docs, so docs is the dependency
  }, [docs, set]);

  const issues = useMemo(() => {
    if (!draft) return [];
    const physics = docs['physics.json'] as Physics | undefined;
    return validateLevel(draft, { tileset, physics, actorKind: (id) => (docs[`actors/${id}.json`] as { kind?: string } | undefined)?.kind, allowWide: !!info?.features.doors });
  }, [draft, tileset, docs, info]);

  // draw
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !draft || !tileset) return;
    c.width = draft.width * CELL;
    c.height = LEVEL_ROWS * CELL;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = set ? `rgb(${hexOf(set.backdrop)})` : '#000';
    g.fillRect(0, 0, c.width, c.height);
    const beh = new Map(tileset.metatiles.map((m) => [m.id, m.behaviour]));
    for (let r = 0; r < LEVEL_ROWS; r++) {
      for (let col = 0; col < draft.width; col++) {
        const id = draft.grid[r]![col]!;
        const img = tiles?.get(id);
        if (img) g.drawImage(img, col * CELL, r * CELL);
        const b = beh.get(id) ?? 'empty';
        if (overlay && BEH_COLOR[b]) {
          // outlined cell + letter with a dark shadow: readable on sky, grass and dirt alike
          g.globalAlpha = 0.22;
          g.fillStyle = BEH_COLOR[b]!;
          g.fillRect(col * CELL, r * CELL, CELL, CELL);
          g.globalAlpha = 0.9;
          g.strokeStyle = BEH_COLOR[b]!;
          g.lineWidth = 1;
          g.strokeRect(col * CELL + 1.5, r * CELL + 1.5, CELL - 3, CELL - 3);
          g.globalAlpha = 1;
          g.font = 'bold 9px monospace';
          g.fillStyle = '#101010';
          g.fillText(BEH_LETTER[b] ?? '', col * CELL + 5, r * CELL + 12);
          g.fillStyle = BEH_COLOR[b]!;
          g.fillText(BEH_LETTER[b] ?? '', col * CELL + 4, r * CELL + 11);
        }
      }
    }
    // screen limits every 16 columns
    g.fillStyle = 'rgba(248,248,248,0.5)';
    for (let s = 16; s < draft.width; s += 16) g.fillRect(s * CELL, 0, 1, c.height);
    for (const e of draft.entities) {
      const img = sprites.get(e.actor);
      if (img) g.drawImage(img, e.col * CELL + (CELL - img.width) / 2 + (img.width > 16 ? 8 : 0), (e.row + 1) * CELL - img.height);
      else (g.fillStyle = '#f83800'), g.fillRect(e.col * CELL + 4, e.row * CELL + 4, 8, 8);
    }
    // the start: a flag
    g.fillStyle = '#f8f8f8';
    g.fillRect(draft.spawn.col * CELL + 3, draft.spawn.row * CELL + 2, 2, 13);
    g.fillStyle = '#58f898';
    g.fillRect(draft.spawn.col * CELL + 5, draft.spawn.row * CELL + 2, 8, 6);
  }, [draft, tileset, tiles, overlay, sprites, set]);

  if (!draft || !tileset) {
    return (
      <Frame title={t('tableau.panel')} className="scroll span-2">
        <p className="muted">{t('tableau.noLevel')}</p>
      </Frame>
    );
  }

  const cellAt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * draft.width);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * LEVEL_ROWS);
    return col >= 0 && col < draft.width && row >= 0 && row < LEVEL_ROWS ? [col, row] : null;
  };
  const apply = (cell: [number, number], first: boolean) => {
    const [col, row] = cell;
    if (tool === 'paint' || tool === 'erase') {
      const id = tool === 'erase' ? tileset.empty : brush;
      if (draft.grid[row]![col] === id) return;
      const grid = draft.grid.map((r) => [...r]);
      grid[row]![col] = id;
      setDraft({ ...draft, grid });
    } else if (first && tool === 'spawn') {
      setDraft({ ...draft, spawn: { col, row } });
    } else if (first && tool === 'entity') {
      const hit = draft.entities.findIndex((x) => x.col === col && x.row === row);
      if (hit >= 0) setDraft({ ...draft, entities: draft.entities.filter((_, i) => i !== hit) });
      else if (actor) setDraft({ ...draft, entities: [...draft.entities, { actor, col, row, facing: 'left' }] });
    }
  };
  const resize = (w: number) => {
    const grid = draft.grid.map((r) => Array.from({ length: w }, (_, c) => r[c] ?? r[r.length - 1] ?? tileset.empty));
    setDraft({ ...draft, width: w, grid, entities: draft.entities.filter((e) => e.col < w), spawn: draft.spawn.col < w ? draft.spawn : { ...draft.spawn, col: 0 } });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  const errors = issues.filter((i) => i.severity === 'error');
  const propose = async () => {
    const r = await window.blum.directors.manual('level', 'propose_level', {
      id: draft.id,
      world: draft.world,
      tileset: draft.tileset,
      width: draft.width,
      grid: draft.grid,
      spawn: draft.spawn,
      entities: draft.entities,
      music: draft.music,
    });
    if (r.ok) (play('success'), onProposal(r.value), toast(t('editor.proposed'), 'success'));
    else (play('error'), toast(pick(r), 'danger'));
  };

  return (
    <>
      <Frame title={t('tableau.panel')} className="scroll" testid="level-panel">
        <div className="stack">
          <div className="row">
            <span className="label">{t('tableau.stage')}</span>
            {stageIds.map((id) => (
              <Radio key={id} on={stage === id} onSelect={() => setStage(id)} label={pick(story!.worlds.flatMap((w) => w.stages).find((s) => s.id === id)!.name)} />
            ))}
          </div>
          <div className="row">
            <span className="label">{t('tableau.tileset')}</span>
            {tilesetIds.map((id) => (
              <Radio key={id} on={draft.tileset === id} onSelect={() => setDraft({ ...draft, tileset: id })} label={id} />
            ))}
          </div>
          <div className="level-scroll" data-testid="level-grid">
            <canvas
              ref={canvasRef}
              className="pixel-canvas level-canvas"
              style={{ width: draft.width * CELL * SCALE, height: LEVEL_ROWS * CELL * SCALE }}
              onPointerDown={(e) => {
                const cell = cellAt(e);
                if (!cell) return;
                painting.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                apply(cell, true);
              }}
              onPointerMove={(e) => {
                if (!painting.current) return;
                const cell = cellAt(e);
                if (cell) apply(cell, false);
              }}
              onPointerUp={() => (painting.current = false)}
            />
          </div>
          <div className="row" role="radiogroup">
            {(['paint', 'erase', 'entity', 'spawn'] as Tool[]).map((x) => (
              <Radio key={x} on={tool === x} onSelect={() => setTool(x)} label={t(`tableau.tool.${x}` as MessageKey)} testid={`tool-${x}`} />
            ))}
            <Toggle on={overlay} onChange={setOverlay} label={t('tableau.overlay')} testid="overlay" />
          </div>
          {tool === 'paint' ? (
            <div className="mt-palette" data-testid="mt-palette">
              {tileset.metatiles.map((m) => (
                <button key={m.id} type="button" className={`mt-swatch ${brush === m.id ? 'on' : ''}`} onClick={() => (play('cursor'), setBrush(m.id))} title={`${m.name} (${t(`beh.${m.behaviour}` as MessageKey)})`}>
                  <MetatileThumb canvas={tiles?.get(m.id)} />
                  <span className="label">{m.name}</span>
                  <span className="dim">{t(`beh.${m.behaviour}` as MessageKey)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {tool === 'entity' ? (
            <div className="row">
              {actors.map((a) => (
                <Radio key={a.id} on={actor === a.id} onSelect={() => setActor(a.id)} label={`${a.name}${a.kind === 'boss' ? ' (boss)' : ''}`} />
              ))}
              <span className="muted small">{t('tableau.entityHint')}</span>
            </div>
          ) : null}
          <SliderPixel label={t('tableau.width')} value={draft.width} min={16} max={info?.features.doors ? 256 : 128} step={16} format={(v) => t('tableau.screens', { n: v / 16 })} onChange={resize} />
          <div className="row">
            <Button variant="primary" onClick={() => void propose()} disabled={!dirty || errors.length > 0} testid="level-propose">
              {t('editor.propose')}
            </Button>
            <Button onClick={() => setDraft(current ? structuredClone(current) : null)} disabled={!dirty} sound="back">
              {t('editor.reset')}
            </Button>
          </div>
        </div>
      </Frame>
      <Frame title={t('tableau.check')} className="scroll">
        <div className="stack" data-testid="level-issues">
          {issues.length === 0 ? <p className="ok-line">{t('tableau.allGood')}</p> : null}
          {issues.map((i, k) => (
            <p key={k} className={i.severity === 'error' ? 'err-line' : 'warn-line'}>
              {pick(i)}
            </p>
          ))}
          <dl className="kv stacked">
            <dt>{t('tableau.size')}</dt>
            <dd>{t('tableau.sizeValue', { cols: draft.width, n: draft.width / 16 })}</dd>
            <dt>{t('tableau.actors')}</dt>
            <dd>{draft.entities.length}</dd>
          </dl>
          <p className="muted small">{t('tableau.hint')}</p>
        </div>
      </Frame>
    </>
  );
}

const NES_RGB_CSS = NES_RGB.map(([r, g, b]) => `${r},${g},${b}`);
function hexOf(c: number): string {
  return NES_RGB_CSS[c & 0x3f]!;
}

function MetatileThumb({ canvas }: { canvas: HTMLCanvasElement | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 16, 16);
    if (canvas) g.drawImage(canvas, 0, 0);
  }, [canvas]);
  return <canvas ref={ref} width={16} height={16} className="pixel-canvas mt-thumb" />;
}
