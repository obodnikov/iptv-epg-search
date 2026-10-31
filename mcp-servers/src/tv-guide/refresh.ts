/**
 * refresh.ts - the background refresh of the TV Guide.
 *
 * A tool call never waits for a download or an import (decision D15): the
 * refresh runs in the background and the tools answer from whatever is in
 * the database. `get_status` reports that a refresh runs and how far it
 * got. The structure is the cinema server's `src/cinema/refresh.ts`; the
 * import itself is `refreshTvGuide` (`import.ts`).
 */

import { type Db } from '../shared/db.ts';
import { type Logger } from '../shared/log.ts';
import { type SettingsStore } from '../shared/settings.ts';
import { type RefreshRunner } from '../shared/refresh.ts';
import { sha256 } from '../shared/hash.ts';
import { readTvGuideSettings, type TvGuideSettings } from './config.ts';
import { importOptionsOf } from './import-options.ts';
import { importSettingsSignature, refreshTvGuide } from './refresh-pipeline.ts';
import { META_KEYS, writeRefreshState } from './status.ts';

/** What the server answered when a refresh was asked for. */
export type RefreshStart = 'started' | 'already_running' | 'not_configured';

export interface GuideRefreshContext {
  db: Db;
  dataDir: string;
  settings: SettingsStore;
  logger: Logger;
  runner: RefreshRunner;
}

/**
 * The hash of the two source URLs.
 *
 * A changed URL triggers a refresh, even when the data is still fresh.
 * Both URLs are hashed together: either of them may change alone.
 */
export function sourceUrlsHash(settings: TvGuideSettings): string {
  return sha256(JSON.stringify([settings.epgUrl, settings.liveUrl]));
}

/**
 * The refresh of the TV Guide.
 *
 * The function returns at once: the work happens in the background.
 */
export function createGuideRefresh(
  ctx: GuideRefreshContext,
): (force: boolean) => RefreshStart {
  return (force: boolean): RefreshStart => {
    const settings = readTvGuideSettings(ctx.settings.settings());

    if (!settings.epgUrl && !settings.liveUrl) {
      ctx.logger.warn('a refresh was asked for, but no source URL is set');
      return 'not_configured';
    }

    const started = ctx.runner.start(async (report) => {
      const current = readTvGuideSettings(ctx.settings.settings());
      const now = Math.floor(Date.now() / 1000);

      const outcome = await refreshTvGuide(ctx.db, ctx.dataDir, importOptionsOf(current, now, {
        dataDir: ctx.dataDir,
        force,
        onPhase: (phase) => report(phase),
        log: {
          warn: (message, fields) => ctx.logger.warn(message, fields),
          error: (message, fields) => ctx.logger.error(message, fields),
          info: (message, fields) => ctx.logger.info(message, fields),
        },
      }));

      writeRefreshState(ctx.db, {
        at: now,
        ok: outcome.ok,
        durationMs: outcome.durationMs,
        programmes: outcome.write?.liveProgrammes ?? 0,
        texts: outcome.write?.texts ?? 0,
        unchanged: outcome.unchanged,
        defaultOffsets: outcome.write?.defaultOffsetTimes ?? 0,
        epgUrlSource: outcome.epgUrlSource ?? 'none',
        error: outcome.error ?? null,
      });

      if (!outcome.ok) {
        ctx.logger.error('the refresh failed', { error: outcome.error ?? 'unknown error' });
        // The task throws, so that the runner knows that the work failed:
        // the phase becomes "failed" and the status carries the reason.
        throw new Error(outcome.error ?? 'the refresh failed');
      }

      // The hash of the sources is written down: a changed URL triggers a
      // refresh. It is written only when the refresh worked.
      ctx.db.setMeta(META_KEYS.sourceUrlHash, sourceUrlsHash(current));

      // The settings that change what is imported are written down as
      // well: a change of them has to be imported again, even when the
      // provider did not change anything.
      ctx.db.setMeta(
        META_KEYS.importSettingsHash,
        importSettingsSignature(importOptionsOf(current, now)),
      );

      ctx.logger.info('the guide was refreshed', {
        programmes: outcome.write?.liveProgrammes ?? 0,
        texts: outcome.write?.texts ?? 0,
        duration_ms: outcome.durationMs,
        unchanged: outcome.unchanged,
      });

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
 * True when the server has to refresh the guide when it starts.
 *
 * The reasons are: the setting says so, the data is older than the setting
 * allows, or a source URL changed.
 */
export function shouldRefreshAtStart(
  db: Db,
  settings: TvGuideSettings,
  now = Math.floor(Date.now() / 1000),
): { refresh: boolean; reason: string } {
  if (!settings.refreshOnStart) {
    return { refresh: false, reason: 'the refresh at the start is switched off' };
  }

  if (!settings.epgUrl && !settings.liveUrl) {
    return { refresh: false, reason: 'no source URL is set' };
  }

  // The age of the data: the moment of the last **successful** import.
  const imported = db.metaNumber(META_KEYS.lastImportAt);
  if (imported === null) {
    return { refresh: true, reason: 'the guide was never imported' };
  }

  // The hash of the sources and the hash of the settings are compared
  // without a shortcut: a hash that was never written down means that the
  // state of the last import is not known, and the server has to import
  // once more to write it down.
  const known = db.meta(META_KEYS.sourceUrlHash);
  if (known !== sourceUrlsHash(settings)) {
    return {
      refresh: true,
      reason:
        known === null
          ? 'the URLs of the last import are not known'
          : 'a source URL changed',
    };
  }

  const settingsHash = importSettingsSignature(importOptionsOf(settings, now));
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
    return { refresh: true, reason: 'the guide is older than the setting allows' };
  }

  return { refresh: false, reason: 'the guide is fresh' };
}
