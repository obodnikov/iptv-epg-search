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
| C3 | MCP server and tools (words only) | not started |
| C4 | Embeddings and search by meaning | not started |
| C5 | Pilot connection and manual checks | not started |
| T1–T6 | TV Guide server | not started |

There is no MCP server to start yet: the catalogue is parsed and stored, but nothing serves it.
The `cinema` and `tv-guide` scripts say so and stop; they become the real commands in C3 and T1.

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
| `npm run cinema` | starts the Cinema server (from C3 on) |
| `npm run tv-guide` | starts the TV Guide server (from T1 on) |
| `npm run check-real-data` | parses a real catalogue file and prints the counts |
| `npm run import-real-data` | imports a real catalogue file and prints the sizes and the times |

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
      hash.ts           the sha256 of the servers
      links.ts          sanitizeUrl (ported) and URL masking
      lock.ts           the refresh lock of the working folder
      log.ts            file log with levels; masks the URLs
      m3u.ts            reader for the extended M3U format
      permissions.ts    the rights of the files of the working folder
      settings.ts       read, validate and write settings.json
      text.ts           normalisation, language guess, Snowball stemming
      time.ts           absolute times from the provider's own strings
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
    tv-guide/           (from T1 on)
  tests/
    fixtures/           small hand-made excerpts; no real hosts or keys
    shared/ cinema/ tv-guide/
  scripts/
    check-real-data.ts  counts of a real catalogue file
    import-real-data.ts imports a real catalogue file and prints the sizes and the times
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
  vectors.sqlite       embeddings (from C4 on)
  refresh.lock         present while a refresh runs
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

## Connecting to Sqowe Pilot

From C5 on. The entry looks like this:

| Field | Value |
| --- | --- |
| Name | `Cinema` |
| Type | `stdio` |
| Command | `node` |
| Args | `<abs path>/mcp-servers/src/cinema/server.ts --data-dir ~/.iptv-mcp/cinema` |
| Environment | `OPENROUTER_API_KEY=…` |
| Tool policy | `allow-reads` |

## Rules of this folder

[`AI_MCP.md`](../AI_MCP.md) holds the coding rules. The short version: TypeScript without a build
step, nothing imported from outside this folder, stdout carries only the MCP protocol, and the
provider URLs are masked everywhere outside the detail tools.
