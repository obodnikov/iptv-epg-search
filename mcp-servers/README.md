# IPTV MCP Servers

Local MCP servers that give a chat model access to the same provider data the web app shows:
the **TV Guide** (XMLTV + live playlist) and the **Cinema** catalogue (extended M3U).

The servers run on the owner's Mac, speak MCP over stdio, and keep everything in their own
working folder. The design is in [`docs/design/`](docs/design/):

- [`docs/design/iptv-mcp-servers.md`](docs/design/iptv-mcp-servers.md) — the parent document
  (decisions, storage, search model, tool rules)
- [`docs/design/cinema-server.md`](docs/design/cinema-server.md) — the Cinema server
- [`docs/design/tv-guide-server.md`](docs/design/tv-guide-server.md) — the TV Guide server

## Status

| Phase | What | State |
| --- | --- | --- |
| 0 | Scaffolding, repository housekeeping, shared base | done |
| C1 | Shared modules and the catalogue parser | done |
| C2 | Storage and import | done |
| C3 | MCP server and tools (words only) | done (2026-10-27) |
| C4 | Embeddings and search by meaning | done (2026-10-27) |
| C5 | Pilot connection and manual checks | in progress (2026-10-28) |
| T1–T6 | TV Guide server | not started |

The Cinema server runs: `npm run cinema` starts it and speaks MCP over stdio. It serves seven
tools — `search_titles`, `find_similar_titles`, `get_title`, `list_episodes`, `list_facets`,
`get_status` and `refresh_catalog`. The search mixes the words and the meaning of the query: it
needs the vectors of the catalogue, which the embedding worker builds in the background.
Without them the search falls back to the words alone, and the answers say so
(`search_mode: "words"`).

The `tv-guide` script still says that it arrives in phase T1.

The dependencies of the servers are already pinned, even though the code that uses them
arrives later (`@modelcontextprotocol/server` in C3, `sqlite-vec` in C2 and C4). They are
pinned now so that the exact versions are locked from the start and the lock file does not
change with every phase.

## Requirements

- Node **24 or newer** (the servers are TypeScript files that Node runs directly, without a build step)
- npm

## Install

```bash
cd mcp-servers
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `tests/` and `scripts/` |
| `npm test` | `node --test 'tests/**/*.test.ts'` — the whole test suite |
| `npm run cinema` | starts the Cinema server (the working folder defaults to `~/.iptv-mcp/cinema`) |
| `npm run tv-guide` | starts the TV Guide server (from T1 on) |
| `npm run check-real-data` | parses a real catalogue file and prints the counts |
| `npm run import-real-data` | imports a real catalogue file and prints the sizes and the times |
| `npm run embed-real-data` | imports a real catalogue file, embeds every text and prints the times |
| `npm run manual-checks` | runs the ten checks of the design against the server of the working folder |

The scripts that need the key of the embedding service load it from the `.env` file of the
repository (or of `mcp-servers/`); a variable that is already in the environment wins. The
file is git-ignored.

## Layout

```
mcp-servers/
  package.json          own package; "type": "module"; exact dependency versions
  package-lock.json     committed
  tsconfig.json         for `tsc --noEmit` only
  src/
    shared/             code used by both servers
      args.ts           --data-dir, ~ expansion, folder creation
      countries.ts      country names in any language -> ISO 3166-1 alpha-2
      country-table.ts  the data behind countries.ts
      db.ts             node:sqlite, sqlite-vec, WAL, the meta table, the transactions
      download.ts       GET with timeout, size limit and User-Agent
      embeddings.ts     the OpenRouter client: batches, retries, the fake for the tests
      hash.ts           the sha256 of the servers
      links.ts          sanitizeUrl (ported) and URL masking
      lock.ts           the refresh lock of the working folder
      log.ts            file log with levels; masks the URLs
      m3u.ts            reader for the extended M3U format
      permissions.ts    the rights of the files of the working folder
      refresh.ts        the background refresh: the phase, the progress, the last result
      settings.ts       read, validate and write settings.json
      text.ts           normalisation, language guess, Snowball stemming
      time.ts           absolute times from the provider's own strings
      tool-kit.ts       the shape of the answers, the cursor
      vectors.ts        the tables of the vectors database and the vectors themselves
    cinema/
      parser.ts         one catalogue entry
      catalog.ts        films with their variants, series with their episodes
      schema.ts         the tables of the database
      embed-text.ts     the text that is embedded for one title
      keys.ts           the lookup key, the id and the hashes of a title
      identity.ts       which id a title gets, and the collision path
      store.ts          the write path: the rows, the index, the removals
      queue.ts          the queue of the texts that have to be embedded
      import.ts         the import pipeline
      import-options.ts the types of the import
      prepare.ts        the titles of the catalogue as the rows that are written
      config.ts         the settings of the cinema server
      filters.ts        the filters of a search, as SQL
      items.ts          the rows of a title and the items of a list
      search.ts         the search: the candidates, the order, the page
      search-types.ts   the shapes of a search
      words.ts          the words of a search: the index, the bm25, the order
      blend.ts          the candidates of a search and the mix of their scores
      similar.ts        the titles that are like a given one
      embedder.ts       the background worker that embeds the texts of the queue
      query-cache.ts    the vectors of the queries
      details.ts        the details of a title and the episodes of a series
      facets.ts         the values a search may be filtered by
      status.ts         the state of the server
      refresh.ts        the background refresh of the catalogue
      render.ts         the compact text of the answers
      schemas.ts        the parameters and the answers of the tools
      descriptions.ts   what the tools tell the model
      tool-context.ts   what the tools need and the answers they share
      handler-search.ts the search_titles tool
      handler-similar.ts the find_similar_titles tool
      handlers.ts       the other five tools
      tools.ts          the registration of the seven tools
      server.ts         the entry point: node src/cinema/server.ts --data-dir …
    tv-guide/           (from T1 on)
  tests/
    fixtures/           small hand-made excerpts; no real hosts or keys
    shared/ cinema/ tv-guide/
  scripts/
    check-real-data.ts  counts of a real catalogue file
    import-real-data.ts imports a real catalogue file and prints the sizes and the times
    embed-real-data.ts  imports a real catalogue file, embeds it and prints the times
    manual-checks.ts    runs the ten checks of the design against the server
    manual/
      checks.ts         the ten checks of the design, with what each one expects
      support.ts        the helpers: the server over stdio, the answers, the database
  docs/design/          the design documents
```

## The working folder

Each server takes a `--data-dir`. The defaults are `~/.iptv-mcp/cinema` and
`~/.iptv-mcp/tv-guide`.

```
~/.iptv-mcp/cinema/
  settings.json        the only file the owner edits
  raw/                 last good download of the source + meta.json
  data.sqlite          catalogue tables and the keyword index (from C2 on)
  vectors.sqlite       the embeddings of the titles and of the queries (from C4 on)
  refresh.lock         present while a refresh runs
  embed.lock           present while the embedding run goes on
  logs/server.log
```

`settings.json` is created on the first start with mode `0600` and a template that holds no
URLs. The owner fills in the URL and restarts nothing: the server re-reads the file when it
changes.

## Settings

The common keys are documented in
[`docs/design/iptv-mcp-servers.md`](docs/design/iptv-mcp-servers.md) §5.2; the Cinema keys in
[`docs/design/cinema-server.md`](docs/design/cinema-server.md) §8. The Cinema template:

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

A URL must parse and use `http:` or `https:`; an empty value means "not set". A wrong value is
reported in the log and the default is used — the file is never rewritten.

The key of the embedding service is not in the settings file: it comes from the environment
(`OPENROUTER_API_KEY`, the name is in `embeddings.apiKeyEnv`). For the local runs the npm
scripts read it from the `.env` file of the repository; for Sqowe Pilot it goes into the
**Environment** field of the server entry. Without the key the server still works: the search
falls back to the words and says so.

## Connecting to Sqowe Pilot

The server speaks MCP over stdio and is ready for the client; the entry in Pilot is checked in
phase C5. It looks like this:

| Field | Value |
| --- | --- |
| Name | `Cinema` |
| Type | `stdio` |
| Command | the absolute path of `node` (see below) |
| Args | `<abs path>/mcp-servers/src/cinema/server.ts --data-dir ~/.iptv-mcp/cinema` |
| Environment | `OPENROUTER_API_KEY=…` (the key is only needed for the embeddings) |
| Tool policy | `allow-reads` |

### Adding the server in the UI of Pilot

**Settings (⌘,) → tab "MCP Connectors" → "Add Custom Connector".**

| Field of the form | Value |
| --- | --- |
| Name | `Cinema` |
| Description | `Online cinema of the user's IPTV provider: find films and series by genre, country, year, rating or meaning; similar titles; new arrivals; play links.` |
| Type | **STDIO (Local)** |
| Command | the **absolute** path of `node`, e.g. `/Users/eobomik/.local/Homebrew/bin/node` |
| Arguments | `<abs path>/mcp-servers/src/cinema/server.ts --data-dir /Users/eobomik/.iptv-mcp/cinema` |
| Environment variables | `OPENROUTER_API_KEY` → the value of the key |
| Enable this connector | on |
| Tool timeout | `0` (the global default of 240 s) |

The name becomes the prefix of the tool names the model sees: `mcp__Cinema__search_titles`,
`mcp__Cinema__find_similar_titles`, `mcp__Cinema__get_title`, `mcp__Cinema__list_episodes`,
`mcp__Cinema__list_facets`, `mcp__Cinema__get_status`, `mcp__Cinema__refresh_catalog`.

Three things that are easy to get wrong:

1. **The command is the absolute path of `node`.** Pilot starts the server without a shell, and
   `node` is not in the default path of macOS. A Homebrew path (`/Users/eobomik/.local/Homebrew/bin/node`)
   survives a Node upgrade; a path of nvm (`/Users/eobomik/.nvm/versions/node/v24.17.0/bin/node`)
   breaks when the version changes.
2. **The Arguments field is split on whitespace** — neither path may contain a space.
3. **The key goes into the Environment field of the entry**, not into `settings.json`. The
   settings file holds the *name* of the variable (`embeddings.apiKeyEnv: "OPENROUTER_API_KEY"`);
   a key pasted into that setting is refused with a message that does not repeat it.

After saving, the card shows **Connected** and the number of the tools. Set the tool policy of
the card to **`allow-reads`**: the default `ask-all` would ask before every search.
`refresh_catalog` still asks — it has no read verb, and that is intended. The server also has
to be enabled for the chat ("MCP Servers for this chat" in the context panel).

When the card shows **Connection failed**, the log says why:

```bash
tail -f ~/.iptv-mcp/cinema/logs/server.log
```

The entry may also be written into the file of Pilot directly:
`~/Library/Application Support/open-cowork/mcp-config.json` (the store is
`src/main/mcp/mcp-config-store.ts` of Pilot). The file is rewritten by the app, so it may only
be changed while Pilot is closed.

## Rules of this folder

[`AI_MCP.md`](../AI_MCP.md) holds the coding rules. The short version: TypeScript without a build
step, nothing imported from outside this folder, stdout carries only the MCP protocol, and the
provider URLs are masked everywhere outside the detail tools.
