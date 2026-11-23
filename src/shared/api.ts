// The window.blum contract between renderer and main. Types only: the sandboxed preload cannot
// import runtime code, and the renderer never sees Node.
import type { DirectorId, HistoryItem, Proposal } from '../core/project/proposal.js';
import type { Issue } from '../core/schema/common.js';
import type { ProjectManifest } from '../core/schema/project.js';
import type { FeatureFlags } from '../core/features.js';
import type { ConversionInput } from '../core/directors/chroma.js';
import type { EditTileInput } from '../core/directors/chroma-tile.js';
import type { ConvertSettings, GraphicsDoc } from '../core/schema/graphics.js';
import type { Palettes } from '../core/schema/misc.js';
import type { BuildReport } from '../core/build/report.js';

export type { BuildReport };

export type Locale = 'fr' | 'en';

export type Result<T> = { ok: true; value: T } | { ok: false; fr: string; en: string };

export interface Settings {
  locale: Locale;
  uiScale: 1 | 2 | 3;
  volume: number;
  muted: boolean;
  models: { directors: string; quality: string; chores: string };
  qualityMax: boolean;
  monthlyCapUsd: number | null;
  projectsDir: string;
}

export interface KeyStatusView {
  hasKey: boolean;
  masked: string | null;
  problem: { fr: string; en: string } | null;
  encryptionAvailable: boolean;
}

export interface ProjectSummary {
  dir: string;
  title: string;
  updatedAt: string;
  worlds: number;
  ok: boolean;
}

export interface ProjectView {
  dir: string;
  manifest: ProjectManifest;
  readOnly: boolean;
  issues: Issue[];
  storyTitle: string;
  worlds: number;
  stages: number;
  canUndo: boolean;
  canRedo: boolean;
  pending: number;
  docs: Record<string, unknown>;
}

export interface ChatLine {
  ts: string;
  role: 'user' | 'assistant';
  text: string;
  costUsd?: number;
  failure?: { fr: string; en: string };
}

export type DirectorEvent =
  | { director: DirectorId; type: 'text'; text: string }
  | { director: DirectorId; type: 'proposal'; proposal: Proposal }
  | { director: DirectorId; type: 'usage'; model: string; costUsd: number; costKnown: boolean }
  | { director: DirectorId; type: 'error'; fr: string; en: string }
  | { director: DirectorId; type: 'done' };

export interface SendView {
  text: string;
  proposals: Proposal[];
  failure: { fr: string; en: string } | null;
  costUsd: number;
}

export interface UsageView {
  calls: number;
  costUsd: number;
  thisMonthUsd: number;
  byDirector: Record<string, number>;
  pricesCheckedAt: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  smoke: boolean;
  provider: 'anthropic' | 'offline';
  features: FeatureFlags;
}

/** A ROM built in main for the in-app emulator (PLAN §7.3). */
export interface RomBuildView {
  rom: Uint8Array;
  title: string;
  /** PRG banks used (label, used, capacity), for the readout under the screen. */
  banks: Array<{ fr: string; en: string; used: number; capacity: number }>;
  fromCache: boolean;
  ms: number;
  /** SEBRING: the stage names, in route order; THE LEGEND OF BLUM: its chapters. */
  route?: Array<{ fr: string; en: string }>;
  /** The cartridge has a battery: the player keeps its PRG-RAM between sessions (rom.battery*). */
  battery?: boolean;
}

/** `sebring`: the prebuilt racer sample (resources/samples/SEBRING), its tracks file checked first (BLUMR-M2). */
/** `legend`: the prebuilt LEGEND OF BLUM slice (resources/samples/LEGEND, BLUMZ-F2), battery saved per user. */
export type RomSource = 'demo' | 'project' | 'sebring' | 'legend';
export type BatterySource = 'legend';

/** BOULON's fix loop, one round (PLAN §7, M5-T3). */
export interface FixView {
  state: 'green' | 'proposed' | 'no-fix' | 'stopped';
  attempts: number;
  max: number;
  report: BuildReport;
  proposals: Proposal[];
  text: string;
  reason: { fr: string; en: string } | null;
}

/** Files written by « Exporter » (PLAN §7.4). */
export interface ExportView {
  dir: string;
  files: Array<{ name: string; bytes: number }>;
}

/** An image dropped in the CHROMA panel, waiting to be converted. */
export interface ChromaSourceView {
  id: string;
  name: string;
  width: number;
  height: number;
}

/** A conversion that wrote nothing yet (PLAN §6). PNGs and CHR as bytes. */
export interface ChromaPreviewView {
  ok: boolean;
  errors: Array<{ fr: string; en: string }>;
  settings: ConvertSettings;
  doc: GraphicsDoc | null;
  chr: Uint8Array | null;
  before: Uint8Array | null;
  after: Uint8Array | null;
  proposedSet: Palettes['sets'][number] | null;
  /** Share (0..1) of the picture whose colour the NES version misses (W1 P1-2). */
  colourMiss: number;
  /** The same share with new palettes (free mode), for locked previews only. */
  freeColourMiss: number | null;
  ms: number;
}

export type ChromaRequest = Partial<ConversionInput> & Pick<ConversionInput, 'source' | 'kind' | 'role'>;

export interface BlumApi {
  versions: { electron: string; chrome: string };
  app: { info(): Promise<AppInfo> };
  settings: { get(): Promise<Settings>; set(patch: Partial<Settings>): Promise<Result<Settings>> };
  key: {
    status(): Promise<KeyStatusView>;
    save(key: string): Promise<Result<KeyStatusView>>;
    clear(): Promise<KeyStatusView>;
    test(): Promise<Result<{ model: string }>>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    create(title: string): Promise<Result<ProjectView>>;
    open(dir: string): Promise<Result<ProjectView>>;
    current(): Promise<ProjectView | null>;
    close(): Promise<void>;
    exportZip(): Promise<Result<{ path: string }>>;
    importZip(): Promise<Result<ProjectView>>;
    /** M6: a fresh copy of the sample game BLUM, opened. */
    openSample(): Promise<Result<ProjectView>>;
  };
  directors: {
    send(director: DirectorId, text: string): Promise<Result<SendView>>;
    cancel(director: DirectorId): Promise<void>;
    chat(director: DirectorId): Promise<ChatLine[]>;
    proposals(director: DirectorId): Promise<Proposal[]>;
    approve(id: string): Promise<Result<ProjectView>>;
    reject(id: string): Promise<Result<ProjectView>>;
    offline(director: DirectorId, choice: string): Promise<Result<Proposal>>;
    /** Editor panels: a tool call without the AI, validated like the AI's. */
    manual(director: DirectorId, tool: string, input: unknown): Promise<Result<Proposal>>;
    onEvent(cb: (e: DirectorEvent) => void): () => void;
  };
  history: {
    list(): Promise<HistoryItem[]>;
    undo(): Promise<Result<ProjectView>>;
    redo(): Promise<Result<ProjectView>>;
  };
  usage: { totals(): Promise<UsageView> };
  rom: {
    build(source: RomSource): Promise<Result<RomBuildView>>;
    /** Battery RAM of a sample with a battery (null before its first save). */
    batteryLoad(source: BatterySource): Promise<Uint8Array | null>;
    batterySave(source: BatterySource, bytes: Uint8Array): Promise<Result<true>>;
  };
  /** BOULON (PLAN §7): full build with report, fix loop, export. */
  build: {
    run(): Promise<Result<BuildReport>>;
    last(): Promise<BuildReport | null>;
    /** `again` continues the current loop after an approval; false starts a new one (5 builds max). */
    fix(again: boolean): Promise<Result<FixView>>;
    exportAll(): Promise<Result<ExportView>>;
  };
  chroma: {
    drop(png: Uint8Array, name: string): Promise<Result<ChromaSourceView>>;
    sources(): Promise<ChromaSourceView[]>;
    preview(req: ChromaRequest): Promise<Result<ChromaPreviewView>>;
    propose(req: ChromaRequest & { id: string; name: string }): Promise<Result<Proposal>>;
    editTile(req: EditTileInput): Promise<Result<Proposal>>;
    asset(path: string): Promise<Uint8Array | null>;
  };
}

/** Fixed IPC channel list (PLAN §2.2). */
export const CHANNELS = [
  'app:info',
  'settings:get',
  'settings:set',
  'key:status',
  'key:save',
  'key:clear',
  'key:test',
  'projects:list',
  'projects:create',
  'projects:open',
  'projects:current',
  'projects:close',
  'projects:export',
  'projects:import',
  'projects:sample',
  'directors:send',
  'directors:cancel',
  'directors:chat',
  'directors:proposals',
  'directors:approve',
  'directors:reject',
  'directors:offline',
  'directors:manual',
  'history:list',
  'history:undo',
  'history:redo',
  'usage:totals',
  'rom:build',
  'rom:batteryLoad',
  'rom:batterySave',
  'build:run',
  'build:last',
  'build:fix',
  'build:export',
  'chroma:drop',
  'chroma:sources',
  'chroma:preview',
  'chroma:propose',
  'chroma:editTile',
  'chroma:asset',
] as const;
export type Channel = (typeof CHANNELS)[number];
export const EVENT_CHANNEL = 'directors:event';
