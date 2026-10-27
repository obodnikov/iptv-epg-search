/**
 * log-level.ts - the levels of the log, in one place.
 *
 * The settings file names a level and the logger has to understand it. Both
 * use this list, so that a new level cannot be added to one of them only.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

/**
 * True when the value is one of the levels.
 */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}
