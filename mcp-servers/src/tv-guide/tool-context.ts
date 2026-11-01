/**
 * tool-context.ts - what the tools of the TV Guide server need, and the
 * answers they share.
 *
 * The context is the same for every tool: the database, the settings, the
 * logger, the refresh runner and the refresh. The helpers answer the
 * questions that every tool asks: is the server configured, is the guide
 * empty, are the values of the filters real, may this programme be shown.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { type Db } from '../shared/db.ts';
import { type TextEmbedder } from '../shared/embeddings.ts';
import { type Logger } from '../shared/log.ts';
import { type QueryCache } from '../shared/query-cache.ts';
import { type RefreshRunner } from '../shared/refresh.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { errorResult } from '../shared/tool-kit.ts';
import { readTvGuideSettings, type TvGuideSettings } from './config.ts';
import { type Embedder } from './embedder.ts';
import { KINDS } from './kind.ts';
import { THEMES } from './groups.ts';
import { guideEmpty } from './queries.ts';
import type { RefreshStart } from './refresh.ts';

/** The most programmes a list may hold. */
export const MAX_LIMIT = 50;

/** Everything the tools of the TV Guide server need. */
export interface GuideToolContext {
  db: Db;
  /** The working folder of the server. */
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /** Starts a refresh in the background. */
  refresh: (force: boolean) => RefreshStart;
  /** The client of the embedding service (the meaning of T4). */
  client: TextEmbedder;
  /** The vectors of the queries, in the memory and in the database. */
  queryCache: QueryCache;
  /** The background worker that embeds the texts of the queue. */
  worker: Embedder;
  /**
   * The moment the tools answer at, in epoch seconds.
   *
   * The guide is now-centric: the statuses, the periods and the catch-up
   * window move with the moment of the call. The server passes the wall
   * clock; the tests hold it still, the way the import carries its `now`.
   */
  now: () => number;
}

/**
 * The settings of the server, as they are now.
 */
export function settingsOf(ctx: GuideToolContext): TvGuideSettings {
  return readTvGuideSettings(ctx.settings.settings());
}

/**
 * The answer when neither source URL is set.
 *
 * The message names the file the owner has to fill in.
 */
export function notConfigured(ctx: GuideToolContext): CallToolResult {
  return errorResult(
    `EPG URL and Live URL are not set: edit ${ctx.settings.path} (the fields "epgUrl" and "liveUrl").`,
  );
}

/**
 * The answer when the guide holds no programme.
 *
 * @returns the answer, or null when the guide holds something.
 */
export function guideEmptyResult(ctx: GuideToolContext): CallToolResult | null {
  if (!guideEmpty(ctx.db)) return null;

  const progress = ctx.runner.progress();
  if (progress.running) {
    return errorResult(
      `The guide is empty: a refresh is running (${progress.phase}). Try again in a few minutes.`,
    );
  }

  return errorResult(
    'The guide is empty. Run refresh_guide to import it, then try again.',
  );
}

/**
 * The values of a closed set: trimmed and without the empty ones.
 */
export function cleanValues(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Check that the kinds of a search are kinds of the guide.
 *
 * An unknown value is an error that lists the valid ones: the model must
 * not guess a spelling (design: iptv-mcp-servers.md §8.2).
 */
export function checkKinds(kinds: string[]): CallToolResult | null {
  if (kinds.length === 0) return null;

  const missing = kinds.filter((kind) => !(KINDS as readonly string[]).includes(kind));
  if (missing.length === 0) return null;

  return errorResult(
    `Kind '${missing.join("', '")}' not found. Valid: ${KINDS.join(', ')}`,
  );
}

/**
 * Check that the channel themes of a search are themes of the guide.
 */
export function checkThemes(themes: string[]): CallToolResult | null {
  if (themes.length === 0) return null;

  const missing = themes.filter((theme) => !(THEMES as readonly string[]).includes(theme));
  if (missing.length === 0) return null;

  return errorResult(
    `Channel theme '${missing.join("', '")}' not found. Valid: ${THEMES.join(', ')}`,
  );
}

/**
 * The answer when a programme is on an adult channel and the setting does
 * not allow it.
 */
export function adultRefused(
  settings: TvGuideSettings,
  isAdult: boolean,
): CallToolResult | null {
  if (!isAdult || settings.includeAdult) return null;
  return errorResult(
    'This programme is on an adult channel. The setting "includeAdult" is off, so its details and its links are not given.',
  );
}

/**
 * The vector of a query, out of the cache or from the service.
 *
 * The vector is asked of the service once and kept, so that a repeated
 * search or the next page of a search costs nothing (design:
 * iptv-mcp-servers.md §7.4). A query without words has no vector, and a
 * service that does not answer answers null: the search falls back to the
 * words and says so.
 */
export async function embedQuery(
  ctx: GuideToolContext,
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
