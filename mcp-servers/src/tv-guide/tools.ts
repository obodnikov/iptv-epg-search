/**
 * tools.ts - the registration of the tools of the TV Guide server.
 *
 * The tools are registered with their parameters, their answers and their
 * annotations. What they do is in `handlers.ts` (the search in
 * `handler-search.ts`), what they tell the model is in `descriptions.ts`.
 *
 * The names follow the rule of Pilot (design: iptv-mcp-servers.md §8.1):
 * every read-only name contains a read verb, and the one tool that moves
 * data is `refresh_guide`, without one - Pilot asks before running it, and
 * that is intended.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import {
  findAiringsTool,
  getChannelScheduleTool,
  getNowAndNextTool,
  getProgramTool,
  listChannelsTool,
  searchProgramsTool,
  type GuideToolContext,
} from './handlers.ts';
import { getStatusTool, refreshGuideTool } from './handler-status.ts';
import {
  FIND_AIRINGS_DESCRIPTION,
  GET_CHANNEL_SCHEDULE_DESCRIPTION,
  GET_NOW_AND_NEXT_DESCRIPTION,
  GET_PROGRAM_DESCRIPTION,
  GET_STATUS_DESCRIPTION,
  LIST_CHANNELS_DESCRIPTION,
  REFRESH_GUIDE_DESCRIPTION,
  SEARCH_PROGRAMS_DESCRIPTION,
} from './descriptions.ts';
import {
  findAiringsInput,
  findAiringsOutput,
  getChannelScheduleInput,
  getChannelScheduleOutput,
  getNowAndNextInput,
  getNowAndNextOutput,
  getProgramInput,
  getProgramOutput,
  getStatusInput,
  getStatusOutput,
  listChannelsInput,
  listChannelsOutput,
  refreshGuideInput,
  refreshGuideOutput,
  searchProgramsInput,
  searchProgramsOutput,
} from './schemas.ts';

/**
 * Register the tools of the TV Guide server.
 */
export function registerGuideTools(server: McpServer, ctx: GuideToolContext): void {
  server.registerTool(
    'search_programs',
    {
      title: 'Search programmes',
      description: SEARCH_PROGRAMS_DESCRIPTION,
      inputSchema: searchProgramsInput,
      outputSchema: searchProgramsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => searchProgramsTool(ctx, args),
  );

  server.registerTool(
    'get_program',
    {
      title: 'Get a programme',
      description: GET_PROGRAM_DESCRIPTION,
      inputSchema: getProgramInput,
      outputSchema: getProgramOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => getProgramTool(ctx, args),
  );

  server.registerTool(
    'get_now_and_next',
    {
      title: 'What is on now and next',
      description: GET_NOW_AND_NEXT_DESCRIPTION,
      inputSchema: getNowAndNextInput,
      outputSchema: getNowAndNextOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => getNowAndNextTool(ctx, args),
  );

  server.registerTool(
    'get_channel_schedule',
    {
      title: 'The schedule of a channel',
      description: GET_CHANNEL_SCHEDULE_DESCRIPTION,
      inputSchema: getChannelScheduleInput,
      outputSchema: getChannelScheduleOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => getChannelScheduleTool(ctx, args),
  );

  server.registerTool(
    'find_airings',
    {
      title: 'Find the airings of a title',
      description: FIND_AIRINGS_DESCRIPTION,
      inputSchema: findAiringsInput,
      outputSchema: findAiringsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => findAiringsTool(ctx, args),
  );

  server.registerTool(
    'list_channels',
    {
      title: 'List the channels',
      description: LIST_CHANNELS_DESCRIPTION,
      inputSchema: listChannelsInput,
      outputSchema: listChannelsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => listChannelsTool(ctx, args),
  );

  server.registerTool(
    'get_status',
    {
      title: 'Get the status of the server',
      description: GET_STATUS_DESCRIPTION,
      inputSchema: getStatusInput,
      outputSchema: getStatusOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => getStatusTool(ctx),
  );

  server.registerTool(
    'refresh_guide',
    {
      title: 'Refresh the guide',
      description: REFRESH_GUIDE_DESCRIPTION,
      inputSchema: refreshGuideInput,
      outputSchema: refreshGuideOutput,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => refreshGuideTool(ctx, args),
  );
}
