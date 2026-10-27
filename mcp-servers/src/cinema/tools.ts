/**
 * tools.ts - the registration of the tools of the cinema server.
 *
 * The tools are registered with their parameters, their answers and their
 * annotations. What they do is in `handlers.ts`, what they tell the model
 * is in `descriptions.ts`.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import {
  getStatusTool,
  getTitleTool,
  listEpisodesTool,
  listFacetsTool,
  refreshCatalogTool,
  searchTitlesTool,
  type CinemaToolContext,
} from './handlers.ts';
import {
  GET_STATUS_DESCRIPTION,
  GET_TITLE_DESCRIPTION,
  LIST_EPISODES_DESCRIPTION,
  LIST_FACETS_DESCRIPTION,
  REFRESH_CATALOG_DESCRIPTION,
  SEARCH_TITLES_DESCRIPTION,
} from './descriptions.ts';
import {
  getStatusInput,
  getStatusOutput,
  getTitleInput,
  getTitleOutput,
  listEpisodesInput,
  listEpisodesOutput,
  listFacetsInput,
  listFacetsOutput,
  refreshCatalogInput,
  refreshCatalogOutput,
  searchTitlesInput,
  searchTitlesOutput,
} from './schemas.ts';

/**
 * Register the tools of the cinema server.
 */
export function registerCinemaTools(server: McpServer, ctx: CinemaToolContext): void {
  server.registerTool(
    'search_titles',
    {
      title: 'Search titles',
      description: SEARCH_TITLES_DESCRIPTION,
      inputSchema: searchTitlesInput,
      outputSchema: searchTitlesOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => searchTitlesTool(ctx, args),
  );

  server.registerTool(
    'get_title',
    {
      title: 'Get a title',
      description: GET_TITLE_DESCRIPTION,
      inputSchema: getTitleInput,
      outputSchema: getTitleOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => getTitleTool(ctx, args),
  );

  server.registerTool(
    'list_episodes',
    {
      title: 'List the episodes of a series',
      description: LIST_EPISODES_DESCRIPTION,
      inputSchema: listEpisodesInput,
      outputSchema: listEpisodesOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) => listEpisodesTool(ctx, args),
  );

  server.registerTool(
    'list_facets',
    {
      title: 'List the values of the catalogue',
      description: LIST_FACETS_DESCRIPTION,
      inputSchema: listFacetsInput,
      outputSchema: listFacetsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => listFacetsTool(ctx),
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
    'refresh_catalog',
    {
      title: 'Refresh the catalogue',
      description: REFRESH_CATALOG_DESCRIPTION,
      inputSchema: refreshCatalogInput,
      outputSchema: refreshCatalogOutput,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    (args) => refreshCatalogTool(ctx, args),
  );
}

