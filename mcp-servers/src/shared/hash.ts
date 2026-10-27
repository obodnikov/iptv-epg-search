/**
 * hash.ts - the hashes of the servers.
 *
 * One implementation of sha256 for the whole product: the hash of the source
 * URL, the hash of a file and the hash of an embedding text are the same
 * function.
 */

import { createHash } from 'node:crypto';

/**
 * sha256 of a text, as hex.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The first characters of the sha256 of a text.
 *
 * The stable id of a title is the first 16 hex characters of a hash
 * (design: cinema-server.md §3.2): 64 bits are enough for the few thousand
 * titles of a catalogue.
 */
export function sha256Prefix(text: string, length = 16): string {
  return sha256(text).slice(0, length);
}
