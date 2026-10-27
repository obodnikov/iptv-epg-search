/**
 * permissions.ts - the rights of the files of the working folder.
 *
 * The settings file, the raw catalogue and the metadata hold the URL of the
 * provider with the access key. They are readable for their owner only.
 *
 * Windows has no Unix modes; there the rights come from the ACL of the
 * folder, so the checks are a no-op.
 */

import { chmodSync, statSync } from 'node:fs';
import { chmod, stat } from 'node:fs/promises';

/** The mode of a file that holds a secret. */
export const PRIVATE_FILE_MODE = 0o600;

/** The mode of a folder of the working folder. */
export const PRIVATE_DIR_MODE = 0o700;

function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Make a file readable for its owner only.
 *
 * @returns true when the file is private afterwards.
 */
export async function hardenFile(path: string): Promise<boolean> {
  if (isWindows()) return true;
  try {
    await chmod(path, PRIVATE_FILE_MODE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make a file readable for its owner only, without waiting.
 */
export function hardenFileSync(path: string): boolean {
  if (isWindows()) return true;
  try {
    chmodSync(path, PRIVATE_FILE_MODE);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the file is readable for its owner only.
 */
export async function isPrivateFile(path: string): Promise<boolean> {
  if (isWindows()) return true;
  try {
    const info = await stat(path);
    return (info.mode & 0o777) === PRIVATE_FILE_MODE;
  } catch {
    return false;
  }
}

/**
 * True when the file is readable for its owner only.
 */
export function isPrivateFileSync(path: string): boolean {
  if (isWindows()) return true;
  try {
    const info = statSync(path);
    return (info.mode & 0o777) === PRIVATE_FILE_MODE;
  } catch {
    return false;
  }
}