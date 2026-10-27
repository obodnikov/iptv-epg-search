/**
 * descriptions.ts - what the tools tell the model.
 *
 * Pilot does not read the instructions of the server, so everything the
 * model needs has to be in the description of the tool
 * (design: iptv-mcp-servers.md §8.4). Every description says when to
 * use the tool, when to use a sibling instead, and gives an example.
 */

export const SEARCH_TITLES_DESCRIPTION =
  'Search the online cinema of the provider: films and series by genre, country, year, rating, director, category or words. Start with this tool for every question about the catalogue. The search matches words, not meaning: `query` is matched against the words of the title, the director and the description, so put the exact words of a title in `keywords` when they are known, and narrow the result with the filters (`genres`, `categories`, `countries`, `year_from`, `min_rating`). Take the values of `genres` and `categories` from `list_facets`. `countries` means the country the film was made in. The result carries no play links: call `get_title` (a film) or `list_episodes` (a series) when the user wants to watch. Example: search_titles(countries=["FR"], genres=["Драма"], min_rating=7).';

export const GET_TITLE_DESCRIPTION =
  'The details of one title: the full description, the rating of the provider, the genres, the countries and the play links of a film (one per quality). Use it after search_titles when the user asks about a specific title or wants to watch it. For a series it lists the seasons and how many episodes they have; the links of the episodes come from `list_episodes`. Example: get_title(title_id="a1b2c3d4e5f60718").';

export const LIST_EPISODES_DESCRIPTION =
  'The episodes of one season of a series, with a play link for every episode. Use it when the user wants to watch a series or asks for a specific episode. The first season is used when `season` is left out. Example: list_episodes(title_id="a1b2c3d4e5f60718", season=3).';

export const LIST_FACETS_DESCRIPTION =
  'The values a search may be filtered by: the categories, the genres and the countries of the catalogue with their counts, the range of the years and of the ratings, the newest day a title was added, and how many titles the provider tagged as new. Call it before a search when the spelling of a genre or a category is not certain. It takes no parameters. Example: list_facets().';

export const GET_STATUS_DESCRIPTION =
  'The state of the server: the settings file and the masked URL of the provider, the last refresh and how much it read, the number of the titles, whether a refresh is running and the last error. Use it when the catalogue looks empty, when a search finds nothing and the reason is not clear, or when the user asks how fresh the data is. It takes no parameters. Example: get_status().';

export const REFRESH_CATALOG_DESCRIPTION =
  'Download the catalogue of the provider and import it again. The work runs in the background and the answer says whether it started. Use it when the user asks for fresh data, or when get_status shows that the catalogue is old. The download is compared with the last one: nothing is written when the provider did not change anything, unless `force` is true. Example: refresh_catalog(force=true).';
