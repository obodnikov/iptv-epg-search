# Cinema MCP Server — Design & Implementation Plan

**Status:** Proposed. **First server to implement.** No code yet.
**Date:** 2026-10-25
**Owner:** @obodnikov
**Parent document:** [iptv-mcp-servers.md](iptv-mcp-servers.md). Shared decisions D1–D15,
settings, storage, search model and tool rules are defined there and not repeated here.
**Sibling:** [tv-guide-server.md](tv-guide-server.md)
**Web app reference:** [m3uParser.js](../../../public/scripts/utils/m3uParser.js),
[cinemaTab.js](../../../public/scripts/components/cinemaTab.js)

---

## 1. Summary

The Cinema server loads the provider's on-demand catalogue (extended M3U), groups episodes
into series, merges quality versions of the same film, and stores one row per film or series
in SQLite with a keyword index and one vector per title. Seven tools let the model:

- search by genre, country, year, rating, director and meaning;
- list valid filter values;
- find similar titles;
- get the details and play links of a film, or the episodes of a series;
- check status and trigger a refresh.

---

## 2. Source data (verified on `tmp/index.m3u`, 2026-10-25)

`tmp/` is the web app's git-ignored local sample folder (June 2026 snapshot).

### 2.1 Format

```
#EXTM3U
#EXTINF:5760 genres="Боевик,Новинки" rating="7" year="2024" country="France" director="Julien Seri" added="2026-05-03 13:08:59+03:00" group-title="Ultra HD", Кали (4K HDR)
#EXTIMG:http://…/screenshots/81/8080.jpg
#EXTDESC:Лиза, она же Кали, когда-то была рекрутом в спецназе. …
http://…/index.m3u8?token=…
#EXTINF:-1 genres="Комедия ,Детектив,Новинки" rating="" year="2026" duration="44" country="Россия" director="…" added="2026-05-01 03:17:27+03:00" censored="0" group-title="Наши сериалы", Бабье царство S01E01
```

(Hosts and keys elided here; never copy them into the repository.)

### 2.2 Counts and quirks

| Fact | Value | Consequence |
| --- | --- | --- |
| `#EXTINF` lines | 67,090 | — |
| Films (title without `S##E##`) | 6,303; the `#EXTINF` number is positive, read as **seconds** (5760 → 96 min; inferred from the values); no `censored` attribute | duration from the `#EXTINF` number |
| Episodes | 60,785; `#EXTINF:-1`, plus `duration="44"`, read as **minutes** (inferred from the values), plus `censored` | duration from the attribute; C1 checks the unit on a few known films and episodes |
| Series (web app's `EPISODE_REGEX`, [m3uParser.js:291](../../../public/scripts/utils/m3uParser.js#L291)) | 1,553; in 1,551 of them every episode carries the same description | one vector per series |
| Quality variants | 627 film titles end in a quality suffix (`(4K HDR)` 602, `(4K)` 14, `(4K SDR)` 10, `(4K HD)` 1); 601 (title, year) pairs occur more than once | merge them into one title with several variants |
| Categories (`group-title`) | 11: Сериалы 26,978 · Наши сериалы 14,621 · Мультсериалы 10,283 · Зарубежные фильмы 4,248 · Аниме 4,174 · ТВ-Шоу 2,614 · Ultra HD 1,578 · Наши фильмы 795 · Эротика (18+) 786 · Мультфильмы 524 · Музыкальные видео 487 | category filter; `list_facets` |
| Genres | 27, comma-separated, sometimes with stray spaces (`"Комедия ,Детектив"`). Top: Комедия 21,085 · Драма 18,169 · Боевик 11,234 · Фантастика 8,248 · Семейный 7,729 · Детектив 6,835 · Приключения 6,088. Two are provider tags, not genres: **Новинки** 1,601 and **Сериал** 865 | trim; treat the two tags separately (§3.3) |
| Countries | 143 distinct values, mixed languages: "United States of America" 16,143 · "США" 2,243 · "USA" 185; "France" 1,859 · "Франция" 89; "United Kingdom", "Англия", "Великобритания" | map to ISO codes (§3.4) |
| Rating | 0–10; 5,927 entries have `rating=""`; `rating="0"` once | empty → NULL; whether 0 means "unknown" is checked in C1 |
| Year | 1937–2026 | — |
| Director | present in 17,983 entries; no cast attribute | `person` filter = director + description text |
| `added` | `YYYY-MM-DD HH:MM:SS+03:00` | parse with its offset |
| Adult | `censored="1"` on exactly 786 entries, all in "Эротика (18+)", all in episode format; genres "Эротические студии" 786, "Взрослые" 547 | adult = `censored="1"` or a category containing `18+`; "Взрослые" is checked in C1 before it is used |
| Malformed stream line | 1 line `fmpeg http://…` | rejected by the http/https check |
| Description length (films) | median 357, 90th percentile 627 characters | fine for one vector per title |

What the web app does with this today: `parseExtInf` reads `genres`, `rating`, `year`,
`country`, `director`, `group-title`, `added` and the title after the last comma
([m3uParser.js:123-192](../../../public/scripts/utils/m3uParser.js#L123-L192)). It does
**not** read `duration="…"` or `censored`. Series consolidation rules are at
[m3uParser.js:339-366](../../../public/scripts/utils/m3uParser.js#L339-L366): first
non-empty poster, description, rating, director and country; earliest year; union of genres;
latest `added`. Episodes are de-duplicated by season+episode
([m3uParser.js:373-384](../../../public/scripts/utils/m3uParser.js#L373-L384)).

---

## 3. Data model

### 3.1 Schema (`data.sqlite`)

```sql
CREATE TABLE IF NOT EXISTS titles (
  title_id      TEXT PRIMARY KEY,     -- stable across refreshes (§3.2)
  type          TEXT NOT NULL,        -- 'film' | 'series'
  title         TEXT NOT NULL,        -- display title, quality suffix removed
  title_norm    TEXT NOT NULL,        -- lower case, ё→е, punctuation and spaces collapsed
  year          INTEGER,
  rating        REAL,                 -- provider rating 0–10, NULL if empty
  category      TEXT,                 -- group-title (series: of the first episode seen)
  director      TEXT,
  description   TEXT,
  poster_url    TEXT,
  duration_min  INTEGER,              -- film length; for series the most common episode length
  added_at      INTEGER,              -- provider "added", UTC epoch seconds (series: latest)
  is_adult      INTEGER NOT NULL DEFAULT 0,
  is_new_tag    INTEGER NOT NULL DEFAULT 0,  -- provider tag "Новинки"
  season_count  INTEGER,
  episode_count INTEGER,
  text_hash     TEXT,                 -- hash of the embedding text (§5)
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  removed_at    INTEGER               -- set when absent from the latest catalogue
);

CREATE TABLE IF NOT EXISTS title_genres (
  title_id TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE,
  genre    TEXT NOT NULL,             -- trimmed provider genre, tags excluded
  PRIMARY KEY (title_id, genre)
);

CREATE TABLE IF NOT EXISTS title_countries (
  title_id TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE,
  raw      TEXT NOT NULL,             -- value as in the catalogue
  code     TEXT,                      -- ISO 3166-1 alpha-2, NULL if unknown
  PRIMARY KEY (title_id, raw)
);

CREATE TABLE IF NOT EXISTS variants (          -- films only
  title_id     TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE,
  quality      TEXT NOT NULL,          -- 'standard', '4K HDR', '4K', '4K SDR', …
  stream_url   TEXT NOT NULL,
  duration_min INTEGER,
  category     TEXT,
  PRIMARY KEY (title_id, quality)
);

CREATE TABLE IF NOT EXISTS episodes (          -- series only
  title_id     TEXT NOT NULL REFERENCES titles(title_id) ON DELETE CASCADE,
  season       INTEGER NOT NULL,
  episode      INTEGER NOT NULL,
  name         TEXT,                   -- full entry title, e.g. "Бабье царство S01E01"
  stream_url   TEXT NOT NULL,
  duration_min INTEGER,
  PRIMARY KEY (title_id, season, episode)
);

CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(
  title_id UNINDEXED,
  title,          -- stemmed
  people,         -- director, stemmed
  description,    -- stemmed
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_titles_type_year ON titles(type, year);
CREATE INDEX IF NOT EXISTS idx_titles_rating    ON titles(rating);
CREATE INDEX IF NOT EXISTS idx_titles_added     ON titles(added_at);
CREATE INDEX IF NOT EXISTS idx_genres_genre     ON title_genres(genre);
CREATE INDEX IF NOT EXISTS idx_countries_code   ON title_countries(code);
```

`bm25(titles_fts, 0, 3.0, 1.5, 1.0)`: title weighs most, then people, then description.

### 3.2 Stable ids

`title_id` = first 16 hex characters of sha256 of `type | title_norm | year`. For a series,
`title_norm` is the series title from the regex (the web app groups by lower-cased series
title, [m3uParser.js:314-316](../../../public/scripts/utils/m3uParser.js#L314-L316)), and the
year is the earliest one. Ids survive refreshes, so a title the model mentioned yesterday can
still be opened. If two different films collide (same title and year), the import logs it and
appends the director to the hash input for both.

### 3.3 Genres and provider tags

- Genres are trimmed and stored as written ("Комедия").
- **Новинки** sets `is_new_tag` and is not stored as a genre. "New" questions use `added_at`
  first; the tag is shown in details.
- **Сериал** is dropped: the type comes from the episode pattern.
- `list_facets` returns the genre list with counts, so the model never guesses spellings.

### 3.4 Countries

`src/shared/countries.ts` maps names in English and Russian (and common short forms: "USA",
"США", "Англия") to ISO codes. Phase C1 generates the table from the 143 values in the sample
and reviews it by hand. Values it does not know keep `code = NULL` and are still found by
text. `countryAliases` in settings can add entries.

### 3.5 Quality variants

A film title matching `\s*\((4K[^)]*|HDR|UHD[^)]*)\)\s*$` has the suffix removed and stored
as `quality`; without a suffix the quality is `standard`. Films with the same
(`title_norm`, `year`) become one title with several variants. Expected: about 5,700 film
titles plus 1,553 series, about 7,300 titles in total (to confirm in C2).

### 3.6 Adult flag

`is_adult = 1` when any entry of the title has `censored="1"` or its category contains
`18+`. All tools filter `is_adult = 0` unless `includeAdult` is `true`.

---

## 4. Import pipeline

1. Download `cinemaUrl` to `raw/catalog.m3u.part` (shared `download.ts`).
2. **Check**: the text starts with `#EXTM3U` (BOM allowed) and has at least one `#EXTINF`.
   Otherwise keep the previous data and record the error.
3. **Parse** with the shared M3U reader: all `#EXTINF` attributes, `#EXTIMG`, `#EXTDESC`, the
   stream line. A stream line that fails the http/https check drops the entry and is counted.
4. **Classify**: the episode regex gives series, season, episode; the rest are films.
5. **Group**: series consolidation (web app rules, §2.2), de-duplicated episodes; film quality
   variants (§3.5).
6. **Normalise**: genres and tags, countries, rating, `added` with offset, durations, adult
   flag, `title_norm`.
7. **Write** into staging tables in one transaction; compute `text_hash`. Then swap:
   - upsert `titles` by `title_id`, keeping `first_seen_at`;
   - set `last_seen_at`;
   - set `removed_at` for titles not seen this time (`trackChanges`);
   - rebuild the variant, episode, genre and country rows of changed titles;
   - rebuild `titles_fts`.
8. **Queue vectors** for `text_hash` values the active model has not embedded yet.

---

## 5. Embedding text

One text per title:

```
{title} ({year}). {Фильм|Сериал}. Жанры: {genres}. Страна: {countries}. Режиссёр: {director}.
{description}
```

Empty parts are left out. The text is normalised before hashing, so whitespace changes do not
cause re-embedding. About 7,300 texts, about 30 MB of vectors.

---

## 6. Tools

All tools follow [iptv-mcp-servers.md](iptv-mcp-servers.md) §8. "List item" below means the
compact record:

`title_id, type, title, year, rating, genres[], countries[] (codes or raw), category,
director, seasons, episodes, duration_min, added (date), snippet, score`.

### 6.1 `search_titles`

The main search. Use it first for any catalogue question.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `query` | string | — | natural description in any language: "тихая французская драма о семье" |
| `keywords` | string[] | — | exact words: titles, director names, places, e.g. `["Кали"]` |
| `type` | `film` \| `series` \| `any` | `any` | — |
| `categories` | string[] | — | values from `list_facets`, e.g. `["Зарубежные фильмы"]` |
| `genres` | string[] | — | at least one must match, as in the web app's genre filter ([m3uParser.js:214-220](../../../public/scripts/utils/m3uParser.js#L214-L220)) |
| `exclude_genres` | string[] | — | none of these |
| `countries` | string[] | — | **production** country: ISO code or name in any language (`FR`, `Франция`, `France`) |
| `year_from` / `year_to` | number | — | inclusive |
| `min_rating` | number | — | provider rating 0–10 |
| `person` | string | — | director, also matched in description text |
| `max_minutes` | number | — | films: length; series: episode length |
| `added_within_days` | number | — | only titles added to the catalogue in the last N days |
| `sort` | `relevance` \| `rating` \| `year_desc` \| `year_asc` \| `added` \| `title` | `relevance` with `query`/`keywords`, else `added` | the web app's default is newest added ([m3uParser.js:278-284](../../../public/scripts/utils/m3uParser.js#L278-L284)) |
| `limit` | number | 20 (max 50) | — |
| `cursor` | string | — | from the previous result |

**Returns:** `{ total, search_mode: "words+meaning" | "words", items: [list item], next_cursor }`.
Titles with `removed_at` set are excluded.

### 6.2 `get_title`

| Parameter | Type | Meaning |
| --- | --- | --- |
| `title_id` | string | from a list |

**Returns:** every field of the title, the full description, `poster_url`, genres, countries
(code and raw), `is_new_tag`, `first_seen`, `removed` (if so). For a film:
`variants[{quality, duration_min, play_url}]`. For a series: `seasons[{season, episodes}]`
(counts only; links come from `list_episodes`).

### 6.3 `list_episodes`

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title_id` | string | — | a series |
| `season` | number | the first season | — |
| `limit` / `cursor` | | 50 | long anime seasons exist |

**Returns:** `{ season, total, items[{season, episode, name, duration_min, play_url}], next_cursor }`.

### 6.4 `find_similar_titles`

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title_id` | string | — | "like this one"; one of `title_id` or `description` is required |
| `description` | string | — | "like this description" (also a film that is not in the catalogue) |
| `type`, `genres`, `exclude_genres`, `countries`, `year_from`, `year_to`, `min_rating` | | | same as `search_titles` |
| `limit` | number | 10 (max 50) | — |

Nearest titles by vector distance; the source title itself is excluded. Without vectors it
falls back to shared genres and country, ordered by rating, and reports `search_mode: "words"`.

### 6.5 `list_facets`

No parameters. **Returns:**
- totals of films and series;
- categories with counts;
- genres with counts;
- countries `{code, name, count}` plus the unmapped raw values with counts;
- year range, rating range;
- the newest `added` date;
- the number of titles tagged "Новинки".

Adult categories appear only when `includeAdult` is `true`.

### 6.6 `get_status`

No parameters. **Returns:**
- settings file path and the masked `cinemaUrl` (or "not set");
- last refresh: time, result, duration, entries read and dropped;
- counts;
- vectors done and total, model, `search_mode` available now;
- whether a refresh is running and its progress;
- the last error.

### 6.7 `refresh_catalog`

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `force` | boolean | false | re-import even if the download is unchanged |

Starts a background refresh and returns at once: `started`, `already running`, or
`not configured` (with the settings path). Pilot asks before running it (no read verb).

---

## 7. Instructions and Pilot Description

**Server instructions (draft):**

> Cinema is the user's on-demand catalogue of films and series from their IPTV provider. Data
> is mostly in Russian; foreign films appear under their Russian titles.
> - Start with `search_titles`. Put a natural description in `query` and exact names (titles,
>   directors, places) in `keywords`. Take category and genre values from `list_facets`.
> - `countries` means the country where the film was made.
> - "New" or "recently added": `sort="added"` with `added_within_days`.
> - "Something like X": find X with `search_titles`, then call `find_similar_titles` with its
>   `title_id`. For a film that is not in the catalogue, pass a short description instead.
> - Lists contain no play links. Call `get_title` (film) or `list_episodes` (series) when the
>   user wants to watch.
> - `rating` is the provider's 0–10 score. When judging whether a title is worth watching, say
>   which part comes from the provider and which from your own knowledge.
> - If a TV Guide server is also connected, it covers broadcast TV. For "where can I watch X",
>   ask both.

**Pilot Description (≤ 200 characters):**

> Online cinema of the user's IPTV provider: find films and series by genre, country, year,
> rating or meaning; similar titles; new arrivals; play links.

---

## 8. Settings (Cinema)

Common keys: [iptv-mcp-servers.md](iptv-mcp-servers.md) §5.2.

| Key | Default | Meaning |
| --- | --- | --- |
| `cinemaUrl` | `""` | **Cinema M3U URL**, as in the web app's Settings ([index.html:87-97](../../../public/index.html#L87-L97)). Required |
| `refreshHours` | 24 | — |
| `excludeCategories` | `[]` | categories not loaded at all |
| `countryAliases` | `{}` | extra raw value → ISO code, e.g. `{ "Соединённые Штаты": "US" }` |
| `trackChanges` | `true` | keep `first_seen_at` / `removed_at` |

Template written at first start:

```json
{
  "cinemaUrl": "",
  "timezone": "auto",
  "refreshHours": 24,
  "refreshOnStart": true,
  "includeAdult": false,
  "excludeCategories": [],
  "countryAliases": {},
  "trackChanges": true,
  "search": { "defaultLimit": 20, "maxLimit": 50, "snippetChars": 200, "meaningWeight": 0.7 },
  "embeddings": {
    "enabled": true,
    "model": "BAAI/bge-m3",
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "batchSize": 50,
    "minTextChars": 40
  },
  "logLevel": "info"
}
```

---

## 9. Phases — tests in every phase

Each phase ends with `npm run typecheck` and `npm test` green. Phase 0 (scaffolding and repo
housekeeping) is in [iptv-mcp-servers.md](iptv-mcp-servers.md) §9.

**C1 — Shared base and catalogue parsing.**
- Shared modules: `args`, `settings`, `log`, `download`, `m3u`, `text`, `countries`, `links`.
- Cinema parser:
  - all attributes, including `duration` and `censored`;
  - episode regex, series consolidation, quality variants;
  - genres and tags, rating, `added` with offset, adult flag.
- Tests, on fixtures:
  - a film and its 4K twin;
  - a series in the forms `S01E01`, `S1 E2`, `s02e03 - Name`, with a duplicate episode;
  - stray spaces in genres; empty rating; mixed-language countries;
  - `censored="1"`; the malformed `fmpeg http://…` line;
  - an entry without a stream line; a BOM before `#EXTM3U`.
- Real-data script on `tmp/index.m3u` prints counts to compare with §2.2. Settle the open
  points: `rating="0"`, genre "Взрослые", the country table.

**C2 — Storage and import.**
- Schema, staging and swap, stable ids, `first_seen` / `removed`, FTS with stemmed text,
  vector queue.
- Tests:
  - importing twice gives the same ids and no duplicates;
  - a title missing from the second import gets `removed_at`;
  - FTS finds other word forms ("убийства" for "убийство");
  - the id collision path.
- Measure and record here: import time and `data.sqlite` size on `tmp/index.m3u`.

**C3 — MCP server and tools, words only.**
- `server.ts`, `tool-kit`.
- Tools: `search_titles` (filters and words), `get_title`, `list_episodes`, `list_facets`,
  `get_status`, `refresh_catalog` (background, lock), instructions, `serverInfo.description`.
- Tests through the SDK's in-memory transport:
  - output schemas;
  - `isError` with valid values for an unknown genre or category;
  - the cursor;
  - adult content excluded by default;
  - no `play_url` in list results;
  - "not configured" answers;
  - every tool name passes Pilot's rule. The verb lists are copied into the test from
    `~/src/open-cowork/src/shared/mcp-tool-classification.ts`; update them when Pilot changes.

**C4 — Embeddings and search by meaning.**
- `embeddings.ts` (OpenRouter, batches, backoff), `vectors.sqlite`, query-embedding cache, the
  blend, `find_similar_titles`.
- Tests with the fake provider:
  - the blend arithmetic;
  - partial vectors;
  - key missing or embeddings disabled → `search_mode: "words"`;
  - a model change ignores the old vectors.
- One live run on the full catalogue: record the time and the number of vectors.

**C5 — Pilot connection and manual checks.**
- README: install, Pilot entry ([iptv-mcp-servers.md](iptv-mcp-servers.md) §5.3), settings
  reference.
- Run the questions in §10. Adjust tool descriptions where the model chose badly; record what
  changed.

---

## 10. Manual checks in Pilot

| # | Ask | Expected tool use |
| --- | --- | --- |
| 1 | «Найди французские драмы с рейтингом выше 7» | `search_titles(countries=["FR"], genres=["Драма"], min_rating=7)` |
| 2 | «Что нового появилось за неделю?» | `search_titles(sort="added", added_within_days=7)` |
| 3 | «Что-нибудь похожее на "Кали"» | `search_titles(keywords=["Кали"])` → `find_similar_titles(title_id)` |
| 4 | «Фильм про одиночество в космосе» | `search_titles(query=…)`; with vectors relevant results, without them a thin result and `search_mode: "words"` |
| 5 | «Сериалы, где режиссёр Владимир Койфман» | `search_titles(type="series", person="Владимир Койфман")` |
| 6 | «Хочу посмотреть "Цинга" — дай ссылку» | `search_titles` → `get_title` → `play_url` |
| 7 | «Сколько сезонов у …, дай вторую серию третьего сезона» | `get_title` → `list_episodes(season=3)` |
| 8 | «Покажи эротику» | nothing, unless `includeAdult` is `true` |
| 9 | Ask for a genre spelled wrongly | `isError` listing valid genres, then a corrected call |
| 10 | Empty `cinemaUrl` | tools name the settings file to fill in |

---

## 11. Open items (Cinema)

1. `rating="0"` (one entry): unknown or a real zero? (C1)
2. Genre "Взрослые" (547 entries): adult, or "for grown-ups"? (C1)
3. Series category when episodes disagree: first seen, or most common? (C2)
4. Is `is_new_tag` useful when `added_at` exists? Keep it in details only unless tests show
   the model needs it.
