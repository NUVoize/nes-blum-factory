import * as jsnes from 'jsnes';
import { useEffect, useRef, useState } from 'react';
import { NesSession, type ButtonName, type JsnesModule } from '../../core/emu/nes-session';
import type { RomBuildView, RomSource } from '../../shared/api';
import { LEGEND_BATTERY_ADDR, LEGEND_BATTERY_BYTES } from '../../core/rpg/legend/legend-sample';
import { go, useApp, useHash } from '../app-context';
import { BudgetMeter, Button, Frame, SliderPixel, Toggle } from '../ui';
import { controlValue, physicsControls } from '../../core/directors/rebond';
import { tuningAddress } from '../../core/engine-data/contract';
import type { Physics } from '../../core/schema/physics';
import type { MessageKey } from '../../shared/i18n';
import { formatControl, physicsDiff } from './MovementPanel';

// In-app emulator (PLAN §7.3): jsnes with our master palette, keyboard + gamepad, quick save state,
// WebAudio. The ROM is built in main by cc65 (`rom:build`); `#/play?rom=demo` plays the demo game.
// BLUMZ-F2: `#/play?rom=legend` plays THE LEGEND OF BLUM slice; its battery RAM is kept in the user data
// (rom.batteryLoad / batterySave), so the game's own save and « Continuer » work between sessions.

const KEYMAP: Record<string, ButtonName> = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyX: 'A',
  KeyZ: 'B',
  Enter: 'START',
  NumpadEnter: 'START',
  ShiftLeft: 'SELECT',
  ShiftRight: 'SELECT',
};

/** The battery RAM the game saves into, without the bot probe page at $7F00 (rewritten every frame). */
const BATTERY_WATCH = LEGEND_BATTERY_BYTES - 256;
const sameBytes = (a: Uint8Array, b: Uint8Array, n: number) => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Standard Gamepad API layout -> NES buttons (bottom/left face = B, right/top face = A). */
function padButtons(): { held: Set<ButtonName>; name: string | null } {
  const held = new Set<ButtonName>();
  let name: string | null = null;
  for (const gp of navigator.getGamepads?.() ?? []) {
    if (!gp) continue;
    name ??= gp.id;
    const b = (i: number) => gp.buttons[i]?.pressed === true;
    if (b(1) || b(3)) held.add('A');
    if (b(0) || b(2)) held.add('B');
    if (b(8)) held.add('SELECT');
    if (b(9)) held.add('START');
    if (b(12) || (gp.axes[1] ?? 0) < -0.5) held.add('UP');
    if (b(13) || (gp.axes[1] ?? 0) > 0.5) held.add('DOWN');
    if (b(14) || (gp.axes[0] ?? 0) < -0.5) held.add('LEFT');
    if (b(15) || (gp.axes[0] ?? 0) > 0.5) held.add('RIGHT');
  }
  return { held, name };
}

const FRAME_MS = 1000 / 60.0988;

/** Small stereo ring buffer fed by jsnes and drained by a ScriptProcessorNode. */
class Speaker {
  private readonly ctx: AudioContext;
  private readonly node: ScriptProcessorNode;
  private readonly buf = new Float32Array(8192 * 2);
  private write = 0;
  private read = 0;
  constructor(volume: number) {
    this.ctx = new AudioContext();
    this.node = this.ctx.createScriptProcessor(2048, 0, 2);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    this.node.onaudioprocess = (e) => {
      const l = e.outputBuffer.getChannelData(0);
      const r = e.outputBuffer.getChannelData(1);
      for (let i = 0; i < l.length; i++) {
        if (this.read === this.write) {
          l[i] = 0;
          r[i] = 0;
          continue;
        }
        l[i] = this.buf[this.read]!;
        r[i] = this.buf[this.read + 1]!;
        this.read = (this.read + 2) % this.buf.length;
      }
    };
    this.node.connect(gain);
    gain.connect(this.ctx.destination);
  }
  get sampleRate(): number {
    return this.ctx.sampleRate;
  }
  push = (left: number, right: number) => {
    const next = (this.write + 2) % this.buf.length;
    if (next === this.read) return; // full: drop
    this.buf[this.write] = left;
    this.buf[this.write + 1] = right;
    this.write = next;
  };
  close(): void {
    this.node.disconnect();
    void this.ctx.close();
  }
}

/**
 * REBOND live tuning (PLAN §5.3, M4-T6): the sliders poke the $7E00 block of the running ROM, so a jump
 * changes on the next frame without a rebuild. "Proposer" turns the result into a REBOND proposal.
 */
function LiveTuning({ session }: { session: { current: NesSession | null } }) {
  const { t, pick, locale, project, info, toast } = useApp();
  const physics = project?.docs['physics.json'] as Physics | undefined;
  const controls = physicsControls(info!.features).filter((c) => c.tuning);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(controls.map((c) => [c.pointer, physics ? controlValue(physics, c.pointer) : c.min])));
  if (!physics) return null;
  const poke = (pointer: string, v: number) => {
    setValues((x) => ({ ...x, [pointer]: v }));
    const c = controls.find((x) => x.pointer === pointer)!;
    const s = session.current;
    if (!s || !c.tuning) return;
    const a = tuningAddress(c.tuning);
    s.mem[a] = v & 0xff;
    s.mem[a + 1] = (v >> 8) & 0xff;
  };
  const tuned = structuredClone(physics) as unknown as Record<string, unknown>;
  for (const c of controls) {
    const keys = c.pointer.split('/').slice(1);
    let o = tuned;
    for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[keys.at(-1)!] = c.unit === 'bool' ? values[c.pointer] === 1 : values[c.pointer];
  }
  const changes = physicsDiff(physics, tuned as unknown as Physics, controls);
  const propose = async () => {
    const r = await window.blum.directors.manual('movement', 'propose_physics', { changes, reason: t('rebond.reasonLive') });
    if (r.ok) toast(t('rebond.liveProposed'), 'success');
    else toast(pick(r), 'danger');
  };
  return (
    <div className="stack" data-testid="live-tuning">
      <h3>{t('rebond.liveTitle')}</h3>
      {controls.map((c) =>
        c.unit === 'bool' ? (
          <Toggle key={c.pointer} on={values[c.pointer] === 1} onChange={(v) => poke(c.pointer, v ? 1 : 0)} label={t(`phys.${c.pointer.slice(1).replaceAll('/', '.')}` as MessageKey)} />
        ) : (
          <SliderPixel
            key={c.pointer}
            label={t(`phys.${c.pointer.slice(1).replaceAll('/', '.')}` as MessageKey)}
            value={values[c.pointer]!}
            min={c.min}
            max={c.max}
            format={(v) => formatControl(c, v, locale)}
            onChange={(v) => poke(c.pointer, v)}
          />
        ),
      )}
      <div className="row">
        <Button variant="primary" onClick={() => void propose()} disabled={!changes.length} testid="live-propose">
          {t('rebond.proposeN', { n: changes.length })}
        </Button>
        <Button onClick={() => controls.forEach((c) => poke(c.pointer, controlValue(physics, c.pointer)))} sound="back">
          {t('editor.reset')}
        </Button>
      </div>
    </div>
  );
}

function sourceFromHash(): RomSource {
  const h = location.hash;
  return /[?&]rom=demo\b/.test(h) ? 'demo' : /[?&]rom=sebring\b/.test(h) ? 'sebring' : /[?&]rom=legend\b/.test(h) ? 'legend' : 'project';
}

export function PlayScreen() {
  const { t, pick, info, settings, toast } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<NesSession | null>(null);
  const stateRef = useRef<string | null>(null);
  const batteryRef = useRef<Uint8Array | null>(null);
  const pausedRef = useRef(false);
  const [build, setBuild] = useState<RomBuildView | null>(null);
  const [error, setError] = useState<{ fr: string; en: string } | null>(null);
  const [frames, setFrames] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pad, setPad] = useState<string | null>(null);
  const [source] = useState(sourceFromHash);
  const hash = useHash();
  const tune = /[?&]tune=1/.test(hash) && source === 'project';
  const [scale, setScale] = useState(2);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // largest integer scale that fits the frame (crisp pixels, PLAN §7.3)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(1, Math.min(4, Math.floor(Math.min((el.clientWidth - 8) / 256, (el.clientHeight - 8) / 240)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // build the ROM once
  useEffect(() => {
    let alive = true;
    void window.blum.rom.build(source).then(async (r) => {
      if (!alive) return;
      if (!r.ok) return setError({ fr: r.fr, en: r.en });
      if (r.value.battery && source === 'legend') batteryRef.current = await window.blum.rom.batteryLoad('legend');
      if (alive) setBuild(r.value);
    });
    return () => {
      alive = false;
    };
  }, [source]);

  // emulator loop
  useEffect(() => {
    if (!build || !canvasRef.current || !info) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(256, 240);
    const pixels = new Uint32Array(image.data.buffer);
    const withSound = !info.smoke && settings !== null && !settings.muted;
    const speaker = withSound ? new Speaker(settings.volume) : null;
    const s = new NesSession(jsnes as unknown as JsnesModule, speaker ? { onAudioSample: speaker.push, sampleRate: speaker.sampleRate } : {});
    s.load(build.rom);
    sessionRef.current = s;
    // battery: the game's saves from an earlier session, then a write-back whenever the game saves
    const battery = build.battery === true && source === 'legend';
    if (battery && batteryRef.current) s.mem.set(batteryRef.current, LEGEND_BATTERY_ADDR);
    let saved = s.mem.slice(LEGEND_BATTERY_ADDR, LEGEND_BATTERY_ADDR + LEGEND_BATTERY_BYTES);
    const keepBattery = () => {
      if (!battery) return;
      const now = s.mem.slice(LEGEND_BATTERY_ADDR, LEGEND_BATTERY_ADDR + LEGEND_BATTERY_BYTES);
      if (sameBytes(now, saved, BATTERY_WATCH)) return;
      saved = now;
      batteryRef.current = now;
      void window.blum.rom.batterySave('legend', now);
    };

    const keys = new Set<ButtonName>();
    const onDown = (e: KeyboardEvent) => {
      const b = KEYMAP[e.code];
      if (!b) return;
      e.preventDefault();
      keys.add(b);
    };
    const onUp = (e: KeyboardEvent) => {
      const b = KEYMAP[e.code];
      if (b) keys.delete(b);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);

    let last = performance.now();
    let acc = 0;
    let stopped = false;
    let handle = 0;
    let padName: string | null = null;
    const timerDriven = info.smoke;
    const draw = () => {
      const f = s.frame;
      for (let i = 0; i < f.length; i++) pixels[i] = 0xff000000 | f[i]!;
      ctx.putImageData(image, 0, 0);
    };
    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      acc += Math.min(now - last, 100);
      last = now;
      let ran = 0;
      while (acc >= FRAME_MS && ran < 3) {
        acc -= FRAME_MS;
        if (pausedRef.current) continue;
        const p = padButtons();
        if (p.name !== padName) {
          padName = p.name;
          setPad(p.name);
        }
        s.setButtons([...keys, ...p.held]);
        s.step();
        ran++;
      }
      if (ran) {
        draw();
        setFrames(s.frames);
        if (s.frames % 60 < ran) keepBattery();
      }
      // hidden windows (smoke) get almost no rAF: drive frames with a timer there
      handle = timerDriven || document.hidden ? window.setTimeout(tick, 4) : requestAnimationFrame(tick);
    };
    tick();
    return () => {
      stopped = true;
      cancelAnimationFrame(handle);
      clearTimeout(handle);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      keepBattery();
      speaker?.close();
      sessionRef.current = null;
    };
  }, [build, info, settings, source]);

  const saveState = () => {
    if (!sessionRef.current) return;
    stateRef.current = sessionRef.current.saveState();
    toast(t('play.saved'), 'success');
  };
  const loadState = () => {
    if (!sessionRef.current) return;
    if (!stateRef.current) return toast(t('play.noState'), 'info');
    sessionRef.current.loadState(stateRef.current);
    toast(t('play.loaded'), 'success');
  };
  // Reset keeps the battery RAM, as on a real cartridge
  const reset = () => {
    const s = sessionRef.current;
    if (!s) return;
    const w = s.mem.slice(LEGEND_BATTERY_ADDR, LEGEND_BATTERY_ADDR + LEGEND_BATTERY_BYTES);
    s.reset();
    if (build?.battery) s.mem.set(w, LEGEND_BATTERY_ADDR);
  };
  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  return (
    <main className="screen play" data-testid="screen-play">
      <div className="topbar">
        <h1 className="grow shadow gold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {build ? build.title : t('play.title')}
        </h1>
        <Button icon="save" onClick={saveState} disabled={!build} testid="play-save">
          {t('play.save')}
        </Button>
        <Button icon="load" onClick={loadState} disabled={!build} testid="play-load">
          {t('play.load')}
        </Button>
        <Button icon="undo" onClick={reset} disabled={!build}>
          {t('play.reset')}
        </Button>
        <Button icon="play" onClick={togglePause} disabled={!build}>
          {paused ? t('play.resume') : t('play.pause')}
        </Button>
        <Button icon="back" onClick={() => go(source === 'demo' ? 'title' : source === 'sebring' || source === 'legend' ? 'cartridges' : tune ? 'director/movement' : 'hub')} sound="back">
          {t('nav.back')}
        </Button>
      </div>
      <div className="play-main">
        <div className="play-box" ref={boxRef}>
        <Frame variant="inset" className="play-screen">
          {error ? (
            <p className="danger" data-testid="play-error">
              {t('play.failed', { why: pick(error) })}
            </p>
          ) : null}
          {!build && !error ? <p className="dim">{t('play.loading')}</p> : null}
          <canvas
            ref={canvasRef}
            width={256}
            height={240}
            className="nes-canvas"
            style={{ width: 256 * scale, height: 240 * scale, display: build ? 'block' : 'none' }}
            data-testid="play-canvas"
            data-frames={frames}
          />
          {frames >= 120 ? <span hidden data-testid="play-ready" /> : null}
        </Frame>
        </div>
        <Frame title={t('play.controls')} className="scroll play-side">
          <p>{t(source === 'sebring' ? 'play.keysSebring' : source === 'legend' ? 'play.keysLegend' : 'play.keys')}</p>
          {source === 'legend' ? <p className="dim" data-testid="play-battery">{t('play.batteryLegend')}</p> : null}
          <p className="dim">{pad ? t('play.padFound', { name: pad.slice(0, 40) }) : t('play.pad')}</p>
          <p className="dim">{t('play.frames', { n: frames })}</p>
          {build && tune ? <LiveTuning session={sessionRef} /> : null}
          {build ? (
            <>
              <p className="dim">{build.fromCache ? t('play.cached') : t('play.built', { ms: build.ms })}</p>
              {build.route ? (
                <>
                  <h3>{t(source === 'legend' ? 'play.chapters' : 'play.route')}</h3>
                  <ol data-testid="play-route">
                    {build.route.map((n) => (
                      <li key={n.fr}>{pick(n)}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <h3>{t('play.banks')}</h3>
                  {build.banks.map((b) => (
                    <BudgetMeter key={b.fr} label={pick(b)} used={b.used} max={b.capacity} />
                  ))}
                </>
              )}
            </>
          ) : null}
        </Frame>
      </div>
    </main>
  );
}
