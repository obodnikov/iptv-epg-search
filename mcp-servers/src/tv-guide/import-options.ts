/**
 * import-options.ts - the types of the import of the TV Guide.
 *
 * They are in their own module, so that the writer and the pipeline can
 * use them without a cycle.
 */

import type { GroupOverride, TvGuideSettings } from './config.ts';

/**
 * Where the import writes what it has to say.
 *
 * The server has a logger that writes to the log file of the working
 * folder. The scripts write to the console.
 */
export interface ImportLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Optional: not every caller of the import has a logger with info. */
  info?(message: string, fields?: Record<string, unknown>): void;
}

/**
 * The settings that decide what the import writes.
 */
export interface ImportOptions {
  /** The URL of the programme guide. An empty URL means "not set". */
  epgUrl: string;
  /** The URL of the live playlist. An empty URL means "not set". */
  liveUrl: string;
  /** The groups that are not loaded at all. */
  excludeGroups: string[];
  /**
   * The overrides of the groups, from the setting `groupMap`.
   *
   * They decide the theme, the region and the time shift of a group, and
   * they win over the built-in table of `groups.ts`.
   */
  groupMap?: Record<string, GroupOverride>;
  /** The offset for times that carry none, as `+HHMM`. */
  epgDefaultOffset: string;
  /** How long ended programmes are kept, in days. */
  pastDays: number;
  /** The model the vectors are made for. */
  embeddingModel: string;
  /** Texts shorter than this are only searched by words. */
  minTextChars: number;
  /** False when the search by meaning is switched off in the settings. */
  embeddingsEnabled: boolean;
  /** The moment of the import, in epoch seconds. */
  now: number;
  /**
   * The working folder.
   *
   * When it is known, the import takes the lock of the folder, so that two
   * processes never write the guide at the same time.
   */
  dataDir?: string;
  /** Where the import writes the errors. */
  log?: ImportLogger;
  /** The phases of the refresh, for the status of the server (T3). */
  onPhase?: (phase: 'downloading' | 'importing') => void;
  /** Import even when a download did not change. */
  force?: boolean;
}
/**
 * What the write into the database did.
 */
export interface WriteResult {
  /** The channels of the guide after the write. */
  channels: number;
  /** The programmes that were written. */
  programmes: number;
  /**
   * The programmes that are in the guide after the write.
   *
   * It is the number of the live guide, not the number of the rows that
   * this write inserted: the retention window removes the old ones.
   */
  liveProgrammes: number;
  /** The distinct texts of the guide after the write. */
  texts: number;
  /** The texts that were new to this import. */
  newTexts: number;
  /**
   * The texts whose derived fields were written again.
   *
   * They are the texts that were in the database with an older version of
   * the derivation.
   */
  derivedTexts: number;
  /** The country names that the country table does not know. */
  unknownCountries: number;
  /** The rows of the keyword index that were written. */
  ftsRows: number;
  /** Programmes dropped because their group is excluded. */
  droppedGroupProgrammes: number;
  /** Channels dropped because their group is excluded. */
  droppedGroupChannels: number;
  /** Programmes dropped by the retention window. */
  droppedOld: number;
  /** Programmes whose times could not be read. */
  badTimes: number;
  /** Programmes whose channel is neither in the playlist nor in the guide. */
  unknownChannel: number;
  /** Programmes that repeated a (channel, start) pair. */
  duplicates: number;
  /** Times that took the `epgDefaultOffset`. */
  defaultOffsetTimes: number;
  /** The texts that left the guide with this import. */
  removedTexts: number;
  /** The queue rows that were removed. */
  queuePruned: number;
  /** The number of texts in the queue when the import was over. */
  queueSize: number;
  /** The first and the last programme start of the guide, in epoch seconds. */
  windowStart: number | null;
  windowEnd: number | null;
}

/**
 * Where the EPG URL of an import came from.
 */
export type EpgUrlSource = 'settings' | 'playlist-header' | null;

/**
 * The result of an import.
 */
export interface ImportOutcome {
  ok: boolean;
  /** The reason the import failed, when it did. */
  error?: string;
  /** The whole import, in milliseconds. */
  durationMs: number;
  /** True when at least one file was downloaded first. */
  downloaded: boolean;
  /** True when every download was the same file as before and nothing was written. */
  unchanged: boolean;
  /** Where the EPG URL came from. */
  epgUrlSource: EpgUrlSource;
  /** The playlist, if there was one. */
  playlist: {
    channels: number;
    skippedNoTvgId: number;
    duplicates: number;
    incomplete: number;
    /** True when the header carried no attributes (the MPEG-TS variant). */
    bareHeader: boolean;
  } | null;
  /** The result of the write, when the import went that far. */
  write: WriteResult | null;
}

/**
 * The settings that the write path needs, next to what the import carries.
 */
export interface WriteOptions {
  /** The model the vectors are made for. */
  embeddingModel: string;
  /** Texts shorter than this are only searched by words. */
  minTextChars: number;
  /** False when the search by meaning is switched off in the settings. */
  embeddingsEnabled: boolean;
  /** The moment of the import, in epoch seconds. */
  now: number;
}

/**
 * The options of the import, out of the settings of the server.
 *
 * This is the one place where the settings become the options of the
 * import: the server (phase T3), the local script and the tests all go
 * through it, and none of them forgets a field.
 *
 * @param settings The settings of the TV Guide server.
 * @param now The moment of the import, in epoch seconds.
 * @param extra The fields that do not come from the settings.
 */
export function importOptionsOf(
  settings: TvGuideSettings,
  now: number,
  extra: {
    dataDir?: string;
    log?: ImportLogger;
    onPhase?: (phase: 'downloading' | 'importing') => void;
    force?: boolean;
  } = {},
): ImportOptions {
  return {
    epgUrl: settings.epgUrl,
    liveUrl: settings.liveUrl,
    excludeGroups: settings.excludeGroups,
    groupMap: settings.groupMap,
    epgDefaultOffset: settings.epgDefaultOffset,
    pastDays: settings.pastDays,
    embeddingModel: settings.embeddings.model,
    minTextChars: settings.embeddings.minTextChars,
    embeddingsEnabled: settings.embeddings.enabled,
    now,
    ...extra,
  };
}

/**
 * An empty write result, for the failures and the unchanged runs.
 */
export function emptyWriteResult(): WriteResult {
  return {
    channels: 0,
    programmes: 0,
    liveProgrammes: 0,
    texts: 0,
    newTexts: 0,
    derivedTexts: 0,
    unknownCountries: 0,
    ftsRows: 0,
    droppedGroupProgrammes: 0,
    droppedGroupChannels: 0,
    droppedOld: 0,
    badTimes: 0,
    unknownChannel: 0,
    duplicates: 0,
    defaultOffsetTimes: 0,
    removedTexts: 0,
    queuePruned: 0,
    queueSize: 0,
    windowStart: null,
    windowEnd: null,
  };
}
