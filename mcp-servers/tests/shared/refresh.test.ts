/**
 * refresh.test.ts - the background refresh of a server.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RefreshRunner } from '../../src/shared/refresh.ts';

/** Wait until the runner is idle again. */
async function settle(runner: RefreshRunner): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (!runner.progress().running) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('RefreshRunner', () => {
  it('starts a refresh and returns at once', async () => {
    const runner = new RefreshRunner();
    let finished = false;

    const outcome = runner.start(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished = true;
      return 'the result';
    });

    assert.equal(outcome, 'started');
    assert.equal(finished, false);
    assert.equal(runner.progress().running, true);

    await settle(runner);
    assert.equal(finished, true);
    assert.equal(runner.progress().running, false);
    assert.equal(runner.lastResult(), 'the result');
  });

  it('refuses a second refresh while one runs', async () => {
    const runner = new RefreshRunner();
    runner.start(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return null;
    });

    const second = runner.start(() => null);
    assert.equal(second, 'already_running');

    await settle(runner);
  });

  it('reports the phase of the refresh', async () => {
    const runner = new RefreshRunner();
    let phase = '';

    runner.start(async (report) => {
      report('downloading');
      await new Promise((resolve) => setTimeout(resolve, 10));
      phase = runner.progress().phase;
      report('importing');
      return null;
    });

    await settle(runner);
    assert.equal(phase, 'downloading');
    assert.equal(runner.progress().phase, 'done');
  });

  it('remembers the failure of a refresh', async () => {
    const runner = new RefreshRunner();

    runner.start(async () => {
      throw new Error('the provider answered 500');
    });

    await settle(runner);
    assert.equal(runner.progress().phase, 'failed');
    assert.equal(runner.lastFailure()?.error, 'the provider answered 500');
  });

  it('has no failure before the first refresh', () => {
    const runner = new RefreshRunner();
    assert.equal(runner.lastFailure(), null);
    assert.equal(runner.lastResult(), null);
  });
});
