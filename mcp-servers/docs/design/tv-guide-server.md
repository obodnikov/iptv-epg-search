# TV Guide MCP Server — Design & Implementation Plan

**Status:** In progress. Second server, after Cinema. **T1 (import) is done
(2026-10-28)**; the derived fields (T2), the tools (T3) and the search by
meaning (T4) follow.
**Date:** 2026-10-25
**Owner:** @obodnikov
**Parent document:** [iptv-mcp-servers.md](iptv-mcp-servers.md). Shared decisions D1–D15,
settings, storage, search model and tool rules are defined there and not repeated here.
**Sibling:** [cinema-server.md](cinema-server.md)
**Web app reference:** [epgParser.js](../../../public/scripts/utils/epgParser.js),
[m3uParser.js](../../../public/scripts/utils/m3uParser.js) (`parseLiveM3u`),
[search.js](../../../public/scripts/utils/search.js),
[results.js](../../../public/scripts/components/results.js) (Watch Live / Catch-up),
[live-tv-playback-plan.md](../../../docs/design/live-tv-playback-plan.md) §5 (verified
catch-up behaviour)

---

## 1. Summary

The TV Guide server loads the provider's programme guide (XMLTV) and the live-channel
playlist (M3U). It stores channels and programmes in SQLite with absolute UTC times, and works
out what each programme is: film, series, sport, news and so on. Where the description allows,
it extracts director, cast, production country, year and genres. Eight tools let the model:

- search by meaning, words, time, kind, channel theme or channel country;
- see what is on now;
- read one channel's schedule;
- find all airings of a title;
- get Watch Live and Catch-up links;
- check status and trigger a refresh.

---

## 2. Source data (verified 2026-10-25)

Samples are in the web app's git-ignored `tmp/` (June 2026 snapshot).

### 2.1 EPG — `tmp/4a27b28d` (XMLTV, uncompressed)

- 146,688,201 bytes; generator `cbilling.tv EPG`.
- **1,303 channels**: `<channel id>`, `<display-name lang="ru">`, `<icon src>`.
- **321,787 programmes** over 10 days, 2026-06-14 … 2026-06-23. Attributes `start`, `stop`,
  `channel` only.
- Every programme start has the offset `+0300`, e.g. `start="20260614091000 +0300"` (stop
  times were not counted separately).
- Children: `<title lang="ru">` (all), `<desc lang="ru">` (211,693; 110,094 programmes have
  none). No category, date, credits or rating element.
- The web app always gunzips the download
  ([epgParser.js:39](../../../public/scripts/utils/epgParser.js#L39)) and parses with
  `DOMParser` ([epgParser.js:67](../../../public/scripts/utils/epgParser.js#L67)).

### 2.2 Live playlist — `tmp/playlist.m3u`

- Header:
  `#EXTM3U url-tvg="http://…/xml/<id>.gz" x-tvg-url="…" catchup-type="shift"`. `url-tvg`
  points at the same EPG file.
- **1,214 channels**. Every `tvg-id` is an EPG channel id, so 89 EPG channels have no stream.
  Per channel: `group-title`, `tvg-id`, `tvg-logo`, `tvg-rec`, the name after the last comma,
  an `#EXTGRP:` line, then the HLS URL (`…/s/<key>/<tvg-id>.m3u8`).
- `tvg-rec` is 7 for 1,054 channels and 0 for 160: Музыкальные 56, XXX (18+) 50, Новости 28,
  Deutschland 7, Türkiye 6, Armenia 4, Israel 3, Ultra HD 2, Беларусь 2, Познавательные 1,
  Azerbaijan 1.
- **22 groups** (channels / programmes over the 10 days):

  | Group | Ch. | Progr. | Group | Ch. | Progr. |
  | --- | --- | --- | --- | --- | --- |
  | Кино | 160 | 27,992 | Музыкальные | 56 | 7,093 |
  | Israel | 126 | 38,604 | Украина | 53 | 10,891 |
  | Познавательные | 101 | 34,816 | XXX (18+) | 50 | 5,031 |
  | Deutschland | 88 | 23,044 | Мультфильмы | 48 | 29,901 |
  | Baltic | 78 | 16,792 | Armenia | 41 | 9,941 |
  | USA | 69 | 10,849 | Новости | 32 | 17,311 |
  | Общероссийские | 67 | 18,183 | Türkiye | 22 | 3,977 |
  | Спорт | 64 | 9,605 | Россия +4ч | 18 | 3,795 |
  | UK | 58 | 14,512 | Россия +2ч | 17 | 3,837 |
  | Azerbaijan | 17 | 3,561 | Россия +7ч | 17 | 3,855 |
  | Ultra HD | 16 | 7,588 | Беларусь | 16 | 4,008 |

  Programmes on EPG channels without a stream: 16,601.
- Groups mix **themes** (Кино, Спорт, Новости), **countries** (Israel, Deutschland, Baltic…)
  and **time-shifted copies**: "Россия +2ч" holds "Первый канал (+2)", "Россия 1 (+2)", and so
  on. "Ultra HD" holds both films ("Кино UHD") and sport ("Eleven Sports 1 4K").
- Variants of the same playlist: `tmp/list.m3u` has no `#EXTGRP` lines;
  `tmp/playlist_mpegts.m3u` has a bare `#EXTM3U` header (no `url-tvg`, no `catchup-type`)
  and MPEG-TS URLs.
- The web app's `parseLiveM3u` skips the header and `#EXTGRP`, and reads neither
  `group-title` nor `catchup-type`
  ([m3uParser.js:418-446](../../../public/scripts/utils/m3uParser.js#L418-L446)).

### 2.3 Programme text

- **Type markers** at the start of titles: х/ф 8,455 · т/с 6,859 · м/ф 6,025 · м/с 5,648 ·
  д/с 2,700 · д/ф 2,011 · rare з/л 4, к/ф 2. Where they appear:

  | Marker | Main groups |
  | --- | --- |
  | х/ф | Кино 5,246; no stream 1,309; Украина 425; Общероссийские 424 |
  | т/с | Кино 3,351; Общероссийские 1,293 |
  | м/ф | Мультфильмы 5,436 |
  | д/ф | Познавательные 927; Общероссийские 703 |

- **`⋗`** starts 1,107 titles, e.g. "⋗ ЧМ-2026. Швеция – Тунис. Трансляция из Мексики". It
  looks like a live-broadcast mark; the meaning is not confirmed (§12).
- **Film descriptions end with structured facts.** Example:
  "… Реж.: Илья Маланин. В ролях: Александр Яценко, Наталья Кудряшова, …. Россия, 2024,
  драма, комедия". Of the 7,358 х/ф programmes with a description:

  | Ending | Programmes |
  | --- | --- |
  | `Реж.:` and a year near the end | 5,244 |
  | `Реж.:` but no year | 1,480 |
  | neither | 582 |

- **Sport titles** name the event, the teams and the place, e.g. "Футбол. ЧМ-2026.
  Нидерланды – Швеция. Трансляция из США". Biathlon does not occur in the June sample (off
  season). Other Sweden examples: "Пограничный контроль: Швеция" (a documentary series),
  "Вселенная Филиппа Эшару (Швеция)".
- **Repetition:** the 321,787 programmes repeat heavily. The counts of
  this list were corrected in T1 (2026-10-28, verified with a direct count
  over `tmp/4a27b28d`; the numbers of the first analysis of 2026-10-25 were
  too low):

  | Measure | Value |
  | --- | --- |
  | distinct (title, description) pairs, whole file | **102,467** (102,466 after trimming) |
  | distinct titles, whole file | 75,553 |
  | Кино | 9,028 |
  | Познавательные | 12,452 |
  | Мультфильмы | 8,430 |
  | Ultra HD | 3,259 |
  | Общероссийские | 4,957 |
  | Кино + Познавательные | 21,446 |
  | programmes on EPG channels that are in no playlist group | 7,569 texts |

  The import keeps one row per distinct pair (its own trimming and the
  excluded adult group explain the small difference to the whole-file
  count: 100,611 texts over the groups that are loaded).

  10,035 programmes on Кино channels have no description.
- **Overlap with the cinema catalogue:** 1,137 EPG titles equal a catalogue title after
  normalisation (lower case, brackets removed, punctuation turned into spaces).
- "Франци…" appears in 2,848 descriptions (1,589 on Кино channels).

---

## 3. What a request means → which field

The same words can point at different data. The server keeps each meaning in its own field,
and the tool has a parameter for each. The model decides which one applies.

| The user means | Example | Field | Parameter |
| --- | --- | --- | --- |
| country where a film was made | «французские фильмы» | `program_texts.countries` (from the description ending) | `production_countries` |
| place of an event | «биатлон в Швеции» | `venue` ("Трансляция из …") + title text | `keywords` (the model adds venues it knows, e.g. «Эстерсунд») |
| participant | «матч сборной Швеции» | title text | `keywords` |
| country of the channel | «что идёт на немецких каналах» | `channels.region` | `channel_regions` |
| kind of programme | «соревнования», «фильмы», «мультики» | `program_texts.kind` | `kinds` |
| theme of the channel | «на киноканалах» | `channels.theme` | `channel_themes` |

---

## 4. Data model

### 4.1 Schema (`data.sqlite`)

```sql
CREATE TABLE IF NOT EXISTS channels (
  channel_id    TEXT PRIMARY KEY,     -- EPG channel id = playlist tvg-id
  name          TEXT NOT NULL,        -- EPG display-name, else playlist name
  playlist_name TEXT,
  group_title   TEXT,                 -- playlist group-title as written
  theme         TEXT,                 -- film | sport | news | kids | documentary | music | general | adult | NULL (mixed)
  region        TEXT,                 -- ISO 3166-1 alpha-2, or a group code such as 'BALTIC'
  timeshift_h   INTEGER NOT NULL DEFAULT 0,
  quality       INTEGER NOT NULL DEFAULT 1,  -- 0 SD, 1 regular, 2 HD, 3 UHD, 4 4K (web app scale, search.js:80-91)
  family_key    TEXT NOT NULL,        -- name without quality and time-shift marks: "первый канал"
  stream_url    TEXT,                 -- NULL when the channel is not in the playlist
  archive_days  INTEGER NOT NULL DEFAULT 0,  -- tvg-rec
  catchup_type  TEXT,                 -- channel attribute, else playlist header, else NULL
  logo_url      TEXT,
  is_adult      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS program_texts (   -- one row per distinct (title, description)
  text_hash    TEXT PRIMARY KEY,
  title        TEXT NOT NULL,        -- type marker and "⋗" removed
  title_norm   TEXT NOT NULL,
  description  TEXT,
  kind         TEXT NOT NULL,        -- §4.3
  kind_source  TEXT NOT NULL,        -- marker | pattern | channel | meaning | none
  live_mark    INTEGER NOT NULL DEFAULT 0,  -- title started with "⋗"
  year         INTEGER,              -- §4.4
  directors    TEXT,
  cast_names   TEXT,
  genres       TEXT,                 -- JSON array
  sport        TEXT,                 -- "Футбол"
  venue        TEXT                  -- "Мексика"
);

CREATE TABLE IF NOT EXISTS text_countries (
  text_hash TEXT NOT NULL REFERENCES program_texts(text_hash) ON DELETE CASCADE,
  raw       TEXT NOT NULL,
  code      TEXT,
  PRIMARY KEY (text_hash, raw)
);

CREATE TABLE IF NOT EXISTS programmes (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id),
  start_utc  INTEGER NOT NULL,       -- from start_raw with its offset
  stop_utc   INTEGER NOT NULL,
  start_raw  TEXT NOT NULL,
  stop_raw   TEXT NOT NULL,
  text_hash  TEXT NOT NULL REFERENCES program_texts(text_hash),
  PRIMARY KEY (channel_id, start_utc)
);

CREATE INDEX IF NOT EXISTS idx_prog_start ON programmes(start_utc);
CREATE INDEX IF NOT EXISTS idx_prog_text  ON programmes(text_hash);
CREATE INDEX IF NOT EXISTS idx_text_kind  ON program_texts(kind);
CREATE INDEX IF NOT EXISTS idx_text_title ON program_texts(title_norm);

CREATE VIRTUAL TABLE IF NOT EXISTS program_texts_fts USING fts5(
  text_hash UNINDEXED,
  title,        -- stemmed
  people,       -- directors + cast, stemmed
  description,  -- stemmed
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Classification, extraction, FTS rows and vectors are all per **text**, not per programme. That
is about 60,000 rows instead of 320,000.

### 4.2 Channel fields

- **Theme and region** come from `group_title` through a built-in map for known names,
  overridable with `groupMap` in settings:

  | Group | theme | region | Note |
  | --- | --- | --- | --- |
  | Общероссийские | general | RU | |
  | Кино | film | RU | |
  | Познавательные | documentary | RU | |
  | Спорт | sport | RU | |
  | Мультфильмы | kids | RU | |
  | Новости | news | RU | most without archive |
  | Музыкальные | music | RU | no archive |
  | Ultra HD | NULL | NULL | mixed: films and sport |
  | XXX (18+) | adult | NULL | excluded by default |
  | Россия +2ч / +4ч / +7ч | general | RU | time shift 2 / 4 / 7 h |
  | Israel, Deutschland, USA, UK, Украина, Armenia, Türkiye, Azerbaijan, Беларусь | general | IL, DE, US, GB, UA, AM, TR, AZ, BY | from `countries.ts` |
  | Baltic | general | BALTIC | names seen are Lithuanian (LNK, LRT, TV3 LT); checked in T2 |

  An **unknown group** (another provider): region from `countries.ts` on the group name
  ("Deutschland" → DE); theme from the closest of the theme words by meaning when vectors
  exist, else NULL.
- **Time shift:** a group or channel name with `+N` hours (`+2ч`, `(+2)`) sets
  `timeshift_h`. Such channels are hidden from search by default (`hide_repeats`).
- **Quality** follows the web app's scale ([search.js:80-91](../../../public/scripts/utils/search.js#L80-L91)):
  4K > UHD > HD > regular > SD.
- **`family_key`** joins "Первый HD", "Первый канал", "Первый канал (+2)" for de-duplication.
  It is built from the name without quality and time-shift marks, then normalised. Exact rules
  are tested in T2.

### 4.3 Kind of programme

`kind` is one of `film`, `series`, `animation`, `animated_series`, `documentary`,
`docuseries`, `sport`, `news`, `kids`, `music`, `show`, `other`. Sources, first match wins:

1. **Title marker**: х/ф, к/ф → film; т/с → series; м/ф → animation; м/с → animated_series;
   д/ф → documentary; д/с → docuseries.
2. **Pattern**: the title starts with a known sport name followed by a full stop ("Футбол.",
   "Хоккей.", "Биатлон.", "Теннис.", …), or contains "Трансляция из" or "Прямая трансляция"
   → sport.
3. **Channel theme**: sport, news, kids, music, documentary channels give their theme. A film
   channel gives `film` only when the description has the film ending (§4.4).
4. **Meaning** (only once vectors exist): the nearest of a small set of label texts
   ("художественный фильм", "спортивная трансляция", "новостной выпуск", …), if it is close
   enough. The threshold is set in T4.
5. Otherwise `other`.

### 4.4 Extractors

- **Film ending**: in the last sentence(s) of the description:
  - `Реж\.?:\s*([^.]+)\.` → directors;
  - `В ролях:\s*([^.]+)\.` → cast;
  - the final comma list `<countries…>, <year>[, <genres…>]` → production countries (through
    `countries.ts`), year, genres.

  Several countries are allowed ("США, Великобритания, 2016, драма").
- **Venue**: `Трансляция из ([^.]+)` → `venue`. Russian place names arrive in the genitive
  ("из Мексики"), so matching to `countries.ts` compares stemmed forms.
- **Sport**: the first title segment, when it is in the sport list.
- The `⋗` mark and the type marker are removed from `title` and kept as flags.

### 4.5 Ids

`program_id` = `<channel_id>@<start_utc>`. It is stable while the programme stays in the guide.

---

## 5. Import pipeline

1. **Playlist** (if `liveUrl` is set): download, check `#EXTM3U`, read the header attributes
   (`url-tvg`, `x-tvg-url`, `catchup-type`) and each channel's attributes. When
   `group-title` is missing, the `#EXTGRP` line gives the group.
2. **EPG URL**: `epgUrl`; if empty, the first http/https value of `url-tvg` / `x-tvg-url`.
   Neither → "not configured". `get_status` says which source was used.
3. **EPG stream**:
   - download, then detect gzip by the first two bytes (`1f 8b`) and pass it through
     `zlib.createGunzip()`;
   - feed a streaming XML parser (choice in T1);
   - `<channel>` elements update `channels` (merged with the playlist by id);
   - `<programme>` elements are written to staging in batches of 5,000.
4. **Times**: a port of `epgRawToEpochSeconds`
   ([epgParser.js:240-278](../../../public/scripts/utils/epgParser.js#L240-L278)). It requires
   the offset and rejects impossible dates such as month 13. If a source has no offset, use the
   setting `epgDefaultOffset` and count those programmes in status. The sample always has
   one.
5. **Texts**: hash (title, description). A new hash gets marker removal, kind and extractors,
   once.
6. **Filtering**: programmes of `excludeGroups` channels are dropped. Adult channels are
   kept only when `includeAdult` is `true`.
7. **Retention**: drop programmes with `stop_utc < now − pastDays·86400`. Then drop texts
   that no programme uses any more. Their vectors stay in `vectors.sqlite`.
8. **Swap**, update FTS for new texts, then queue vectors for new texts that are long enough
   (`embeddings.minTextChars`) on groups in `embeddings.groups`.

Measure in T1 and record here: import time, peak memory, `data.sqlite` size.

---

## 6. Links

- **Watch Live**: the channel's `stream_url`, after the http/https check. It is valid for any
  programme on a channel that has a stream, as the web app decided
  ([live-tv-playback-plan.md](../../../docs/design/live-tv-playback-plan.md) §4.3).
- **Catch-up**: only when `catchup_type` is `shift`, the type verified for this provider
  (plan §5.1). The rule is ported from
  [results.js:268-297](../../../public/scripts/components/results.js#L268-L297):
  - conditions: `archive_days > 0`; the stream URL passes the check; start and stop epochs
    are valid; `stop_utc < now`; `now − start_utc ≤ archive_days · 86400`;
  - URL: parse `stream_url` with the URL API, set `utc=<start_utc>` and `lutc=<now>` as query
    parameters (existing ones are kept), then check the result again;
  - no stop time is sent: the external player rolls on into the next programme (plan §3.2).
- **Built at call time**, in `get_program` only, with `link_built_at` in the result. The
  provider was probed only with `lutc` ≈ the moment of the request. The tool description
  therefore asks the model to fetch the link right before the user watches.
- **Other catch-up types** (`append`, `flussonic`, `xc`, …) are not supported until verified.
  The result says "archive exists, but this catch-up type is not supported".

---

## 7. Tools

All tools follow [iptv-mcp-servers.md](iptv-mcp-servers.md) §8. "List item" means:

`program_id, title, kind, channel {id, name, theme, region}, start, end, status
(past | live | upcoming), year, countries[], snippet, has_live, has_catchup, score`.

**Periods**, in the configured time zone:

| Period | Meaning |
| --- | --- |
| `now` | on air at this moment |
| `tonight` | starting between max(now, `tonightFromHour`:00) and 24:00 today |
| `today` | on air or starting between now and 24:00 |
| `tomorrow` | starting 00:00–24:00 tomorrow |
| `next_24h`, `next_7d` | starting from now on |
| `past_24h`, `past_7d` | ended in that window (and within the archive window for catch-up) |

### 7.1 `search_programs`

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `query` | string | — | natural description, any language |
| `keywords` | string[] | — | exact names: teams, places, venues, people (`["Эстерсунд","Швеция"]`) |
| `kinds` | string[] (§4.3) | — | what the programme is |
| `period` | §7 table | upcoming (now → end of data) | ignored when `from`/`to` are given |
| `from` / `to` | ISO date-time | — | exact window |
| `channel_themes` | string[] | — | film, sport, news, kids, documentary, music, general |
| `channel_regions` | string[] | — | **country of the channel**: ISO code or name |
| `channels` | string[] | — | channel ids or names from `list_channels` |
| `production_countries` | string[] | — | where a film or series was made (from the description) |
| `year_from` / `year_to` | number | — | production year |
| `person` | string | — | director or actor |
| `only_catchup` | boolean | false | ended programmes that have a catch-up link |
| `hide_repeats` | boolean | true | drop time-shifted copies; one airing per (title, channel family), the nearest to now |
| `prefer_hd` | boolean | true | the same programme at the same time on several qualities → keep the best |
| `sort` | `relevance` \| `time` \| `channel` | `relevance` with `query`/`keywords`, else `time` | — |
| `limit` / `cursor` | | 20 (max 50) | — |

`hide_repeats` and `prefer_hd` re-implement the web app's
`filterUniqueByClosestTime` and `filterPreferHD`
([search.js:98-168](../../../public/scripts/utils/search.js#L98-L168)) on epoch seconds.

**Returns:** `{ total, search_mode, window {from, to}, items: [list item], next_cursor }`.

### 7.2 `get_program`

`program_id` → the full description; extracted facts (directors, cast, countries, year,
genres, sport, venue); channel (name, theme, region, archive days); times and status;
`watch_live_url`; `catchup_url` (or the reason there is none) with `link_built_at`;
`other_airings`: the next 3 upcoming and the latest archived airings of the same title.

### 7.3 `get_now_and_next`

Parameters: `channel_themes`, `channel_regions`, `channels`, `limit` (channels, default 20).
For each channel: the current programme (title, kind, start, end, percent elapsed) and the next
one. Time-shifted channels are left out unless named.

### 7.4 `get_channel_schedule`

Parameters: `channel` (id or name), `date` (`YYYY-MM-DD`, local) or `from` / `to`,
`limit` / `cursor`. Programmes in time order with status.

### 7.5 `find_airings`

Parameters: `title`, `year` (optional), `include_past` (default true). Exact `title_norm`
match first, then the FTS title match. Returns `upcoming[]` (time, channel) and `archived[]`
(time, channel, `has_catchup`). For "when will X be shown".

### 7.6 `list_channels`

Parameters: `theme`, `region`, `query` (part of a name), `include_timeshift` (false),
`only_with_stream` (true). Without filters it returns only the group summary: group, theme,
region, number of channels, archive days. With filters it returns channels:
`{channel_id, name, theme, region, quality, has_stream, archive_days}`.

### 7.7 `get_status`

As in Cinema, plus:
- the data window (first and last programme start);
- counts of channels, programmes and texts;
- where the EPG URL came from (settings or playlist header), both URLs masked;
- the count of programmes without a time offset.

### 7.8 `refresh_guide`

`force` (boolean). Starts a background refresh and returns at once: `started`,
`already running`, or `not configured`.

---

## 8. Instructions and Pilot Description

**Server instructions (draft):**

> TV Guide is the user's broadcast TV: the programme guide of their IPTV provider, with live
> and catch-up links. Data is mostly in Russian; foreign channels use their own languages.
> - Start with `search_programs`. Put a natural description in `query` and exact names
>   (teams, places, venues, people) in `keywords`. If you know where an event takes place
>   (a biathlon stage in Östersund), add the place to `keywords`.
> - Decide what a country in the request means: `production_countries` is where a film was
>   made; `channel_regions` is the channel's country; the place of an event and a
>   participating team go into `keywords`.
> - `kinds` says what a programme is. Take channel themes and regions from `list_channels`.
> - Times are in the user's time zone. Use `period` for common windows and `from`/`to` for
>   exact ones.
> - "When will X be on": `find_airings`. "What is on now": `get_now_and_next`. One channel:
>   `get_channel_schedule`.
> - Lists contain no links. `get_program` returns the Watch Live and Catch-up links. Fetch them
>   right before the user wants to watch: a catch-up link depends on the current time.
> - If a Cinema server is also connected, it holds on-demand films. For "where can I watch X",
>   ask both.

**Pilot Description (≤ 200 characters):**

> Broadcast TV guide of the user's IPTV provider: what is on now, tonight or in the archive by
> kind, channel, country or meaning; when a title airs; live and catch-up links.

---

## 9. Settings (TV Guide)

Common keys: [iptv-mcp-servers.md](iptv-mcp-servers.md) §5.2.

| Key | Default | Meaning |
| --- | --- | --- |
| `epgUrl` | `""` | **EPG URL**, as in the web app's Settings ([index.html:72-82](../../../public/index.html#L72-L82)). XMLTV, gzipped or plain. Required unless the playlist header provides `url-tvg` |
| `liveUrl` | `""` | **Live TV M3U URL** ([index.html:102-112](../../../public/index.html#L102-L112)). Gives channel groups, links and the archive depth; strongly recommended |
| `refreshHours` | 12 | — |
| `pastDays` | 7 | keep ended programmes this long (= `tvg-rec` here) |
| `excludeGroups` | `["XXX (18+)"]` | groups not loaded |
| `timeshiftGroups` | auto (`+N` hours in the name) | groups treated as repeats |
| `groupMap` | `{}` | group → `{ "theme": …, "region": …, "timeshiftHours": … }`, overriding §4.2 |
| `tonightFromHour` | 18 | start of `tonight` |
| `epgDefaultOffset` | `"+0000"` | used only for times without an offset |
| `embeddings.groups` | `"all"` | or a list of groups (D11: all) |

**Content checks**:
- EPG: after optional gunzip, the text starts (after a BOM or whitespace) with `<?xml` or
  `<tv`, and contains `<tv`.
- Playlist: starts with `#EXTM3U`.

Template written at first start:

```json
{
  "epgUrl": "",
  "liveUrl": "",
  "timezone": "auto",
  "refreshHours": 12,
  "refreshOnStart": true,
  "includeAdult": false,
  "pastDays": 7,
  "excludeGroups": ["XXX (18+)"],
  "timeshiftGroups": "auto",
  "groupMap": {},
  "tonightFromHour": 18,
  "epgDefaultOffset": "+0000",
  "search": { "defaultLimit": 20, "maxLimit": 50, "snippetChars": 200, "meaningWeight": 0.7 },
  "embeddings": {
    "enabled": true,
    "model": "BAAI/bge-m3",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "batchSize": 50,
    "minTextChars": 40,
    "groups": "all"
  },
  "logLevel": "info"
}
```

---

## 10. Phases — tests in every phase

Each phase ends with `npm run typecheck` and `npm test` green. The shared modules come from the
Cinema phases ([cinema-server.md](cinema-server.md) §9).

**T1 — Playlist and streaming EPG import.** *(done 2026-10-28)*
- What was built:
  - `src/tv-guide/epg-time.ts` — the port of `epgRawToEpochSeconds` and
    `parseEpgTime`, which applies `epgDefaultOffset` and says when it did;
  - `src/tv-guide/playlist.ts` — the live playlist: header attributes,
    `group-title` with the `#EXTGRP` fallback, `tvg-rec`, per-channel
    `catchup-type`, the EPG URL candidates of the header;
  - `src/tv-guide/epg.ts` — gzip detection by the first two bytes and the
    streaming reader (`EpgReader` over saxes, `streamEpg` from a stream,
    `parseEpgText` from a string) with the download check of §9;
  - `src/tv-guide/schema.ts` — the tables of §4.1;
  - `src/tv-guide/texts.ts` — the hash of the (title, description) pair and
    the embedding text (T1 form: title and description; the facts of T2
    extend it);
  - `src/tv-guide/store.ts` — the `GuideWriter`: one synchronous
    transaction, channels first, one row per text written before its
    programmes (the foreign key wants it so), the orphan texts removed
    with their keyword-index rows, every live text of the active model
    kept in the queue;
  - `src/tv-guide/queue.ts` — the queue of the texts, the shape of the
    cinema one (T4 takes it);
  - `src/tv-guide/import.ts` — the pipeline: playlist download, EPG URL
    resolution (settings first, then the header), EPG download, the
    unchanged skip per source (`raw/meta-playlist.json`,
    `raw/meta-epg.json`), the import of local files for the tests and the
    scripts;
  - `src/tv-guide/config.ts` — the template and the rules of §9;
  - `scripts/import-tv-real-data.ts` (npm run `import-tv-real-data`), with
    `--now` and `--past-days` for the measurement inside the window of the
    snapshot.
- Shared modules that changed for it: `download.ts` gives the validator
  the raw bytes of the head as well (the gzip magic does not survive the
  UTF-8 decoding); `settings.ts` accepts map settings whose values are
  objects (`freeFormObjects`, for `groupMap`); `text.ts` took `charLength`
  over from the cinema queue (both servers use it); `db.ts` gained
  `withTransactionAsync`, because the guide streams in while the write
  transaction is open.
- **The XML parser is `saxes` 6.0.0.** The benchmark of §10 ran both on
  `tmp/4a27b28d`: saxes read the file in **0.8 s** (peak RSS 114 MB), sax
  1.6.1 in **2.0 s** (118 MB). Both counted 1,303 channels and 321,787
  programmes, both reported a truncated document, a stray ampersand and a
  broken attribute quote in strict mode. saxes is actively maintained;
  sax is not. `sax` was removed after the benchmark.
- Two decisions the design left open, taken in T1:
  - the **"staging and swap" of §5 is: parse into the memory first, then
    one synchronous transaction on the live tables** — the way the cinema
    server writes (C2). The channels, the texts and the programme rows of
    the import are gathered while the guide streams in; nothing is written
    until the stream has ended. The write transaction is synchronous, so
    nothing in the process can run on the connection in the middle of it,
    the readers keep seeing the old guide until the commit, and a guide
    that fails to parse mid-way never touches the database. A staging
    table of 320,000 programme keys would have doubled the disk for
    nothing, and a write transaction held across an await would have let
    the rest of the process see the half-written guide. The cost: the
    import blocks the event loop for the length of its write (about 10 s
    on the real file — a tool call that arrives in that window waits; the
    import runs in the background and the tool that starts it answers at
    once, D15);
  - **the text of a programme is written when the text is first seen**, not
    after the stream: the programmes table carries a foreign key to
    `program_texts`, and the foreign key is checked on every insert.
- Adult channels are **stored and marked** (`is_adult`), the same decision
  the cinema took in C2: the filter belongs to the search (T3), not to the
  import. The groups of `excludeGroups` are not loaded at all.
- `family_key` is the normalised name for now (placeholder); the rules
  without the quality and time-shift marks arrive with T2.
- Tests (`tests/tv-guide/`): the time cases of §10, plain and gzipped
  fixtures (the gzip file is generated in the test), a programme without a
  description, a channel without a stream, `tvg-rec="0"`, a bare playlist
  header, `#EXTGRP` fallback, a missing and a duplicated `tvg-id`, the
  retention window, the excluded groups, text deduplication, a second
  import, a broken guide that fails the import and leaves the old data,
  the default offset, the queue with `minTextChars`, the settings
  (template 0600, `groupMap`, `epgDefaultOffset` pattern).
- **Measured on the real files** (`tmp/playlist.m3u` + `tmp/4a27b28d`, the
  June 2026 snapshot; `now` 2026-06-23, `pastDays` 10 so that the whole
  window is inside the retention):

  | Fact | Value |
  | --- | --- |
  | Channels | 1,253 kept + 50 of the group XXX (18+) = 1,303 EPG channels |
  | Programmes | 316,746 kept + 5,031 of the excluded group + 10 with unreadable times = 321,787 |
  | Programmes with unreadable times | 10 — two zero-length ("dmax-hd-orig-de") and eight of `baku-az-hd` ("ANONS") whose stop lies before their start |
  | Texts | 100,611 (the whole file holds 102,467 distinct pairs — see the corrected §2.3) |
  | Texts in the queue | 86,040 (`minTextChars` 40) |
  | Guide window | 2026-06-14 06:08 UTC … 2026-06-23 06:07 UTC |
  | Import, first run | **14–15 s**, peak RSS 480–600 MB (the programme rows are held in the memory of the writer until the write) |
  | Import, nothing changed | **5.8 s** (no new texts, no new keyword-index rows) |
  | `data.sqlite` | 503 MB after the first import, 335 MB after the second (the pages of the first are reused) |

  The target of the parent document §7.4 (a search under 300 ms) is a
  question of T3/T4; the import runs in the background and a tool call
  never waits for it (D15).
- Three decisions the review of T1 added (2026-10-28):
  - **the unchanged refresh still runs the database work**: the retention
    window moves with the day, so the programmes that have fallen out of
    `pastDays` are removed on the unchanged path too, with the texts that
    only they carried (`applyRetention`), and the outcome carries the
    sizes of the guide that is still in the database. The moment of the
    run is deliberately **not** part of the settings signature — that
    would force a full import every run;
  - `embeddingsEnabled` is part of the settings signature: switching the
    search by meaning on re-imports an unchanged guide once, so that the
    queue is filled (`queueMissingVectors`). With the embeddings off the
    queue is emptied — it would promise work that never runs;
  - the queue holds the rows of the **active model only**: a changed
    model drops the rows of the old one, and every live text of the new
    model is queued again — also when the vectors database is not
    attached yet (the texts are re-queued on every import with
    `INSERT OR IGNORE`, so the model change cannot empty the queue).
- The batching of §5 dissolved: the guide is parsed into the memory
  first, so the programmes are written in one pass with one prepared
  statement. What the design staged in batches of 5,000 is the memory of
  the writer now.
- A guide that lists its programmes before its channels imports as it
  should: the channel checks (unknown id, excluded group) run at the
  write, when every channel is known, not during the stream.
- Three schema additions of §4.1, each for a reason: `program_texts.embed_text`
  (the queue reads the text it belongs to), `program_texts.fts_rowid` (the
  index row is removed by it when the text leaves the guide), and the
  `vector_queue` table (filled from T1, consumed in T4).
- One correction of §2.3 came out of the measurement: the distinct texts of
  the whole file are 102,467, not 60,447, and the numbers of the groups
  were too low as well. The corrected numbers stand in §2.3.
- The review-fix-loop of T1 ran five rounds and approved the phase
  (2026-10-28). The approved report named five non-blocking improvements
  that belong before T3, when `get_status` starts reading the numbers:
  `epgDefaultOffset` should be validated with the ranges of
  `compactTimeToEpoch` (HH ≤ 23, MM ≤ 59) already in the settings;
  `queueText` should refuse an empty embedding text even when
  `minTextChars` is 0; the guide reader should stop feeding a file after
  its first parse error; the retention outcome should carry the live
  programme count; and the playlist of a refresh should be parsed once,
  not once more for the outcome summary.

**T2 — Derived fields.**
- Group map and regions; time shift; quality and `family_key`; kinds (markers, patterns,
  theme); film-ending, venue and sport extractors.
- Real-data script prints coverage:
  - kind distribution;
  - the share of х/ф texts with countries and year (expected near 5,244 / 7,358);
  - venues found.
- Tests:
  - endings with several countries, without genres, without a year;
  - "Трансляция из США";
  - markers after "⋗";
  - `family_key` for "Первый HD" / "Первый канал (+2)".

**T3 — Tools, words only.**
- All eight tools; periods; `hide_repeats` / `prefer_hd`; catch-up rule; instructions.
- Tests:
  - the catch-up rule with a fixed clock: boundaries at `stop_utc = now` and at exactly
    `archive_days` days; an existing query on the stream URL; a non-http stream URL;
  - periods around midnight, and with `timezone` different from the EPG offset (e.g.
    `Europe/Berlin` against `+0300`; the web app shows this skew, ARCHITECTURE.md §7 "Program
    Status");
  - contract tests as in Cinema C3, including the Pilot name rule.

**T4 — Embeddings.**
- Vectors for texts (all groups, D11).
- Measure `vec_distance_cosine` over the largest candidate sets. Move to a `vec0` table with
  metadata columns if it misses the target in [iptv-mcp-servers.md](iptv-mcp-servers.md)
  §7.4.
- Kind by meaning (§4.3 step 4) with a tuned threshold.
- Tests with the fake provider, as in Cinema C4.

**T5 — Pilot connection and manual checks** (§11, TV Guide alone).

**T6 — Both servers together.** Cross-server questions (§11 rows 10–11). Tune both
Descriptions and the instructions; record what changed.

---

## 11. Manual checks in Pilot

| # | Ask | Expected tool use |
| --- | --- | --- |
| 1 | «Что сейчас идёт на спортивных каналах?» | `get_now_and_next(channel_themes=["sport"])` |
| 2 | «Какие фильмы покажут сегодня вечером?» | `search_programs(kinds=["film"], period="tonight")` |
| 3 | «Французские фильмы по ТВ на этой неделе» | `search_programs(kinds=["film"], production_countries=["FR"], period="next_7d")` |
| 4 | «Соревнования по биатлону в Швеции» | `search_programs(kinds=["sport"], query="биатлон", keywords=["Эстерсунд","Швеция"])`; on summer data, an empty result explained plainly |
| 5 | «Когда играет сборная Швеции?» | `search_programs(kinds=["sport"], keywords=["Швеция"])` |
| 6 | «Что вечером на немецких каналах?» | `search_programs(channel_regions=["DE"], period="tonight")` |
| 7 | «Когда покажут "Бык"?» | `find_airings(title="Бык")` |
| 8 | «Хочу посмотреть вчерашние новости на Первом» | `search_programs(channels=[…], kinds=["news"], period="past_24h", only_catchup=true)` → `get_program` → `catchup_url` |
| 9 | «Программа Матч ТВ на завтра» | `get_channel_schedule(channel="Матч ТВ HD", date=…)` |
| 10 | «Где посмотреть "Леший"?» (both servers) | `find_airings` + Cinema `search_titles` |
| 11 | «Что-нибудь про космос сегодня — фильм или документалку» (both servers) | `search_programs(query=…, kinds=["film","documentary"], period="today")` + Cinema `search_titles(query=…)` |
| 12 | `timezone` set to a zone other than `+03:00` | "now" and "tonight" match the clock |

---

## 12. Open items (TV Guide)

1. Meaning of `⋗` (1,107 titles). Compare with airing times: is it set exactly on live
   broadcasts? (T2)
2. Catch-up types other than `shift` (§6).
3. Region of "Baltic": Lithuania only, or Latvia and Estonia too? (T2)
4. How far back and ahead the provider's EPG reaches (the sample covers 10 days).
5. How long a catch-up link with an old `lutc` keeps working (§6).
6. The biathlon example needs winter data to verify.
7. ~~The 89 EPG channels without a stream (16,601 programmes): searchable with
   `has_live = false` (proposed), or hidden?~~ **Closed in T1 (2026-10-28, decision of
   @obodnikov):** they are imported like every channel and are **searchable**; the tools
   mark them with `has_live = false`, and `get_program` says that the channel has no
   stream. The search filter arrives with T3.
8. Whether news texts are worth embedding: they change daily and are seldom searched by
   meaning.
