/**
 * descriptions.ts - what the tools tell the model.
 *
 * Pilot does not read the instructions of the server, so everything the
 * model needs has to be in the description of the tool
 * (design: iptv-mcp-servers.md §8.4). Every description says when to use
 * the tool, when to use a sibling instead, and gives an example.
 */

export const SEARCH_PROGRAMS_DESCRIPTION =
  'Search the programme guide of the user\u2019s IPTV provider: what airs now, tonight, this week or in the catch-up archive, by words, kind, channel, country or meaning. Start with this tool for every question about broadcast TV. `query` takes a description in any language; put exact names (teams, places, venues, people) in `keywords`. Decide what a country in the request means: `production_countries` is where a film was made ("\u0444\u0440\u0430\u043d\u0446\u0443\u0437\u0441\u043a\u0438\u0435 \u0444\u0438\u043b\u044c\u043c\u044b" \u2192 ["FR"]), `channel_regions` is the country of the channel ("\u043d\u0430 \u043d\u0435\u043c\u0435\u0446\u043a\u0438\u0445 \u043a\u0430\u043d\u0430\u043b\u0430\u0445" \u2192 ["DE"]), the place of an event or a participating team goes into `keywords` (a biathlon stage in \u00d6stersund \u2192 keywords=["\u042d\u0441\u0442\u0435\u0440\u0441\u0443\u043d\u0434","\u0428\u0432\u0435\u0446\u0438\u044f"]). The answer carries no links: call get_program when the user wants to watch. Example: search_programs(kinds=["film"], production_countries=["FR"], period="next_7d").';

export const GET_PROGRAM_DESCRIPTION =
  'The details of one airing: the full description, the extracted facts (director, cast, year, genres, production countries, sport, venue), the channel with its archive depth, and the Watch Live and Catch-up links. Use it after search_programs or find_airings when the user asks about a specific programme or wants to watch. The catch-up link depends on the current time: fetch it right before the user watches. Example: get_program(program_id="match-tv-hd@1781500000").';

export const GET_NOW_AND_NEXT_DESCRIPTION =
  'What every channel is showing now and what comes next. Use it for "what is on", on all channels or on a selection by theme, country or name. The time-shifted copies ("+2\u0447") are left out unless they are named in `channels`. For one channel\u2019s whole day use get_channel_schedule instead. Example: get_now_and_next(channel_themes=["sport"]).';

export const GET_CHANNEL_SCHEDULE_DESCRIPTION =
  'The programmes of one channel for a day or an exact window, in time order. Use it when the user asks for the programme of one channel ("\u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0430 \u041c\u0430\u0442\u0447 \u0422\u0412 \u043d\u0430 \u0437\u0430\u0432\u0442\u0440\u0430"). For what is on right now across channels use get_now_and_next. Example: get_channel_schedule(channel="\u041c\u0430\u0442\u0447 \u0422\u0412 HD", date="2026-06-15").';

export const FIND_AIRINGS_DESCRIPTION =
  'Every airing of one title: when it will be shown, and which archived airings still have a catch-up link. Use it for "\u043a\u043e\u0433\u0434\u0430 \u043f\u043e\u043a\u0430\u0436\u0443\u0442 X" or "\u0433\u0434\u0435 \u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c X \u043f\u043e \u0422\u0412". The title is matched exactly first, then by its words. For a wider search by description use search_programs. Example: find_airings(title="\u0411\u044b\u043a").';

export const LIST_CHANNELS_DESCRIPTION =
  'The channels of the guide: the groups with their themes and regions when no filter is given, the channels themselves when one is. Use it before a search to take the exact values of `channel_themes` and `channel_regions`, or to find the name of a channel. Example: list_channels(region="DE").';

export const GET_STATUS_DESCRIPTION =
  'The state of the server: the settings file and the masked URLs, where the EPG URL came from, the last refresh, the numbers of the guide and its time window, whether a refresh is running and the last error. Use it when a search finds nothing and the reason is not clear, or when the user asks how fresh the data is. It takes no parameters. Example: get_status().';

export const REFRESH_GUIDE_DESCRIPTION =
  'Download the programme guide and the playlist of the provider and import them again. The work runs in the background and the answer says whether it started. Use it when the user asks for fresh data, or when get_status shows that the guide is old. An import that sees no change at the provider writes nothing, unless `force` is true. Example: refresh_guide(force=true).';
