/**
 * tool-names.test.ts - the names of the tools and the rule of Pilot.
 *
 * Pilot approves a tool of a read-only name without asking the user. The
 * rule lives in the client, not here (design: iptv-mcp-servers.md §8.1),
 * so the lists of the verbs are copied from
 * `~/src/open-cowork/src/shared/mcp-tool-classification.ts`. They have to
 * be updated when Pilot changes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cinemaHarness } from './harness.ts';

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

describe('the names of the tools of the cinema server', () => {
  it('are approved by Pilot without a question', async () => {
    const harness = await cinemaHarness();
    try {
      const tools = await harness.client.listTools();

      for (const tool of tools.tools) {
        if (tool.name === 'refresh_catalog') continue;
        assert.equal(
          isReadOnlyForPilot(tool.name),
          true,
          `${tool.name} is not a read-only name for Pilot`,
        );
      }
    } finally {
      await harness.cleanup();
    }
  });

  it('ask the user before the refresh runs', async () => {
    const harness = await cinemaHarness();
    try {
      const tools = await harness.client.listTools();
      const refresh = tools.tools.find((tool) => tool.name === 'refresh_catalog');

      assert.ok(refresh);
      // The name has no read verb: Pilot asks before the tool runs.
      assert.equal(isReadOnlyForPilot('refresh_catalog'), false);
    } finally {
      await harness.cleanup();
    }
  });

  it('have no write verb in their name', () => {
    for (const name of [
      'search_titles',
      'find_similar_titles',
      'get_title',
      'list_episodes',
      'list_facets',
      'get_status',
      'refresh_catalog',
    ]) {
      assert.equal(matchesVerb(name.toLowerCase(), WRITE_VERBS), false, name);
    }
  });
});
