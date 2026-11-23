// Converter fixture images (tests/fixtures/img/, drawn by scripts/make-fixture-images.mjs).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { decodePng, type RgbaImage } from '../../src/core/util/png';

export const IMG_DIR = path.join(import.meta.dirname, 'img');
export const fixtureBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(IMG_DIR, name)));
export const fixture = (name: string): RgbaImage => decodePng(fixtureBytes(name));
