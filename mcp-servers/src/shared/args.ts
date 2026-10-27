/**
 * args.ts - command-line argument handling for the MCP servers.
 *
 * The only argument every server understands is `--data-dir <path>`: the
 * working folder that holds settings.json, raw downloads, databases and logs
 * (design: iptv-mcp-servers.md §5.1).
 */

import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';

export interface ParsedArgs {
  /** Absolute path of the working folder, with `~` expanded. */
  dataDir: string;
  /** Everything the parser did not recognise, for callers that need it. */
  unknown: string[];
  /** `--help` / `-h` was given. */
  help: boolean;
}

/**
 * Expand a leading `~` to the user's home directory.
 * A bare `~` and `~/…` are expanded; `~name/…` is left alone.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2));
  return path;
}

/**
 * Parse `--data-dir <path>`, `--data-dir=<path>` and `--help` out of the
 * arguments of the program.
 *
 * @param argv The arguments after the program name, e.g. `process.argv.slice(2)`.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const unknown: string[] = [];
  let dataDir = '';
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--data-dir') {
      const value = argv[i + 1];
      // A value that looks like another flag is not a folder.
      if (value === undefined || value.startsWith('-')) {
        unknown.push(arg);
        continue;
      }
      dataDir = value;
      i++;
      continue;
    }

    if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
      continue;
    }

    unknown.push(arg);
  }

  return {
    dataDir: dataDir ? resolve(expandHome(dataDir)) : '',
    unknown,
    help,
  };
}

/**
 * Create a folder and every folder above it, each with mode 0700.
 *
 * `mkdirSync` with `recursive: true` only gives the mode to the last folder;
 * the folders above it get the default mode of the system. The working
 * folder holds the settings and the databases, so every folder of the chain
 * is created private.
 *
 * Only the folders this call created and the folder itself are made
 * private. A folder that existed before — `/tmp`, `/var`, the home folder —
 * is left exactly as it was: it does not belong to the server, and a
 * process that runs as root would otherwise take the permissions of the
 * whole system away.
 */
export function ensureDir(path: string): string {
  const absolute = resolve(expandHome(path));
  // The root of the path: "/" on Unix, "C:\" on Windows, "\\server\share\" on a
  // network share. The chain is walked with dirname(), so no assumption about
  // a leading separator is made.
  const root = parsePath(absolute).root;

  // The root of the file system is never a working folder.
  if (absolute === root) {
    throw new Error(`the working folder must not be the root of the file system: ${absolute}`);
  }

  const missing: string[] = [];
  let current = absolute;
  while (current !== root && current !== dirname(current)) {
    if (!existsSync(current)) missing.push(current);
    current = dirname(current);
  }

  // The folders are created from the top down, each with mode 0700.
  const created: string[] = [];
  for (const dir of missing.reverse()) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      created.push(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  // The working folder itself is made private as well: it is the folder the
  // settings, the raw catalogue and the databases live in. The folders above
  // it are not touched — they may be /tmp, /var or the home folder.
  if (process.platform !== 'win32') {
    try {
      const stat = statSync(absolute);
      if ((stat.mode & 0o777) !== 0o700) chmodSync(absolute, 0o700);
    } catch {
      // A folder that cannot be changed is left alone.
    }
  }

  return absolute;
}

/**
 * Create the working folder (and its parents) if it does not exist.
 *
 * @returns the absolute path of the folder.
 */
export function ensureDataDir(path: string): string {
  return ensureDir(path);
}

/**
 * Default working folders (design: iptv-mcp-servers.md §5.1, decision D6).
 */
export const DEFAULT_DATA_DIRS = {
  'tv-guide': '~/.iptv-mcp/tv-guide',
  cinema: '~/.iptv-mcp/cinema',
} as const;

/**
 * Build a path inside the working folder.
 */
export function dataPath(dataDir: string, ...parts: string[]): string {
  return resolve(dataDir, ...parts);
}

/**
 * Create the `logs/` sub-folder of the working folder.
 */
export function ensureLogDir(dataDir: string): string {
  return ensureDir(dataPath(dataDir, 'logs'));
}

/**
 * Create the `raw/` sub-folder of the working folder.
 */
export function ensureRawDir(dataDir: string): string {
  return ensureDir(dataPath(dataDir, 'raw'));
}

/** Parent directory of a path, used when a file has to be written atomically. */
export function parentDir(path: string): string {
  return dirname(path);
}

/** True when the path is absolute. */
export function isAbsolutePath(path: string): boolean {
  return isAbsolute(path);
}
