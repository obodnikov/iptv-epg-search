/**
 * Helper for the test fixtures.
 *
 * The fixtures are hand-made excerpts of the provider's catalogue with the
 * hosts replaced by example.invalid and the keys by KEY. Real catalogue files
 * never enter the repository (design: iptv-mcp-servers.md §10).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Read a fixture file by name.
 */
export function fixture(name: string): string {
  return readFileSync(join(here, name), 'utf8');
}
