/**
 * log.ts - file log with levels.
 *
 * The servers write to `<data-dir>/logs/server.log` and never to stdout:
 * stdout carries the MCP protocol and nothing else
 * (design: iptv-mcp-servers.md §4.2 step 5).
 *
 * Every message is passed through the URL masker, so an access key can never
 * reach the log file.
 */

import { appendFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { ensureDir } from './args.ts';
import { maskUrlsInText } from './links.ts';
import { type LogLevel } from './log-level.ts';

export type { LogLevel };
export { LOG_LEVELS } from './log-level.ts';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
};

export interface LogFields {
  [key: string]: unknown;
}

/**
 * Write a log line. Errors are swallowed: a broken log must never stop the
 * server.
 */
export class Logger {
  private readonly filePath: string;
  private level: LogLevel;
  /** The file is made private after the first line was written. */
  private hardened = false;

  constructor(filePath: string, level: LogLevel = 'info') {
    this.filePath = filePath;
    this.level = level;
    // The folder of the log is created with mode 0700, like the rest of the
    // working folder. A folder that exists already is left as it is.
    try {
      ensureDir(dirname(filePath));
    } catch {
      // The log folder cannot be created: the log file will report it.
    }
    if (existsSync(filePath)) this.harden();
  }

  /** Make the log file readable for its owner only. */
  private harden(): void {
    if (this.hardened || process.platform === 'win32') return;
    try {
      chmodSync(this.filePath, 0o600);
      this.hardened = true;
    } catch {
      // The file may not exist yet.
    }
  }

  /** Change the level, for example after the settings file was re-read. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** The level currently in use. */
  getLevel(): LogLevel {
    return this.level;
  }

  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) return;

    const parts: string[] = [
      new Date().toISOString(),
      LEVEL_NAMES[level],
      maskUrlsInText(sanitizeLine(message)),
    ];
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        parts.push(`${key}=${maskUrlsInText(sanitizeLine(formatValue(value)))}`);
      }
    }

    const line = `${parts.join(' ')}\n`;
    try {
      appendFileSync(this.filePath, line, { mode: 0o600 });
      this.harden();
    } catch {
      // Fall back to stderr. Never to stdout.
      try {
        process.stderr.write(line);
      } catch {
        // Nothing else to do.
      }
    }
  }
}

/**
 * Replace the line breaks of a text, so that one log call is always one
 * line. A title or an error message cannot forge extra log lines.
 */
export function sanitizeLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ');
}

/**
 * Format a log field value.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
