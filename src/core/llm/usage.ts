import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Usage } from './types.js';

// PLAN §4.5: one line per call in %APPDATA%\NES BLUM FACTORY\usage.jsonl (and in the director log).
export interface UsageRecord extends Usage {
  ts: string;
  projectId: string;
  director: string;
  model: string;
  costUsd: number;
  costKnown: boolean;
}

export function appendUsage(file: string, rec: UsageRecord): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(rec) + '\n');
}

export function readUsage(file: string): UsageRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageRecord);
}

export interface UsageTotals {
  calls: number;
  costUsd: number;
  byDirector: Record<string, number>;
  thisMonthUsd: number;
}

export function summarizeUsage(records: UsageRecord[], now: Date = new Date()): UsageTotals {
  const month = now.toISOString().slice(0, 7);
  const byDirector: Record<string, number> = {};
  let costUsd = 0;
  let thisMonthUsd = 0;
  for (const r of records) {
    costUsd += r.costUsd;
    byDirector[r.director] = (byDirector[r.director] ?? 0) + r.costUsd;
    if (r.ts.startsWith(month)) thisMonthUsd += r.costUsd;
  }
  return { calls: records.length, costUsd, byDirector, thisMonthUsd };
}
