import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameSpec } from '@game-creator/contracts';

export interface StandardFixture {
  runId: string;
  /** live_groq: run folder had provider-exchange.json from a real Groq call.
   * synthetic: written by hand for a physics or hazard case. */
  provenance: 'live_groq' | 'e2e_mock' | 'synthetic';
  source: string;
  provenanceNote?: string;
  /** The user prompt of the recorded run (request.json). */
  prompt?: string;
  note?: string;
  spec: unknown;
}

const directory = fileURLToPath(new URL('./fixtures/standard/', import.meta.url));

/** `name` is a run suffix (`c36f`) or a full file name without `.json`. */
export function standardFixture(name: string): StandardFixture {
  const files = readdirSync(directory).filter((file) => file === `${name}.json` || file.endsWith(`-${name}.json`));
  if (files.length !== 1) throw new Error(`Fixture ${name} matches ${files.length} files`);
  return JSON.parse(readFileSync(join(directory, files[0]!), 'utf8')) as StandardFixture;
}

/** A fresh copy of the GameSpec, typed for tests that pass it to repair directly. */
export function fixtureSpec(name: string): GameSpec {
  return structuredClone(standardFixture(name).spec) as GameSpec;
}
