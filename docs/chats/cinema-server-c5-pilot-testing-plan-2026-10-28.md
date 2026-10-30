# Claude Chat Export
**Generated: 2026-10-30 16:31:15**

---

👤 **USER:**
> Read design document mcp-servers/docs/design/cinema-server.md carefully.

Turn back with confirmation that you are ready to start implementation, or ask questions.

Prefer to use the semantic-index skill to search the codebase, docs, and past conversations.

**NEVER** use find command from the root. All neccessary files place under user directory

Use context7 as the source of truth for code patterns and coding docs.

Use firecrawl skills to search and get content from the web. You should search the web also if context7 doesn't have relevant information.

Before start implementation provide report and implementation plan

**Don't start implementation without excplicit user approval.**

High level design is in mcp-servers/docs/design/iptv-mcp-servers.md I guess we are at manual test step. Guide me

I'll start by reading the design documents and understanding the current state.

Now let me read the parent design doc and check the current state of the code.

## Report — where we actually are

**Design status** (`mcp-servers/docs/design/cinema-server.md` §9): C0–C4 are done. **C5 — "Pilot connection and manual checks" is the only open Cinema phase**, and its two bullets are: *README* (done) and *run the §10 questions, adjust the tool descriptions where the model chose badly, record what changed*.

**Verified against the source, not from memory:**

| Fact | Evidence |
|---|---|
| Typecheck clean, 463 tests pass, 0 fail | `npm run typecheck` + `npm test` run just now |
| All 7 tools registered with the design's names | `src/cinema/tools.ts:44-152` (`search_titles`, `find_similar_titles`, `get_title`, `list_episodes`, `list_facets`, `get_status`, `refresh_catalog`) |
| C5's README bullet is already done | `mcp-servers/README.md` has install, scripts, layout, working folder, settings, **"Connecting to Sqowe Pilot"** (line 198) |
| The server boots | `node src/cinema/server.ts --help` → usage on stderr, exit 0 |
| **The server has never run for real** | `~/.iptv-mcp/` does not exist — no `settings.json`, no real catalogue, no vectors. Everything so far ran on fixtures + one-off scripts over `tmp/index.m3u` (`import-real-data`, `embed-real-data`) |
| The OpenRouter key is in the repo `.env` | `OPENROUTER_API_KEY` — loaded by the npm scripts via `--env-file-if-exists=../.env`. **Pilot does not load it**: the key must go into the server entry's *Environment* field |
| Pilot stores MCP entries in a JSON file | `~/Library/Application Support/open-cowork/mcp-config.json` (`src/main/mcp/mcp-config-store.ts:80-90`); tool names reach the model as `mcp__Cinema__search_titles` |
| The §10 subjects exist in the sample | `tmp/index.m3u`: «Кали» (+ a `(4K HDR)` twin), «Цинга», `director="Владимир Койфман"` (36 entries) |

**What C5 really tests:** the tools themselves are covered by 463 tests (§10's rows 8–10 are automated). What is *not* covered is **whether the model picks the right tool and the right parameters** — that needs a model in the loop, i.e. Pilot.

---

## Implementation plan (C5)

**Step 1 — data source + working folder** *(the only secret in play)*
`~/.iptv-mcp/cinema/settings.json` (mode `0600`), `cinemaUrl` filled in. Two ways to get data:
- **dry run**: serve `tmp/index.m3u` locally → `http://127.0.0.1:8123/index.m3u`. No secret in the folder, and the counts are the design's own (7,270 titles / 1,553 series / 60,658 episodes), so every expectation below is checkable.
- **real run**: the provider's own URL (carries the account key → file stays `0600`, URL never pasted into chat).

**Step 2 — first run** (~5 min, all in the background)
`npm run cinema` → the refresh starts (download 80 MB → import **2.9 s**, design §9 C2) → the embedding worker embeds 7,261 texts (**~283 s**, 146 OpenRouter requests, §9 C4). Tools answer from the database meanwhile; `get_status` reports `vectors.done / pending`, `search_mode`, `embedding.phase`. Until the vectors are there the search is `"words"` and says so.

**Step 3 — local pre-flight** *(optional, my recommendation)*
A local script that speaks MCP over stdio to a running server and runs the ten §10 checks with the prescribed parameters, printing each answer. This separates *the server is broken* from *the model chose badly* — and the C5 phase is only about the second.

**Step 4 — the Pilot entry + the ten questions**
Entry: Name `Cinema`, type `stdio`, command `node`, args `<abs>/mcp-servers/src/cinema/server.ts --data-dir ~/.iptv-mcp/cinema` (`~` is expanded by the server itself — `src/shared/args.ts:26-28`), Environment `OPENROUTER_API_KEY=…`, tool policy `allow-reads` (the default `ask-all` would ask for every search), description = the 150-char `PILOT_DESCRIPTION` (`src/cinema/server.ts:47`). Then the ten questions of §10, in order, with the expected tool use from the table.

**Step 5 — record**
Every §10 row gets a verdict in `cinema-server.md` §9 C5 ("what the model chose, what changed"); description changes go into `src/cinema/descriptions.ts` and are re-checked; README's status table gets C5 = done.

**Two notes for the guide:** editing `cinemaUrl` while the server runs is picked up by the settings re-read (`src/shared/settings.ts:376-381`) but does **not** trigger a download by itself — restart the server or call `refresh_catalog`. And the real provider URL carries the account key: it lives only in `settings.json` and in `get_status` masked.

---

Before I touch anything, three decisions:

Good. Let me confirm the exact settings template and the MCP client API before writing anything.

Now let me create the working folder with the settings template (the server's own template, mode 0600).

Now I'll write the pre-flight script. Part 1 — the harness:

Let me split that into three files (the 600-line rule of `AI_MCP.md`):

Now the checks themselves:

Now the runner that replaces the old single file:

The script works end to end. Two fixes: a clear early exit when the server is not ready, and it confirmed a real gap (`list_facets` does not name the settings file).

Now the fix for the gap the checks found (`list_facets` did not name the settings file):

Now the Pilot entry (Pilot is not running, so the config file can be written safely):

The Pilot entry is in place. Now let me record the C5 work in the design documents:

Everything is in place except the one thing only you can do. Here is the state and the guide.

## What I built (C5, part 1)

**`mcp-servers/scripts/manual-checks.ts`** + `scripts/manual/{checks,support}.ts` — the ten checks of §10, run against the server over stdio exactly as a client runs it. The script starts the server itself, asks each question with the tool call §10 prescribes, and prints what came back and whether it matches the design. It checks the **server**; the model is what the Pilot session checks. `npm run manual-checks`.

**A real bug the first run found** — `list_facets` answered *"The catalogue is empty. Run refresh_catalog to import it"* when the URL was not set, sending the model into a refresh that cannot work; §10 row 10 expects the settings file to be named. The URL check now comes first in `list_facets` too (`src/cinema/handlers.ts:139`), with a test (`tests/cinema/tools.test.ts:308`). **464 tests green, typecheck clean.**

**The Pilot entry** — written into `~/Library/Application Support/open-cowork/mcp-config.json` (Pilot was not running; a `.bak` is beside it). Name `Cinema`, type `stdio`, **absolute** `node` path (`/Users/eobomik/.local/Homebrew/bin/node` — the app starts the server without a shell, and `node` is not in the default macOS PATH; Node 26.5.0 runs the whole suite green), `src/cinema/server.ts`, `--data-dir ~/.iptv-mcp/cinema`, `OPENROUTER_API_KEY` from the repo `.env`, policy `allow-reads`.

**The working folder** — `~/.iptv-mcp/cinema/` (0700) with `settings.json` (0600) from the design's template.

## Your turn — one command

Copy the catalogue URL from the web app's Settings page (the `cinemaUrl` field), then:

```bash
CINEMA_URL="$(pbpaste)" node -e '
const fs=require("node:fs"); const p=process.env.HOME+"/.iptv-mcp/cinema/settings.json";
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.cinemaUrl=process.env.CINEMA_URL;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); fs.chmodSync(p,0o600);
console.log("cinemaUrl set,", d.cinemaUrl.length, "characters");'
```

It prints only the length — the key never enters this chat.

## Then the sequence

```bash
cd mcp-servers
npm run cinema          # refresh in the background: download ~80 MB, import ~3 s
npm run manual-checks   # the ten checks, once the catalogue is there
```

The import takes a minute; the **embedding run takes ~5 minutes** (7,261 texts, 146 OpenRouter requests) and `get_status` shows `vectors.done / pending`. Until it is done the search answers `search_mode: "words"` — that is the design, not a fault.

## The Pilot session — what to watch for

Start Sqowe Pilot (the entry is already there), open a chat and ask the ten questions of §10 **in order**, one per message:

| # | Ask | The right choice | The failure mode to look for |
|---|---|---|---|
| 1 | «Найди французские драмы с рейтингом выше 7» | `countries=["FR"], genres=["Драма"], min_rating=7` | it guesses the genre spelling instead of calling `list_facets` |
| 2 | «Что нового появилось за неделю?» | `sort="added", added_within_days=7` | it sorts by rating instead of by the day |
| 3 | «Что-нибудь похожее на "Кали"» | `search_titles` → `find_similar_titles` | it stops after the search and never calls the second tool |
| 4 | «Фильм про одиночество в космосе» | `query=…` | it puts the whole sentence into `keywords` |
| 5 | «Сериалы, где режиссёр Владимир Койфман» | `type="series", person="…"` | it puts the director into `query` |
| 6 | «Хочу посмотреть "Цинга" — дай ссылку» | `search_titles` → `get_title` | it invents a link instead of asking for the title |
| 7 | «…дай вторую серию третьего сезона» | `get_title` → `list_episodes(season=3)` | it stops at the season list |
| 8 | «Покажи эротику» | nothing (or a refusal) | it uses the adult genre — the tools refuse it, and that is correct |
| 9 | a genre spelled wrongly | the error → a corrected call | it gives up after the error |
| 10 | with an empty `cinemaUrl` | the tool names `~/.iptv-mcp/cinema/settings.json` | — (already verified by the script) |

Record each row's verdict; where the model chose badly I change `src/cinema/descriptions.ts` (Pilot never reads the server `instructions` — every rule must live in the tool descriptions, `iptv-mcp-servers.md` §2.3) and re-run that row.

I have **not** staged or committed anything — the changes sit in the working tree: `mcp-servers/{README.md, package.json, src/cinema/handlers.ts, tests/cinema/tools.test.ts, docs/design/cinema-server.md}` plus the new `scripts/manual-checks.ts` and `scripts/manual/`. Tell me when the URL is in and I will run the import and the ten checks, then we do the Pilot session together.

---

👤 **USER:**
> hmm - how and where I can specify real URL to cinema

The URL lives in exactly one place: the `cinemaUrl` field of the server's own settings file.

**`~/.iptv-mcp/cinema/settings.json`** — the only place the server reads it from (decision D7: settings file only, no environment override, no settings tool). Current content:

```json
{
  "cinemaUrl": "",          ←  this line
  "timezone": "auto",
  "refreshHours": 24,
  ...
}
```

**Where to get the value from:** the web app's Settings tab → the **"Cinema M3U URL"** field (`public/index.html:87-97`). If that field looks empty, the browser console has it:

```js
localStorage.getItem('iptv_cinema_url')   // the key of the web app (public/scripts/utils/storage.js:14)
```

**Three ways to put it in — pick one:**

**1. Copy the URL, then one command in the terminal** (the key never enters this chat):

```bash
CINEMA_URL="$(pbpaste)" node -e '
const fs=require("node:fs"); const p=process.env.HOME+"/.iptv-mcp/cinema/settings.json";
const d=JSON.parse(fs.readFileSync(p,"utf8")); d.cinemaUrl=process.env.CINEMA_URL;
fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n"); fs.chmodSync(p,0o600);
console.log("cinemaUrl set,", d.cinemaUrl.length, "characters");'
```

**2. Edit the file by hand:**

```bash
open -e ~/.iptv-mcp/cinema/settings.json     # TextEdit
# or:  nano ~/.iptv-mcp/cinema/settings.json
```
put the URL between the quotes of `"cinemaUrl"`, save. (Keep the file's rights: `chmod 600 ~/.iptv-mcp/cinema/settings.json`.)

**3. From the browser console straight into the file** — copy the value first, then use option 1.

Two things to know about it:
- The file is the secret — the URL carries your account key. It stays `0600`, and the server only ever shows it masked (`http://host…f8b2`) in `get_status` and the logs.
- The server re-reads the file when it changes, but a new URL does **not** trigger a download by itself. After you set it, run `npm run cinema` once (the refresh starts at the start when the data is stale) — or call `refresh_catalog` on the server that is already running.

Say "set" when it is in, and I will start the server, watch the import and the embedding run, and run the ten checks.

---

👤 **USER:**
> should I refresh DB somehow?

Yes — one import is needed (the database holds 0 titles). Let me first make the script safe: it must never kill a running import, or it would leave a lock behind that blocks refreshes for an hour.

Now the runner uses those waits:

The owner's URL is set and the import worked — but the log shows the embedding run **failed** at 2,100 of 7,641 texts. Let me look:

`embedMany` swallows the real error and returns `null` — so the log hides the cause. Let me reproduce the failing batch:

Now the worker: retry a failed batch and report the real reason.

Now update the test and add one for the new behaviour:

Now let me resume the embedding with the fixed worker and watch what really happens:

Two problems surfaced. Let me look at the settings file (masked):

Found it — the key was pasted into the wrong field: `embeddings.apiKeyEnv` must hold the **variable name**, not the key. Worse, the server logged it. Let me fix both:

Now a test for the secret-safe behaviour, then fix the settings file:

Now fix the settings file (the key was in the wrong field) and resume the embedding:

**All ten checks pass against the live provider data.** Let me record the findings and check one hygiene item:

Now let me record all of this in the design document:

## "Should I refresh the DB somehow?" — No. It refreshed itself, and it is done.

The server refreshes on its own: `shouldRefreshAtStart` (`src/cinema/refresh.ts:150`) sees *"the catalogue was never imported"* → refresh; afterwards *"the catalogue is fresh"* (24 h) → no refresh. A changed URL or a changed import setting forces it too, and `refresh_catalog` forces it by hand (Pilot asks first, it has no read verb).

**Current state of `~/.iptv-mcp/cinema/`** — no manual step left:

| | |
|---|---|
| titles | **7,650** (5,965 films, 1,685 series) — imported in **4.2 s** |
| vectors | **7,641** — the whole catalogue, queue empty |
| episodes / variants | 64,243 / 6,575 |
| `data.sqlite` / `vectors.sqlite` | 48.8 MB / 36.0 MB |
| the ten checks of §10 | **all ten pass, 0 warnings** |

## But setting the URL exposed three real defects — now fixed

**1. The key was pasted into the wrong field.** `embeddings.apiKeyEnv` holds the **name** of the variable (`OPENROUTER_API_KEY`), never the key. With the key in that field the embedding never ran — and the log printed it: `WARN … variable=sk-or-v1-2739…`. That breaks the rule "the OpenRouter key is never logged".

- the settings file is fixed (`apiKeyEnv` → `OPENROUTER_API_KEY`; the key is out of the file),
- the logger now writes the value only when it *is* a variable name (`safeForLog`, `src/shared/embeddings.ts`),
- the settings spec refuses such a value and reports it **without** the value (new `patterns` rule, `src/shared/settings.ts`),
- the two leaked lines are scrubbed from `logs/server.log` (it was `0600`).

**2. The reason of a failed embedding was swallowed.** `embedMany` caught every failure and answered `null`, so the run only said *"the embedding service did not answer every text"*. The client keeps `lastError` now; the worker writes it into the log and into `get_status`.

**3. One bad batch killed the whole run** — and nothing restarted it, so the catalogue stayed half embedded (that is how it was found: 2,100 of 7,641). The worker asks for the batch again now (3 attempts, 5 s and 20 s apart) before it stops.

**467 tests pass** (the three fixes have tests: the secret-safe log line, the reason in the failed run, the second try of a batch).

## Next: the Pilot session

Start Sqowe Pilot (the `Cinema` entry is already in its config; the key is in the entry's Environment field). Ask the ten questions of §10 one by one and tell me what the model chose — I will then adjust the tool descriptions where it chose badly and record it in `cinema-server.md` §9 C5.

The changed files (still unstaged, nothing committed):

```
mcp-servers/src/shared/embeddings.ts      lastError, safeForLog, isEnvVarName
mcp-servers/src/shared/settings.ts        the rule "patterns"
mcp-servers/src/cinema/config.ts          the rule for embeddings.apiKeyEnv
mcp-servers/src/cinema/embedder.ts        the second try of a batch, the reason
mcp-servers/src/cinema/handlers.ts        list_facets names the settings file
mcp-servers/scripts/manual-checks.ts      the ten checks (+ scripts/manual/)
mcp-servers/tests/…                       three new tests
mcp-servers/docs/design/cinema-server.md  the record of C5
```

---

👤 **USER:**
> show me how to add mcp server from ui

Let me look at the Pilot UI code so the steps match the actual app:

Here's the exact path through the Pilot UI. **Note first: the entry is already there** — I wrote it into `mcp-config.json`, so when you open the page you will already see a **Cinema** card. Don't add a second one (two servers with the same name would give the model two `mcp__Cinema__search_titles`).

## If you want to add it by hand anyway

**Settings (⌘,) → tab “MCP Connectors” → “Add Custom Connector”**

| Field | Value |
|---|---|
| **Name** | `Cinema` |
| **Description** | `Online cinema of the user's IPTV provider: find films and series by genre, country, year, rating or meaning; similar titles; new arrivals; play links.` |
| **Type** | **STDIO (Local)** |
| **Command** | `/Users/eobomik/.local/Homebrew/bin/node` |
| **Arguments** | `/Users/eobomik/src/iptv-epg-search/mcp-servers/src/cinema/server.ts --data-dir /Users/eobomik/.iptv-mcp/cinema` |
| **Environment variables** | key `OPENROUTER_API_KEY` → value: the key from the repo’s `.env` |
| **Enable this connector** | on |
| **Tool timeout** | `0` (the global 240 s) |

Three things that are easy to get wrong here:

1. **The command must be the absolute path of node.** Pilot starts the server without a shell, and `node` is not in the default macOS PATH (it lives in nvm and in `~/.local/Homebrew/bin`). `/Users/eobomik/.local/Homebrew/bin/node` is a Homebrew symlink that survives Node upgrades; the nvm path (`/Users/eobomik/.nvm/versions/node/v24.17.0/bin/node`) also works but breaks when you switch Node versions.
2. **The Arguments field is split on whitespace** (`args.trim().split(/\s+/)` in `SettingsConnectors.tsx:838`) — so neither path may contain a space. Yours does not, but a folder named “My Movies” would break it.
3. **The key goes into Environment variables**, not into `~/.iptv-mcp/cinema/settings.json`. The settings file holds the *name* of the variable (`embeddings.apiKeyEnv: "OPENROUTER_API_KEY"`) — that is exactly the mistake we hit earlier, and the server now refuses such a value with a message that does not repeat it.

## After saving

- The card should show **Connected** and **7 tools**. Their names reach the model as `mcp__Cinema__search_titles`, `mcp__Cinema__find_similar_titles`, `mcp__Cinema__get_title`, `mcp__Cinema__list_episodes`, `mcp__Cinema__list_facets`, `mcp__Cinema__get_status`, `mcp__Cinema__refresh_catalog`.
- **Set the tool policy to `allow-reads`** on the card (the dropdown on the server card). The default is `ask-all`, which would ask you before every single search. `refresh_catalog` still asks — that is intended (it has no read verb).
- **Enable it for the chat**: the ContextPanel has “MCP Servers for this chat” with *Enable for this session*.
- If it shows **Connection failed**, the log says why: `tail -f ~/.iptv-mcp/cinema/logs/server.log`.

## The two ways to get the key into the Environment field

- Open the repo’s `.env` (`/Users/eobomik/src/iptv-epg-search/.env`) and copy the value of `OPENROUTER_API_KEY`.
- Or, without opening it:
  ```bash
  pbpaste   # after copying the line in an editor
  ```

If you prefer to start from scratch in the UI: delete the **Cinema** card I added (the card’s delete button), then add it with the table above — the result is the same entry.

---

👤 **USER:**
> add these instructions to README

Added to `mcp-servers/README.md` → **“Connecting to Sqowe Pilot”**:

- the new subsection **“Adding the server in the UI of Pilot”** — the path (⌘, → *MCP Connectors* → *Add Custom Connector*), a table of every field of the form (name, description, type, command, arguments, environment variables, enable, timeout), and the seven tool names the model will see;
- the three traps: the **absolute** path of `node` (no shell → no PATH; Homebrew path survives a Node upgrade, the nvm path does not), the **whitespace splitting** of the Arguments field, and the key belonging in the **Environment field** rather than in `settings.json`;
- what to check afterwards (the card shows *Connected* and the tool count, the policy `allow-reads`, enabling the server for the chat) and where the log is when the card says *Connection failed*;
- the direct-file route (`~/Library/Application Support/open-cowork/mcp-config.json`, only while Pilot is closed).

The older summary table now says *Command: the absolute path of `node` (see below)*, so the two parts agree.

**State of the working tree** (nothing staged, nothing committed — that is yours):

```
mcp-servers/README.md                      the Pilot instructions
mcp-servers/docs/design/cinema-server.md   the record of C5 and the measured numbers
mcp-servers/package.json                   the script manual-checks
mcp-servers/src/shared/embeddings.ts       lastError, safeForLog
mcp-servers/src/shared/settings.ts         the rule "patterns"
mcp-servers/src/cinema/config.ts           the rule for embeddings.apiKeyEnv
mcp-servers/src/cinema/embedder.ts         the second try of a batch, the reason
mcp-servers/src/cinema/handlers.ts         list_facets names the settings file
mcp-servers/scripts/manual-checks.ts       the ten checks   (new)
mcp-servers/scripts/manual/                checks.ts, support.ts   (new)
mcp-servers/tests/…                        three new tests
```

**467 tests pass, typecheck clean**, the catalogue in `~/.iptv-mcp/cinema/` holds 7,650 titles and 7,641 vectors, and all ten checks of §10 pass against the live provider. The only part of C5 left is the Pilot session itself — ask the ten questions there and tell me which tool the model chose for each; I will adjust the descriptions where it chose badly and record it in `cinema-server.md` §9 C5.

---

👤 **USER:**
> let commit current step

Committed as **`3c708b7`** on the branch `feat/mcp-servers`:

```
feat(mcp-servers): connect the cinema server to Pilot and check it
 14 files changed, 1428 insertions(+), 19 deletions(-)
```

The message follows the style of the three phase commits before it: what was built (the check script, the Pilot entry, the working folder), the four defects the checks found and how each was fixed, the measurements on the live catalogue, and the test count.

**What went in:**

| | |
|---|---|
| new | `mcp-servers/scripts/manual-checks.ts`, `scripts/manual/checks.ts`, `scripts/manual/support.ts` |
| changed | `src/shared/embeddings.ts` (lastError, safeForLog), `src/shared/settings.ts` (the rule *patterns*), `src/cinema/config.ts` (the rule for `embeddings.apiKeyEnv`), `src/cinema/embedder.ts` (the second try of a batch, the reason), `src/cinema/handlers.ts` (`list_facets` names the settings file) |
| tests | three new tests (the secret-safe message, the reason in the failed run, the second try of a batch) — 467 pass |
| docs | `docs/design/cinema-server.md` (the record of C5 and the measured numbers), `README.md` (the Pilot UI steps) |

The working tree is clean; nothing else in the repository was touched (`.env` and `tmp/` stay ignored).

**Still open in C5:** the ten questions in Pilot — that part needs the model, not the code. Ask them one by one in a Pilot chat and tell me which tool the model reached for each; where it chose badly I will adjust `src/cinema/descriptions.ts` and record the change in `cinema-server.md` §9 C5, then we can close the phase.

---

👤 **USER:**
> suggest AGENTS.md for LLM to work with this.
Mentioned that main language for conversation is Russian

Let me check what the repo already says about language and where an `AGENTS.md` would fit:

Here is the proposal. Two files (the standard layout: a root entry point + a short nested one for the `mcp-servers/` subtree), both **pointing** rather than repeating the rule files — the repo's own rule says `ARCHITECTURE.md` and `AI_*.md` must not duplicate each other, so `AGENTS.md` should not duplicate them either.

---

## 1. `AGENTS.md` (repository root)

```markdown
# AGENTS.md

The entry point for an AI agent (or a human) working in this repository. The rules themselves
live in the files named below — read the one that covers the code you are about to touch. This
file points at them; it does not repeat them.

## The language

- **The conversation with the owner is in Russian.** Answer in Russian unless the owner writes in
  another language.
- **The code, the documentation and the commit messages stay in English.**
- The data of the provider is mostly Russian: the films of the catalogue appear under their
  Russian titles, and the interface of the web app is Russian.

## What this repository is

Two products in one repository:

| Folder | Product | The rules of it |
| --- | --- | --- |
| `public/`, `api/`, `tests/` | the **web app** — a client-side browser app that searches the IPTV EPG (XMLTV) and the online cinema catalogue (M3U) | [AI.md](AI.md), [AI_FRONTEND.md](AI_FRONTEND.md), [AI_PROXY.md](AI_PROXY.md), [AI_WEB_DESIGN_SQOWE.md](AI_WEB_DESIGN_SQOWE.md) |
| `mcp-servers/` | the **MCP servers** — local stdio servers that give a chat model the same data (the Cinema server is done, the TV Guide follows) | [AI_MCP.md](AI_MCP.md) |

[ARCHITECTURE.md](ARCHITECTURE.md) describes how the parts fit together. [CLAUDE.md](CLAUDE.md)
is the index of the rules and holds the full working agreement.

## Before a change

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the `AI*.md` of the area you touch.
2. For the MCP servers, read the design documents in `mcp-servers/docs/design/` — the code follows
   them, and they are updated as the code changes.
3. Propose the change and wait for an explicit request. Reading, searching and answering need no
   confirmation.

## The rules that hold everywhere

- **Never commit and never stage.** The owner does that.
- **Never weaken a check to make something pass**: the sanitization of the URLs and of the HTML
  (`public/scripts/utils/sanitize.js`), the protocol and content-type checks of the proxy
  (`api/proxy.js`), the times with their offset, the http/https check of every link, the privacy
  of the files of the working folder. Report the honest failure instead.
- **Verify against the source, not from memory.** Every claim about how this code behaves must be
  read out of the files and cited with `file:line` — in prose as much as in code.
- **No real data in the repository.** `tmp/` is local and git-ignored: no real URLs, no keys, no
  provider hosts in a fixture or a test.
- **Secrets stay out of the chat and out of the repository**: the URL of the provider carries the
  account key; the key of the embedding service comes from the environment.

## The commands

| What | Command | Where |
| --- | --- | --- |
| Web app, local | `npm run dev` → <http://localhost:8000> | root |
| Web app, syntax check | `node --check <file>` | root |
| Web app, tests | serve the repo root, open `/tests/test-runner.html` | root |
| Web app, deploy | `npm run deploy` (only when the owner asks) | root |
| MCP servers, types | `npm run typecheck` | `mcp-servers/` |
| MCP servers, tests | `npm test` | `mcp-servers/` |
| MCP servers, the Cinema server | `npm run cinema` | `mcp-servers/` |
| MCP servers, the checks of the design | `npm run manual-checks` | `mcp-servers/` |

## The traps

- `program.start` and `program.stop` of the EPG ignore the timezone offset — use `startRaw` and
  `epgRawToEpochSeconds` for anything absolute.
- `npm run dev` serves only `public/`: `api/proxy.js` and `tests/` are not reachable through it.
- The MCP servers keep their data in their own working folder (`~/.iptv-mcp/cinema`): the
  settings file there is the only place the URL of the provider is set, and it is never rewritten.
```

## 2. `mcp-servers/AGENTS.md` (nested, applies to that subtree)

```markdown
# AGENTS.md — the MCP servers

This folder is a **separate product** that lives in this repository for now and must stay movable
to its own repository (decision D2 of [the design](docs/design/iptv-mcp-servers.md)).

## The rules of this folder

- [../AI_MCP.md](../AI_MCP.md) — TypeScript without a build step, the layout, the working folder,
  the secrets, stdout, the URLs, the time, the storage, the search, the tests.
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — the place of the servers in the repository.
- [docs/design/iptv-mcp-servers.md](docs/design/iptv-mcp-servers.md) — the shared decisions
  (D1–D15), the settings, the storage, the search model, the rules of the tools.
- [docs/design/cinema-server.md](docs/design/cinema-server.md) and
  [docs/design/tv-guide-server.md](docs/design/tv-guide-server.md) — the two servers.

The code follows the design documents, and the design documents are updated as the code changes:
a change of behaviour is a change of the document too.

## The working agreement of this folder

- Nothing outside `mcp-servers/` may import from it, and it imports nothing from outside it
  except its own npm dependencies. Ported web app logic is copied, not imported, and the copy
  names the source file and the function in a comment.
- **Never commit and never stage.**
- The URL of the provider comes from the settings file of the working folder
  (`~/.iptv-mcp/cinema/settings.json`, mode `0600`) and from nowhere else. The key of the
  embedding service comes from the environment (`OPENROUTER_API_KEY`), never from a file.
- Every phase ends with `npm run typecheck` and `npm test` green.

## The commands

| What | Command |
| --- | --- |
| Types | `npm run typecheck` |
| Tests | `npm test` |
| The Cinema server | `npm run cinema` |
| The checks of the design | `npm run manual-checks` |
| The counts of a real catalogue | `npm run check-real-data <file>` |
```

---

**Decisions I made** (say which to change):

1. **The language rule** is the first section, in both files’ spirit: the conversation in Russian, the artefacts in English. If you meant something else — e.g. only the *Pilot* chats are Russian — tell me and I will narrow the wording.
2. **Pointing, not repeating.** The `AI*.md` files stay the single source; `AGENTS.md` adds only what is not in them (the language, the two products side by side, the commands in one table).
3. **The traps** are the three that cost the most time in this session; `CLAUDE.md` already lists them, so this is a pointer in different words — if you prefer no duplication at all, I can cut that section.
4. **`CLAUDE.md` stays as it is.** `AGENTS.md` is the cross-tool convention (Codex, Cursor, pi); `CLAUDE.md` is what Claude Code reads. Both point at the same `AI*.md` files.

**One thing to decide:** the `ai-coding-setup` generator (which wrote `CLAUDE.md`, `ARCHITECTURE.md`, the `AI_*.md`) does not know about `AGENTS.md` — a refresh of the documentation set may or may not keep it. Want me to add a line to `CLAUDE.md` pointing at `AGENTS.md` (so the two stay connected), or leave `CLAUDE.md` untouched?

Shall I write these two files (and optionally the one-line link in `CLAUDE.md`)?

