# IPTV MCP Servers (TV Guide + Cinema) — Design & Implementation Plan

**Status:** Proposed. Design agreed in discussion on 2026-10-25. **Phase 0 and phase C1 are done
(2026-10-27)**: the scaffolding, the shared base and the Cinema catalogue parser. Cinema first;
the TV Guide server follows.
**Date:** 2026-10-25
**Owner:** @obodnikov
**Location:** `mcp-servers/` in the `iptv-epg-search` repository. A separate product that lives
here for now and must stay movable (§4.4).
**Client:** Sqowe Pilot (`~/src/open-cowork`, app 1.5.0)
**Server documents:** [cinema-server.md](cinema-server.md) · [tv-guide-server.md](tv-guide-server.md)
**Related:** the web app's [ARCHITECTURE.md](../../../ARCHITECTURE.md);
[live-tv-playback-plan.md](../../../docs/design/live-tv-playback-plan.md) §5 (verified catch-up
behaviour of the provider)

---

## 1. Summary

Two local MCP servers let a chat model in Sqowe Pilot work with the same provider data the web
app shows:

- **TV Guide**: the programme guide (XMLTV) plus the live-channel playlist (M3U). It answers
  "what is on", "when will X be shown", "films on TV tonight", "sport from Sweden", and
  returns Watch Live / Catch-up links.
- **Cinema**: the on-demand catalogue (extended M3U). It answers "French dramas rated above 7",
  "something like X", "what was added this week", and returns play links.

Each server keeps everything in its own **working folder**: a settings file, the last
downloaded sources, and SQLite databases with a keyword index and text vectors (embeddings)
for search by meaning. The model does the judging ("worth watching", taste, its own knowledge
of films). The servers filter, search by words and by meaning, and build links.

---

## 2. Findings that led here (verified 2026-10-25)

### 2.1 Provider data

Checked on the local samples in the web app's `tmp/`. The folder is git-ignored and local
only; the snapshot is from June 2026, so counts will differ today.

| File | What it is | Key facts |
| --- | --- | --- |
| `tmp/4a27b28d` | EPG, XMLTV, uncompressed | 146,688,201 bytes; 1,303 channels; 321,787 programmes over 10 days (2026-06-14 … 2026-06-23); every programme start has offset `+0300`. A programme has only `title` and `desc` (`desc` in 211,693); there is no category, year or rating element |
| `tmp/playlist.m3u` | live-channel playlist | 1,214 channels, every `tvg-id` is an EPG channel id; header `url-tvg`, `x-tvg-url`, `catchup-type="shift"`; per channel `group-title`, `tvg-logo`, `tvg-rec` (7 for 1,054 channels, 0 for 160); 22 groups |
| `tmp/playlist_mpegts.m3u` | the same channels, other stream format | header is a bare `#EXTM3U`: the attributes above may be missing |
| `tmp/index.m3u` | cinema catalogue | 67,090 `#EXTINF` lines: 6,303 films and 60,785 episodes grouped into 1,553 series; 11 categories, 27 genres, 143 distinct country values |

Details per server are in the server documents. The two facts that shape the shared design:

- **Text is mostly Russian**, with English or other languages for foreign channels and some
  catalogue fields (`country="France"` next to `country="Франция"`).
- **Stream URLs carry the account's access key** in the path or the query. Anything a server
  logs or returns can leak it.

### 2.2 What the web app already does

The web app's code is the reference for behaviour. It cannot be imported: the folder must stay
movable (D2), and parts of it depend on the browser.

| Behaviour | Web app code | Use in the servers |
| --- | --- | --- |
| Extended M3U parsing (cinema) | `parseExtInf` [m3uParser.js:123](../../../public/scripts/utils/m3uParser.js#L123) | port; it ignores `duration="…"` and `censored="…"`, which the servers need |
| Series grouping | `EPISODE_REGEX` and `groupSeriesEpisodes` [m3uParser.js:291-408](../../../public/scripts/utils/m3uParser.js#L291-L408) | port the regex and the consolidation rules |
| Live playlist parsing | `parseLiveM3u` [m3uParser.js:418](../../../public/scripts/utils/m3uParser.js#L418) | port and extend: it skips the header line ([m3uParser.js:426](../../../public/scripts/utils/m3uParser.js#L426)) and does not read `group-title` |
| M3U validity check | `#EXTM3U` header required [m3uParser.js:33](../../../public/scripts/utils/m3uParser.js#L33) | same rule |
| EPG download | always gunzips [epgParser.js:39](../../../public/scripts/utils/epgParser.js#L39) | accept gzip **and** plain XML (detect by the first bytes) |
| EPG parsing | `DOMParser` [epgParser.js:67](../../../public/scripts/utils/epgParser.js#L67) | not available in Node, and a 146 MB tree is too heavy: use a streaming parser |
| Programme time | `parseEpgTime` drops the offset [epgParser.js:134](../../../public/scripts/utils/epgParser.js#L134); `epgRawToEpochSeconds` keeps it [epgParser.js:240](../../../public/scripts/utils/epgParser.js#L240) | port only `epgRawToEpochSeconds`; every absolute time comes from the raw string |
| Time filters, de-duplication | `filterByTime`, `filterUniqueByClosestTime` use the offset-less `Date` [search.js:48](../../../public/scripts/utils/search.js#L48), [search.js:98](../../../public/scripts/utils/search.js#L98) | re-implement on epoch seconds |
| HD preference | `getChannelQuality`, `filterPreferHD` [search.js:80](../../../public/scripts/utils/search.js#L80), [search.js:136](../../../public/scripts/utils/search.js#L136) | port the idea |
| Stemming | Snowball via global `snowballFactory` [fuzzySearch.js:61](../../../public/scripts/utils/fuzzySearch.js#L61) | same stemmer as a Node package (Phase 0 confirms the package) |
| Fuzzy matching | Fuse.js, threshold 0.4 [fuzzySearch.js:194-208](../../../public/scripts/utils/fuzzySearch.js#L194-L208) | not ported, see §7.5 |
| Catch-up link rule | [results.js:268-297](../../../public/scripts/components/results.js#L268-L297) | port exactly ([tv-guide-server.md](tv-guide-server.md) §6) |
| Link check | `sanitizeUrl`, http/https only [sanitize.js:43](../../../public/scripts/utils/sanitize.js#L43) | port; never weaken it |
| Settings fields | `epgUrl`, `cinemaUrl`, `liveUrl` [index.html:72-112](../../../public/index.html#L72-L112); checks [settings.js:219-265](../../../public/scripts/components/settings.js#L219-L265) | same field names and URL checks (§5.2) |

### 2.3 Sqowe Pilot as the client

Read from `~/src/open-cowork` on 2026-10-25:

- **Launch.** Pilot starts a stdio server with `command`, `args`, `env` and an optional `cwd`
  (`src/main/mcp/mcp-manager.ts:898-903`). The server's stdout is the protocol channel
  (comment at `mcp-manager.ts:998`): log to a file or stderr only.
- **Tool names** reach the model as `mcp__<ServerName>__<toolName>`
  (`mcp-manager.ts:1435-1436`).
- **Permissions.** The default policy is `ask-all` (README "Tool Permissions"). Under
  `allow-reads`, Pilot auto-approves a tool whose name contains a read verb (`get`, `list`,
  `search`, `find`, `fetch`, `query`, `read`, `describe`, `show`, `check`, `count`, `lookup`,
  `browse`, `view`, `inspect`, `retrieve`) as prefix, infix or suffix, unless it also contains
  a write verb (`create`, `update`, `delete`, `set`, `run`, `start`, `stop`, `send`, …)
  (`src/shared/mcp-tool-classification.ts:59-126`). `readOnlyHint` can only make a tool
  stricter, never grant approval (`mcp-tool-classification.ts:17-21`).
- **Timeout.** A tool call times out after **240 s** by default
  (`src/main/config/config-store.ts:685`), with a per-server override.
- **Routing.** The system prompt gets one line per connected server, "name: Description",
  inside `<mcp_server_directory>` (`src/main/claude/session-mcp-tools.ts:67-93`). Description
  is typed by the user or generated by an LLM from the tool list: one sentence, at most 25
  words (`src/main/mcp/mcp-description-generator.ts:24-29`), cut to 200 characters
  (`mcp-description-generator.ts:282-295`).
- **Server instructions are not read.** The bundled SDK (`@modelcontextprotocol/sdk` 1.32.1)
  offers `client.getInstructions()` (`node_modules/…/client/index.d.ts:167`), and nothing in
  `src/main` calls it. The owner is considering a Pilot change. Until then, everything the
  model needs must be in the tool descriptions (§8).
- **Many models.** Pilot works with several model providers. Tool schemas must stay simple
  (§8).

### 2.4 Runtime and libraries

| Item | Fact | How verified |
| --- | --- | --- |
| Node | v24.17.0 runs `.ts` files directly (type stripping), with imports written with `.ts`; `enum` fails | ran a sample file, 2026-10-25 |
| Tests | `node --test 'tests/**/*.test.ts'` runs TypeScript tests with no extra packages | ran a sample test |
| SQLite | built-in `node:sqlite`: SQLite 3.53.0, FTS5 compiled in, `allowExtension: true` accepted, no warning | ran a check |
| sqlite-vec | loads into `node:sqlite` (Node ≥ 23.5) with `sqliteVec.load(db)`; vectors passed as `Uint8Array` over a `Float32Array`; scalar `vec_distance_cosine()` works on ordinary tables; `vec0` tables support metadata filters `= != > >= < <=` | context7 `/asg017/sqlite-vec` |
| MCP SDK | `@modelcontextprotocol/server` v2 (2.4.0; stable line since 2026-07-27; spec 2026-07-28; Node ≥ 20). `serveStdio` is exported from the **subpath `@modelcontextprotocol/server/stdio`**, not from the package root; `McpServer(serverInfo, options)` with `serverInfo.description` and `options.instructions`; `registerTool` with zod `inputSchema` / `outputSchema`, `structuredContent`, `annotations`, `isError` | context7 `/websites/ts_sdk_modelcontextprotocol_io_v2`, `/modelcontextprotocol/typescript-sdk`; verified by installing the package (2026-10-27) |
| Embeddings | OpenRouter `POST https://openrouter.ai/api/v1/embeddings`, body `{ model, input: [texts] }`, answer `data[].embedding` sorted by `index`; model `BAAI/bge-m3`, 1,024 dimensions | the owner's semantic-index tool already uses this (`~/.claude/skills/semantic-index/scripts/lib/providers/openrouter.py:23`, `:113`, `:291`; this repo's `.index/config.json`) |
| XML streaming | `saxes` (strict) and `sax` (lenient) both exist and are documented | context7; the choice is made in Phase T1 |

---

## 3. Decisions (locked 2026-10-25 by @obodnikov)

| # | Decision | Resolution |
| --- | --- | --- |
| D1 | Split | **Two servers by source**: TV Guide and Cinema. |
| D2 | Where the code lives | Folder `mcp-servers/` at the root of this repo, as a separate product. No imports from `public/`; the folder can be moved to its own repository as it is. |
| D3 | Language | **TypeScript**, run directly by Node (type stripping). No build step. `tsc --noEmit` checks types. Only syntax Node can erase: no `enum`, `namespace` or constructor parameter properties. |
| D4 | Transport | stdio only, on the owner's Mac. No remote hosting, no Vercel. |
| D5 | Client | Sqowe Pilot. Tool names follow its read-verb rule (§8.1). |
| D6 | Working folder | Each server takes `--data-dir`. Defaults: `~/.iptv-mcp/tv-guide`, `~/.iptv-mcp/cinema`. |
| D7 | Settings | Each server has its **own** `settings.json` in its working folder. Source fields are named as in the web app's Settings: `epgUrl` and `liveUrl` (TV Guide), `cinemaUrl` (Cinema). Settings are edited **only in the file**: no settings tool, no environment overrides for URLs, no Pilot presets. |
| D8 | Secrets in Pilot | Only `OPENROUTER_API_KEY` in the server's environment. |
| D9 | Storage | SQLite through built-in `node:sqlite`, plus the `sqlite-vec` extension. |
| D10 | Embeddings | OpenRouter, `BAAI/bge-m3`. |
| D11 | What TV Guide embeds | All channel groups; a setting can narrow it. |
| D12 | Player | No "open in player" command; servers return links only. |
| D13 | Personal data | No watchlist or ratings ("my taste"). Pilot's memory covers it. |
| D14 | Adult content | Excluded unless the setting allows it. |
| D15 | Long work | Downloads, imports and embedding run in the background. A tool call never waits for them (Pilot's 240 s timeout). |

---

## 4. Architecture

### 4.1 Folder layout

```
mcp-servers/
  package.json          own package; "type": "module"; exact dependency versions
  package-lock.json     committed (needs a .gitignore exception, §9 Phase 0)
  tsconfig.json         for `tsc --noEmit` only
  README.md             install, Pilot setup, settings reference
  src/
    shared/             code used by both servers (§4.3)
    cinema/
      server.ts         entry point: node src/cinema/server.ts --data-dir …
      …                 import, schema, tools
    tv-guide/
      server.ts         entry point: node src/tv-guide/server.ts --data-dir …
      …
  tests/
    fixtures/           small hand-made excerpts, no real keys or hosts (§10)
    shared/ cinema/ tv-guide/
  docs/design/          this document and the two server documents
```

### 4.2 Process model

1. Pilot starts `node <abs>/mcp-servers/src/<server>/server.ts --data-dir <folder>`.
2. The server reads `settings.json`. If the file is missing, it writes a template with empty
   source fields (file mode `0600`) and starts anyway. Tools then answer with a message that
   names the file to fill in.
3. It opens the databases, applies schema migrations, registers the tools and connects stdio.
4. If the data is older than `refreshHours` (or there is none), it starts a background refresh.
   Tools answer from whatever is in the database; `get_status` reports progress.
5. Logs go to `<data-dir>/logs/server.log`, never to stdout. URLs are masked (§5.4).

### 4.3 Shared modules (`src/shared/`)

| Module | Responsibility |
| --- | --- |
| `args.ts` | `--data-dir`; `~` expansion; create the folder |
| `settings.ts` | read, validate and default `settings.json`; write the template |
| `log.ts` | file log with levels; masks URLs |
| `download.ts` | GET with timeout, size limit and `User-Agent` (the web app's proxy sends one: [api/proxy.js:36-38](../../../api/proxy.js#L36-L38)); keeps the last good copy and its metadata in `raw/` |
| `m3u.ts` | line reader for extended M3U: header attributes, `#EXTINF` attributes, `#EXTIMG`, `#EXTDESC`, `#EXTGRP`, stream line |
| `text.ts` | normalisation (case, `ё`, spaces, punctuation); Snowball stemming ru/en; language guess (port of `detectLanguage`, [fuzzySearch.js:20](../../../public/scripts/utils/fuzzySearch.js#L20)) |
| `time.ts` | absolute times from the provider's own strings: `parseProviderTimestamp` (`YYYY-MM-DD HH:MM:SS±HH:MM` → UTC epoch seconds), `formatInTimezone` |
| `db.ts` | open `node:sqlite`, load `sqlite-vec`, WAL, schema version, `ATTACH` of the vectors file |
| `embeddings.ts` | OpenRouter client: batches, retries with backoff, honours `Retry-After`, vectors keyed by text hash and model |
| `search.ts` | keyword score + vector distance → blended ranking (§7) |
| `links.ts` | port of `sanitizeUrl`; URL masking for logs and status |
| `refresh.ts` | schedule, lock file, staging import and swap, progress for `get_status` |
| `countries.ts` | country names in any language → ISO 3166-1 alpha-2 (used by both servers) |
| `tool-kit.ts` | shared result shape: compact text + `structuredContent`, `isError` with a recovery hint, cursor encoding |

### 4.4 Movability rule

Nothing outside `mcp-servers/` imports from it, and it imports nothing from outside except its
own npm dependencies. Ported web app logic is copied with a comment naming the source file and
function, so the two can be compared later.

---

## 5. Working folder and settings

### 5.1 Contents of a working folder

```
~/.iptv-mcp/cinema/            (same shape for tv-guide/)
  settings.json                the only file the owner edits
  raw/                         last good download of each source + meta.json
                               (fetched_at, sha256, bytes, url_hash)
  data.sqlite                  catalogue / guide tables, keyword index — rebuildable from raw/
  vectors.sqlite               embeddings — expensive to rebuild, kept when data.sqlite is deleted
  refresh.lock                 present while a refresh runs
  logs/server.log
```

Vectors live in their own file so that deleting `data.sqlite` (or changing the source URL)
never throws away paid-for vectors. `db.ts` attaches it as `vec`.

### 5.2 `settings.json`: common keys

| Key | Default | Meaning |
| --- | --- | --- |
| *(source URL keys)* | `""` | per server, named as in the web app: see the server documents |
| `timezone` | `"auto"` | IANA zone for reading and showing times; `auto` = the system zone |
| `refreshHours` | Cinema 24, TV Guide 12 | how old the data may get before a background refresh |
| `refreshOnStart` | `true` | refresh at start if the data is older than `refreshHours` |
| `includeAdult` | `false` | let adult content into results |
| `search.defaultLimit` / `search.maxLimit` | 20 / 50 | results per call |
| `search.snippetChars` | 200 | description excerpt length in lists |
| `search.meaningWeight` | 0.7 | weight of meaning versus words in the blend (§7.1) |
| `embeddings.enabled` | `true` | `false` = keyword search only |
| `embeddings.model` | `"BAAI/bge-m3"` | OpenRouter model id |
| `embeddings.apiKeyEnv` | `"OPENROUTER_API_KEY"` | environment variable holding the key |
| `embeddings.batchSize` | 50 | texts per request |
| `embeddings.minTextChars` | 40 | shorter texts are only searched by words |
| `logLevel` | `"info"` | `error`, `warn`, `info`, `debug` |

**URL checks** follow the web app ([settings.js:225-265](../../../public/scripts/components/settings.js#L225-L265)):
trim spaces, must parse as a URL, protocol `http:` or `https:`. An empty string means "not
set" for every field. The web app keeps an old EPG URL when the field is emptied
([settings.js:268](../../../public/scripts/components/settings.js#L268)); the servers do not.
The content check is stricter than the web app's: see the server documents.

Settings are read at start and re-read when the file changes on disk, so an edited URL takes
effect without restarting Pilot. A changed source URL triggers a refresh.

### 5.3 Pilot entry

| Field | Value |
| --- | --- |
| Name | `Cinema` / `TV Guide` (becomes the tool prefix) |
| Type | `stdio` |
| Command | `node` |
| Args | `<abs path>/mcp-servers/src/cinema/server.ts --data-dir ~/.iptv-mcp/cinema` |
| Environment | `OPENROUTER_API_KEY=…` |
| Description | the ≤ 200-character text in each server document |
| Tool policy | `allow-reads` (the default `ask-all` would ask for every search) |

### 5.4 Secrets and masking

- Provider URLs are personal. `settings.json` is created with mode `0600`.
- Logs and `get_status` show URLs masked: scheme, host and the last 4 characters, e.g.
  `http://s03.example…/…f8b2`.
- Play links appear **only** in detail tools (`get_title`, `list_episodes`, `get_program`).
  Lists never carry them, so fewer keys reach the chat history.
- The OpenRouter key is read from the environment only and never logged.

---

## 6. Storage

### 6.1 SQLite setup

- `new DatabaseSync(path, { allowExtension: true })`, then `sqliteVec.load(db)`.
- `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`
- A `meta` table holds `schema_version`, source metadata and refresh state. Migrations are
  idempotent (`CREATE TABLE IF NOT EXISTS`, add-column helpers).
- Times are stored as **integer UTC epoch seconds**; the raw source strings are kept next to
  them for display and for re-checking.

### 6.2 Vectors (shared shape, in `vectors.sqlite`)

```sql
CREATE TABLE IF NOT EXISTS vectors (
  text_hash   TEXT NOT NULL,      -- sha256 of the normalised embedding text
  model       TEXT NOT NULL,      -- e.g. BAAI/bge-m3
  dim         INTEGER NOT NULL,   -- 1024 for bge-m3
  embedding   BLOB NOT NULL,      -- float32 little-endian, length = dim * 4
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (text_hash, model)
);
```

- Rows in `data.sqlite` carry `text_hash`. A refresh embeds only hashes missing for the active
  model. A text that comes back next week costs nothing.
- Vectors of different models are never compared. If `embeddings.model` changes, search falls
  back to words until the new model's vectors exist, and `get_status` says so.
- Size: about 4 KB per vector. Cinema needs about 7,300 vectors (≈ 30 MB); TV Guide up to
  about 60,000 (≈ 250 MB) when every group is embedded.
- Distance: `vec_distance_cosine(embedding, :query)` over the rows left after filtering. If
  measurement in Phase T4 shows that is too slow for TV Guide, move those vectors to a `vec0`
  table with metadata columns (start time, theme, kind).

### 6.3 Keyword index

FTS5 has no Russian stemmer. Text is therefore stemmed by `text.ts` (Snowball, by detected
language) **before** it goes into the FTS table, and queries are stemmed the same way.
Tokenizer: `unicode61 remove_diacritics 2`. Ranking: `bm25()` with column weights (title
heavier than description, as the web app weights title 2 and description 1,
[fuzzySearch.js:195-199](../../../public/scripts/utils/fuzzySearch.js#L195-L199)).

### 6.4 Refresh and locking

1. Take `refresh.lock`. If another process holds it (two Pilot sessions, a manual run), skip
   and report "refresh already running". A lock older than 1 hour counts as stale.
2. Download to `raw/<name>.part`. Check the content. Keep the previous copy until the new one
   passes.
3. If the sha256 equals the previous download, only update `fetched_at`.
4. Otherwise import into staging tables in one transaction, then swap them in. Readers keep
   seeing the old data until the swap.
5. Embed the new text hashes in batches. Search uses vectors as they arrive.
6. Release the lock and record the result (counts, duration, error) in `meta`.

---

## 7. Search model (both servers)

### 7.1 Pipeline

1. **Filters in SQL**: time window, kind, channel theme or region, genres, countries, years,
   rating, adult flag, and so on. This produces the candidate set.
2. **Words**: FTS5 match of the stemmed `query` plus every entry of `keywords` → `bm25`
   score.
3. **Meaning**: embed `query` once (cached by hash) → cosine distance to each candidate's
   vector.
4. **Blend**: each score is rescaled to 0–1 within the candidate set, then
   `score = meaningWeight · meaning + (1 − meaningWeight) · words`. A candidate found by only
   one side gets 0 for the other.
5. Sort by the requested order (`relevance` uses the blend), cut to `limit`, return a cursor.

With no `query` and no `keywords`, the result is the filter result in the requested order.
That covers "what was added this week" or "films on TV tonight".

### 7.2 `query` and `keywords`

- `query`: a natural-language description in any language ("a quiet French drama about
  family"). It feeds both sides.
- `keywords`: exact words that must count as matches: names of people, places, teams,
  venues ("Эстерсунд", "Depardieu"). They feed the keyword side only. Tool descriptions tell
  the model to put names it knows here. This is how "biathlon in Sweden" becomes
  `keywords=["Эстерсунд","Швеция"]`.

### 7.3 Without vectors

If embeddings are disabled, the key is missing, OpenRouter fails, or vectors are still being
built, search runs on words only. The result says which mode was used (`search_mode`), so the
model can explain a thin result.

### 7.4 Performance targets (to measure, not promises)

- A search call under 300 ms on the owner's Mac, excluding the one OpenRouter call that embeds
  the query.
- The query embedding is cached by hash, so a repeated or paged query costs nothing.

### 7.5 Why no Fuse.js

The web app needs typo tolerance because people type. Here the model writes the queries, and
it rarely misspells. Stemming covers word forms; vectors cover synonyms and paraphrase. If
title typos turn out to matter, an FTS5 `trigram` table on titles is the fallback.

---

## 8. Tool design rules (both servers)

### 8.1 Names and annotations

- Every read-only tool name contains a Pilot read verb (`search_`, `get_`, `list_`, `find_`)
  and no write verb anywhere. Avoid words like `start`, `set`, `update`, `run`, `stop` even
  inside names: Pilot matches them at any `_` boundary.
- The data-reload tool is `refresh_<thing>`. It has no read verb, so Pilot asks before running
  it. That is intended.
- Annotations: read tools `readOnlyHint: true, openWorldHint: false`; refresh tools
  `readOnlyHint: false, idempotentHint: true, openWorldHint: true`. Pilot only uses them to
  restrict; other clients may use them to approve.

### 8.2 Parameters

- Types: string, number, boolean, list of strings, or one of a fixed set of strings. No nested
  objects, no "one of several shapes" constructs: Pilot serves several model providers.
- Every parameter has a description with an example. Defaults are stated in the description.
- Filter values with a closed set (genres, categories, themes, regions) are listed by
  `list_facets` / `list_channels`. An unknown value returns `isError` with the valid values.
- Countries are accepted as an ISO code or a name in any language, mapped by `countries.ts`.

### 8.3 Results

- `content`: a compact text rendering for the model (one line per item), plus
  `structuredContent` with the same data. An `outputSchema` is declared.
- Lists: default 20, maximum 50 items; description excerpt of `snippetChars`; a `next_cursor`
  when more exist; a `total` count.
- Times: ISO 8601 in the configured zone, with offset (`2026-06-14T21:00:00+03:00`), plus a
  status where relevant (`past`, `live`, `upcoming`).
- Errors: `isError: true` with a sentence the model can act on, for example "Genre
  'фантастика' not found. Valid: Фантастика, Фэнтези, …", "Cinema URL is not set: edit
  ~/.iptv-mcp/cinema/settings.json", or "Data is loading (42 %), try again in about 2
  minutes".

### 8.4 Descriptions, instructions, Pilot Description

- **Tool descriptions are self-sufficient.** Today Pilot passes only them (§2.3). Each one says
  when to use the tool, when to use a sibling instead, and gives one or two filled-in examples.
- **Server instructions** (`McpServer` option `instructions`) carry the rules that span
  tools: when to combine both servers, which parameter matches which meaning of "country",
  links only from detail tools. They are harmless for Pilot today and used by clients that
  read them. Drafts are in the server documents.
- **`serverInfo.description`** is set to the same text as the suggested Pilot Description.

---

## 9. Phases — tests in every phase

Each phase ends with `npm run typecheck` (`tsc --noEmit`) and `npm test`
(`node --test 'tests/**/*.test.ts'`) green.

**Phase 0 — scaffolding and repository housekeeping.** *(done 2026-10-27)*
- `mcp-servers/package.json` (exact versions: `@modelcontextprotocol/server` **2.4.0**, `zod`
  **4.6.7**, `sqlite-vec` **0.1.9**, `snowball-stemmers` **0.6.0**, and later the XML parser),
  `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`,
  `erasableSyntaxOnly`), npm scripts `typecheck`, `test`, `cinema`, `tv-guide`,
  `check-real-data`. TypeScript **7.0.2** and `@types/node` **26.6.5** as dev dependencies.
- Confirm with context7 or the package itself: the Snowball package matches
  `public/vendor/snowball-stemmers.js` (same sha256 `4bd12417…`); `zod` import path for the SDK
  version (`zod ^4.2.0`); `sqlite-vec` loads on this Mac (arm64); `serveStdio` comes from
  `@modelcontextprotocol/server/stdio`.
- In the web app repo, not inside `mcp-servers/`:
  - **CLAUDE.md** says "No database, backend framework, React, TypeScript or Docker is part of
    this project". Add a note that this describes the web app and that `mcp-servers/` has its
    own rules.
  - **ARCHITECTURE.md**: add `mcp-servers/` to the repository structure as a separate product.
  - A new **`AI_MCP.md`** for `mcp-servers/**`, plus its row in the CLAUDE.md table.
  - **`.vercelignore`**: add `mcp-servers`.
  - **`.gitignore`**: the root ignores `package-lock.json` and `node_modules/`. Add the
    exception `!mcp-servers/package-lock.json`.
- Tests: settings validation (empty, bad protocol, bad URL, template written with mode
  `0600`); URL masking; country mapping basics.

**Phases C1–C5 — Cinema server.** See [cinema-server.md](cinema-server.md) §9. This also
builds most of `src/shared/`.

**Phases T1–T6 — TV Guide server.** See [tv-guide-server.md](tv-guide-server.md) §10.

---

## 10. Testing approach

- **Unit tests** with `node:test` on small fixtures in `tests/fixtures/`. They are hand-made
  from the patterns in `tmp/`, with hosts replaced by `example.invalid` and keys by `KEY`.
  **Never copy `tmp/` files or real URLs into the repository.**
- **OpenRouter is faked** in unit tests: a deterministic vector from a text hash, so ranking
  tests are stable. One optional live test runs only when `OPENROUTER_API_KEY` and
  `IPTV_MCP_LIVE=1` are set.
- **Real-data checks** run locally against `tmp/` through a script that prints counts. They
  are compared with the numbers in the server documents, not asserted in CI.
- **Tool contract tests** call the registered tools through the SDK's in-memory transport and
  check the output schema, `isError` cases and the cursor.
- **Manual checks in Pilot**: the question lists in each server document.

---

## 11. Review checklist

Invariants. A change that breaks any of these is rejected:

- Every link a tool returns passed the `http:`/`https:` check. The check is never relaxed to
  make data pass.
- Full provider URLs never appear in logs, `get_status` or list results.
- Every absolute time is computed from the raw source string with its offset. No offset-less
  parsing anywhere.
- No tool call waits for a download, an import or embedding.
- Search works with embeddings disabled, with the key missing, and while vectors are being
  built.
- Vectors from different models are never compared.
- Adult content is absent unless `includeAdult` is `true`.
- stdout carries only MCP protocol messages.
- Read-only tool names contain a read verb and no write verb.
- Nothing under `mcp-servers/` imports from outside it.
- Tests use only fixture data without real hosts or keys.

---

## 12. Risks and limits

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Provider changes formats | import fails or fields go empty | last good data stays in place; `get_status` shows the error; extractors are optional |
| Another provider uses other conventions (group names, title markers, catch-up type) | weaker classification, no catch-up links | every derived field has a fallback; catch-up only for verified types |
| OpenRouter unavailable or rate-limited | slower or missing meaning search | backoff and `Retry-After`; search by words keeps working |
| Data volume (TV Guide) | large database, slow first import | measure in T1; staging import; retention window |
| Keys in chat history | a link with a personal key is stored by the chat app | links only in detail tools; the owner accepts this for personal use |
| Pilot ignores server instructions | cross-tool rules unseen | self-sufficient tool descriptions; manual Pilot Description |
| Two copies of one server run at once | concurrent refresh | lock file; WAL for readers |
| Model passes free text where a fixed value is expected | errors, retries | `isError` with valid values; facets tools |

---

## 13. Open items

1. A Pilot change to read server `instructions` (owner considering, outside this repo).
2. Catch-up types other than `shift` ([tv-guide-server.md](tv-guide-server.md) §6).
3. Meaning of the `⋗` prefix in 1,107 EPG titles ([tv-guide-server.md](tv-guide-server.md) §2.3).
4. Source of the catalogue's `rating` (scale 0–10; provider does not say).
5. Whether Pilot shows `structuredContent` or only `content` (both are sent either way).
6. Real sizes and timings: measured in C2 and T1, then recorded here.

## 14. Non-goals

- Remote hosting, OAuth, Vercel.
- In-chat UI (MCP Apps), player control, opening streams.
- Watchlist, viewing history, ratings.
- Any change to the web app's behaviour (Phase 0 changes only documents and ignore files).
- Typo-tolerant fuzzy matching (§7.5).
- Changing settings from the chat.
