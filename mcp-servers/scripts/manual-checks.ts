/**
 * manual-checks.ts - the ten checks of the design, run against the cinema
 * server (design: cinema-server.md §10).
 *
 * The script starts the server over stdio, the way a client starts it, and
 * asks it the ten questions of §10 with the tool calls the design
 * prescribes. It prints what the server answered and whether the answer is
 * the one the design expects.
 *
 * The script does not judge the model: it checks the **server**. What the
 * model chooses is what the checks in Pilot are for; this script tells the
 * two apart.
 *
 * Usage:
 *   node scripts/manual-checks.ts [--data-dir <folder>]
 *
 * The working folder defaults to `~/.iptv-mcp/cinema`. The script starts
 * the server itself, so nothing has to be kept open in a terminal.
 */

import { CHECKS } from './manual/checks.ts';
import {
  DEFAULT_DATA_DIR,
  folderOf,
  startServer,
  structured,
  textOf,
  waitForCatalogue,
  waitForRefreshToSettle,
  waitForVectors,
  type Server,
} from './manual/support.ts';

/**
 * The state of the server, before the checks.
 *
 * @returns the text of the state, the sentence that says why the checks
 *   cannot run yet (null when they can), and whether an import is running
 *   that the script has to wait for.
 */
async function statusOf(
  server: Server,
): Promise<{ text: string; ready: string | null; importing: boolean }> {
  const result = await server.call('get_status');
  if (result.isError) {
    return { text: `the status is an error: ${textOf(result)}`, ready: null, importing: false };
  }

  const data = structured(result);
  const counts = data['counts'] as Record<string, number> | undefined;
  const vectors = data['vectors'] as Record<string, unknown> | undefined;
  const refresh = data['last_refresh'] as Record<string, unknown> | undefined;
  const embedding = data['embedding'] as Record<string, unknown> | undefined;

  const text = [
    `titles: ${counts?.titles ?? 0} (${counts?.films ?? 0} films, ${counts?.series ?? 0} series)`,
    `vectors: ${vectors?.done ?? 0} done, ${vectors?.pending ?? 0} pending (${vectors?.model ?? '?'})`,
    `search mode: ${data['search_mode'] ?? '?'}`,
    `last refresh: ${refresh?.status ?? '?'} (${refresh?.titles ?? 0} titles, ${refresh?.duration_ms ?? 0} ms)`,
    `embedding: ${embedding?.running === true ? 'running' : 'idle'} (${embedding?.done ?? 0} texts in this run, ${embedding?.error ?? 'no error'})`,
  ].join('\n');

  if (data['configured'] !== true) {
    return {
      text,
      ready: `The cinema URL is not set: edit ${String(data['settings_path'] ?? 'the settings file')}.`,
      importing: false,
    };
  }

  if ((counts?.titles ?? 0) === 0) {
    const running = data['refresh_running'] as Record<string, unknown> | null;
    if (running) return { text, ready: null, importing: true };
    return {
      text,
      ready:
        'The catalogue is empty and no refresh is running. Call refresh_catalog, then run the checks again.',
      importing: false,
    };
  }

  return { text, ready: null, importing: false };
}

/**
 * Run the checks and print the report.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let dataDir = DEFAULT_DATA_DIR;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--data-dir' && index + 1 < argv.length) {
      dataDir = argv[index + 1] ?? dataDir;
      index++;
      continue;
    }
    if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
      continue;
    }
    console.error(`unknown argument: ${arg}`);
    console.error('usage: node scripts/manual-checks.ts [--data-dir <folder>]');
    process.exit(2);
  }

  const folder = folderOf(dataDir);

  console.log('Cinema MCP server - the manual checks of cinema-server.md §10');
  console.log(`Working folder: ${folder}`);
  console.log('');

  const server = await startServer(folder);
  let failures = 0;
  let warnings = 0;

  try {
    const status = await statusOf(server);
    console.log('The state of the server:');
    console.log(
      status.text
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    );
    console.log('');

    if (status.ready && !status.importing) {
      console.log(status.ready);
      process.exit(2);
    }

    if (status.importing) {
      // The server started the import by itself (the catalogue was never
      // imported). The script waits for it: a killed import leaves its
      // lock behind, and the lock blocks the next refresh for an hour.
      console.log('The catalogue is empty: the import runs in the background.');
      const imported = await waitForCatalogue(server, undefined, (phase) =>
        console.log(`  the import is in the phase "${phase}"…`),
      );
      console.log(`  ${imported.note}`);
      console.log('');

      if (!imported.ready) {
        console.log(imported.note);
        process.exit(2);
      }
    }

    // The vectors of the catalogue: the search by meaning needs them, and
    // the fourth check of the design looks at the mode of the search.
    const vectors = await waitForVectors(server, undefined, (done, pending) =>
      console.log(`  ${done} texts embedded in this run, ${pending} to go…`),
    );
    console.log(`  ${vectors.note}`);
    console.log('');

    for (const check of CHECKS) {
      let outcome;
      try {
        outcome = await check.run(server, { dataDir: folder });
      } catch (error) {
        outcome = {
          ok: false,
          note: `the check threw: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      if (!outcome.ok) failures++;
      else if (outcome.soft) warnings++;

      const mark = outcome.ok ? (outcome.soft ? 'WARN' : ' OK ') : 'FAIL';
      console.log(`${String(check.id).padStart(2)}. ${mark}  ${check.question}`);
      console.log(`      tool: ${check.tool}`);
      console.log(`      ${outcome.note}`);
      console.log('');
    }
  } finally {
    // The server is closed: a refresh that is killed leaves its lock
    // behind, and the lock blocks the next refresh for an hour.
    const running = await waitForRefreshToSettle(server);
    if (running) {
      console.log(`Warning: ${running}. The lock of the working folder may block the next refresh for an hour.`);
    }
    await server.close();
  }

  const failed = failures > 0;
  console.log(
    failed
      ? `${failures} of ${CHECKS.length} checks failed (${warnings} warnings).`
      : `All ${CHECKS.length} checks passed (${warnings} warnings).`,
  );
  process.exit(failed ? 1 : 0);
}

await main();
