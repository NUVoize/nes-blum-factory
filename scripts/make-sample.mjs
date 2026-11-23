// M6 (PLAN §12.3): writes the sample game BLUM into resources/samples/BLUM.blum by replaying the
// hand-authored proposals through the app's DirectorRuntime + FakeProvider (src/core/sample/blum.ts).
// The folder is committed and shipped (extraResources); the app copies it before opening it.
// Run after `npm run build` (needs dist/): node scripts/make-sample.mjs
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dist = (p) => path.join(root, 'dist', 'electron', 'core', ...p.split('/'));
const { makeSampleBlum } = require(dist('sample/blum.js'));
const { pricesSchema } = require(dist('llm/prices.js'));

const prices = pricesSchema.parse(JSON.parse(readFileSync(path.join(root, 'config', 'prices.json'), 'utf8')));
const samples = path.join(root, 'resources', 'samples');
const target = path.join(samples, 'BLUM.blum');
const fresh = path.join(root, '.tmp', 'sample-new', 'BLUM.blum');
rmSync(path.dirname(fresh), { recursive: true, force: true });
mkdirSync(path.dirname(fresh), { recursive: true });
const { store, approved } = await makeSampleBlum(fresh, prices);
store.close();
rmSync(path.join(fresh, '.lock'), { force: true });
rmSync(path.join(fresh, 'build'), { recursive: true, force: true });
mkdirSync(samples, { recursive: true });
if (existsSync(target)) {
  // the previous sample goes to .tmp (never deleted in place from the repo by this script)
  const old = path.join(root, '.tmp', `sample-old-${Date.now()}`);
  renameSync(target, old);
}
renameSync(fresh, target);
console.log(`sample: ${approved.length} approved proposals -> ${path.relative(root, target)}`);
