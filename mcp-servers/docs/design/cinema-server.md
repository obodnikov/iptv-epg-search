# Cinema MCP Server — Design & Implementation Plan

**Status:** In progress. **First server to implement.** Phase 0, C1 and C2 are done (2026-10-27):
the shared base, the catalogue parser and the storage with the import, with the measured
numbers of §2.3 and §9. The MCP server itself comes in C3.
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
| Quality variants | 637 film titles end in a quality suffix (`(4K HDR)` 602, `(4K)` 14, `(4K SDR)` 10, `(4K HD)` 1, `(4К HDR)` 10 with a **Cyrillic К**); 583 (title, year) pairs occur more than once | merge them into one title with several variants |
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

### 2.3 Measured on the real file (2026-10-27, `mcp-servers/scripts/check-real-data.ts`)

The numbers of §2.2 come from the June 2026 snapshot. The parser of phase C1 was run over the
same file; these are the measured values:

| Fact | Measured | Comment |
| --- | --- | --- |
| `#EXTINF` lines | 67,090 | — |
| Entries with a stream line | 67,088 | **2** `#EXTINF` blocks have no stream line; the web app drops them too, because it only pushes an item when a stream line follows |
| Entries rejected by the http/https check | 1 | the `fmpeg http://…` line of §2.2 |
| Films (titles after merging the variants) | **5,717** | 6,303 film *entries* in the file, 6,302 of them read (the malformed stream line is rejected); the design's estimate "about 5,700" was right |
| Series | **1,553** | exactly as predicted |
| Unique episodes | **60,658** | 60,787 episode entries; **127** are duplicates of a season+episode number and are dropped |
| Titles in total | **7,270** | 5,717 films + 1,553 series; the design's estimate "about 7,300" was right |
| Quality suffixes | **637** | 602 `4K HDR`, 14 `4K`, 10 `4K SDR`, 1 `4K HD` and **10 `4К HDR` with a Cyrillic К**. The design counted 627: it missed the Cyrillic ones |
| Films with several quality variants | **583** | 574 extra variants; the design's "601 (title, year) pairs" was measured with a plain lower-case comparison, with the `title_norm` rule it is 583 |
| Series names with more than one director | **0** | no two series of the sample share a name, so the grouping by name does not merge anything |
| Adult titles | **3** | the 786 `censored="1"` entries collapse into 3 series |
| Titles tagged "Новинки" | **190** | 1,601 entries carry the tag |
| Country names | **143**, all mapped to an ISO code | the `country` attribute is a comma-separated list; the table covers every name |
| `added` offsets | all `+03:00` | 67,088 values, one format |
| Film length | p10 86 min, p50 104 min, p90 135 min | the `#EXTINF` number is **seconds** ✓ |
| Episode length | 4 … 600 min | the `duration` attribute is **minutes** ✓ |
| Parse time | 0.4 s | 54 MB of text, single pass |

Two clarifications of the numbers above, measured on 2026-10-27:

- The file is **80,954,706 bytes**; the "54 MB of text" of the table are the 54,373,653
  characters of the file, the rest is the UTF-8 of the Cyrillic text.
- The 583 films with several variants are 583 *(title, year)* pairs, but only **582** different
  normalised titles: one of them is in the catalogue in two years.

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
  removed_at    INTEGER,              -- set when absent from the latest catalogue
  lookup_key    TEXT NOT NULL,        -- film|<title_norm>|<year> | series|<title_norm>
  content_hash  TEXT,                 -- hash over the whole row set of the title
  added_raw     TEXT,                 -- the provider's own "added" string
  embed_text    TEXT                  -- the text that is embedded (§5)
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
CREATE INDEX IF NOT EXISTS idx_titles_lookup    ON titles(lookup_key);
CREATE INDEX IF NOT EXISTS idx_titles_removed   ON titles(removed_at);
CREATE INDEX IF NOT EXISTS idx_genres_genre     ON title_genres(genre);
CREATE INDEX IF NOT EXISTS idx_countries_code   ON title_countries(code);

-- The titles of the running import. A title that is not in this table did
-- not come back from the provider.
CREATE TABLE IF NOT EXISTS import_staging (
  title_id TEXT PRIMARY KEY
);

-- The texts the active model has not embedded yet.
CREATE TABLE IF NOT EXISTS vector_queue (
  text_hash TEXT NOT NULL,
  model     TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);
```

`bm25(titles_fts, 0, 3.0, 1.5, 1.0)`: title weighs most, then people, then description.

### 3.1.1 Four columns and two tables that the schema of §3.1 needed (phase C2)

The shape above is the one the design described. The implementation added four columns and
two tables, each of them for a rule the design asks for elsewhere:

| Addition | Why |
| --- | --- |
| `titles.lookup_key` | §3.2 derives the id from a hash, but §11.7 wants the importer to *"look the title up by its type and its normalised title and keep the id the row already has"*, so that the id of a series never drifts when its earliest episode year changes. A hash cannot be that lookup key. The key is `film\|<title_norm>\|<year>` for a film and `series\|<title_norm>` for a series. The index over it is a **unique** one: two rows with the same key would send the rows of a new catalogue to the wrong title, so the import has to fail instead of that. |
| `titles.content_hash` | §4 step 7 rebuilds the variant, episode, genre and country rows of the **changed** titles. The hash over the whole row set of a title is what says "changed". |
| `titles.added_raw` | The parent document (§6.1) keeps the raw source string next to the time. The parser already reads it. |
| `titles.embed_text` | The text that is embedded. Without it the embedding run would have to rebuild the text from the columns of the title, and the rebuilt text would not be the one the hash was made of. |
| `import_staging` | The set of the titles of the running import. The titles that are not in it are the ones that left the catalogue; the removals are one SQL statement over this table. |
| `vector_queue` | The texts the active model has not embedded yet. The queue is per model: when the model of the settings changes, the queue of the new model is built again and the old one is dropped. |

The keyword index holds the **stemmed** text (§6.3 of the parent document). The name of a
title is therefore read from the `titles` table, not from `titles_fts`. The rowid of a row of
`titles_fts` is the rowid of the row of `titles`, so that the two can be joined.

### 3.2 Stable ids

`title_id` = first 16 hex characters of sha256 of `type | title_norm | year`. For a series,
`title_norm` is the series title from the regex (the web app groups by lower-cased series
title, [m3uParser.js:314-316](../../../public/scripts/utils/m3uParser.js#L314-L316)), and the
year is the earliest one. Ids survive refreshes, so a title the model mentioned yesterday can
still be opened. If two different films collide (same title and year), the import logs it and
appends the director to the hash input for both.

**How the id is kept (phase C2).** The id is a hash, but a hash cannot answer *"which row is
this title?"* — the year of a series may change. So the importer looks the title up by its
`lookup_key` (§3.1.1) first:

1. a row with that key is there → the title keeps the id of that row;
2. no row with that key → the id is the hash of the seed;
3. that id is already held by another row → **collision**: the import logs the pair and
   appends the director (or, when it is empty, the category or the genres) to the hash input
   for both titles, so that neither of them holds the id they both wanted.

Rule 1 is what keeps the id of a series stable when an earlier episode changes its earliest
year (§11.7). The sample has no such case: the ids of all 7,270 titles are the same after the
first and the second import.

When two titles of **one** import want the same id, the first one is moved to another id and
the staging table of the running import follows it. A title that was staged under the old id
would otherwise look like a title that left the catalogue.

### 3.3 Genres and provider tags

- Genres are trimmed and stored as written ("Комедия").
- **Новинки** sets `is_new_tag` and is not stored as a genre. "New" questions use `added_at`
  first; the tag is shown in details.
- **Сериал** is dropped: the type comes from the episode pattern. All 865 entries carrying it
  live in the category "Ultra HD", so it marks a quality, not a type.
- **Взрослые** is a genre, not an adult marker (see §3.6). All 547 entries live in the category
  "Мультсериалы" with `censored="0"` — for example «Частые побочные явления» (South Park).
- `list_facets` returns the genre list with counts, so the model never guesses spellings.

### 3.4 Countries

`src/shared/countries.ts` maps names in English and Russian (and common short forms: "USA",
"США", "Англия") to ISO codes. The table was generated from the 143 values of the sample and
reviewed by hand: **all 143 are mapped** (phase C1). Values it does not know keep `code = NULL`
and are still found by text. `countryAliases` in settings can add entries.

The `country` attribute holds a **comma-separated list** ("Canada, United States of America").
The table maps the single names; a title keeps the raw value and gets one code per country of the
list.

### 3.5 Quality variants

A film title matching `\s*\((4[KК](?:\s+(?:HDR|SDR|HD))?|HDR|UHD)\)\s*$` has the suffix removed
and stored as `quality`; without a suffix the quality is `standard`. Films with the same
(`title_norm`, `year`) become one title with several variants. Measured on the sample: **5,717
film titles and 1,553 series, 7,270 titles in total**; 583 films carry more than one variant
(§2.3).

The suffix is matched against the tokens the provider really uses, and the "К" of "4К HDR" is
the Cyrillic letter in ten entries. A title that only starts like a quality ("4Kids", "UHDTV")
keeps its bracket.

### 3.6 Adult flag

`is_adult = 1` when any entry of the title has `censored="1"` or its category contains
`18+`. All tools filter `is_adult = 0` unless `includeAdult` is `true`.

The genre "Взрослые" ("for grown-ups") is **not** an adult marker: its 547 entries are
`censored="0"` and sit in the category "Мультсериалы". The adult set is exactly the 786
`censored="1"` entries, all in "Эротика (18+)", all in the episode format, all with the genre
"Эротические студии". They form 3 series (§2.3).

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
   flag, `title_norm`, the embedding text and its hash, the content hash of the title.
7. **Write in one transaction** (phase C2): the whole write is one transaction, so a reader
   keeps seeing the old catalogue until it is committed, and a failed import leaves the old
   catalogue untouched.
   - the id of every title is resolved (§3.2): the id of the row that is already there is
     kept;
   - the titles are written; `first_seen_at` is kept, `last_seen_at` is set, `removed_at` is
     cleared;
   - the variant, episode, genre and country rows of the **changed** titles are written
     again; the title row of every title is written, because `last_seen_at` changes;
   - the row of the keyword index is written again when the text of the title changed;
   - the titles that are not in `import_staging` get a `removed_at`, or are deleted when
     `trackChanges` is off;
   - the queue rows of the texts that left the catalogue are removed.8. **Queue vectors** for `text_hash` values the active model has not embedded yet.

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

**C1 — Shared base and catalogue parsing.** *(done 2026-10-27)*
- Shared modules: `args`, `settings`, `log`, `download`, `m3u`, `text`, `countries`, `links`.
  Two more were added: `country-table.ts` (the data behind `countries.ts`) and `time.ts` (the
  absolute times of the provider's own strings).
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
- What was built: `src/shared/{args,countries,country-table,download,hash,links,log,log-level,m3u,permissions,settings,text,time}.ts`
  and `src/cinema/{parser,catalog}.ts`, with 217 tests in `tests/` and
  `scripts/check-real-data.ts`. The measured numbers are in §2.3.
- Two deviations from this document, both forced by the real data:
  - the title is split at the last comma **outside** the quoted attribute values, so that
    `country="Canada, United States of America"` does not cut the title in the wrong place
    (no title of the sample holds a comma);
  - the series are grouped by the normalised series title alone, and the **earliest** year of
    their episodes becomes the year of the series. Grouping by the year of the episode would
    split one series into several.
- The quality suffix is matched against the tokens the provider uses, and the Cyrillic "К" of
  "4К HDR" is recognised: the regex of §3.5 was too greedy ("4Kids" would have become a
  variant) and too narrow (the ten Cyrillic entries would have kept their bracket).
- The episode pattern is the one of the web app, unchanged. Of the sample, **no** title looks
  like an episode and still fails the pattern, so the pattern was not loosened.

**C2 — Storage and import.** *(done 2026-10-27)*
- What was built:
  - `src/shared/db.ts` — the database: `node:sqlite`, the `sqlite-vec` extension, WAL, foreign
    keys on, the `meta` table with the schema version, the vectors file attached as `vec`,
    idempotent column migrations, and the transaction helper;
  - `src/shared/lock.ts` — the refresh lock of the working folder; a lock older than an hour
    counts as stale;
  - `src/shared/hash.ts` — the sha256 of the servers (the one of `download.ts` moved here);
  - `src/cinema/schema.ts` — the tables of §3.1 and the four columns and two tables of
    §3.1.1;
  - `src/cinema/embed-text.ts` — the text of §5;
  - `src/cinema/keys.ts` — the lookup key, the seed, the id and the hashes;
  - `src/cinema/identity.ts` — the resolution of the id, the lookup by the lookup key and the
    collision path;
  - `src/cinema/store.ts` — the write path: the upsert, the rows of the title, the keyword
    index and the removals;
  - `src/cinema/queue.ts` — the queue of the texts that have to be embedded;
  - `src/cinema/import.ts` — the pipeline of §4, from the download to the write;
  - `scripts/import-real-data.ts` — the import of a real catalogue with the numbers of this
    phase.
- Tests, on fixtures (`tests/cinema/import.test.ts`, `tests/shared/db.test.ts`,
  `tests/shared/lock.test.ts`):
  - importing twice gives the same ids and no duplicates;
  - a title missing from the second import gets `removed_at`;
  - FTS finds other word forms ("убийства" for "убийство");
  - the id collision path.
  - and: the write is atomic (a broken title leaves the old catalogue untouched); the
    excluded categories are not loaded; the adult titles are stored and marked; one row per
    country of a list, with the code and with the aliases of the settings; the episodes and
    the variants are written; the series keeps its id when its earliest year changes;
    `first_seen_at` is kept; `trackChanges: false` deletes the titles that left and keeps
    `first_seen_at` of the rest; the keyword index has one row per title and is written again
    when the text changes; the queue holds the new texts, holds no text twice and drops the
    texts that left; the lock is taken, given back and taken over when it is stale, and a
    release never removes a lock that is not its own; the database can be opened read-only, and
    the write-ahead log, the shared memory file and the vectors file are readable for their
    owner only.
- **Measured on `tmp/index.m3u` (2026-10-27):**

  | Fact | Value |
  | --- | --- |
  | Import time, empty database | **2.9 s** (67,088 entries read, 1 rejected, 2 without a stream line) |
  | Import time, nothing changed | **1.0 s** (the change detection keeps the rows of the titles that did not change) |
  | `data.sqlite` | **44.1 MB** |
  | Titles | 7,270 (5,717 films, 1,553 series) |
  | Variants / episodes | 6,301 / 60,658 |
  | Genre rows / country rows | 10,019 / 9,216 (143 country names, all mapped) |
  | Rows of the keyword index | 7,270 |
  | Texts to embed | 7,261 (9 titles have a text shorter than `embeddings.minTextChars`) |

- Two decisions that the design left open, taken in C2:
  - the removals are **one transaction on the live tables**, not a swap of tables (§4 step 7):
    the readers keep seeing the old catalogue until the transaction is committed, and the
    foreign keys and the shadow tables of the keyword index stay untouched. The `import_staging`
    table holds the titles of the running import;
  - the **queue of the texts to embed is a table** (`vector_queue`), per model. It is filled
    by the import, it is pruned when the texts leave the catalogue, and it is built again when
    the model of the settings changes.
- The review of 2026-10-27 found eight issues; they were all fixed:
  - a title that was moved to another id (the collision path) was still in the staging table
    under the old id, so it looked like a title that left the catalogue. The staging table
    follows the id now, and the case of **two titles of one import** that want the same id is
    covered by a test;
  - the write-ahead log and the shared memory file of the database were created with the
    rights of the process, and the log holds the same data as the database. They are made
    private after every write now, and so is the vectors file;
  - a lock that was taken over by another process could be removed by the release of the
    process that held it before. The release only removes the file when it still belongs to
    the handle;
  - a database that was opened read-only could not be opened at all: the connection tried to
    write. A read-only connection changes nothing and attaches the vectors read-only;
  - the index over the lookup key is a **unique** one now, so that a duplicate fails the
    import instead of sending the rows of a new catalogue to the wrong title;
  - `npm run import-real-data -- <path>` took the path of the catalogue; it did not, because
    npm does not pass the `--` on. The first free argument is the catalogue now;
  - the number of the queued texts is read from the queue itself, so that it is the number of
    the rows that are really in it;
  - the adult titles are stored and marked; the filter is a question of the search, not of the
    import. The test now says so.
- The second review of the same day found eight more:
  - a write that fails (a constraint of the database, a full disk) **threw** instead of
    answering with a failed import. Every failure of the whole path is now an
    `ImportOutcome` with `ok: false` and a message; the transaction is still thrown back, so
    the old catalogue stays. A test with a trigger that fails the write covers it;
  - the collisions were collected but never written down. The import writes them to the
    logger, and the real-data script prints them;
  - only the download-and-refresh took the lock of the working folder; a script that imports
    a file wrote without it. Every write path takes the lock now, when it knows the working
    folder;
  - the version of the schema was never written into `meta`, and a database with titles that
    share their lookup key was quietly accepted. The version is written now, and the
    duplicates make the schema fail with a message;
  - the index over the lookup key is unique, and that is tested: a second row with the same
    key is refused;
  - a title that comes back into the catalogue keeps its id and the moment it was first seen.
    That is tested too;
  - after a collision the row of the keyword index follows the id of its title. That is
    tested as well;
  - the text of a title was measured with two different rules: the units of UTF-16 in
    JavaScript and the characters in SQLite. The rule is one now;
  - a test used a path that only works on Unix, and had a line that did nothing. Both are
    fixed.
- The third review of the same day found five more:
  - the refresh wrote to `<working folder>/raw/catalog.m3u` but never created the folder, so
    the first download failed with a missing folder. The folder is created by the refresh
    itself now, and a test without it covers the case;
  - a failure while making the files private **after** the commit could turn a written
    catalogue into a failed import. The commit and the rights of the files are apart now: a
    transaction that was committed is never thrown back;
  - the lock of the working folder threw when the folder was not there. Every failure of the
    import is an `ImportOutcome` now;
  - the refresh and the import had two copies of the lock handling. There is one now;
  - the test of the texts that are queued again did not empty the queue, so it passed even
    when the queue was broken. The test is honest now.
- The fourth review approved the phase and named five things that were not blocking; they
  were fixed as well:
  - a lock whose rights could not be made private was left behind without a handle to give
    it back with, and it blocked the refresh for an hour. The lock is taken as soon as the
    file is written;
  - the failures of the refresh built their answer by hand, and some of them never reached
    the log. Every failure goes through one helper now;
  - the temporary folder of the real-data script stayed behind when the database could not
    be opened. It is removed now;
  - the number of the queued texts was counted twice and then overwritten. It is the number
    of the rows in the queue, read once;
  - a title that cannot be told apart from a thousand others ran out of ids and failed with
    a message of the database. The id says what happened now.
- The fifth review found one blocking thing and one test that was missing; both are fixed:
  - a title that left the catalogue and came back later **with the same text** was not put
    into the queue of the texts again: the text of a title that left was removed from the
    queue with it, and a title that comes back is found by its lookup key, so neither the
    text nor the row was new. The text of a title that comes back is queued again now;
  - the test of the titles that come back checks the queue as well.

The fifth review was the last one of the loop, so these two fixes were **not** reviewed
again. The test suite covers them: 307 tests, all green.

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

1. ~~`rating="0"` (one entry): unknown or a real zero?~~ **Closed in C1 (2026-10-27):** the
   provider uses `rating=""` (5,927 entries) for "unknown", so `rating="0"` is a real score and
   stays 0. The single entry is «Все по новой» (2016, "Комедия", "Зарубежные фильмы").
2. ~~Genre "Взрослые" (547 entries): adult, or "for grown-ups"?~~ **Closed in C1 (2026-10-27):**
   "for grown-ups". All 547 entries are `censored="0"` and sit in "Мультсериалы". The genre is
   kept; the adult flag follows §3.6.
3. ~~Series category when episodes disagree: first seen, or most common?~~ **Closed in C2
   (2026-10-27):** the **first episode seen** keeps the category, as §3.1 says. The parser of
   C1 already worked that way, and C2 stores the value as it is.
4. ~~Is `is_new_tag` useful when `added_at` exists?~~ **Closed in C2 (2026-10-27):** the tag
   stays in the details of the title (§6.2) and is not a filter. The "new" questions use
   `added_at` and `added_within_days`. The flag is stored for all 190 titles of the sample.
5. ~~The `added` date of a **film** with several variants: the earliest or the latest?~~
   **Closed in C2 (2026-10-27):** the **earliest**, as the parser of C1 already did. The
   title entered the catalogue with its first variant, so the first variant carries the day it
   appeared. The database stores that day in `added_at` and the provider's own string in
   `added_raw`.
6. ~~The 127 duplicate episodes: which one survives?~~ **Closed in C2 (2026-10-27):** the
   **first** one, as the parser of C1 already did (the web app does the same). The rows of the
   episodes of the sample are 60,658 — the same number as the parser.
7. ~~The series are grouped by the normalised series title alone; the id of a series holds its
   earliest episode year.~~ **Closed in C2 (2026-10-27):** the grouping stays (§9 C1), and the
   id of a series never drifts: the importer looks the title up by its `lookup_key`
   (§3.1.1) and keeps the id the row already has. A series whose earliest episode year
   changes keeps its id, and the test covers that case. The sample holds no two series of the
   same name, and the parser still reports every series whose episodes name more than one
   director, so that a merge does not happen unnoticed.
