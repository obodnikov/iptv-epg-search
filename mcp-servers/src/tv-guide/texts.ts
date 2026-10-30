/**
 * texts.ts - the deduplicated programme texts.
 *
 * Programmes repeat heavily: the 321,787 programmes of the sample carry
 * only 60,447 distinct (title, description) pairs (design:
 * tv-guide-server.md §2.3). Classification, extraction, the keyword index
 * and the vectors are all per **text**, not per programme.
 *
 * The hash is over the pair exactly as the source wrote it: the derived
 * fields (the cleaned title, the facts of phase T2) change when their
 * extraction improves, but a text whose source pair did not change must
 * not get a new hash and a new vector.
 */

import { createHash } from 'node:crypto';

import { normalizeText, normalizeTitle } from '../shared/text.ts';

/**
 * One distinct (title, description) pair.
 */
export interface ProgrammeText {
  /** The title as the source wrote it. The markers are removed in T2. */
  title: string;
  /** The description as the source wrote it, or an empty string. */
  description: string;
  /** The normalised title (lower case, ё→е, punctuation collapsed). */
  titleNorm: string;
  /** The text that is embedded (phase T4 consumes it). */
  embedText: string;
  /** The hash of the source pair. */
  hash: string;
}

/**
 * The hash of a (title, description) pair.
 *
 * The lengths are part of the input, so that a title that ends where a
 * description begins cannot forge the same input.
 */
export function programmeTextHash(title: string, description: string): string {
  const hash = createHash('sha256');
  hash.update(`${title.length}`);
  hash.update('\u0000');
  hash.update(title);
  hash.update('\u0000');
  hash.update(description);
  hash.update('\u0000');
  return hash.digest('hex');
}

/**
 * Build the record of one programme text.
 *
 * The embedding text of T1 is the title and the description; the facts of
 * phase T2 (kind, people, countries, year) are added to it when they
 * exist, and the change re-queues the text for embedding.
 */
export function buildProgrammeText(title: string, description: string): ProgrammeText {
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();

  const parts: string[] = [];
  if (cleanTitle) parts.push(cleanTitle);
  const embedText = normalizeText(parts.join('.\n') + (cleanDescription ? `\n${cleanDescription}` : ''));

  return {
    title: cleanTitle,
    description: cleanDescription,
    titleNorm: normalizeTitle(cleanTitle),
    embedText,
    hash: programmeTextHash(cleanTitle, cleanDescription),
  };
}
