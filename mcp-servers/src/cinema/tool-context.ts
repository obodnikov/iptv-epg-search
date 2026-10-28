/**
 * tool-context.ts - what the tools of the cinema server need, and the
 * answers they share.
 *
 * The context is the same for every tool: the database, the settings, the
 * logger, the refresh, the client of the embedding service, the cache of
 * the queries and the worker of the embeddings.
 *
 * The helpers of this module answer the questions that every tool asks: is
 * the server configured, is the catalogue empty, are the values of the
 * filters real, may this title be shown.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type RefreshRunner } from '../shared/refresh.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type TextEmbedder } from '../shared/embeddings.ts';
import { errorResult } from '../shared/tool-kit.ts';
import { readCinemaSettings, type CinemaSettings } from './config.ts';
import { categoryValues, genreValues, unknownValues, valueNames } from './filters.ts';
import { type Embedder } from './embedder.ts';
import { QueryCache } from './query-cache.ts';
import type { RefreshStart } from './refresh.ts';

/**
 * The vector of a query.
 *
 * The vector is asked of the service once and kept: a repeated search or
 * the next page of a search costs nothing (design: iptv-mcp-servers.md
 * §7.4).
 *
 * @returns the vector, or null when the meaning is not available.
 */
export async function embedQuery(
  ctx: CinemaToolContext,
  text: string,
  model: string,
): Promise<Float32Array | null> {
  if (!text.trim()) return null;

  const cached = ctx.queryCache.get(model, text);
  if (cached) return cached;

  const vector = await ctx.client.embed(text);
  if (!vector) return null;

  ctx.queryCache.set(model, text, vector);
  return vector;
}

/**
 * The most titles a list may hold.
 *
 * The design says 50 (cinema-server.md §6.1); the schema of the tools
 * says the same, and the setting `search.maxLimit` may not promise more.
 */
export const MAX_LIMIT = 50;

/** Everything the tools of the cinema server need. */
export interface CinemaToolContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /** Starts a refresh in the background. */
  refresh: (force: boolean) => RefreshStart;
  /** The client of the embedding service. */
  client: TextEmbedder;
  /** The cache of the vectors of the queries. */
  queryCache: QueryCache;
  /** The background worker of the embeddings. */
  worker: Embedder;
}

/**
 * The settings of the server, as they are now.
 */
export function settingsOf(ctx: CinemaToolContext): CinemaSettings {
  return readCinemaSettings(ctx.settings.settings());
}

/**
 * The number of the titles that are in the catalogue right now.
 */
function liveTitleCount(db: Db): number {
  return (
    db.get<{ found: number }>(
      'SELECT count(*) AS found FROM titles WHERE removed_at IS NULL',
    )?.found ?? 0
  );
}

/**
 * The answer when the URL of the provider is not set.
 *
 * The message names the file the owner has to fill in.
 */
export function notConfigured(ctx: CinemaToolContext): CallToolResult {
  return errorResult(`Cinema URL is not set: edit ${ctx.settings.path}`);
}

/**
 * The answer when the catalogue is empty.
 *
 * @returns the answer, or null when the catalogue holds something.
 */
export function catalogueEmpty(ctx: CinemaToolContext): CallToolResult | null {
  if (liveTitleCount(ctx.db) > 0) return null;

  const progress = ctx.runner.progress();
  if (progress.running) {
    return errorResult(
      `The catalogue is empty: a refresh is running (${progress.phase}). Try again in about a minute.`,
    );
  }
  return errorResult(
    'The catalogue is empty. Run refresh_catalog to import it, then try again.',
  );
}

/**
 * How many valid values an error message names.
 *
 * The catalogue of a provider holds dozens of genres and countries: the
 * whole list in every error would fill the context of the model. The rest
 * is in `list_facets`.
 */
const MAX_LISTED_VALUES = 20;

/**
 * The names of the valid values, shortened when there are many.
 */
function listedValues(values: string[]): string {
  if (values.length <= MAX_LISTED_VALUES) return values.join(', ');
  return `${values.slice(0, MAX_LISTED_VALUES).join(', ')}, … (call list_facets for all of them)`;
}

/**
 * Check that the genres and the categories of a search are values of the
 * catalogue.
 *
 * An unknown value is an error that lists the valid ones: the model must
 * not guess a spelling (design: iptv-mcp-servers.md §8.2).
 */
export function checkFacetValues(
  ctx: CinemaToolContext,
  settings: CinemaSettings,
  genres: string[],
  categories: string[],
  excludeGenres: string[],
): CallToolResult | null {
  const problems: string[] = [];

  const knownGenres = genreValues(ctx.db, settings.includeAdult);
  for (const wanted of [genres, excludeGenres]) {
    if (wanted.length === 0) continue;
    const missing = unknownValues(wanted, knownGenres);
    if (missing.length > 0) {
      problems.push(
        `Genre '${missing.join("', '")}' not found. Valid: ${listedValues(valueNames(knownGenres))}`,
      );
    }
  }

  if (categories.length > 0) {
    const known = categoryValues(ctx.db, settings.includeAdult);
    const missing = unknownValues(categories, known);
    if (missing.length > 0) {
      problems.push(
        `Category '${missing.join("', '")}' not found. Valid: ${listedValues(valueNames(known))}`,
      );
    }
  }

  if (problems.length === 0) return null;
  return errorResult(problems.join(' '));
}

/**
 * The answer when a title is adult content and the setting does not allow
 * it.
 *
 * The rule of the design is that adult content is absent unless
 * `includeAdult` is true (design: iptv-mcp-servers.md §11) — in the lists
 * and in the details as well.
 */
export function adultRefused(
  settings: CinemaSettings,
  isAdult: boolean,
): CallToolResult | null {
  if (!isAdult || settings.includeAdult) return null;
  return errorResult(
    'This title is adult content. The setting "includeAdult" is off, so its details and its links are not given.',
  );
}

/**
 * The values of a closed set: trimmed and without the empty ones.
 *
 * The values are cleaned once, so that the check and the SQL use the same
 * spelling.
 */
export function cleanValues(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
