/**
 * refresh.ts - the background refresh of the cinema catalogue.
 *
 * The refresh never waits for a tool call (decision D15): it runs in the
 * background and the tools answer from whatever is in the database. The
 * state of the run is in the `meta` table, so that a server that starts
 * again knows how fresh its data is.
 */

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type RefreshRunner } from '../shared/refresh.ts';
import { sha256 } from '../shared/hash.ts';
import { readCinemaSettings, type CinemaSettings } from './config.ts';
import { type Embedder } from './embedder.ts';
import { importSettingsSignature, refreshCatalog } from './import.ts';
import { META_KEYS, writeRefreshState } from './status.ts';

/** What the server answered when a refresh was asked for. */
export type RefreshStart = 'started' | 'already_running' | 'not_configured';

export interface CinemaRefreshContext {
  db: Db;
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
  /**
   * The worker of the embeddings.
   *
   * It starts after a successful import: the texts that changed have to be
   * embedded again, and the run happens in the background.
   */
  worker: Embedder;
}

/**
 * The options of the import, out of the settings.
 */
function importOptions(settings: CinemaSettings, now: number) {
  return {
    cinemaUrl: settings.cinemaUrl,
    excludeCategories: settings.excludeCategories,
    countryAliases: settings.countryAliases,
    trackChanges: settings.trackChanges,
    embeddingModel: settings.embeddings.model,
    minTextChars: settings.embeddings.minTextChars,
    now,
  };
}

/**
 * The refresh of the cinema catalogue.
 *
 * The function returns at once: the work happens in the background.
 */
export function createCinemaRefresh(ctx: CinemaRefreshContext): (force: boolean) => RefreshStart {
  return (force: boolean): RefreshStart => {
    const settings = readCinemaSettings(ctx.settings.settings());

    if (!settings.cinemaUrl) {
      ctx.logger.warn('a refresh was asked for, but the cinema URL is not set');
      return 'not_configured';
    }

    const started = ctx.runner.start(async (report) => {
      const current = readCinemaSettings(ctx.settings.settings());
      const now = Math.floor(Date.now() / 1000);

      const outcome = await refreshCatalog(ctx.db, ctx.dataDir, {
        ...importOptions(current, now),
        dataDir: ctx.dataDir,
        force,
        onPhase: (phase) => report(phase),
        log: {
          warn: (message, fields) => ctx.logger.warn(message, fields),
          error: (message, fields) => ctx.logger.error(message, fields),
          info: (message, fields) => ctx.logger.info(message, fields),
        },
      });

      writeRefreshState(ctx.db, {
        at: now,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        entries: outcome.entries,
        rejected: outcome.rejected,
        incomplete: outcome.incomplete,
        titles: outcome.titles,
        unchanged: outcome.unchanged,
        error: outcome.error ?? null,
      });

      if (!outcome.ok) {
        ctx.logger.error('the refresh failed', { error: outcome.error ?? 'unknown error' });
        // The task throws, so that the runner knows that the work failed:
        // the phase becomes "failed" and the status carries the reason.
        throw new Error(outcome.error ?? 'the refresh failed');
      }

      // The hash of the source is written down: a changed URL triggers a
      // refresh, even when the data is still fresh. It is written only
      // when the refresh worked: a failed refresh has not applied the URL.
      ctx.db.setMeta(META_KEYS.sourceUrlHash, sha256(current.cinemaUrl));

      // The settings that change what is imported are written down as
      // well: a change of them has to be imported again, even when the
      // file of the provider did not change.
      ctx.db.setMeta(
        META_KEYS.importSettingsHash,
        importSettingsSignature(current),
      );

      ctx.logger.info('the catalogue was refreshed', {
        titles: outcome.titles,
        entries: outcome.entries,
        duration_ms: outcome.durationMs,
        unchanged: outcome.unchanged,
      });

      // The texts that have to be embedded are embedded in the background:
      // the tool call never waits for it.
      const pending =
        ctx.db.get<{ found: number }>(
          'SELECT count(*) AS found FROM vector_queue',
        )?.found ?? 0;
      if (pending > 0) {
        ctx.worker.start();
      }

      return outcome;
    });

    if (started === 'already_running') {
      ctx.logger.info('a refresh is already running');
      return 'already_running';
    }

    return 'started';
  };
}

/**
 * True when the server has to refresh the catalogue when it starts.
 *
 * The reasons are: the setting says so, the data is older than the setting
 * allows, or the URL of the provider changed.
 */
export function shouldRefreshAtStart(
  db: Db,
  settings: CinemaSettings,
  now = Math.floor(Date.now() / 1000),
): { refresh: boolean; reason: string } {
  if (!settings.refreshOnStart) {
    return { refresh: false, reason: 'the refresh at the start is switched off' };
  }

  if (!settings.cinemaUrl) {
    return { refresh: false, reason: 'the cinema URL is not set' };
  }

  // The age of the data: the moment of the last **successful** import.
  const imported = db.metaNumber(META_KEYS.lastImportAt);
  if (imported === null) {
    return { refresh: true, reason: 'the catalogue was never imported' };
  }

  // The hash of the source and the hash of the settings are compared
  // without a shortcut: a hash that was never written down means that the
  // state of the last import is not known, and the server has to import
  // once more to write it down.
  const known = db.meta(META_KEYS.sourceUrlHash);
  if (known !== sha256(settings.cinemaUrl)) {
    return {
      refresh: true,
      reason:
        known === null
          ? 'the URL of the last import is not known'
          : 'the URL of the provider changed',
    };
  }

  // The settings that change what is imported: a change of them has to be
  // imported again, even when the data is still fresh.
  const settingsHash = importSettingsSignature(settings);
  const knownSettings = db.meta(META_KEYS.importSettingsHash);
  if (knownSettings !== settingsHash) {
    return {
      refresh: true,
      reason:
        knownSettings === null
          ? 'the settings of the last import are not known'
          : 'the import settings changed',
    };
  }

  // The last attempt failed: the data may be old, and the reason of the
  // failure may be gone. The server tries again.
  if (db.meta(META_KEYS.lastRefreshOk) !== '1') {
    return { refresh: true, reason: 'the last refresh failed' };
  }

  const ageSeconds = now - imported;
  if (ageSeconds >= settings.refreshHours * 3600) {
    return { refresh: true, reason: 'the catalogue is older than the setting allows' };
  }

  return { refresh: false, reason: 'the catalogue is fresh' };
}
