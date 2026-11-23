// ld65 map file + error parser -> per-bank PRG usage (PLAN §5.3: budget panel, build error on overflow).

export interface MapSegment {
  name: string;
  start: number;
  end: number;
  size: number;
}

export interface MapExport {
  name: string;
  value: number;
}

export interface Ld65Map {
  segments: MapSegment[];
  exports: MapExport[];
}

export function parseLd65Map(text: string): Ld65Map {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const segments: MapSegment[] = [];
  const exports: MapExport[] = [];
  let section = '';
  for (const line of lines) {
    if (/^Segment list:/.test(line)) section = 'segments';
    else if (/^Exports list by name:/.test(line)) section = 'exports';
    else if (/^Exports list by value:/.test(line) || /^Imports list:/.test(line) || /^Modules list:/.test(line)) section = '';
    else if (section === 'segments') {
      const m = /^(\S+)\s+([0-9A-F]{6})\s+([0-9A-F]{6})\s+([0-9A-F]{6})\s+([0-9A-F]{5})\s*$/.exec(line);
      if (m) segments.push({ name: m[1]!, start: parseInt(m[2]!, 16), end: parseInt(m[3]!, 16), size: parseInt(m[4]!, 16) });
    } else if (section === 'exports') {
      // two exports per line: "name  value  flags  name  value  flags"
      const re = /(\S+)\s+([0-9A-F]{6})\s+\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) exports.push({ name: m[1]!, value: parseInt(m[2]!, 16) });
    }
  }
  return { segments, exports };
}

export interface BankUsage {
  area: string; // memory area name in the cfg (PRG0..PRG28, PRG, PRGE)
  label: string; // human label (French)
  labelEn: string;
  banks: number[];
  capacity: number;
  used: number;
  segments: string[];
  overflowBytes: number;
}

/** Memory area of each segment in engine/cfg/blum_mmc3.cfg. */
export function areaOfSegment(seg: string): string | null {
  const bank = /^BANK(\d+)$/.exec(seg);
  if (bank) return `PRG${bank[1]}`;
  if (seg === 'SOUND') return 'PRG28';
  if (['LOWCODE', 'INIT', 'CODE', 'RODATA', 'DATA', 'ONCE'].includes(seg)) return 'PRG';
  if (seg === 'STARTUP' || seg === 'VECTORS') return 'PRGE';
  return null;
}

function areaInfo(area: string): { label: string; labelEn: string; banks: number[]; capacity: number } {
  if (area === 'PRG') return { label: 'code fixe $A000-$DFFF', labelEn: 'fixed code $A000-$DFFF', banks: [29, 30], capacity: 0x4000 };
  if (area === 'PRGE') return { label: 'démarrage $E000-$FFFF', labelEn: 'startup $E000-$FFFF', banks: [31], capacity: 0x2000 };
  const n = Number(area.slice(3));
  return n === 28
    ? { label: 'banque SOUND', labelEn: 'SOUND bank', banks: [n], capacity: 0x2000 }
    : { label: `banque ${n}`, labelEn: `bank ${n}`, banks: [n], capacity: 0x2000 };
}

/** `Segment "X" overflows memory area "Y" by N bytes` (ld65). */
export function parseOverflows(ld65Output: string): Array<{ segment: string; area: string; bytes: number }> {
  const out: Array<{ segment: string; area: string; bytes: number }> = [];
  // ld65 quotes names with ‘…’ (2.19 snapshot) or '…' / "…" (older builds).
  const re = /Segment [`'"‘’]?(\w+)[`'"‘’]? overflows memory area [`'"‘’]?(\w+)[`'"‘’]? by (\d+) bytes?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ld65Output))) out.push({ segment: m[1]!, area: m[2]!, bytes: Number(m[3]) });
  return out;
}

/** Per-bank usage from a map (when the link succeeded) and/or the overflow errors (when it failed). */
export function bankUsage(map: Ld65Map | null, ld65Output = ''): BankUsage[] {
  const byArea = new Map<string, BankUsage>();
  const get = (area: string) => {
    let u = byArea.get(area);
    if (!u) {
      const info = areaInfo(area);
      u = { area, ...info, used: 0, segments: [], overflowBytes: 0 };
      byArea.set(area, u);
    }
    return u;
  };
  for (const s of map?.segments ?? []) {
    const area = areaOfSegment(s.name);
    if (!area) continue;
    const u = get(area);
    u.used += s.size;
    if (s.size > 0) u.segments.push(s.name);
  }
  for (const o of parseOverflows(ld65Output)) {
    const u = get(o.area);
    u.overflowBytes += o.bytes;
    if (!u.segments.includes(o.segment)) u.segments.push(o.segment);
    u.used = Math.max(u.used, u.capacity + u.overflowBytes);
  }
  const order = (a: string) => (a === 'PRG' ? 100 : a === 'PRGE' ? 101 : Number(a.slice(3)));
  return [...byArea.values()].sort((a, b) => order(a.area) - order(b.area));
}
