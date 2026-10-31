/**
 * The names of the tools of the TV Guide server and the rule of Pilot.
 *
 * Pilot approves a tool of a read-only name without asking the user. The
 * rule lives in the client, not here (design: iptv-mcp-servers.md §8.1),
 * so the lists of the verbs are copied from
 * `~/src/open-cowork/src/shared/mcp-tool-classification.ts`. They have to
 * be updated when Pilot changes.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { guideHarness, type GuideHarness } from './harness.ts';

/**
 * The verbs that mark a tool as read-only.
 *
 * Copied from `src/shared/mcp-tool-classification.ts` of Sqowe Pilot
 * (READ_ONLY_VERBS).
 */
const READ_ONLY_VERBS = [
  'get',
  'list',
  'search',
  'find',
  'fetch',
  'query',
  'read',
  'describe',
  'show',
  'check',
  'count',
  'lookup',
  'browse',
  'view',
  'inspect',
  'retrieve',
];

/**
 * The verbs that mark a tool as a write.
 *
 * Copied from the same file (WRITE_VERBS).
 */
const WRITE_VERBS = [
  'create',
  'update',
  'delete',
  'remove',
  'modify',
  'set',
  'put',
  'post',
  'patch',
  'write',
  'execute',
  'run',
  'send',
  'publish',
  'deploy',
  'drop',
  'insert',
  'upsert',
  'mutate',
  'trigger',
  'invoke',
  'submit',
  'approve',
  'reject',
  'cancel',
  'revoke',
  'grant',
  'assign',
  'unassign',
  'enable',
  'disable',
  'start',
  'stop',
  'restart',
  'kill',
  'terminate',
  'capture',
];

/**
 * True when a verb of the list matches the name of a tool, as a prefix,
 * as an infix or as a suffix.
 *
 * The rule of Pilot (mcp-tool-classification.ts, `matchesVerb`).
 */
function matchesVerb(lower: string, verbs: string[]): boolean {
  for (const verb of verbs) {
    if (lower.startsWith(`${verb}_`)) return true;
    if (lower.includes(`_${verb}_`)) return true;
    if (lower.endsWith(`_${verb}`)) return true;
  }
  return false;
}

/**
 * True when Pilot approves the tool of this name without asking.
 */
function isReadOnlyForPilot(name: string): boolean {
  const lower = name.toLowerCase();
  if (matchesVerb(lower, WRITE_VERBS)) return false;
  return matchesVerb(lower, READ_ONLY_VERBS);
}

const harnesses: GuideHarness[] = [];

after(async () => {
  for (const harness of harnesses) await harness.cleanup();
});

describe('the names of the tools of the TV Guide server', () => {
  it('are approved by Pilot without a question', async () => {
    const harness = await guideHarness({ guide: false });
    harnesses.push(harness);

    const tools = await harness.client.listTools();

    for (const tool of tools.tools) {
      if (tool.name === 'refresh_guide') continue;
      assert.equal(
        isReadOnlyForPilot(tool.name),
        true,
        `${tool.name} is not a read-only name for Pilot`,
      );
    }
  });

  it('ask the user before the refresh runs', async () => {
    const harness = await guideHarness({ guide: false });
    harnesses.push(harness);

    const tools = await harness.client.listTools();
    const refresh = tools.tools.find((tool) => tool.name === 'refresh_guide');

    assert.ok(refresh);
    // The name has no read verb: Pilot asks before the tool runs.
    assert.equal(isReadOnlyForPilot('refresh_guide'), false);
    // The refresh is the only tool without one.
    assert.equal(tools.tools.length, 8);
  });
});
