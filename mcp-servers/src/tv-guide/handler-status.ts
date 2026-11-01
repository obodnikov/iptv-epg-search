/**
 * handler-status.ts - the `get_status` and `refresh_guide` tools.
 *
 * The state of the server comes from the `meta` table and the counters of
 * the guide (`status.ts`); the URLs are masked there. The refresh runs in
 * the background and answers at once (decision D15).
 */

import type { CallToolResult } from '@modelcontextprotocol/server';

import { okResult } from '../shared/tool-kit.ts';
import { epgUrlSourceOf, statusReport } from './status.ts';
import { settingsOf, type GuideToolContext } from './tool-context.ts';

/**
 * `get_status` — the state of the server.
 */
export async function getStatusTool(ctx: GuideToolContext): Promise<CallToolResult> {
  const settings = settingsOf(ctx);
  const progress = ctx.runner.progress();
  const failure = ctx.runner.lastFailure();

  const report = statusReport(ctx.db, {
    settingsPath: ctx.settings.path,
    epgUrl: settings.epgUrl,
    liveUrl: settings.liveUrl,
    epgUrlSource: epgUrlSourceOf(ctx.db),
    timezone: settings.timezone,
    model: settings.embeddings.model,
    progress,
    lastError: failure?.error ?? null,
    embedding: ctx.worker.status(),
  });

  const issues = ctx.settings.issues();

  const lines: string[] = [];
  lines.push(`Settings: ${report.settings_path}`);
  lines.push(`EPG URL: ${report.epg_url}`);
  lines.push(`Live URL: ${report.live_url}`);
  lines.push(
    `EPG URL of the last import came from: ${report.epg_url_source === 'none' ? '(no import yet)' : report.epg_url_source}`,
  );
  for (const issue of issues) {
    lines.push(`Problem of the settings file: ${issue}`);
  }
  lines.push(
    `Guide: ${report.counts.programmes} programmes on ${report.counts.channels} channels (${report.counts.with_stream} with a stream, ${report.counts.with_archive} with an archive), ${report.counts.texts} distinct texts`,
  );
  if (report.window.from && report.window.to) {
    lines.push(`Window of the guide: ${report.window.from} … ${report.window.to}`);
  } else {
    lines.push('The guide is empty.');
  }
  if (report.last_refresh.status === 'never') {
    lines.push('Last refresh: never');
  } else {
    const what = report.last_refresh.unchanged
      ? 'nothing changed at the provider, nothing was written'
      : `${report.last_refresh.programmes} programmes, ${report.last_refresh.texts} texts`;
    lines.push(
      `Last refresh: ${report.last_refresh.at} (${report.last_refresh.status}, ${what}, ${report.last_refresh.duration_ms} ms)`,
    );
    if (report.last_refresh.default_offsets > 0) {
      lines.push(
        `${report.last_refresh.default_offsets} programme(s) took the default offset of the zone.`,
      );
    }
    if (report.last_refresh.last_success_at) {
      lines.push(`Last successful import: ${report.last_refresh.last_success_at}`);
    }
    if (report.last_refresh.error) {
      lines.push(`The last refresh failed: ${report.last_refresh.error}`);
    }
  }
  lines.push(
    `Vectors: ${report.vectors.done} done, ${report.vectors.pending} pending (model ${report.vectors.model})`,
  );
  lines.push(`Search mode: ${report.search_mode}`);
  if (report.embedding.running) {
    lines.push(
      `An embedding run is in progress (${report.embedding.done} of ${report.embedding.done + report.embedding.pending} done, ${report.embedding.phase})`,
    );
  }
  if (!report.vectors.meaning && !report.embedding.running) {
    if (!report.embedding.enabled) {
      lines.push(
        'The search by meaning is switched off: set "embeddings"."enabled" to true in the settings file.',
      );
    } else if (!report.embedding.available) {
      lines.push(
        `The search by meaning needs the key of the embedding service: put it in the environment variable "${settings.embeddings.apiKeyEnv}".`,
      );
    } else {
      lines.push(
        'The search by meaning is not available yet: the vectors of the guide are still being built.',
      );
    }
  }
  if (report.refresh_running) {
    lines.push(
      `A refresh is running (${report.refresh_running.phase}, ${report.refresh_running.elapsed_ms} ms)`,
    );
  }
  if (report.last_error) lines.push(`Last error: ${report.last_error}`);

  return okResult(
    { ...report, settings_issues: issues },
    lines.join('\n'),
  );
}

/**
 * `refresh_guide` — the background refresh of the guide.
 */
export async function refreshGuideTool(
  ctx: GuideToolContext,
  args: { force?: boolean },
): Promise<CallToolResult> {
  const status = ctx.refresh(args.force ?? false);

  let message: string;
  if (status === 'not_configured') {
    message = `EPG URL and Live URL are not set: edit ${ctx.settings.path}`;
  } else if (status === 'already_running') {
    message = 'A refresh is already running. Ask get_status for its progress.';
  } else {
    message = 'The refresh started. It runs in the background; ask get_status for its progress.';
  }

  const data = {
    status,
    settings_path: ctx.settings.path,
    message,
  };

  return okResult(data, message);
}
