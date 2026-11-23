import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { DEFAULT_FEATURES, type FeatureFlags } from '../features.js';
import type { Issue } from '../schema/common.js';
import { isAssetPath, META_DIRS, schemaForDoc, validateProjectDocs } from '../schema/documents.js';
import { demoDocs } from '../engine-data/demo.js';
import { placeholderProject } from '../engine-data/placeholder.js';
import { ENGINE_DATA_VERSION } from '../engine-data/contract.js';
import { DEFAULT_AUDIO, DEFAULT_PALETTES } from '../schema/misc.js';
import { DEFAULT_PHYSICS } from '../schema/physics.js';
import { DEFAULT_CARTRIDGE, PROJECT_FORMAT, type ProjectManifest } from '../schema/project.js';
import { DEFAULT_STORY } from '../schema/story.js';
import { atomicWriteFile, type AtomicHooks } from '../util/atomic.js';
import { sha256 } from '../util/hash.js';
import type { Json } from '../util/json-pointer.js';
import { ulid } from '../util/ulid.js';
import { applyOps, serializeDoc, type DocSet, type Op } from './ops.js';
import {
  journalEntrySchema,
  proposalSchema,
  type DirectorId,
  type HistoryItem,
  type JournalEntry,
  type Proposal,
} from './proposal.js';

// PLAN §3: a project is a plain folder. Every subfolder exists from creation so the layout is stable.
export const PROJECT_DIRS = [
  'actors',
  'scripts',
  'graphics',
  'graphics/sources',
  'tilesets',
  'levels',
  'audio',
  'directors',
  'proposals',
  'history',
  'history/snapshots',
  'build',
] as const;

export const JOURNAL = 'history/journal.jsonl';
export const LOCK_FILE = '.lock';

export class ProjectError extends Error {
  constructor(
    readonly code: 'locked' | 'invalid' | 'exists' | 'missing' | 'readonly' | 'nothing',
    readonly fr: string,
    readonly en: string,
    readonly issues: Issue[] = [],
  ) {
    super(en);
  }
}

export interface CreateOptions {
  title: string;
  locale?: 'fr' | 'en';
  now?: () => Date;
  /** false: no placeholder art (a bare project, for tests). Default true. */
  placeholderArt?: boolean;
}

export interface StoreOptions {
  flags?: FeatureFlags;
  now?: () => Date;
  /** Test hook passed to every atomic write. */
  atomicHooks?: AtomicHooks;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}


/** Walk the project folder and return document and asset paths (posix, relative). */
function listProjectFiles(dir: string): { docs: string[]; assets: string[] } {
  const docs: string[] = [];
  const assets: string[] = [];
  const walk = (rel: string) => {
    for (const ent of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!rel && (META_DIRS as readonly string[]).includes(ent.name)) continue;
        walk(r);
      } else if (schemaForDoc(r)) docs.push(r);
      else if (isAssetPath(r)) assets.push(r);
    }
  };
  walk('');
  return { docs: docs.sort(), assets: assets.sort() };
}

export class ProjectStore {
  private state: DocSet;
  private closed = false;
  private invalid: boolean;
  private issuesAtLoad: Issue[];
  private readonly flags: FeatureFlags;
  private readonly now: () => Date;
  private readonly hooks: AtomicHooks;

  private constructor(readonly dir: string, opts: StoreOptions) {
    this.flags = opts.flags ?? DEFAULT_FEATURES;
    this.now = opts.now ?? (() => new Date());
    this.hooks = opts.atomicHooks ?? {};
    this.acquireLock();
    try {
      this.state = this.loadFromDisk();
      this.issuesAtLoad = validateProjectDocs(this.state.docs, this.flags);
      // An invalid project opens read-only with a clear message, never silently fixed (PLAN §3).
      this.invalid = this.issuesAtLoad.some((i) => i.severity === 'error');
    } catch (e) {
      this.releaseLock();
      throw e;
    }
  }

  /**
   * Read-only while the documents on disk are invalid. The only write accepted then is a repair: an
   * approved proposal whose result passes every check (BOULON's fixes, M5); undo and redo stay blocked.
   */
  get readOnly(): boolean {
    return this.invalid;
  }

  get loadIssues(): Issue[] {
    return this.issuesAtLoad;
  }

  static create(dir: string, opts: CreateOptions, storeOpts: StoreOptions = {}): ProjectStore {
    if (existsSync(dir) && readdirSync(dir).length > 0) {
      throw new ProjectError('exists', `le dossier existe déjà : ${dir}`, `folder already exists: ${dir}`);
    }
    const now = (opts.now ?? storeOpts.now ?? (() => new Date()))().toISOString();
    for (const d of PROJECT_DIRS) mkdirSync(path.join(dir, d), { recursive: true });
    const manifest: ProjectManifest = {
      format: PROJECT_FORMAT,
      schemaVersion: 1,
      id: ulid(),
      title: opts.title,
      locale: opts.locale ?? 'fr',
      engineDataVersion: ENGINE_DATA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    const art = placeholderProject();
    const initial: Record<string, unknown> = {
      'project.json': manifest,
      'cartridge.json': DEFAULT_CARTRIDGE,
      'story.json': { ...DEFAULT_STORY, title: opts.title.slice(0, 24).toUpperCase() },
      'physics.json': DEFAULT_PHYSICS,
      'graphics/palettes.json': DEFAULT_PALETTES,
      'audio/library.json': DEFAULT_AUDIO,
      // the demo stage, so a new project builds and plays right away (PLAN §1.2)
      ...demoDocs(),
      // the placeholder art set (hero wired in, the rest in the graphics library), MILESTONES M3
      ...(opts.placeholderArt === false ? {} : art.docs),
    };
    const issues = validateProjectDocs(initial as Record<string, Json>);
    if (issues.length) throw new ProjectError('invalid', issues[0]!.fr, issues[0]!.en, issues);
    for (const [p, v] of Object.entries(initial)) atomicWriteFile(path.join(dir, p), serializeDoc(v as Json));
    if (opts.placeholderArt !== false) for (const [p, b] of Object.entries(art.assets)) atomicWriteFile(path.join(dir, p), b);
    writeFileSync(path.join(dir, JOURNAL), '');
    return new ProjectStore(dir, storeOpts);
  }

  static open(dir: string, storeOpts: StoreOptions = {}): ProjectStore {
    if (!existsSync(path.join(dir, 'project.json'))) {
      throw new ProjectError('missing', `aucun projet ici : ${dir}`, `no project here: ${dir}`);
    }
    return new ProjectStore(dir, storeOpts);
  }

  // ---------- lock ----------

  private acquireLock(): void {
    const lockPath = path.join(this.dir, LOCK_FILE);
    if (existsSync(lockPath)) {
      let pid = -1;
      try {
        pid = Number(JSON.parse(readFileSync(lockPath, 'utf8')).pid);
      } catch {
        // unreadable lock = stale
      }
      if (pid > 0 && pidAlive(pid)) {
        throw new ProjectError(
          'locked',
          `ce projet est déjà ouvert (processus ${pid})`,
          `this project is already open (process ${pid})`,
        );
      }
      rmSync(lockPath, { force: true });
    }
    try {
      writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname() }), {
        flag: 'wx',
      });
    } catch {
      throw new ProjectError('locked', 'ce projet est déjà ouvert', 'this project is already open');
    }
  }

  private releaseLock(): void {
    rmSync(path.join(this.dir, LOCK_FILE), { force: true });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseLock();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  // ---------- reading ----------

  private loadFromDisk(): DocSet {
    const { docs, assets } = listProjectFiles(this.dir);
    const out: DocSet = { docs: {}, assets: {} };
    for (const d of docs) {
      const text = readFileSync(path.join(this.dir, d), 'utf8');
      try {
        out.docs[d] = JSON.parse(text) as Json;
      } catch {
        throw new ProjectError('invalid', `fichier JSON illisible : ${d}`, `unreadable JSON file: ${d}`);
      }
    }
    for (const a of assets) out.assets[a] = new Uint8Array(readFileSync(path.join(this.dir, a)));
    return out;
  }

  get manifest(): ProjectManifest {
    return this.state.docs['project.json'] as unknown as ProjectManifest;
  }

  docs(): Record<string, Json> {
    return structuredClone(this.state.docs);
  }

  /** Binary files (CHR banks, images), read-only copies. */
  assets(): Record<string, Uint8Array> {
    return Object.fromEntries(Object.entries(this.state.assets).map(([k, v]) => [k, v.slice()]));
  }

  asset(p: string): Uint8Array | undefined {
    return this.state.assets[p]?.slice();
  }

  doc<T = Json>(docPath: string): T | undefined {
    const v = this.state.docs[docPath];
    return v === undefined ? undefined : (structuredClone(v) as T);
  }

  /** sha256 of every document and asset as stored on disk. */
  fileHashes(): Record<string, string> {
    const { docs, assets } = listProjectFiles(this.dir);
    const out: Record<string, string> = {};
    for (const f of [...docs, ...assets]) out[f] = sha256(readFileSync(path.join(this.dir, f)));
    return out;
  }

  // ---------- transactions ----------

  /** Dry-run ops on an in-memory copy: schemas + budgets. Never touches the disk. */
  dryRun(ops: Op[]): { ok: boolean; issues: Issue[]; next: DocSet | null } {
    let next: DocSet;
    try {
      next = applyOps(this.state, ops);
    } catch (e) {
      const msg = (e as Error).message;
      return { ok: false, issues: [{ doc: '', path: '', severity: 'error', fr: msg, en: msg }], next: null };
    }
    const issues = validateProjectDocs(next.docs, this.flags);
    return { ok: !issues.some((i) => i.severity === 'error'), issues, next };
  }

  private assertWritable(repair = false): void {
    if (this.closed) throw new ProjectError('readonly', 'projet fermé', 'project closed');
    if (this.invalid && !repair) throw new ProjectError('readonly', 'projet en lecture seule (documents invalides)', 'project is read-only (invalid documents)');
  }

  private fileBytes(state: DocSet, p: string): Buffer | null {
    if (p in state.docs) return Buffer.from(serializeDoc(state.docs[p]!), 'utf8');
    if (p in state.assets) return Buffer.from(state.assets[p]!);
    return null;
  }

  private appendJournal(entry: JournalEntry): void {
    journalEntrySchema.parse(entry);
    const fd = openSync(path.join(this.dir, JOURNAL), 'a');
    try {
      appendFileSync(fd, JSON.stringify(entry) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Approve = one transaction: snapshot, atomic writes, journal line (PLAN §4.3 step 6). */
  apply(input: { director: DirectorId | 'manual'; summary: { fr: string; en: string }; ops: Op[]; proposalId?: string }): JournalEntry {
    // on an invalid project only a repair passes: dryRun below demands a fully valid result
    this.assertWritable(true);
    const { ok, issues, next } = this.dryRun(input.ops);
    if (!ok || !next) {
      const e = this.invalid ? new ProjectError('readonly', 'projet en lecture seule (documents invalides)', 'project is read-only (invalid documents)', issues) : new ProjectError('invalid', issues[0]?.fr ?? 'proposition invalide', issues[0]?.en ?? 'invalid proposal', issues);
      throw e;
    }

    const paths = new Set([...Object.keys(this.state.docs), ...Object.keys(next.docs), ...Object.keys(this.state.assets), ...Object.keys(next.assets)]);
    const changed: Array<{ path: string; before: Buffer | null; after: Buffer | null }> = [];
    for (const p of [...paths].sort()) {
      const before = this.fileBytes(this.state, p);
      const after = this.fileBytes(next, p);
      if (before === null && after === null) continue;
      if (before && after && before.equals(after)) continue;
      changed.push({ path: p, before, after });
    }
    if (changed.length === 0) throw new ProjectError('nothing', 'aucun changement', 'no change');

    const txId = ulid(this.now().getTime());
    const snapDir = path.join(this.dir, 'history', 'snapshots', txId);
    for (const c of changed) {
      if (c.before) atomicWriteFile(path.join(snapDir, 'before', c.path), c.before);
      if (c.after) atomicWriteFile(path.join(snapDir, 'after', c.path), c.after);
    }
    this.writeFiles(changed.map((c) => ({ path: c.path, bytes: c.after })));
    this.state = next;
    const entry: JournalEntry = {
      id: txId,
      kind: 'apply',
      ts: this.now().toISOString(),
      director: input.director,
      summary: input.summary,
      ops: input.ops,
      files: changed.map((c) => ({ path: c.path, before: c.before ? sha256(c.before) : null, after: c.after ? sha256(c.after) : null })),
      ...(input.proposalId ? { proposalId: input.proposalId } : {}),
    };
    this.appendJournal(entry);
    if (this.invalid) {
      this.invalid = false;
      this.issuesAtLoad = issues;
    }
    return entry;
  }

  private writeFiles(files: Array<{ path: string; bytes: Buffer | null }>): void {
    for (const f of files) {
      const abs = path.join(this.dir, f.path);
      if (f.bytes) atomicWriteFile(abs, f.bytes, this.hooks);
      else rmSync(abs, { force: true });
    }
  }

  journal(): JournalEntry[] {
    const text = readFileSync(path.join(this.dir, JOURNAL), 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => journalEntrySchema.parse(JSON.parse(l)));
  }

  /** Done/redo stacks derived from the append-only journal. */
  private stacks(): { done: JournalEntry[]; redo: JournalEntry[] } {
    const byId = new Map<string, JournalEntry>();
    const done: JournalEntry[] = [];
    let redo: JournalEntry[] = [];
    for (const e of this.journal()) {
      if (e.kind === 'apply') {
        byId.set(e.id, e);
        done.push(e);
        redo = [];
      } else if (e.kind === 'undo') {
        const t = done.pop();
        if (t) redo.push(t);
      } else {
        const t = redo.pop();
        if (t) done.push(t);
      }
    }
    return { done, redo };
  }

  canUndo(): boolean {
    return this.stacks().done.length > 0;
  }

  canRedo(): boolean {
    return this.stacks().redo.length > 0;
  }

  private restore(tx: JournalEntry, side: 'before' | 'after'): void {
    const snapDir = path.join(this.dir, 'history', 'snapshots', tx.id, side);
    const files = tx.files.map((f) => ({
      path: f.path,
      bytes: f[side] === null ? null : readFileSync(path.join(snapDir, f.path)),
    }));
    this.writeFiles(files);
    this.state = this.loadFromDisk();
  }

  /** Undo restores the snapshot and appends an `undo` entry; nothing is erased (PLAN §3). */
  undo(): JournalEntry {
    this.assertWritable();
    const tx = this.stacks().done.at(-1);
    if (!tx) throw new ProjectError('nothing', 'rien à annuler', 'nothing to undo');
    this.restore(tx, 'before');
    const entry: JournalEntry = { id: ulid(this.now().getTime()), kind: 'undo', ts: this.now().toISOString(), target: tx.id, files: tx.files.map((f) => ({ path: f.path, before: f.after, after: f.before })) };
    this.appendJournal(entry);
    return entry;
  }

  redo(): JournalEntry {
    this.assertWritable();
    const tx = this.stacks().redo.at(-1);
    if (!tx) throw new ProjectError('nothing', 'rien à refaire', 'nothing to redo');
    this.restore(tx, 'after');
    const entry: JournalEntry = { id: ulid(this.now().getTime()), kind: 'redo', ts: this.now().toISOString(), target: tx.id, files: tx.files };
    this.appendJournal(entry);
    return entry;
  }

  history(): HistoryItem[] {
    const { done, redo } = this.stacks();
    const items = [
      ...done.map((e) => ({ e, state: 'applied' as const })),
      ...redo.map((e) => ({ e, state: 'undone' as const })),
    ];
    return items
      .sort((a, b) => (a.e.id < b.e.id ? 1 : -1))
      .map(({ e, state }) => ({
        id: e.id,
        ts: e.ts,
        director: e.director ?? 'manual',
        summary: e.summary ?? { fr: '', en: '' },
        files: e.files.map((f) => f.path),
        state,
      }));
  }

  // ---------- proposals and chat logs (metadata, not journaled) ----------

  saveProposal(p: Proposal): void {
    proposalSchema.parse(p);
    atomicWriteFile(path.join(this.dir, 'proposals', `${p.id}.json`), JSON.stringify(p, null, 2) + '\n');
  }

  proposal(id: string): Proposal | null {
    const f = path.join(this.dir, 'proposals', `${id}.json`);
    if (!/^[0-9A-Z]{26}$/.test(id) || !existsSync(f)) return null;
    return proposalSchema.parse(JSON.parse(readFileSync(f, 'utf8')));
  }

  proposals(director?: DirectorId): Proposal[] {
    const dir = path.join(this.dir, 'proposals');
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => proposalSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))))
      .filter((p) => !director || p.director === director);
  }

  appendChat(director: DirectorId, entry: Record<string, unknown>): void {
    appendFileSync(path.join(this.dir, 'directors', `${director}.jsonl`), JSON.stringify(entry) + '\n');
  }

  chat(director: DirectorId): Array<Record<string, unknown>> {
    const f = path.join(this.dir, 'directors', `${director}.jsonl`);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

