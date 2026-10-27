/**
 * settings.ts - read, validate and write the servers' settings.json.
 *
 * Each server owns one settings file inside its working folder
 * (design: iptv-mcp-servers.md §5.2). The owner edits that file by hand;
 * the server never writes anything else into it, and never takes a URL from
 * the environment.
 *
 * URL validation follows the web app
 * (public/scripts/components/settings.js:225-265): trim, parse, and require
 * http: or https:. An empty string means "not set".
 */

import { chmodSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';

import { type LogLevel, LOG_LEVELS, isLogLevel } from './log-level.ts';
import { hardenFileSync } from './permissions.ts';

export type { LogLevel };
export { LOG_LEVELS };

export interface UrlCheck {
  ok: boolean;
  /** Trimmed URL, or '' when the field is not set. */
  value: string;
  /** Human-readable reason, present only when ok is false. */
  error?: string;
}

/**
 * Validate one source URL.
 *
 * @param raw Raw value from the settings file.
 */
export function checkSourceUrl(raw: unknown): UrlCheck {
  if (raw === undefined || raw === null) return { ok: true, value: '' };
  if (typeof raw !== 'string') {
    return { ok: false, value: '', error: 'must be a string' };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: '' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, value: '', error: 'is not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      value: '',
      error: `must use http:// or https:// (got "${parsed.protocol}")`,
    };
  }

  return { ok: true, value: trimmed };
}

export interface SettingsSpec {
  /** Full template: every key with its default value. */
  defaults: Record<string, unknown>;
  /** Keys that hold a source URL and are checked with `checkSourceUrl`. */
  urlFields?: string[];
  /** Paths (dot separated) that accept arbitrary keys, e.g. "countryAliases". */
  freeForm?: string[];
  /** Paths (dot separated) with a closed set of allowed values. */
  enums?: Record<string, string[]>;
  /** Paths (dot separated) with a lowest and a highest allowed value. */
  ranges?: Record<string, { min?: number; max?: number }>;
}

export interface SettingsLoad {
  /** Merged settings: defaults overridden by the valid values of the file. */
  settings: Record<string, unknown>;
  /** Validation problems found in the file, as human-readable sentences. */
  issues: string[];
  /** True when the template was written because no file existed. */
  createdTemplate: boolean;
  /** True when a settings file was found on disk. */
  exists: boolean;
  /** Fingerprint of the file that was read, for change detection. */
  fingerprint: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merge one raw value into the default value of the same key.
 * A value of the wrong type is reported and the default is kept.
 */
function mergeValue(
  base: unknown,
  raw: unknown,
  path: string,
  issues: string[],
  freeForm: Set<string>,
  enums: Map<string, string[]>,
  ranges: Map<string, { min?: number; max?: number }>,
): unknown {
  if (raw === undefined) return base;

  if (isPlainObject(base)) {
    if (!isPlainObject(raw)) {
      issues.push(`"${path}" must be an object`);
      return base;
    }
    const out: Record<string, unknown> = { ...base };
    const isFreeForm = freeForm.has(path);
    for (const [key, value] of Object.entries(raw)) {
      // The path of a nested key is dot separated: "search.defaultLimit".
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in base) && !isFreeForm) {
        issues.push(`unknown setting "${childPath}"`);
        continue;
      }
      out[key] = isFreeForm
        ? typeof value === 'string'
          ? value
          : (issues.push(`"${childPath}" must be a string`), undefined)
        : mergeValue(
            base[key],
            value,
            childPath,
            issues,
            freeForm,
            enums,
            ranges,
          );
      if (out[key] === undefined) delete out[key];
    }
    return out;
  }

  if (Array.isArray(base)) {
    if (!Array.isArray(raw)) {
      issues.push(`"${path}" must be a list`);
      return base;
    }
    if (!raw.every((item) => typeof item === 'string')) {
      issues.push(`"${path}" must be a list of strings`);
      return base;
    }
    return raw;
  }

  if (typeof base === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      issues.push(`"${path}" must be a number`);
      return base;
    }
    const range = ranges.get(path);
    if (range) {
      if (range.min !== undefined && raw < range.min) {
        issues.push(`"${path}" must be at least ${range.min}`);
        return base;
      }
      if (range.max !== undefined && raw > range.max) {
        issues.push(`"${path}" must be at most ${range.max}`);
        return base;
      }
    }
    return raw;
  }

  if (typeof base === 'boolean') {
    if (typeof raw !== 'boolean') {
      issues.push(`"${path}" must be true or false`);
      return base;
    }
    return raw;
  }

  if (typeof base === 'string') {
    if (typeof raw !== 'string') {
      issues.push(`"${path}" must be a string`);
      return base;
    }
    const allowed = enums.get(path);
    if (allowed && !allowed.includes(raw)) {
      issues.push(`"${path}" must be one of: ${allowed.join(', ')}`);
      return base;
    }
    return raw;
  }

  return raw;
}

/**
 * Merge a raw settings object into the template.
 */
export function mergeSettings(
  raw: unknown,
  spec: SettingsSpec,
): { settings: Record<string, unknown>; issues: string[] } {
  const issues: string[] = [];
  const freeForm = new Set(spec.freeForm ?? []);
  const enums = new Map(Object.entries(spec.enums ?? {}));
  const ranges = new Map(Object.entries(spec.ranges ?? {}));

  // The template is copied first: the caller must never be able to change
  // the template of the server by changing the settings it got.
  const defaults = structuredClone(spec.defaults);

  if (!isPlainObject(raw)) {
    issues.push('the settings file must contain a JSON object');
    return { settings: defaults, issues };
  }

  const merged = mergeValue(
    defaults,
    raw,
    '',
    issues,
    freeForm,
    enums,
    ranges,
  ) as Record<string, unknown>;

  // URL fields are checked after the merge, so a bad URL never lands in the
  // settings object.
  for (const field of spec.urlFields ?? []) {
    const check = checkSourceUrl(merged[field]);
    if (!check.ok) {
      issues.push(`"${field}" ${check.error ?? 'is not valid'}`);
      merged[field] = '';
    } else {
      merged[field] = check.value;
    }
  }

  return { settings: merged, issues };
}

/**
 * Write the settings template with file mode 0600.
 * Existing files are never overwritten.
 */
export function writeSettingsTemplate(path: string, template: unknown): void {
  writeFileSync(path, `${JSON.stringify(template, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
}

/**
 * Fingerprint of a settings file, used to detect changes on disk.
 */
export function fingerprintOf(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return 'missing';
  }
}

/**
 * Make a file private.
 *
 * The settings file holds the source URL with the access key of the
 * provider. A file that was created with wider rights is tightened, so that
 * it never stays readable for everybody.
 *
 * Windows has no Unix modes; there the rights come from the ACL of the
 * folder.
 */
export function hardenFile(path: string): boolean {
  return hardenFileSync(path);
}

/**
 * Read the settings file and merge it into the template.
 *
 * When the file does not exist it is created from the template with mode 0600
 * (design: iptv-mcp-servers.md §4.2 step 2).
 */
export function loadSettings(path: string, spec: SettingsSpec): SettingsLoad {
  return readSettings(path, spec, true);
}

/**
 * Read the settings file and merge it into the template.
 *
 * When the file does not exist it is created from the template with mode 0600
 * (design: iptv-mcp-servers.md §4.2 step 2).
 */
function readSettings(path: string, spec: SettingsSpec, allowRetry: boolean): SettingsLoad {
  if (!existsSync(path)) {
    const { settings, issues } = mergeSettings({}, spec);
    try {
      writeSettingsTemplate(path, spec.defaults);
      return {
        settings,
        issues,
        createdTemplate: true,
        exists: true,
        fingerprint: fingerprintOf(path),
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' && allowRetry) {
        // Another process wrote the file first: read it.
        return readSettings(path, spec, false);
      }
      // The template cannot be written. The server starts with the defaults
      // and says so, instead of crashing.
      issues.push(
        `the settings template could not be written (${
          error instanceof Error ? error.message : String(error)
        }); the defaults are used`,
      );
      return {
        settings,
        issues,
        createdTemplate: false,
        exists: false,
        fingerprint: 'missing',
      };
    }
  }

  let raw: unknown = {};
  const issues: string[] = [];

  // The file holds the provider URL: it must not be readable for everybody.
  if (!hardenFile(path)) {
    issues.push('the settings file could not be made readable for its owner only');
  }

  try {
    const text = readFileSync(path, 'utf8');
    raw = text.trim() ? JSON.parse(text) : {};
  } catch (error) {
    issues.push(
      `settings file could not be read as JSON (${
        error instanceof Error ? error.message : String(error)
      }); defaults are used`,
    );
    raw = {};
  }

  const merged = mergeSettings(raw, spec);
  issues.push(...merged.issues);

  return {
    settings: merged.settings,
    issues,
    createdTemplate: false,
    exists: true,
    fingerprint: fingerprintOf(path),
  };
}

/**
 * Settings holder that re-reads the file when it changes on disk, so an
 * edited URL takes effect without restarting the client.
 */
export class SettingsStore {
  readonly path: string;
  private readonly spec: SettingsSpec;
  private load: SettingsLoad;

  constructor(path: string, spec: SettingsSpec) {
    this.path = path;
    this.spec = spec;
    this.load = loadSettings(path, spec);
  }

  /** The current settings, re-read when the file changed. */
  current(): SettingsLoad {
    const fingerprint = fingerprintOf(this.path);
    if (fingerprint !== this.load.fingerprint) {
      this.load = loadSettings(this.path, this.spec);
    }
    return this.load;
  }

  /** The merged settings object. */
  settings(): Record<string, unknown> {
    return this.current().settings;
  }

  /** Validation problems of the last read. */
  issues(): string[] {
    return this.current().issues;
  }
}

/* ------------------------------------------------------------------ */
/* Typed accessors                                                     */
/* ------------------------------------------------------------------ */

export function getString(settings: Record<string, unknown>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : '';
}

export function getNumber(settings: Record<string, unknown>, key: string): number {
  const value = settings[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function getBoolean(settings: Record<string, unknown>, key: string): boolean {
  const value = settings[key];
  return value === true;
}

export function getStringList(settings: Record<string, unknown>, key: string): string[] {
  const value = settings[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function getObject(settings: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = settings[key];
  return isPlainObject(value) ? value : {};
}

export function getLogLevel(settings: Record<string, unknown>): LogLevel {
  const value = settings['logLevel'];
  return isLogLevel(value) ? value : 'info';
}
