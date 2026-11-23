// The build report (PLAN §7.1 step 7): pure types, shared by main, the worker and the renderer.
import type { BuildStepId, Problem } from './errors.js';

export interface StepView {
  id: BuildStepId;
  /** null = not run (an earlier step failed). */
  ok: boolean | null;
  ms: number;
}

export interface BuildReport {
  ok: boolean;
  title: string;
  at: string;
  ms: number;
  steps: StepView[];
  /** Errors first, then warnings. */
  problems: Problem[];
  banks: Array<{ fr: string; en: string; used: number; capacity: number }>;
  chr: Array<{ name: string; bank1k: number; used: number; capacity: number }>;
  rom: { bytes: number; header: string; sha1: string; crc32: string } | null;
  run: { frames: number; lagFrames: number; probe: boolean; advancing: boolean; blank: boolean } | null;
}
