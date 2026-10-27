/**
 * config.ts - the settings of the cinema server.
 *
 * The template is the one of the design (cinema-server.md §8). The file is
 * written once, when it does not exist, and is never rewritten: the owner
 * edits it by hand (decision D7).
 *
 * The URLs come from the file only. There is no environment override and no
 * settings tool.
 */

import {
  getBoolean,
  getNumber,
  getObject,
  getString,
  getStringList,
  getLogLevel,
  type LogLevel,
  type SettingsSpec,
} from '../shared/settings.ts';
import { LOG_LEVELS } from '../shared/log-level.ts';

/**
 * The template of `settings.json`.
 */
export const CINEMA_SETTINGS_TEMPLATE: Record<string, unknown> = {
  cinemaUrl: '',
  timezone: 'auto',
  refreshHours: 24,
  refreshOnStart: true,
  includeAdult: false,
  excludeCategories: [],
  countryAliases: {},
  trackChanges: true,
  search: { defaultLimit: 20, maxLimit: 50, snippetChars: 200, meaningWeight: 0.7 },
  embeddings: {
    enabled: true,
    model: 'BAAI/bge-m3',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    batchSize: 50,
    minTextChars: 40,
  },
  logLevel: 'info',
};

/**
 * The rules of the settings file.
 *
 * `countryAliases` accepts any key: it maps a raw country name of the
 * provider to an ISO code (design: cinema-server.md §3.4).
 */
export const CINEMA_SETTINGS_SPEC: SettingsSpec = {
  defaults: CINEMA_SETTINGS_TEMPLATE,
  urlFields: ['cinemaUrl'],
  freeForm: ['countryAliases'],
  enums: { logLevel: [...LOG_LEVELS] },
  ranges: {
    refreshHours: { min: 0, max: 8760 },
    'search.defaultLimit': { min: 1, max: 50 },
    'search.maxLimit': { min: 1, max: 50 },
    'search.snippetChars': { min: 0, max: 4000 },
    'search.meaningWeight': { min: 0, max: 1 },
    'embeddings.batchSize': { min: 1, max: 500 },
    'embeddings.minTextChars': { min: 0, max: 10000 },
  },
};

/** The settings of the search. */
export interface SearchSettings {
  defaultLimit: number;
  maxLimit: number;
  snippetChars: number;
  meaningWeight: number;
}

/** The settings of the embeddings. */
export interface EmbeddingSettings {
  enabled: boolean;
  model: string;
  apiKeyEnv: string;
  batchSize: number;
  minTextChars: number;
}

/** The settings of the cinema server, read from the merged file. */
export interface CinemaSettings {
  /** The URL of the catalogue. An empty string means "not set". */
  cinemaUrl: string;
  /** The IANA zone the times are shown in; 'auto' is the zone of the machine. */
  timezone: string;
  /** How old the data may get before a background refresh. */
  refreshHours: number;
  /** Refresh at the start when the data is too old. */
  refreshOnStart: boolean;
  /** Let adult content into the results. */
  includeAdult: boolean;
  /** The categories that are not loaded at all. */
  excludeCategories: string[];
  /** Extra country names to ISO codes. */
  countryAliases: Record<string, string>;
  /** Keep `first_seen_at` and `removed_at`. */
  trackChanges: boolean;
  search: SearchSettings;
  embeddings: EmbeddingSettings;
  logLevel: LogLevel;
}

/**
 * Read the settings of the cinema server out of the merged settings object.
 */
export function readCinemaSettings(settings: Record<string, unknown>): CinemaSettings {
  const search = getObject(settings, 'search');
  const embeddings = getObject(settings, 'embeddings');
  const aliases = getObject(settings, 'countryAliases');

  // The aliases map a raw country name to an ISO code: both are strings.
  const countryAliases: Record<string, string> = {};
  for (const [name, code] of Object.entries(aliases)) {
    if (typeof code === 'string') countryAliases[name] = code;
  }

  // The default limit may not be bigger than the biggest limit: the two
  // are checked one after the other, so a file with both set to a wrong
  // value would otherwise promise more than the tool returns.
  const maxLimit = getNumber(search, 'maxLimit');
  const defaultLimit = Math.min(getNumber(search, 'defaultLimit'), maxLimit);

  return {
    cinemaUrl: getString(settings, 'cinemaUrl'),
    timezone: getString(settings, 'timezone') || 'auto',
    refreshHours: getNumber(settings, 'refreshHours'),
    refreshOnStart: getBoolean(settings, 'refreshOnStart'),
    includeAdult: getBoolean(settings, 'includeAdult'),
    excludeCategories: getStringList(settings, 'excludeCategories'),
    countryAliases,
    trackChanges: getBoolean(settings, 'trackChanges'),
    search: {
      defaultLimit,
      maxLimit,
      snippetChars: getNumber(search, 'snippetChars'),
      meaningWeight: getNumber(search, 'meaningWeight'),
    },
    embeddings: {
      enabled: getBoolean(embeddings, 'enabled'),
      model: getString(embeddings, 'model'),
      apiKeyEnv: getString(embeddings, 'apiKeyEnv'),
      batchSize: getNumber(embeddings, 'batchSize'),
      minTextChars: getNumber(embeddings, 'minTextChars'),
    },
    logLevel: getLogLevel(settings),
  };
}
