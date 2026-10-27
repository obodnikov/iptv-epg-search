/**
 * refresh.ts - the background refresh of a server.
 *
 * A tool call never waits for a download or an import (decision D15): the
 * refresh runs in the background and the tools answer from whatever is in
 * the database. `get_status` reports that a refresh is running and how far
 * it got.
 *
 * The lock of the working folder is not here: it is in `lock.ts`, and the
 * import takes it itself (design: cinema-server.md §4).
 */

import { type LogLevel } from './log-level.ts';

/** The phases a refresh goes through. */
export type RefreshPhase = 'starting' | 'downloading' | 'importing' | 'done' | 'failed';

export interface RefreshProgress {
  /** True while the refresh runs. */
  running: boolean;
  /** What the refresh is doing right now. */
  phase: RefreshPhase;
  /** Epoch milliseconds of the moment the refresh started. */
  startedAt: number | null;
  /** How long the refresh has been running, in milliseconds. */
  elapsedMs: number;
}

export interface RefreshFailure {
  /** The reason the refresh failed. */
  error: string;
  /** Epoch milliseconds of the moment it failed. */
  at: number;
}

/**
 * The runner of the background refresh of one server.
 *
 * Only one refresh runs at a time: a second call is told that a refresh is
 * already running.
 */
export class RefreshRunner {
  private running = false;
  private phase: RefreshPhase = 'done';
  private startedAt: number | null = null;
  private failure: RefreshFailure | null = null;
  private lastSuccessAt: number | null = null;
  /** The result of the last refresh, whatever it was. */
  private result: unknown = null;

  /**
   * Start a refresh in the background.
   *
   * @param task The work. It gets a function that reports the phase.
   * @returns 'started' when the work began, 'already_running' when a
   *   refresh was already going on.
   */
  start(
    task: (report: (phase: RefreshPhase) => void) => Promise<unknown> | unknown,
  ): 'started' | 'already_running' {
    if (this.running) return 'already_running';

    this.running = true;
    this.phase = 'starting';
    this.startedAt = Date.now();
    this.failure = null;

    const report = (phase: RefreshPhase): void => {
      this.phase = phase;
    };

    // The task is not awaited: the tool call returns at once.
    void (async () => {
      try {
        this.result = await task(report);
        this.phase = 'done';
        this.lastSuccessAt = Date.now();
      } catch (error) {
        this.phase = 'failed';
        this.failure = {
          error: error instanceof Error ? error.message : String(error),
          at: Date.now(),
        };
      } finally {
        this.running = false;
        this.startedAt = null;
      }
    })();

    return 'started';
  }

  /** The state of the refresh right now. */
  progress(now = Date.now()): RefreshProgress {
    return {
      running: this.running,
      phase: this.phase,
      startedAt: this.startedAt,
      elapsedMs: this.startedAt === null ? 0 : Math.max(0, now - this.startedAt),
    };
  }

  /** The result of the last refresh, or null when there was none. */
  lastResult(): unknown {
    return this.result;
  }

  /** The failure of the last refresh, or null when it did not fail. */
  lastFailure(): RefreshFailure | null {
    return this.failure;
  }

  /** The moment of the last successful refresh, in epoch milliseconds. */
  lastSuccess(): number | null {
    return this.lastSuccessAt;
  }
}

/**
 * The word of a log line that says how far a refresh got.
 */
export function phaseWord(phase: RefreshPhase): string {
  switch (phase) {
    case 'starting':
      return 'starting';
    case 'downloading':
      return 'downloading';
    case 'importing':
      return 'importing';
    case 'done':
      return 'done';
    case 'failed':
      return 'failed';
  }
}

/**
 * The level a log line of a phase gets.
 */
export function phaseLevel(phase: RefreshPhase): LogLevel {
  return phase === 'failed' ? 'error' : 'info';
}
