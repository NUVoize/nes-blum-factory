// RFC 6901 JSON Pointer helpers on plain JSON values. All functions are pure: they return copies.
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`pointeur JSON invalide : ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function containerAt(root: Json, parts: string[]): Json {
  let cur: Json = root;
  for (const p of parts) {
    if (Array.isArray(cur)) cur = cur[Number(p)] as Json;
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, Json>)[p] as Json;
    else throw new Error(`chemin introuvable : /${parts.join('/')}`);
    if (cur === undefined) throw new Error(`chemin introuvable : /${parts.join('/')}`);
  }
  return cur;
}

export function getAt(root: Json, pointer: string): Json | undefined {
  try {
    return containerAt(root, parsePointer(pointer));
  } catch {
    return undefined;
  }
}

/** Replace (or create) the value at `pointer`. Arrays: index must exist, or be `-` / length to append. */
export function setAt(root: Json, pointer: string, value: Json): Json {
  const parts = parsePointer(pointer);
  if (parts.length === 0) return clone(value);
  const out = clone(root);
  const parent = containerAt(out, parts.slice(0, -1));
  const key = parts[parts.length - 1]!;
  if (Array.isArray(parent)) {
    const idx = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new Error(`index invalide : ${pointer}`);
    parent[idx] = clone(value);
  } else if (parent && typeof parent === 'object') {
    (parent as Record<string, Json>)[key] = clone(value);
  } else {
    throw new Error(`chemin introuvable : ${pointer}`);
  }
  return out;
}

/** Insert into an array (index or `-`) or add an object key. */
export function addAt(root: Json, pointer: string, value: Json): Json {
  const parts = parsePointer(pointer);
  const out = clone(root);
  const parent = containerAt(out, parts.slice(0, -1));
  const key = parts[parts.length - 1]!;
  if (Array.isArray(parent)) {
    const idx = key === '-' ? parent.length : Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) throw new Error(`index invalide : ${pointer}`);
    parent.splice(idx, 0, clone(value));
    return out;
  }
  return setAt(root, pointer, value);
}

export function removeAt(root: Json, pointer: string): Json {
  const parts = parsePointer(pointer);
  if (parts.length === 0) throw new Error('impossible de retirer la racine');
  const out = clone(root);
  const parent = containerAt(out, parts.slice(0, -1));
  const key = parts[parts.length - 1]!;
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) throw new Error(`index invalide : ${pointer}`);
    parent.splice(idx, 1);
  } else if (parent && typeof parent === 'object' && key in parent) {
    delete (parent as Record<string, Json>)[key];
  } else {
    throw new Error(`chemin introuvable : ${pointer}`);
  }
  return out;
}
