# Claude Chat Export
**Generated: 2026-10-30 16:31:14**

---

👤 **USER:**
> Read design document mcp-servers/docs/design/iptv-mcp-servers.md carefully.

Turn back with confirmation that you are ready to start implementation, or ask questions.

Prefer to use the semantic-index skill to search the codebase, docs, and past conversations.

**NEVER** use find command from the root. All neccessary files place under user directory

Use context7 as the source of truth for code patterns and coding docs.

Use firecrawl skills to search and get content from the web. You should search the web also if context7 doesn't have relevant information.

Before start implementation provide report and implementation plan

**Don't start implementation without excplicit user approval.**

High level design is in mcp-servers/docs/design/tv-guide-server.md

I'll start by reading the design documents, then explore the codebase to verify claims before proposing a plan.

Now let me explore the actual state of the codebase. Let me check the semantic index and the `mcp-servers/` folder.

Let me refresh the semantic index (25 files stale) and read the key implementation files in parallel.

Let me verify the real-data claims that T2 will depend on, by checking the actual sample files.

Let me verify the five non-blocking improvements the T1 review left for later.

I have read both design documents, verified the current state of the code, and checked the real data in `tmp/`. Here is the report.

---

# Report

## 1. Current state — verified

| Fact | Evidence |
|---|---|
| T1 is the last phase built | `git log`: `1cb2500 feat(mcp-servers): add the TV guide import: playlist and streaming EPG (T1)`; branch `feat/mcp-servers` |
| Type check and tests are green | `npm run typecheck` → clean; `npm test` → **548 pass, 0 fail** (109 suites) |
| The TV Guide server entry point does not exist yet | `package.json` → `"tv-guide": "node -e \"console.error('The TV Guide server arrives in phase T1.'); …\""` |
| The shared base is complete | `src/shared/`: `args, countries, country-table, db, download, embeddings, hash, links, lock, log, log-level, m3u, permissions, refresh, settings, text, time, tool-kit, vectors` |
| Cinema is the pattern to follow | `src/cinema/`: `server.ts` (entry), `tools.ts` (registration), `handlers.ts`, `descriptions.ts`, `schemas.ts` (zod in/out), `tool-context.ts`, `search.ts`/`blend.ts`/`words.ts`/`filters.ts` (the pipeline), `embedder.ts` (background worker), `status.ts` |
| The guide's storage exists, the derived fields do not | `src/tv-guide/schema.ts:60-80` — `kind`, `kind_source`, `live_mark`, `year`, `directors`, `cast_names`, `genres`, `sport`, `venue` are all present but `store.ts:305-312` writes `'other'`, `'none'`, `0`, `NULL` |

**What remains:** T2 (derived fields), T3 (tools, words only), T4 (embeddings), T5 (Pilot), T6 (both servers).

## 2. Findings from the real data that refine the design

I measured `tmp/4a27b28d` and `tmp/playlist.m3u` directly rather than trusting the document.

**Confirmed exactly as the design says:** 22 playlist groups with the same channel counts (Кино 160, Israel 126, Познавательные 101 … Ultra HD 16); `х/ф` = 8,455 programmes; `⋗` = 1,107; **102,467** distinct (title, description) pairs; **75,553** distinct titles.

**The film ending needs three rules, not two.** The design §4.4 lists `Реж.:` and `В ролях:`. The data also has **`Вед.:`** (the host of a talk show) in 4,366 programmes — e.g. *"… Реж.: Роман Бутовский, Алексей Морозов. Вед.: Дмитрий Борисов. Россия, 2005, ток-шоу"*. Counts: `Реж.:` 21,905 · `В ролях:` 15,699 · `Вед.:` 4,366. The country/year/genre list must come from the **last** comma list, after the `Вед.:` sentence, or `Россия, 2005, ток-шоу` is read as the countries of a talk show.

**The venue rule of the design is too greedy.** `Трансляция из ([^.]+)` captures the age mark and the countries in the genitive: *"Трансляция из Казани (12+)"*, *"Трансляция из Турции (12+)"*, *"Трансляция из Белоруссии (12+)"*. The `(12+)` has to be stripped, and a venue that is a country has to be told apart from a city.

**Sport prefixes, measured per programme:** Футбол 1,211 · Автоспорт 205 · Велоспорт 150 · Гандбол 114 · Хоккей 109 · Волейбол 104 · Регби 74 · Бокс 57 · Баскетбол 54 · Теннис 50 · Плавание 30 · Фигурное катание 8.

**The `⋗` mark — design open item §12.1.** No title string appears both with and without the mark (0 of 1,107). The same event airs repeatedly on the same channels; the marked airing and the unmarked repeatings differ in time ("ЧМ-2026. Испания – Кабо-Верде": marked at 18:00, unmarked at 07:25, 13:40, 18:30). Every `⋗` programme in this snapshot is a sport broadcast. **This supports the "live broadcast" reading**, but the June snapshot only contains the World Cup, so it is evidence, not proof.

*(Correction to my own first reading: I initially measured the `⋗` start minutes as "all on the hour" — that was a bug in my one-liner, which read the seconds field. Redone correctly: 411 of 1,107 start on the hour, the rest on 5-minute steps.)*

## 3. A real gap in the design that T2 must close

The **Cinema** server keys its vectors by the hash of the *embedding text* (`src/cinema/keys.ts:72` — `textHash(text) = sha256(normalizeText(text))`), so a vector always describes what was embedded.

The **TV Guide** (T1) keys its texts by the hash of the *raw (title, description) pair* (`src/tv-guide/texts.ts:38`). T2 changes the embed text (it gains kind, people, country, year). The vector is stored under the text hash — so after T2 the vector would describe the **old** text, and `queueMissingVectors` (`src/tv-guide/queue.ts:167`) checks only "no vector for this hash", so it would **never re-queue them**. The vectors would silently be wrong.

The same applies to the keyword index: the FTS row is written only for **new** texts (`src/tv-guide/store.ts:305`, `ON CONFLICT DO NOTHING`), so the 100,611 existing texts would keep an empty `people` column and a title that still carries the markers.

A `derived_version` column plus a separate `embed_hash` solves both: the import rewrites the derived fields, the FTS row and the queue entry of a text whose version differs, and the vector is keyed by the embed text.

## 4. The five improvements the T1 review left open — all still open (verified)

| # | Improvement | Where it should go | Still open? |
|---|---|---|---|
| 1 | `epgDefaultOffset` validated with HH ≤ 23, MM ≤ 59 | `src/tv-guide/config.ts:85` — the pattern is only `/^[+-]\d{4}$/`, so `+9999` passes | yes |
| 2 | `queueText` refuses an empty embed text even when `minTextChars` is 0 | `src/tv-guide/queue.ts:104` — `charLength('') < 0` is false, so it queues | yes |
| 3 | The guide reader stops feeding the file after the first parse error | `src/tv-guide/epg.ts:164-167` — *"the parser keeps going"* | yes |
| 4 | The retention outcome carries the live programme count | `src/tv-guide/import-options.ts` — `WriteResult` has no programme count | yes |
| 5 | The playlist of a refresh is parsed once, not once more | `src/tv-guide/import.ts:667` parses it, and `playlistSummaryOf` (`:207`) parses it again at `:579`, `:600`, `:657` — **three times per refresh** | yes |

## 5. Implementation plan

### T2 — Derived fields (one phase, one commit, like C1–C4 and T1)
New in `src/tv-guide/`: `groups.ts` (group → theme/region/timeshift, the §4.2 table + `groupMap` overrides), `channel-facts.ts` (quality — a port of `public/scripts/utils/search.js:80-91` — the `+Nч` time shift, `family_key`), `kind.ts` (the five sources of §4.3 in order: marker → pattern → channel theme → meaning (T4) → other), `extract.ts` (the film ending with three rules, the venue with the age mark stripped, the sport).
Changed: `texts.ts` (strip the marker and `⋗`, build the facts and the new embed text, add `embed_hash`), `store.ts` (write the derived fields, the FTS `people` column, the `text_countries` rows, the `derived_version`), `schema.ts` (add `embed_hash`, `derived_version`), `config.ts` (fix #1), `queue.ts` (fix #2).
Tests: the endings with several countries, without genres, without a year, with `Вед.:`; "Трансляция из США" and "Казани (12+)"; the markers after `⋗`; `family_key` for "Первый HD" / "Первый канал (+2)". A real-data script prints the coverage: the kind distribution, the share of `х/ф` texts with countries and year (expected near 5,244 / 7,358), the venues found.

### T3 — Tools, words only
`server.ts`, `tools.ts`, `descriptions.ts`, `schemas.ts`, `handlers.ts`, `tool-context.ts`, `search.ts`, `filters.ts`, `words.ts`, `items.ts`, `links.ts` (the catch-up rule, a port of `public/scripts/components/results.js:268-297`), `periods.ts` (the §7 table), `status.ts`, `refresh.ts`.
The eight tools of §7. `hide_repeats` and `prefer_hd` re-implement `filterUniqueByClosestTime` (`search.js:98`) and `filterPreferHD` (`search.js:136`) on epoch seconds. The catch-up URL is `?utc=<start_utc>&lutc=<now>`, built only in `get_program`, with `link_built_at`.
Tests: the catch-up rule with a fixed clock (the boundaries at `stop_utc = now` and at exactly `archive_days`; an existing query on the stream URL; a non-http stream URL); the periods around midnight and with a timezone other than `+03:00`; the contract tests through the SDK in-memory transport, including the Pilot name rule (`tests/cinema/tool-names.test.ts` is the model).

### T4 — Embeddings
The worker (`src/cinema/embedder.ts` is the model), the kind by meaning with a tuned threshold, and the measurement of `vec_distance_cosine` over the largest candidate set. **One decision I will make and measure:** the candidate set is built **text-first** (FTS + vectors over ~100k texts, then expand the surviving texts to their airings) rather than airing-first (a 320k-row join per query). The alternative is the fallback the design names: a `vec0` table with metadata columns.

### T5 / T6 — Pilot and both servers
The Pilot entry, the twelve manual checks of §11, then the cross-server questions.

**In every phase:** `npm run typecheck` and `npm test` green, then the review-fix loop (`.agents/skills/review-fix-loop/SKILL.md`, max 5 rounds — T1 took five). The design documents are updated as they are built, and the commit is left for you — I never stage or commit.

---

Four decisions are yours before I start:

Approved: **T2 only**, `embed_hash` for the vectors, `⋗` as a flag only, and all five T1 improvements folded in. Let me read the two files I still need before writing code.

Now let me check the country table and measure the real shapes of the film endings before writing the extractors.

The data shows the design's rule needs tightening. Let me test a stricter rule against the real file.

Now I'll implement. Starting with the shared country table (the guide writes countries in the language of the film and in the genitive).

Now the stem-based country lookup in the shared module:

Now the TV Guide modules. First, the channel facts (quality, time shift, family key):

Now the core: the derived programme text.

Now the schema — the `embed_hash`, the `derived_version` and the queue re-keyed on the embedding text:

Now the write path — the store:

Now the settings fix (#1) — validating the offset range:

Now the import pipeline — fix #5 (parse the playlist once) and pass the group map:

Now let me restructure the refresh to parse the playlist once:

Now fix #3 — the guide reader must stop feeding the file after its first parse error:

The marker kinds are missing — the marker was stripped before the kind was read. Let me fix that:

The kind priority needs refining — the channel theme must beat the film ending, and the film ending must beat "other". Let me restructure:

The derivation works on the real data. Now the tests:

Now let me add the end-to-end tests for the derived fields:

Now let me update the design document with what T2 built:

Now the README:

The phase is complete and green. Now the review loop, as the project does at the end of every phase:

