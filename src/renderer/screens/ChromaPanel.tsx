import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { suggestNewPalettes } from '../../core/convert/fidelity';
import { renderTileSheet } from '../../core/convert/render';
import { decodeTile } from '../../core/nes/chr';
import { NES_PALETTE } from '../../core/nes/palette';
import type { Proposal } from '../../core/project/proposal';
import type { GraphicsDoc } from '../../core/schema/graphics';
import type { Palettes } from '../../core/schema/misc';
import type { Story } from '../../core/schema/story';
import type { ChromaPreviewView, ChromaRequest, ChromaSourceView } from '../../shared/api';
import type { MessageKey } from '../../shared/i18n';
import { useApp } from '../app-context';
import { play } from '../sounds';
import { BudgetMeter, Button, Frame, PaletteSwatch, Radio, SliderPixel, Toggle } from '../ui';
import exampleLandscape from '../chroma/exemple-paysage.png';
import exampleCharacter from '../chroma/exemple-personnage.png';

// CHROMA workbench (PLAN §6, MILESTONES M3): drop an image, pick what it becomes, see the NES result and
// its budget before anything is written; "Proposer" turns it into a normal proposal (approve = files).

type Target = 'player' | 'enemy' | 'boss' | 'common' | 'tileset' | 'screen';
const TARGETS: Target[] = ['player', 'enemy', 'boss', 'common', 'tileset', 'screen'];
const FRAMES: Array<[number, number]> = [
  [16, 16],
  [16, 24],
  [16, 32],
  [24, 32],
  [32, 32],
];

function kindOf(t: Target): Pick<ChromaRequest, 'kind' | 'role'> {
  if (t === 'tileset') return { kind: 'tileset', role: 'background' };
  if (t === 'screen') return { kind: 'screen', role: 'background' };
  return { kind: 'sprite', role: t };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'image';

/** Any image file -> PNG bytes, longest side ≤ 512 px (the converter downsizes anyway). */
async function toPngBytes(blob: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = scale < 1;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const png = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  return new Uint8Array(await png.arrayBuffer());
}

function useBlobUrl(bytes: Uint8Array | null): string | null {
  const url = useMemo(() => (bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })) : null), [bytes]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

/** RGBA -> canvas, nearest-neighbour scaled by CSS. */
function PixelCanvas({ rgba, width, height, scale = 2, onPick, testid }: { rgba: Uint8Array; width: number; height: number; scale?: number; onPick?: (x: number, y: number) => void; testid?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  }, [rgba, width, height]);
  return (
    <canvas
      ref={ref}
      className="pixel-canvas"
      style={{ width: width * scale, height: height * scale, cursor: onPick ? 'pointer' : undefined }}
      data-testid={testid}
      onClick={(e) => {
        if (!onPick) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPick(Math.floor(((e.clientX - r.left) / r.width) * width), Math.floor(((e.clientY - r.top) / r.height) * height));
      }}
    />
  );
}

/** Single-tile pixel editor (PLAN §12.1): 8×8, 4 values, saved through a proposal. */
function TileEditor({ pixels, colors, onSave, onClose }: { pixels: Uint8Array; colors: readonly number[]; onSave: (p: number[]) => void; onClose: () => void }) {
  const { t } = useApp();
  const [px, setPx] = useState<number[]>(() => Array.from(pixels));
  const [ink, setInk] = useState(1);
  const [down, setDown] = useState(false);
  useEffect(() => setPx(Array.from(pixels)), [pixels]);
  const paint = (i: number) => setPx((p) => (p[i] === ink ? p : p.map((v, k) => (k === i ? ink : v))));
  return (
    <div className="tile-editor stack" data-testid="tile-editor" onMouseLeave={() => setDown(false)} onMouseUp={() => setDown(false)}>
      <span className="label">{t('chroma.editTitle')}</span>
      <div className="tile-grid">
        {px.map((v, i) => (
          <span
            key={i}
            className="tile-px"
            style={v === 0 ? undefined : { background: NES_PALETTE[colors[v]!] }}
            onMouseDown={() => (setDown(true), paint(i))}
            onMouseEnter={() => down && paint(i)}
          />
        ))}
      </div>
      <div className="row">
        {[0, 1, 2, 3].map((v) => (
          <button key={v} type="button" className={`ink ${ink === v ? 'on' : ''}`} style={{ background: v === 0 ? undefined : NES_PALETTE[colors[v]!] }} onClick={() => (play('cursor'), setInk(v))} aria-label={t('chroma.ink', { n: v })} />
        ))}
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => onSave(px)} testid="tile-save">
          {t('chroma.editPropose')}
        </Button>
        <Button onClick={onClose} sound="back">
          {t('nav.cancel')}
        </Button>
      </div>
    </div>
  );
}

export function ChromaPanel({ onProposal }: { onProposal: (p: Proposal) => void }) {
  const { t, pick, project, info, toast } = useApp();
  const docs = project?.docs ?? {};
  const palettes = docs['graphics/palettes.json'] as Palettes | undefined;
  const worlds = useMemo(() => ((docs['story.json'] as Story | undefined)?.worlds ?? []).map((w) => w.id), [docs]);
  // BLUM-Q1: radios show the world's name (« Le Chantier »), not its id (« chantier »)
  const worldLabel = (id: string) => {
    const name = (docs['story.json'] as Story | undefined)?.worlds.find((w) => w.id === id)?.name;
    return name ? pick(name) : id;
  };
  const [sources, setSources] = useState<ChromaSourceView[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>('player');
  const [mode, setMode] = useState<'locked' | 'free'>('locked');
  const [world, setWorld] = useState<string>(worlds[0] ?? 'monde-1');
  const [frame, setFrame] = useState<[number, number]>([16, 24]);
  const [dither, setDither] = useState(true);
  const [strength, setStrength] = useState(50);
  const [smooth, setSmooth] = useState(false);
  const [use, setUse] = useState(false);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<ChromaPreviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [libChr, setLibChr] = useState<Uint8Array | null>(null);
  const [editTile, setEditTile] = useState<{ bank: number; tile: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // dropped images live in main: coming back to CHROMA shows the last one again
  useEffect(() => {
    void window.blum.chroma.sources().then((list) => {
      setSources(list);
      setSource((cur) => cur ?? list.at(-1)?.id ?? null);
    });
  }, []);

  const drop = useCallback(
    async (blob: Blob, fileName: string) => {
      try {
        const r = await window.blum.chroma.drop(await toPngBytes(blob), fileName);
        if (!r.ok) return toast(pick(r), 'danger');
        play('coin');
        setSources((s) => [...s.filter((x) => x.id !== r.value.id), r.value]);
        setSource(r.value.id);
        setName((n) => n || r.value.id.slice(0, 24));
      } catch {
        toast(t('chroma.badImage'), 'danger');
      }
    },
    [pick, t, toast],
  );

  const loadExample = async (which: 'landscape' | 'character') => {
    const blob = await (await fetch(which === 'landscape' ? exampleLandscape : exampleCharacter)).blob();
    if (which === 'landscape') (setTarget('screen'), setSmooth(true));
    else (setTarget('player'), setFrame([16, 24]));
    await drop(blob, which === 'landscape' ? 'exemple-paysage.png' : 'exemple-personnage.png');
  };

  const request = useMemo((): ChromaRequest | null => {
    if (!source) return null;
    const k = kindOf(target);
    const req: ChromaRequest = { source, ...k, mode, world, dither: dither ? 'bayer' : 'none', ditherStrength: strength, fit: target === 'screen' ? 'cover' : 'contain' };
    if (smooth) req.smooth = true;
    if (k.kind === 'sprite') req.frame = { w: frame[0], h: frame[1] };
    if (target === 'player' && use) req.use = 'player';
    if (target === 'tileset' && use) req.use = 'tileset';
    return req;
  }, [source, target, mode, world, dither, strength, smooth, frame, use]);

  // live preview (worker thread in main), debounced
  useEffect(() => {
    if (!request) return;
    let live = true;
    const h = setTimeout(() => {
      setBusy(true);
      void window.blum.chroma.preview(request).then((r) => {
        if (!live) return;
        setBusy(false);
        if (r.ok) setPreview(r.value);
        else toast(pick(r), 'danger');
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [request, pick, toast]);

  const propose = async () => {
    if (!request || !preview?.ok) return;
    const id = slug(name || source || 'image');
    const r = await window.blum.chroma.propose({ ...request, id, name: (name || id).slice(0, 32) });
    if (!r.ok) return (play('error'), toast(pick(r), 'danger'));
    play('success');
    onProposal(r.value);
    toast(t('chroma.proposed'), 'success');
  };

  const before = useBlobUrl(preview?.before ?? null);
  const after = useBlobUrl(preview?.after ?? null);
  const doc = preview?.doc ?? null;
  const set = palettes?.sets.find((s) => s.id === world) ?? palettes?.sets[0];
  const shownSet = mode === 'free' && preview?.proposedSet ? preview.proposedSet : set;
  const usedSlots = new Set(doc?.palettes.slots.map((s) => s.slot) ?? []);
  const sprite = doc?.kind === 'sprite';

  // graphics library (converted + placeholder art)
  const library = useMemo(
    () =>
      Object.entries(docs)
        .filter(([p, v]) => /^graphics\/[a-z0-9-]+\.json$/.test(p) && (v as { format?: string }).format === 'nbf-graphics')
        .map(([, v]) => v as GraphicsDoc),
    [docs],
  );
  const libDoc = library.find((g) => g.id === selected) ?? null;
  useEffect(() => {
    setEditTile(null);
    if (!libDoc) return setLibChr(null);
    void window.blum.chroma.asset(libDoc.chr).then((b) => setLibChr(b));
  }, [libDoc]);

  const sheetOf = (g: GraphicsDoc, chr: Uint8Array) => {
    const banks = g.budget.banks;
    const out: Array<{ bank: number; rgba: Uint8Array; rows: number; count: number; colors: number[] }> = [];
    for (const b of banks) {
      const slot = g.palettes.slots[0];
      const wset = palettes?.sets.find((s) => s.id === g.palettes.world) ?? set;
      const cols = g.kind === 'sprite' ? (g.palettes.mode === 'locked' && slot ? wset?.sprites[slot.slot] : slot?.colors) : (g.palettes.mode === 'locked' ? wset?.bg[1] : g.palettes.slots[1]?.colors);
      const colors = [g.kind === 'sprite' ? 0x0f : (g.palettes.backdrop ?? 0x0f), ...(cols ?? [0x00, 0x10, 0x30])];
      const offset = g.kind === 'sprite' ? b.index * 1024 : 0;
      const count = Math.max(1, b.tiles);
      out.push({ bank: b.index, rgba: renderTileSheet(chr, offset, count, colors).data, rows: Math.ceil(count / 16), count, colors });
    }
    return out;
  };

  const previewSheets = doc && preview?.chr ? sheetOf(doc, preview.chr) : [];
  const libSheets = libDoc && libChr ? sheetOf(libDoc, libChr) : [];
  const budget = doc?.budget;
  const warnings = [...(preview?.errors ?? []), ...(budget?.warnings ?? [])];
  const targetLabel = (x: Target) => t(`chroma.target.${x}` as MessageKey);

  const saveTile = async (pixels: number[]) => {
    if (!libDoc || !editTile) return;
    const r = await window.blum.chroma.editTile({ graphic: libDoc.id, bank: editTile.bank, tile: editTile.tile, pixels });
    if (!r.ok) return (play('error'), toast(pick(r), 'danger'));
    play('success');
    onProposal(r.value);
    setEditTile(null);
    toast(t('chroma.proposed'), 'success');
  };

  return (
    <>
      <Frame title={t('chroma.workbench')} className="scroll" testid="chroma-workbench">
        <div className="stack">
          <div
            className={`dropzone ${over ? 'over' : ''}`}
            data-testid="chroma-drop"
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) void drop(f, f.name);
            }}
          >
            <span>{t('chroma.dropHint')}</span>
            <div className="row">
              <Button icon="image" onClick={() => fileRef.current?.click()} testid="chroma-pick">
                {t('chroma.pick')}
              </Button>
              <Button onClick={() => void loadExample('character')} testid="chroma-example-character">
                {t('chroma.exampleCharacter')}
              </Button>
              <Button onClick={() => void loadExample('landscape')} testid="chroma-example">
                {t('chroma.exampleLandscape')}
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void drop(f, f.name);
                e.target.value = '';
              }}
            />
          </div>
          {sources.length ? (
            <div className="row" role="radiogroup">
              <span className="label">{t('chroma.sources')}</span>
              {sources.map((s) => (
                <Radio key={s.id} on={s.id === source} onSelect={() => setSource(s.id)} label={`${s.id} ${s.width}x${s.height}`} />
              ))}
            </div>
          ) : null}

          <div className="row" role="radiogroup">
            <span className="label">{t('chroma.becomes')}</span>
            {TARGETS.map((x) => (
              <Radio key={x} on={target === x} onSelect={() => setTarget(x)} label={targetLabel(x)} testid={`chroma-target-${x}`} />
            ))}
          </div>
          <div className="row" role="radiogroup">
            <span className="label">{t('chroma.palettes')}</span>
            <Radio on={mode === 'locked'} onSelect={() => setMode('locked')} label={t('chroma.locked')} testid="chroma-locked" />
            <Radio on={mode === 'free'} onSelect={() => setMode('free')} label={t('chroma.free')} testid="chroma-free" />
          </div>
          {worlds.length > 1 ? (
            <div className="row" role="radiogroup">
              <span className="label">{t('chroma.world')}</span>
              {worlds.map((w) => (
                <Radio key={w} on={world === w} onSelect={() => setWorld(w)} label={worldLabel(w)} />
              ))}
            </div>
          ) : null}
          {kindOf(target).kind === 'sprite' ? (
            <div className="row" role="radiogroup">
              <span className="label">{t('chroma.frame')}</span>
              {FRAMES.filter(([w]) => target === 'boss' || w <= 24).map(([w, h]) => (
                <Radio key={`${w}x${h}`} on={frame[0] === w && frame[1] === h} onSelect={() => setFrame([w, h])} label={`${w}x${h}`} />
              ))}
            </div>
          ) : null}
          <div className="row">
            <Toggle on={dither} onChange={setDither} label={t('chroma.dither')} testid="chroma-dither" />
            {dither ? <SliderPixel value={strength} min={0} max={100} step={10} label={t('chroma.strength')} onChange={setStrength} /> : null}
            <Toggle on={smooth} onChange={setSmooth} label={t('chroma.smooth')} />
            {target === 'player' || target === 'tileset' ? <Toggle on={use} onChange={setUse} label={t(target === 'player' ? 'chroma.useHero' : 'chroma.useTileset')} testid="chroma-use" /> : null}
          </div>

          {preview ? (
            <div className="before-after" data-testid="chroma-preview">
              <figure>
                <figcaption className="label">{t('chroma.before')}</figcaption>
                {before ? <img src={before} className="pixel-img" alt={t('chroma.before')} data-testid="chroma-before" /> : null}
              </figure>
              <figure>
                <figcaption className="label">
                  {t('chroma.after')} {busy ? t('chroma.working') : t('chroma.ms', { n: preview.ms })}
                </figcaption>
                {after ? <img src={after} className="pixel-img" alt={t('chroma.after')} data-testid="chroma-after" /> : <p className="gold">{pick(preview.errors[0] ?? { fr: '', en: '' })}</p>}
              </figure>
            </div>
          ) : (
            <p className="muted" data-testid="chroma-empty">{t('chroma.empty')}</p>
          )}
          {preview && mode === 'locked' && suggestNewPalettes(preview) ? (
            <div className="row" data-testid="chroma-colour-hint">
              <p className="gold">{t('chroma.colourHint', { n: Math.round(preview.colourMiss * 100) })}</p>
              <Button onClick={() => setMode('free')} testid="chroma-colour-hint-free">
                {t('chroma.colourHintTry')}
              </Button>
            </div>
          ) : null}

          {doc && sprite ? (
            <div className="stack" data-testid="chroma-frames">
              <span className="label">{t('chroma.frames', { n: doc.frames!.length })}</span>
              <div className="row">
                {doc.frames!.map((f) => (
                  <span key={f.name} className={`badge ${f.maxPerLine > 8 ? 'danger' : 'muted'}`}>
                    {t('chroma.frameInfo', { name: f.name, bank: f.bank, n: f.sprites.length, line: f.maxPerLine })}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {previewSheets.length ? (
            <div className="stack" data-testid="chroma-tiles">
              <span className="label">{t('chroma.tiles')}</span>
              <div className="row">
                {previewSheets.map((s) => (
                  <figure key={s.bank} className="sheet">
                    {previewSheets.length > 1 ? <figcaption className="label">{t('chroma.bank', { n: s.bank })}</figcaption> : null}
                    <PixelCanvas rgba={s.rgba} width={128} height={s.rows * 8} />
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          <div className="row">
            <label className="stack name-field">
              <span className="label">{t('chroma.name')}</span>
              <input className="field" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} data-testid="chroma-name" />
            </label>
            <Button variant="primary" onClick={() => void propose()} disabled={!preview?.ok || busy || project?.readOnly} testid="chroma-propose">
              {t('chroma.propose')}
            </Button>
          </div>

          <span className="label">{t('chroma.library', { n: library.length })}</span>
          <div className="library" data-testid="chroma-library">
            {library.map((g) => (
              <LibraryItem key={g.id} doc={g} on={selected === g.id} onClick={() => setSelected(selected === g.id ? null : g.id)} />
            ))}
          </div>
          {libDoc && libSheets.length ? (
            <div className="row lib-detail">
              {libSheets.map((s) => (
                <figure key={s.bank} className="sheet">
                  <figcaption className="label">{t('chroma.bank', { n: s.bank })}</figcaption>
                  <PixelCanvas
                    rgba={s.rgba}
                    width={128}
                    height={s.rows * 8}
                    onPick={(x, y) => {
                      const tile = Math.floor(y / 8) * 16 + Math.floor(x / 8);
                      if (tile < s.count) setEditTile({ bank: s.bank, tile });
                    }}
                    testid={`lib-sheet-${s.bank}`}
                  />
                </figure>
              ))}
              {editTile && libChr ? (
                <TileEditor
                  pixels={decodeTile(libChr, (libDoc.kind === 'sprite' ? editTile.bank * 1024 : 0) + editTile.tile * 16)}
                  colors={libSheets.find((s) => s.bank === editTile.bank)!.colors}
                  onSave={(p) => void saveTile(p)}
                  onClose={() => setEditTile(null)}
                />
              ) : (
                <p className="muted">{t('chroma.editHint')}</p>
              )}
            </div>
          ) : null}
        </div>
      </Frame>

      <Frame title={t('chroma.budget')} className="scroll" testid="chroma-budget">
        <div className="stack">
          {shownSet ? (
            <div className="stack" data-testid="chroma-palettes">
              <span className="label">{t('doc.bg')}</span>
              {shownSet.bg.map((sp, i) => (
                <div key={`bg${i}`} className={`row pal-row ${!sprite && usedSlots.has(i) ? 'used' : ''}`}>
                  <span className="pal-n">{i}</span>
                  <PaletteSwatch index={shownSet.backdrop} />
                  {sp.map((c, j) => (
                    <PaletteSwatch key={j} index={c} />
                  ))}
                </div>
              ))}
              <span className="label">{t('doc.sprites')}</span>
              {shownSet.sprites.map((sp, i) => (
                <div key={`sp${i}`} className={`row pal-row ${sprite && usedSlots.has(i) ? 'used' : ''}`}>
                  <span className="pal-n">{i}</span>
                  {sp.map((c, j) => (
                    <PaletteSwatch key={j} index={c} />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {budget ? (
            <>
              <BudgetMeter label={t(sprite ? 'budget.spritePalettes' : 'budget.bgPalettes')} used={budget.subpalettes} max={4} cells={4} testid="meter-palettes" />
              {sprite ? (
                budget.banks.map((b) => <BudgetMeter key={b.index} label={t('chroma.bankTiles', { n: b.index })} used={b.tiles} max={64} cells={16} />)
              ) : (
                <BudgetMeter label={t('budget.bgTiles')} used={budget.tiles} max={256} cells={16} testid="meter-tiles" />
              )}
              {budget.metatiles !== undefined ? <BudgetMeter label={t('chroma.metatiles')} used={budget.metatiles} max={128} cells={16} /> : null}
              {sprite ? <BudgetMeter label={t('chroma.perLine')} used={budget.maxPerLine} max={8} cells={8} /> : null}
              <p className="muted small">{t('chroma.colors', { n: budget.colors, merged: budget.merged })}</p>
            </>
          ) : null}
          {warnings.map((w, i) => (
            <p key={i} className="warn-line">
              {pick(w)}
            </p>
          ))}
          {info?.provider === 'offline' ? null : <p className="muted small">{t('chroma.askHint')}</p>}
        </div>
      </Frame>
    </>
  );
}

function LibraryItem({ doc, on, onClick }: { doc: GraphicsDoc; on: boolean; onClick: () => void }) {
  const { t } = useApp();
  const [png, setPng] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (doc.preview) void window.blum.chroma.asset(doc.preview).then(setPng);
  }, [doc.preview]);
  const url = useBlobUrl(png);
  return (
    <button type="button" className={`lib-item ${on ? 'on' : ''}`} onClick={() => (play('cursor'), onClick())} title={doc.name}>
      {url ? <img src={url} className="pixel-img" alt={doc.name} /> : null}
      <span className="label">{doc.name}</span>
      <span className="dim small">{t(`chroma.target.${doc.kind === 'sprite' ? doc.role : doc.kind}` as MessageKey)}</span>
    </button>
  );
}
