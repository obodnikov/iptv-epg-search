/**
 * config.ts - the settings of the TV Guide server.
 *
 * The template is the one of the design (tv-guide-server.md §9). Like the
 * cinema server, the file is written once, when it does not exist, and is
 * never rewritten: the owner edits it by hand (decision D7). The URLs come
 * from the file only: no environment override and no settings tool.
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
export const TV_GUIDE_SETTINGS_TEMPLATE: Record<string, unknown> = {
  epgUrl: '',
  liveUrl: '',
  timezone: 'auto',
  refreshHours: 12,
  refreshOnStart: true,
  includeAdult: false,
  pastDays: 7,
  excludeGroups: ['XXX (18+)'],
  timeshiftGroups: 'auto',
  groupMap: {},
  tonightFromHour: 18,
  epgDefaultOffset: '+0000',
  search: { defaultLimit: 20, maxLimit: 50, snippetChars: 200, meaningWeight: 0.7 },
  embeddings: {
    enabled: true,
    model: 'BAAI/bge-m3',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    batchSize: 50,
    minTextChars: 40,
    groups: 'all',
  },
  logLevel: 'info',
};

/**
 * The rules of the settings file.
 *
 * `groupMap` maps a group name to a small object of overrides
 * (`theme`, `region`, `timeshiftHours`); its contents are read defensively
 * by the group map of phase T2, so the values are accepted as objects.
 */
export const TV_GUIDE_SETTINGS_SPEC: SettingsSpec = {
  defaults: TV_GUIDE_SETTINGS_TEMPLATE,
  urlFields: ['epgUrl', 'liveUrl'],
  freeFormObjects: ['groupMap'],
  enums: { logLevel: [...LOG_LEVELS] },
  ranges: {
    refreshHours: { min: 0, max: 8760 },
    pastDays: { min: 0, max: 90 },
    tonightFromHour: { min: 0, max: 23 },
    'search.defaultLimit': { min: 1, max: 50 },
    'search.maxLimit': { min: 1, max: 50 },
    'search.snippetChars': { min: 0, max: 4000 },
    'search.meaningWeight': { min: 0, max: 1 },
    'embeddings.batchSize': { min: 1, max: 500 },
    'embeddings.minTextChars': { min: 0, max: 10000 },
  },
  patterns: {
    // The offset of the times that have none, as `+HHMM` or `-HHMM`.
    epgDefaultOffset: {
      pattern: /^[+-]\d{4}$/,
      what: 'an offset in the form +HHMM, e.g. +0300',
    },
    // The setting holds the **name** of the variable that holds the key.
    'embeddings.apiKeyEnv': {
      pattern: /^[A-Za-z_][A-Za-z0-9_]*$/,
      what: 'the name of an environment variable (the key itself does not belong in this file)',
    },
  },
  // The offset of the times that have none has to be a real offset: the
  // hours may not be more than 23 and the minutes not more than 59. The
  // pattern above only holds the form of the offset.
  checks: {
    epgDefaultOffset: (value: string): string | null => {
      const match = /^([+-])(\d{2})(\d{2})$/.exec(value.trim());
      if (!match) return 'an offset in the form +HHMM, e.g. +0300';
      const hours = Number(match[2]);
      const minutes = Number(match[3]);
      if (hours > 23) return 'the hours of the offset may not be more than 23';
      if (minutes > 59) return 'the minutes of the offset may not be more than 59';
      return null;
    },
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
  /** 'all', or a list of group names the vectors are made for. */
  groups: string;
}

/** The overrides of one group from the setting `groupMap`. */
export interface GroupOverride {
  theme?: string;
  region?: string;
  timeshiftHours?: number;
}

/** The settings of the TV Guide server, read from the merged file. */
export interface TvGuideSettings {
  /** The URL of the programme guide. An empty string means "not set". */
  epgUrl: string;
  /** The URL of the live-channel playlist. An empty string means "not set". */
  liveUrl: string;
  /** The IANA zone the times are shown in; 'auto' is the zone of the machine. */
  timezone: string;
  /** How old the data may get before a background refresh. */
  refreshHours: number;
  /** Refresh at the start when the data is too old. */
  refreshOnStart: boolean;
  /** Let adult content into the results. */
  includeAdult: boolean;
  /** How long ended programmes are kept. */
  pastDays: number;
  /** The groups that are not loaded at all. */
  excludeGroups: string[];
  /** 'auto', 'none', or a comma-separated list of group names. */
  timeshiftGroups: string;
  /** Per-group overrides, read defensively. */
  groupMap: Record<string, GroupOverride>;
  /** The hour `tonight` starts at. */
  tonightFromHour: number;
  /** The offset used for times without one, as `+HHMM`. */
  epgDefaultOffset: string;
  search: SearchSettings;
  embeddings: EmbeddingSettings;
  logLevel: LogLevel;
}

/**
 * Read the group overrides out of the merged settings.
 *
 * Unknown fields are ignored, wrong types are skipped: a group override
 * that does not parse must not break the import.
 */
function readGroupMap(settings: Record<string, unknown>): Record<string, GroupOverride> {
  const raw = getObject(settings, 'groupMap');
  const groupMap: Record<string, GroupOverride> = {};

  for (const [group, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const source = value as Record<string, unknown>;
    const override: GroupOverride = {};

    const theme = source['theme'];
    if (typeof theme === 'string') override.theme = theme;

    const region = source['region'];
    if (typeof region === 'string') override.region = region;

    const timeshiftHours = source['timeshiftHours'];
    if (typeof timeshiftHours === 'number' && Number.isFinite(timeshiftHours)) {
      override.timeshiftHours = timeshiftHours;
    }

    groupMap[group] = override;
  }

  return groupMap;
}

/**
 * Read the settings of the TV Guide server out of the merged settings
 * object.
 */
export function readTvGuideSettings(settings: Record<string, unknown>): TvGuideSettings {
  const search = getObject(settings, 'search');
  const embeddings = getObject(settings, 'embeddings');

  const groups = getString(embeddings, 'groups');

  return {
    epgUrl: getString(settings, 'epgUrl'),
    liveUrl: getString(settings, 'liveUrl'),
    timezone: getString(settings, 'timezone'),
    refreshHours: getNumber(settings, 'refreshHours'),
    refreshOnStart: getBoolean(settings, 'refreshOnStart'),
    includeAdult: getBoolean(settings, 'includeAdult'),
    pastDays: getNumber(settings, 'pastDays'),
    excludeGroups: getStringList(settings, 'excludeGroups'),
    timeshiftGroups: getString(settings, 'timeshiftGroups'),
    groupMap: readGroupMap(settings),
    tonightFromHour: getNumber(settings, 'tonightFromHour'),
    epgDefaultOffset: getString(settings, 'epgDefaultOffset'),
    search: {
      defaultLimit: getNumber(search, 'defaultLimit'),
      maxLimit: getNumber(search, 'maxLimit'),
      snippetChars: getNumber(search, 'snippetChars'),
      meaningWeight: getNumber(search, 'meaningWeight'),
    },
    embeddings: {
      enabled: getBoolean(embeddings, 'enabled'),
      model: getString(embeddings, 'model'),
      apiKeyEnv: getString(embeddings, 'apiKeyEnv'),
      batchSize: getNumber(embeddings, 'batchSize'),
      minTextChars: getNumber(embeddings, 'minTextChars'),
      groups: groups.length > 0 ? groups : 'all',
    },
    logLevel: getLogLevel(settings),
  };
}
