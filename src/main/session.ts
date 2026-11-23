import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DirectorRuntime } from '../core/directors/runtime.js';
import { OFFLINE_CHOICES } from '../core/directors/specs.js';

/** Tools the editor panels may call without the AI (session.manual). CHROMA has its own channels. */
const MANUAL_TOOLS: Partial<Record<DirectorId, string[]>> = {
  story: ['propose_story'],
  movement: ['propose_physics', 'propose_enemy', 'propose_boss'],
  level: ['propose_level'],
};
import { DEFAULT_FEATURES } from '../core/features.js';
import { AnthropicProvider, classifyError } from '../core/llm/anthropic.js';
import { OfflineProvider } from '../core/llm/offline.js';
import { pricesSchema, type Prices } from '../core/llm/prices.js';
import { redactForLog } from '../core/llm/redact.js';
import type { LlmProvider } from '../core/llm/types.js';
import { appendUsage, readUsage, summarizeUsage } from '../core/llm/usage.js';
import { directorIdSchema, type DirectorId } from '../core/project/proposal.js';
import { ProjectError, ProjectStore } from '../core/project/store.js';
import { exportProjectZip, importProjectZip } from '../core/project/zip.js';
import { projectManifestSchema } from '../core/schema/project.js';
import { DEFAULT_STORY, type Story } from '../core/schema/story.js';
import { buildRom } from '../core/build/engine-build.js';
import { demoDocs } from '../core/engine-data/demo.js';
import { DEFAULT_AUDIO } from '../core/schema/misc.js';
import { DEFAULT_PHYSICS } from '../core/schema/physics.js';
import { DEFAULT_CARTRIDGE } from '../core/schema/project.js';
import type { Json } from '../core/util/json-pointer.js';
import { createHash } from 'node:crypto';
import { conversionInput, settingsFor, worldSet, type SourceImages } from '../core/directors/chroma.js';
import { editTileInput } from '../core/directors/chroma-tile.js';
import { runConvertJob, type ConvertJob, type ConvertJobResult } from '../core/convert/job.js';
import { decodePng } from '../core/util/png.js';
import { runPipeline, type BuildReport, type PipelineInput, type PipelineResult } from '../core/build/pipeline.js';
import { BuildFixLoop, fixRequest, MAX_FIX_ATTEMPTS, type AskResult, type FixLoopState } from '../core/build/fix-loop.js';
import { exportFiles, fileTitle, loadNotices } from '../core/build/export.js';
import { SEBRING_FOLDER, SEBRING_ROM, SEBRING_TRACKS, readSebringSample } from '../core/racer/sebring-sample.js';
import { LEGEND_BATTERY_BYTES, LEGEND_CHAPTERS, LEGEND_FOLDER, LEGEND_ROM, LEGEND_TITLE, checkLegendRom } from '../core/rpg/legend/legend-sample.js';
import type {
  AppInfo,
  ChatLine,
  ChromaPreviewView,
  ChromaSourceView,
  DirectorEvent,
  ExportView,
  FixView,
  KeyStatusView,
  ProjectSummary,
  ProjectView,
  Result,
  RomBuildView,
  SendView,
  Settings,
  UsageView,
} from '../shared/api.js';
import { KeyVault, KeyVaultError } from './key-vault.js';
import { SettingsStore } from './settings.js';

// Everything behind window.blum, without Electron imports: main.ts wires it to ipcMain, tests can
// drive it directly. Every payload from the renderer is parsed with zod here (PLAN §2.2).
export interface SessionDeps {
  userData: string;
  bundledPrices: string;
  settings: SettingsStore;
  vault: KeyVault;
  version: string;
  electron: string;
  smoke: boolean;
  /** Smoke and tests never talk to the network. */
  forceOffline: boolean;
  emit: (e: DirectorEvent) => void;
  log: (line: string) => void;
  chooseSavePath: (defaultName: string) => Promise<string | null>;
  chooseOpenPath: () => Promise<string | null>;
  /** ROM builds for the in-app emulator (cc65 toolchain + engine template). */
  rom?: { engineDir: string; toolchainDir: string; buildRoot: string };
  /** CHROMA previews off the main thread (worker); tests run them inline. */
  convert?: (job: ConvertJob) => Promise<ConvertJobResult>;
  /** BOULON builds off the main thread (worker with jsnes); tests run them inline. */
  build?: (input: Omit<PipelineInput, 'jsnes' | 'now'>) => Promise<PipelineResult>;
  /** resources/licenses (notices for the cartridge sheet). */
  licensesDir?: string;
  /** Folder for « Exporter » (a dialog in the app, a fixed folder in smoke and tests). */
  chooseExportDir?: (defaultName: string) => Promise<string | null>;
  /** resources/samples: the sample game BLUM (M6), copied into the projects folder before opening. */
  samplesDir?: string;
}

/** The bundled sample project (PLAN §12.3). */
export const SAMPLE_FOLDER = 'BLUM.blum';

/** Most images a session keeps waiting for conversion (memory bound). */
const MAX_SOURCES = 24;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
function fail(e: unknown): { ok: false; fr: string; en: string } {
  if (e instanceof ProjectError || e instanceof KeyVaultError) return { ok: false, fr: e.fr, en: e.en };
  if (e instanceof z.ZodError) return { ok: false, fr: 'données refusées', en: 'data refused' };
  const m = redactForLog(e instanceof Error ? e.message : e);
  return { ok: false, fr: m, en: m };
}

export function safeFolderName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return cleaned || 'Mon jeu';
}

export class Session {
  private store: ProjectStore | null = null;
  private runtime: DirectorRuntime | null = null;
  private readonly aborts = new Map<DirectorId, AbortController>();
  private prices: Prices;
  private romCache: { key: string; view: RomBuildView } | null = null;
  /** Last BOULON build of the open project, by document hash. */
  private lastBuild: { key: string; result: PipelineResult } | null = null;
  private fixLoop: BuildFixLoop | null = null;
  /** Images dropped in the CHROMA panel, by id, until converted (PLAN §6). */
  private readonly dropped = new Map<string, ChromaSourceView & { png: Uint8Array }>();
  readonly sources: SourceImages = {
    get: (id) => this.dropped.get(id)?.png,
    list: () => [...this.dropped.values()].map(({ id, name, width, height }) => ({ id, name, width, height })),
  };

  constructor(private readonly d: SessionDeps) {
    this.prices = this.loadPrices();
  }

  private loadPrices(): Prices {
    const userCopy = path.join(this.d.userData, 'prices.json');
    const bundled = pricesSchema.parse(JSON.parse(readFileSync(this.d.bundledPrices, 'utf8')));
    if (!existsSync(userCopy)) {
      mkdirSync(this.d.userData, { recursive: true });
      writeFileSync(userCopy, JSON.stringify(bundled, null, 2) + '\n');
      return bundled;
    }
    const parsed = pricesSchema.safeParse(JSON.parse(readFileSync(userCopy, 'utf8')));
    return parsed.success ? parsed.data : bundled;
  }

  private get usageFile(): string {
    return path.join(this.d.userData, 'usage.jsonl');
  }

  private provider(): LlmProvider {
    const locale = this.d.settings.get().locale;
    if (this.d.forceOffline) return new OfflineProvider(locale);
    const key = this.d.vault.readKeyForMain();
    return key ? new AnthropicProvider({ apiKey: key }) : new OfflineProvider(locale);
  }

  // ---------- app / settings / key ----------

  info(): AppInfo {
    return {
      version: this.d.version,
      electron: this.d.electron,
      smoke: this.d.smoke,
      provider: this.provider().id === 'anthropic' ? 'anthropic' : 'offline',
      features: DEFAULT_FEATURES,
    };
  }

  getSettings(): Settings {
    return this.d.settings.get();
  }

  setSettings(patch: unknown): Result<Settings> {
    try {
      const p = z.record(z.string(), z.unknown()).parse(patch) as Partial<Settings>;
      return ok(this.d.settings.set(p));
    } catch (e) {
      return fail(e);
    }
  }

  keyStatus(): KeyStatusView {
    return this.d.vault.status();
  }

  keySave(key: unknown): Result<KeyStatusView> {
    try {
      return ok(this.d.vault.save(z.string().max(400).parse(key)));
    } catch (e) {
      return fail(e);
    }
  }

  keyClear(): KeyStatusView {
    return this.d.vault.clear();
  }

  /** « Tester la clé »: one tiny request with the cheap model. */
  async keyTest(): Promise<Result<{ model: string }>> {
    const key = this.d.vault.readKeyForMain();
    if (!key) return { ok: false, fr: 'Aucune clé enregistrée.', en: 'No key saved.' };
    if (this.d.forceOffline) return { ok: false, fr: 'Test désactivé en mode essai.', en: 'Test disabled in smoke mode.' };
    const model = this.d.settings.get().models.chores;
    try {
      const p = new AnthropicProvider({ apiKey: key, maxRetries: 0 });
      for await (const ev of p.send({ model, system: 'Réponds OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'OK ?' }] }], tools: [], maxTokens: 16 })) {
        if (ev.type === 'error') return { ok: false, fr: ev.fr, en: ev.en };
      }
      return ok({ model });
    } catch (e) {
      const c = classifyError(e);
      return { ok: false, fr: c.fr, en: c.en };
    }
  }

  // ---------- projects ----------

  private view(): ProjectView {
    const s = this.store!;
    const story = s.doc<Story>('story.json');
    return {
      dir: s.dir,
      manifest: s.manifest,
      readOnly: s.readOnly,
      issues: s.loadIssues,
      storyTitle: story?.title ?? s.manifest.title,
      worlds: story?.worlds.length ?? 0,
      stages: story?.worlds.reduce((n, w) => n + w.stages.length, 0) ?? 0,
      canUndo: s.canUndo(),
      canRedo: s.canRedo(),
      pending: s.proposals().filter((p) => p.state === 'pending').length,
      docs: s.docs(),
    };
  }

  private attach(store: ProjectStore): ProjectView {
    this.closeProject();
    this.store = store;
    // Used for approve / reject / offline paths only; chat messages get a fresh runtime in send().
    this.runtime = new DirectorRuntime({ store, provider: new OfflineProvider(this.d.settings.get().locale), prices: this.prices, sources: this.sources });
    return this.view();
  }

  listProjects(): ProjectSummary[] {
    const root = this.d.settings.get().projectsDir;
    if (!existsSync(root)) return [];
    const out: ProjectSummary[] = [];
    for (const ent of readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || !ent.name.endsWith('.blum')) continue;
      const dir = path.join(root, ent.name);
      try {
        const m = projectManifestSchema.parse(JSON.parse(readFileSync(path.join(dir, 'project.json'), 'utf8')));
        let worlds = 0;
        try {
          worlds = (JSON.parse(readFileSync(path.join(dir, 'story.json'), 'utf8')) as Story).worlds.length;
        } catch {
          worlds = 0;
        }
        out.push({ dir, title: m.title, updatedAt: m.updatedAt, worlds, ok: true });
      } catch {
        out.push({ dir, title: ent.name.replace(/\.blum$/, ''), updatedAt: '', worlds: 0, ok: false });
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  private uniqueDir(title: string): string {
    const root = this.d.settings.get().projectsDir;
    mkdirSync(root, { recursive: true });
    const base = safeFolderName(title);
    let dir = path.join(root, `${base}.blum`);
    for (let i = 2; existsSync(dir); i++) dir = path.join(root, `${base} (${i}).blum`);
    return dir;
  }

  createProject(title: unknown): Result<ProjectView> {
    try {
      const t = z.string().trim().min(1).max(32).parse(title);
      const dir = this.uniqueDir(t);
      return ok(this.attach(ProjectStore.create(dir, { title: t, locale: this.d.settings.get().locale })));
    } catch (e) {
      return fail(e);
    }
  }

  /** Copies the bundled sample BLUM into the projects folder (never edits the shipped copy) and opens it. */
  openSample(): Result<ProjectView> {
    try {
      const src = this.d.samplesDir ? path.join(this.d.samplesDir, SAMPLE_FOLDER) : '';
      if (!src || !existsSync(path.join(src, 'project.json'))) {
        return { ok: false, fr: 'le jeu d’exemple BLUM est introuvable', en: 'the sample game BLUM is missing' };
      }
      const dir = this.uniqueDir('BLUM');
      cpSync(src, dir, { recursive: true, filter: (p) => !['.lock', 'build'].includes(path.basename(p)) });
      return ok(this.attach(ProjectStore.open(dir)));
    } catch (e) {
      return fail(e);
    }
  }

  openProject(dir: unknown): Result<ProjectView> {
    try {
      const p = z.string().min(1).parse(dir);
      if (this.store && path.resolve(this.store.dir) === path.resolve(p)) return ok(this.view());
      return ok(this.attach(ProjectStore.open(p)));
    } catch (e) {
      return fail(e);
    }
  }

  current(): ProjectView | null {
    return this.store ? this.view() : null;
  }

  /** « Jeu d'exemple SEBRING » (BLUMR-M2): the tracks file is read and validated, then the prebuilt ROM plays. */
  sebringRom(): Result<RomBuildView> {
    const dir = this.d.samplesDir ? path.join(this.d.samplesDir, SEBRING_FOLDER) : '';
    if (!dir || !existsSync(path.join(dir, SEBRING_ROM)) || !existsSync(path.join(dir, SEBRING_TRACKS))) {
      return { ok: false, fr: 'le jeu d’exemple SEBRING est introuvable', en: 'the sample game SEBRING is missing' };
    }
    const t0 = Date.now();
    const tracks = readSebringSample(JSON.parse(readFileSync(path.join(dir, SEBRING_TRACKS), 'utf8')) as unknown);
    if (tracks.issues.length) return { ok: false, fr: tracks.issues[0]!.fr, en: tracks.issues[0]!.en };
    const rom = new Uint8Array(readFileSync(path.join(dir, SEBRING_ROM)));
    this.d.log(`rom:sebring ${rom.length} bytes, ${tracks.stages.length} stages`);
    return ok({ rom, title: 'SEBRING', banks: [], route: tracks.stages.map((s) => s.name), fromCache: true, ms: Date.now() - t0 });
  }

  /** « Jeu d'exemple THE LEGEND OF BLUM (début) » (BLUMZ-F2): the prebuilt slice ROM, checked, then played. */
  legendRom(): Result<RomBuildView> {
    const file = this.d.samplesDir ? path.join(this.d.samplesDir, LEGEND_FOLDER, LEGEND_ROM) : '';
    if (!file || !existsSync(file)) return { ok: false, fr: 'le jeu d’exemple THE LEGEND OF BLUM est introuvable', en: 'the sample game THE LEGEND OF BLUM is missing' };
    const t0 = Date.now();
    const rom = new Uint8Array(readFileSync(file));
    const bad = checkLegendRom(rom);
    if (bad) return { ok: false, ...bad };
    this.d.log(`rom:legend ${rom.length} bytes`);
    return ok({ rom, title: LEGEND_TITLE, banks: [], route: LEGEND_CHAPTERS, fromCache: true, ms: Date.now() - t0, battery: true });
  }

  private batteryFile(source: unknown): string {
    z.literal('legend').parse(source);
    return path.join(this.d.userData, 'saves', `${LEGEND_FOLDER}.sav`);
  }

  /** The sample's battery RAM (8 KiB), as the player left it; null before the first save. */
  batteryLoad(source: unknown): Uint8Array | null {
    const f = this.batteryFile(source);
    if (!existsSync(f)) return null;
    const b = readFileSync(f);
    return b.length === LEGEND_BATTERY_BYTES ? new Uint8Array(b) : null;
  }

  /** Writes the battery RAM (the game's own save slots live there; same bytes as Mesen's .sav). */
  batterySave(source: unknown, bytes: unknown): Result<true> {
    try {
      const f = this.batteryFile(source);
      if (!(bytes instanceof Uint8Array) || bytes.length !== LEGEND_BATTERY_BYTES) return { ok: false, fr: 'sauvegarde invalide', en: 'invalid save' };
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(`${f}.tmp`, bytes);
      renameSync(`${f}.tmp`, f);
      return ok(true);
    } catch (e) {
      return fail(e);
    }
  }

  /** Builds the demo game or the open project with cc65 (sync, about a second); cached per document hash. */
  buildRom(source: unknown): Result<RomBuildView> {
    try {
      const src = z.enum(['demo', 'project', 'sebring', 'legend']).parse(source);
      if (src === 'sebring') return this.sebringRom();
      if (src === 'legend') return this.legendRom();
      if (!this.d.rom) return { ok: false, fr: 'construction indisponible', en: 'build unavailable' };
      let docs: Record<string, Json>;
      if (src === 'project') {
        if (!this.store) return { ok: false, fr: 'aucune cartouche ouverte', en: 'no cartridge open' };
        docs = this.store.docs();
      } else {
        docs = structuredClone({
          'cartridge.json': DEFAULT_CARTRIDGE,
          'story.json': { ...DEFAULT_STORY, title: 'BLUM DEMO' },
          'physics.json': DEFAULT_PHYSICS,
          'audio/library.json': DEFAULT_AUDIO,
          ...demoDocs(),
        }) as Record<string, Json>;
      }
      const assets = src === 'project' ? this.store!.assets() : {};
      const key = createHash('sha1')
        .update(JSON.stringify(docs))
        .update(Object.entries(assets).map(([p, b]) => p + createHash('sha1').update(b).digest('hex')).join())
        .digest('hex');
      if (this.romCache?.key === key) return ok({ ...this.romCache.view, fromCache: true, ms: 0 });
      const t0 = Date.now();
      const r = buildRom({
        docs,
        assets,
        engineDir: this.d.rom.engineDir,
        toolchain: { dir: this.d.rom.toolchainDir },
        workDir: path.join(this.d.rom.buildRoot, key.slice(0, 12)),
      });
      if (!r.ok || !r.rom) {
        const first = r.issues.find((i) => i.severity === 'error') ?? r.issues[0];
        this.d.log(`rom:build failed: ${first?.en ?? 'unknown'}`);
        return { ok: false, fr: first?.fr ?? 'la construction a échoué', en: first?.en ?? 'the build failed' };
      }
      const story = docs['story.json'] as unknown as Story;
      const view: RomBuildView = {
        rom: r.rom,
        title: story.title,
        banks: r.banks.map((b) => ({ fr: b.label, en: b.labelEn, used: b.used, capacity: b.capacity })),
        fromCache: false,
        ms: Date.now() - t0,
      };
      this.romCache = { key, view };
      return ok(view);
    } catch (e) {
      return fail(e);
    }
  }

  closeProject(): void {
    for (const a of this.aborts.values()) a.abort();
    this.aborts.clear();
    this.store?.close();
    this.store = null;
    this.runtime = null;
    this.lastBuild = null;
    this.fixLoop = null;
  }

  async exportZip(): Promise<Result<{ path: string }>> {
    if (!this.store) return { ok: false, fr: 'Aucun projet ouvert.', en: 'No project open.' };
    const target = await this.d.chooseSavePath(`${safeFolderName(this.store.manifest.title)}.zip`);
    if (!target) return { ok: false, fr: 'Exportation annulée.', en: 'Export cancelled.' };
    try {
      writeFileSync(target, exportProjectZip(this.store.dir));
      return ok({ path: target });
    } catch (e) {
      return fail(e);
    }
  }

  async importZip(): Promise<Result<ProjectView>> {
    const src = await this.d.chooseOpenPath();
    if (!src) return { ok: false, fr: 'Importation annulée.', en: 'Import cancelled.' };
    try {
      const dir = this.uniqueDir(path.basename(src).replace(/\.zip$/i, ''));
      importProjectZip(new Uint8Array(readFileSync(src)), dir);
      return ok(this.attach(ProjectStore.open(dir)));
    } catch (e) {
      return fail(e);
    }
  }

  // ---------- directors ----------

  private requireRuntime(): DirectorRuntime {
    if (!this.runtime || !this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
    return this.runtime;
  }

  async send(director: unknown, text: unknown): Promise<Result<SendView>> {
    try {
      const id = directorIdSchema.parse(director);
      const msg = z.string().trim().min(1).max(4000).parse(text);
      this.requireRuntime();
      this.aborts.get(id)?.abort();
      const ac = new AbortController();
      this.aborts.set(id, ac);
      const runtime = this.liveRuntime(id);
      const r = await runtime.send(id, msg, ac.signal);
      this.d.emit({ director: id, type: 'done' });
      return ok({ text: r.text, proposals: r.proposals, failure: r.failure, costUsd: r.costUsd });
    } catch (e) {
      this.d.log(`directors:send ${redactForLog(e)}`);
      return fail(e);
    }
  }

  /** A fresh runtime per message picks up a key saved meanwhile; events and usage go to the UI and usage.jsonl. */
  private liveRuntime(id: DirectorId): DirectorRuntime {
      const store = this.store!;
      return new DirectorRuntime({
        store,
        provider: this.provider(),
        prices: this.prices,
        locale: this.d.settings.get().locale,
        sources: this.sources,
        model: this.d.settings.get().qualityMax ? this.d.settings.get().models.quality : this.d.settings.get().models.directors,
        onEvent: (e) => {
          if (e.type === 'usage') this.d.emit({ director: id, type: 'usage', model: e.model, costUsd: e.costUsd, costKnown: e.costKnown });
          else this.d.emit({ director: id, ...e } as DirectorEvent);
        },
        onUsage: (u) =>
          appendUsage(this.usageFile, {
            ts: new Date().toISOString(),
            projectId: store.manifest.id,
            director: u.director,
            model: u.model,
            ...u.usage,
            costUsd: u.costUsd,
            costKnown: u.costKnown,
          }),
      });
  }

  cancel(director: unknown): void {
    const id = directorIdSchema.safeParse(director);
    if (id.success) this.aborts.get(id.data)?.abort();
  }

  chat(director: unknown): ChatLine[] {
    const id = directorIdSchema.parse(director);
    if (!this.store) return [];
    return this.store.chat(id).map((l) => ({
      ts: String(l.ts ?? ''),
      role: l.role === 'assistant' ? 'assistant' : 'user',
      text: String(l.text ?? ''),
      ...(typeof l.costUsd === 'number' ? { costUsd: l.costUsd } : {}),
      ...(l.failure ? { failure: l.failure as { fr: string; en: string } } : {}),
    }));
  }

  proposals(director: unknown) {
    const id = directorIdSchema.parse(director);
    return this.store ? this.store.proposals(id) : [];
  }

  approve(id: unknown): Result<ProjectView> {
    try {
      this.requireRuntime().approve(z.string().parse(id));
      return ok(this.view());
    } catch (e) {
      return fail(e);
    }
  }

  reject(id: unknown): Result<ProjectView> {
    try {
      this.requireRuntime().reject(z.string().parse(id));
      return ok(this.view());
    } catch (e) {
      return fail(e);
    }
  }

  offline(director: unknown, choice: unknown) {
    try {
      const id = directorIdSchema.parse(director);
      const c = z.enum((OFFLINE_CHOICES[id] ?? ['-']) as [string, ...string[]]).parse(choice);
      return ok(this.requireRuntime().offline(id, c));
    } catch (e) {
      return fail(e);
    }
  }

  /**
   * Editor path (PLUME form, REBOND sliders and forms, TABLEAU grid): the same tool, Ops and validation as
   * the AI path, no model call. Only the tools a panel offers are accepted here.
   */
  manual(director: unknown, tool: unknown, input: unknown) {
    try {
      const id = directorIdSchema.parse(director);
      const name = z.string().max(40).parse(tool);
      if (!(MANUAL_TOOLS[id] ?? []).includes(name)) return { ok: false as const, fr: `outil refusé : ${name}`, en: `tool refused: ${name}` };
      return ok(this.requireRuntime().manual(id, name, input));
    } catch (e) {
      return fail(e);
    }
  }

  // ---------- BOULON (PLAN §7) ----------

  private docsKey(docs: Record<string, Json>, assets: Record<string, Uint8Array>): string {
    return createHash('sha1')
      .update(JSON.stringify(docs))
      .update(Object.entries(assets).map(([p, b]) => p + createHash('sha1').update(b).digest('hex')).join())
      .digest('hex');
  }

  /** Release build of the open project (never test options), through the worker when there is one. */
  private async fullBuild(): Promise<PipelineResult> {
    if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
    if (!this.d.rom) throw new ProjectError('missing', 'construction indisponible', 'build unavailable');
    const docs = this.store.docs();
    const assets = this.store.assets();
    const key = this.docsKey(docs, assets);
    if (this.lastBuild?.key === key) return this.lastBuild.result;
    const input = {
      docs,
      assets,
      engineDir: this.d.rom.engineDir,
      toolchain: { dir: this.d.rom.toolchainDir },
      workDir: path.join(this.d.rom.buildRoot, `b${key.slice(0, 12)}`),
    };
    const result = this.d.build ? await this.d.build(input) : runPipeline(input);
    this.lastBuild = { key, result };
    const first = result.report.problems.find((p) => p.severity === 'error');
    this.d.log(`build: ${result.report.ok ? 'green' : `red (${first?.id ?? '?'})`} in ${result.report.ms} ms`);
    return result;
  }

  async buildRun(): Promise<Result<BuildReport>> {
    try {
      return ok((await this.fullBuild()).report);
    } catch (e) {
      return fail(e);
    }
  }

  /** Where builds read the engine and cc65 from (smoke report: the packaged app must use its own). */
  buildPaths(): { engineDir: string; toolchainDir: string } | null {
    return this.d.rom ? { engineDir: this.d.rom.engineDir, toolchainDir: this.d.rom.toolchainDir } : null;
  }

  buildLast(): BuildReport | null {
    return this.lastBuild?.result.report ?? null;
  }

  /** BOULON answers a red report: the AI with a key, else the catalog's own repair (offline). */
  private async askBoulon(report: BuildReport, attempt: number, max: number): Promise<AskResult> {
    const store = this.store!;
    if (this.provider().id === 'anthropic') {
      const r = await this.liveRuntime('build').send('build', fixRequest(report, attempt, max));
      this.d.emit({ director: 'build', type: 'done' });
      return { proposals: r.proposals, text: r.text, failure: r.failure };
    }
    const hint = report.problems.find((p) => p.severity === 'error' && p.hint)?.hint;
    if (!hint) return { proposals: [], text: '', failure: null };
    // the same tool, Ops and validation as the AI path (DirectorRuntime.manual)
    const runtime = new DirectorRuntime({ store, provider: new OfflineProvider(this.d.settings.get().locale), prices: this.prices, sources: this.sources });
    try {
      const p = runtime.manual('build', 'propose_split_stage', { stage: hint.stage });
      return { proposals: [p], text: p.summary.fr, failure: null };
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return { proposals: [], text: '', failure: { fr: `BOULON ne peut pas réparer seul : ${m}`, en: `BOULON cannot repair it alone: ${m}` } };
    }
  }

  async buildFix(again: unknown): Promise<Result<FixView>> {
    try {
      const cont = z.boolean().parse(again);
      if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
      if (!cont || !this.fixLoop) {
        this.fixLoop = new BuildFixLoop({
          build: async () => (await this.fullBuild()).report,
          ask: (r, n, max) => this.askBoulon(r, n, max),
        });
      }
      const st: FixLoopState = await this.fixLoop.step();
      return ok({
        state: st.state,
        attempts: st.attempts,
        max: MAX_FIX_ATTEMPTS,
        report: st.report,
        proposals: st.state === 'proposed' ? st.proposals : [],
        text: st.state === 'proposed' ? st.text : '',
        reason: st.state === 'stopped' || st.state === 'no-fix' ? st.reason : null,
      });
    } catch (e) {
      return fail(e);
    }
  }

  /** « Exporter »: green build -> .nes, split .bin, cartridge sheets (FR + EN), .dbg, project zip. */
  async buildExport(): Promise<Result<ExportView>> {
    try {
      if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
      const built = await this.fullBuild();
      if (!built.report.ok || !built.rom) {
        return { ok: false, fr: 'La construction n’est pas verte : répare d’abord avec BOULON.', en: 'The build is not green: repair it with BOULON first.' };
      }
      if (!this.d.licensesDir) throw new ProjectError('missing', 'notices introuvables', 'notices not found');
      const title = built.report.title || this.store.manifest.title;
      const dir = await (this.d.chooseExportDir ?? (async () => null))(fileTitle(title));
      if (!dir) return { ok: false, fr: 'Exportation annulée.', en: 'Export cancelled.' };
      const out = exportFiles({
        title,
        rom: built.rom,
        notices: loadNotices(this.d.licensesDir),
        appVersion: this.d.version,
        dbg: built.dbg,
        projectZip: exportProjectZip(this.store.dir),
      });
      mkdirSync(dir, { recursive: true });
      for (const f of out.files) writeFileSync(path.join(dir, f.name), f.bytes);
      this.d.log(`build:export ${out.files.length} files`);
      return ok({ dir, files: out.files.map((f) => ({ name: f.name, bytes: f.bytes.length })) });
    } catch (e) {
      return fail(e);
    }
  }

  // ---------- CHROMA (PLAN §6) ----------

  /** Keep a dropped image (PNG bytes made by the renderer) until it is converted. */
  chromaDrop(png: unknown, name: unknown): Result<ChromaSourceView> {
    try {
      const bytes = z.instanceof(Uint8Array).refine((b) => b.length <= 8_000_000, 'image trop lourde (8 Mo max)').parse(png);
      const label = z.string().max(80).parse(name);
      const img = decodePng(bytes);
      const base = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'image';
      let id = base;
      for (let i = 2; this.dropped.has(id); i++) id = `${base}-${i}`;
      if (this.dropped.size >= MAX_SOURCES) this.dropped.delete(this.dropped.keys().next().value!);
      const view: ChromaSourceView = { id, name: label || id, width: img.width, height: img.height };
      this.dropped.set(id, { ...view, png: bytes });
      return ok(view);
    } catch (e) {
      return fail(e);
    }
  }

  chromaSources(): ChromaSourceView[] {
    return this.sources.list();
  }

  /** Convert without writing anything: before/after, palettes, tiles, budget (worker thread). */
  async chromaPreview(raw: unknown): Promise<Result<ChromaPreviewView>> {
    try {
      if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
      const input = conversionInput.parse({ id: 'apercu', name: 'Aperçu', ...z.record(z.string(), z.unknown()).parse(raw) });
      const src = this.dropped.get(input.source);
      if (!src) return { ok: false, fr: 'Dépose d’abord une image.', en: 'Drop an image first.' };
      const docs = this.store.docs();
      const settings = settingsFor(input, src.width, src.height, docs);
      const job: ConvertJob = { png: src.png, settings, id: input.id, name: input.name, paletteSet: worldSet(docs, settings.world) };
      const r = await (this.d.convert ?? (async (j: ConvertJob) => runConvertJob(j)))(job);
      return ok({ ...r, settings });
    } catch (e) {
      return fail(e);
    }
  }

  /** The conversion as a pending proposal, through the same tool the AI uses. */
  chromaPropose(raw: unknown) {
    try {
      return ok(this.requireRuntime().manual('visual', 'propose_conversion', raw));
    } catch (e) {
      return fail(e);
    }
  }

  chromaEditTile(raw: unknown) {
    try {
      return ok(this.requireRuntime().manual('visual', 'edit_tile', editTileInput.parse(raw)));
    } catch (e) {
      return fail(e);
    }
  }

  /** Converted files for the panel (CHR bytes, preview PNGs). */
  chromaAsset(p: unknown): Uint8Array | null {
    const ok_ = z.string().regex(/^graphics\/(sources\/)?[a-z0-9-]{1,32}\.(png|chr)$/).safeParse(p);
    if (!ok_.success || !this.store) return null;
    return this.store.asset(ok_.data) ?? null;
  }

  // ---------- history / usage ----------

  history() {
    return this.store ? this.store.history() : [];
  }

  undo(): Result<ProjectView> {
    try {
      if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
      this.store.undo();
      return ok(this.view());
    } catch (e) {
      return fail(e);
    }
  }

  redo(): Result<ProjectView> {
    try {
      if (!this.store) throw new ProjectError('missing', 'Aucun projet ouvert.', 'No project open.');
      this.store.redo();
      return ok(this.view());
    } catch (e) {
      return fail(e);
    }
  }

  usage(): UsageView {
    const t = summarizeUsage(readUsage(this.usageFile));
    return { ...t, pricesCheckedAt: this.prices.checkedAt };
  }
}
