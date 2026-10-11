/**
 * Loads the generated character models straight from disk, for the headless
 * test harness and the screenshot tool — neither of which has a browser to
 * `fetch()` from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ModelLibrary } from '../src/characters/models';
import { ROSTER } from '../src/characters/roster';

export function readModelBuffer(id: string): ArrayBuffer {
  const file = path.resolve(process.cwd(), 'public/models', `${id}.glb`);
  const buffer = fs.readFileSync(file);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

export async function loadModelLibrary(): Promise<ModelLibrary> {
  const library = new ModelLibrary();
  for (const profile of ROSTER) {
    await library.parse(profile.id, readModelBuffer(profile.id));
  }
  return library;
}
