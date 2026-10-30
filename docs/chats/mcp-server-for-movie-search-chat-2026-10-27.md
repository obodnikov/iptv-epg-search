# Claude Chat Export
**Generated: 2026-10-30 16:31:13**

---

👤 **USER:**
> Посмотри этот проект внимательно
Я думаю о MCP server (один или 2) которые повторяли бы функции сайта, но позволяли бы мне использовать чат с моделями для поиска фильмов которые стоит или хочется посмотреть

Предложи мне варианты

<pasted_content id="cf01">
Prefer to use the semantic-index skill to search the codebase, docs, and past conversations.

**NEVER** use find command from the root. All neccessary files place under user directory

Use context7 as the source of truth for code patterns and coding docs.

Use firecrawl skills to search and get content from the web. You should search the web also if context7 doesn't have relevant information.

Before start implementation provide report and implementation plan

**Don't start implementation without excplicit user approval.**
</pasted_content id="cf01">

---

👤 **USER:**
> Посмотри этот проект внимательно
Я думаю о MCP server (один или 2) которые повторяли бы функции сайта, но позволяли бы мне использовать чат с моделями для поиска фильмов которые стоит или хочется посмотреть

Предложи мне варианты

<pasted_content id="cf01">
Prefer to use the semantic-index skill to search the codebase, docs, and past conversations.

**NEVER** use find command from the root. All neccessary files place under user directory

Use context7 as the source of truth for code patterns and coding docs.

Use firecrawl skills to search and get content from the web. You should search the web also if context7 doesn't have relevant information.

Before start implementation provide report and implementation plan

**Don't start implementation without excplicit user approval.**
</pasted_content id="cf01">

Начну с изучения проекта: архитектура, правила, код клиента и прокси, прошлые обсуждения.

---

👤 **USER:**
> Base directory for this skill: /Users/eobomik/.claude/skills/semantic-index

# Semantic Index

Index code, documentation, and office documents for meaning-based search using embeddings.

## When To Use This Skill

### Indexing

#### User-initiated
- The user asks to index, re-index, or update the index of their project
- The user opens a new project and wants to set up semantic search

#### AI-initiated
- The project has no .index/ directory and semantic search would be useful
  for the current task — suggest indexing first
- Before searching: run index_status.py to check for stale files. If many files
  are stale (>20% of indexed files), suggest re-indexing before searching.
  The same output says which human languages the index holds
  (`human_languages`) — read it before writing the first query, see
  "Which language to write the query in"
- The user has made significant changes (new modules, large refactors) and
  the AI knows the index is likely outdated

**Important**: Suggest indexing at most once per conversation. If the user
declines or ignores the suggestion, do not bring it up again — fall back
to Grep/Glob/Read and move on with the task. The goal is to be helpful,
not to nag.

### Searching

#### User-initiated
- The user wants to search code by concept, not exact string
- The user asks "where is X handled?" or "how does Y work?"
- The user explicitly asks for semantic/vector/embedding search

#### AI-initiated
- Before implementing a feature: search for similar existing patterns,
  conventions, or related modules to stay consistent with the codebase
- Before fixing a bug: search for related code, similar past fixes, or
  other places where the same pattern appears
- When the user mentions "something similar was done before" or "check how
  we handled X" — search for that prior implementation
- When exploring an unfamiliar codebase before making changes: build
  understanding of architecture, naming conventions, and module boundaries
- When the user's task touches a concept that could span multiple files
  and you don't know which ones
- When Grep/Glob would require guessing the exact terminology the codebase
  uses (e.g., the user says "authentication" but the code might use "auth",
  "session", "jwt", "credentials", or "login")

### When NOT to use
- The user knows the exact string to search for (use Grep instead)
- The user wants to find files by name pattern (use Glob instead)
- The total project content comfortably fits within context (e.g., a few
  small files under ~200 lines each). If individual files are large (500+
  lines) or the combined content would exceed ~50K tokens, semantic indexing
  is worthwhile even for just 3-5 files.

## Prerequisites

The skill needs a Python virtual environment with dependencies installed.
On first use, run setup:

```bash
cd <skill-path>/scripts
bash setup.sh
```

This creates a `.venv` in the scripts directory and installs core dependencies.
It only needs to run once per machine.

Optional dependency groups (pass as flags to `setup.sh`):
- `--with-huggingface` — local embedding via HuggingFace (no API key needed)
- `--with-office` — PDF, DOCX, PPTX extraction (PyMuPDF, python-docx, python-pptx)
- `--with-mcp` — MCP server transport (see `references/mcp-server.md`)

Example installing everything:
```bash
bash setup.sh --with-huggingface --with-office --with-mcp
```

Embedding provider setup depends on the `embedding.provider` field in
`.index/config.json` (defaults to `"openrouter"`):

- **openrouter**: Requires an API key. Check `OPENROUTER_API_KEY` env var,
  then `config.embedding.api_key`. If neither exists, ask the user.
- **huggingface**: No API key needed. On first run, the model is downloaded
  to `~/.cache/huggingface/hub` (~274MB for Nomic). Subsequent runs load
  from cache. Works fully offline after first download.

If no `.index/config.json` exists yet, the scripts create one on first run.
The provider choice is purely a configuration concern — indexing and search
commands work identically regardless of provider.

## Path Resolution

Before running any command, resolve these two placeholders:

- `<skill-path>`: Always `~/.kiro/skills/semantic-index`. This is fixed.
- `<project-root>`: The actual workspace root directory. **Always run `pwd`
  first** to get the real path. Never guess from environment variables,
  Machine ID context, or other indirect sources — these can point to
  non-existent or inaccessible paths.

**Common mistake**: Using a path like `/Users/<username>/Documents/workspace`
derived from IDE context variables instead of the actual working directory.
This causes `PermissionError` or "No .index/ directory found" even when the
index exists, because the script tries to create directories under a path
it cannot access.

**Correct pattern**:
```bash
# Step 1: Get the real workspace path
pwd
# Output: /Users/johndoe/src/my-project

# Step 2: Use that exact path in all commands
~/.kiro/skills/semantic-index/scripts/.venv/bin/python \
  ~/.kiro/skills/semantic-index/scripts/index_status.py \
  --project-dir /Users/johndoe/src/my-project
```

## Core Commands

All commands output structured JSON to stdout. Progress and logs go to stderr.

### Indexing

To index the current project:

```bash
<skill-path>/scripts/.venv/bin/python <skill-path>/scripts/build_index.py \
  --project-dir <project-root> \
  [--config <path-to-config.json>] \
  [--full]
```

Arguments:
- `--project-dir` (required): Path to the project root
- `--config`: Path to config.json (default: `<project-root>/.index/config.json`)
- `--full`: Force full re-index, ignoring the manifest

What this does:
1. Scans the project for supported files (code, markdown, DITA XML, office documents)
2. Respects .gitignore and .indexignore patterns
3. Computes SHA-256 hashes to detect changed files
4. Chunks files using format-aware splitting:
   - Code: Tree-sitter AST parsing (functions, classes, methods)
   - Markdown: header-based section splitting
   - DITA XML: topic-aware parsing (concepts, tasks, references, glossary)
   - PDF: page-based splitting with short-page merging
   - DOCX: heading-based sectioning (mirrors markdown strategy)
   - PPTX: slide-based splitting with speaker notes
5. Embeds chunks via the configured provider (OpenRouter API or local HuggingFace)
6. Stores embeddings in `.index/` (LanceDB format) with a BM25 keyword index
7. Saves file manifest for incremental re-indexing

On re-run, only changed/new files are re-indexed (incremental).

After the skill itself is updated, the first build of an existing project may
report `"bm25_upgraded": true`: the keyword index was re-tokenized from the
text it already holds. This needs no embedding calls. Until that build, an
index made by an older version is searched by the older keyword rules.

Success output:
```json
{
  "status": "success",
  "files_indexed": 42,
  "files_skipped": 180,
  "files_deleted": 2,
  "chunks_created": 387,
  "duration_seconds": 12.4,
  "embedding_api_calls": 4,
  "truncated_chunks": 3,
  "truncated_files": ["src/big_data.py"]
}
```

`truncated_chunks` counts chunks that were shortened to fit the
embedding model's context window. Their full text is preserved in
`chunk.metadata["original_content"]`; the embedding vector only
covers the surviving prefix, so search hits on those chunks will
miss anything past it. `truncated_files` lists the project-relative
paths of files that contributed at least one truncated chunk.
When `truncated_chunks > 0`, a `truncation_message` field is added
with a human-readable summary; affected file paths are also
emitted at DEBUG on the build's stderr stream.

No changes output:
```json
{
  "status": "up_to_date",
  "message": "No changes detected",
  "files_unchanged": 222
}
```

### Searching

To search the index:

```bash
<skill-path>/scripts/.venv/bin/python <skill-path>/scripts/semantic_search.py \
  --project-dir <project-root> \
  --query "your natural language query" \
  [--top-k 10] \
  [--threshold 0.3] \
  [--mode hybrid] \
  [--alpha 0.7] \
  [--rerank] \
  [--filter-lang <lang>] \
  [--filter-path <glob>]
```

Arguments:
- `--project-dir` (required): Path to the project root
- `--query` (required): Natural language search query, in the language of the
  text you are looking for (see "Which language to write the query in")
- `--top-k`: Max results to return (default: from config, usually 10)
- `--threshold`: Min similarity score 0.0–1.0 (default: from config, usually 0.3)
- `--mode`: Search mode — `vector`, `keyword`, or `hybrid` (default: from config, usually `hybrid`)
- `--alpha`: Hybrid balance — 0.0 = pure keyword, 1.0 = pure vector (default: 0.7).
  Below 0.5 a keyword match outranks the best match by meaning, which hides
  texts written in another language than the query — keep the default when the
  index holds more than one human language
- `--rerank`: Re-rank results using a cross-encoder model for higher precision (requires HuggingFace deps)
- `--filter-lang`: Only search files of this language (e.g., "python")
- `--filter-path`: Only search files matching this glob (e.g., "src/**")

Search modes:
- `vector` — pure semantic similarity using embeddings
- `keyword` — BM25 keyword matching for when you know specific terms. Words
  are matched in any language written with spaces between words, and a
  function, class or template name finds the fragment that defines it
- `hybrid` (default) — combines both: each list's scores are rescaled to 0–1
  and blended by `--alpha`

In hybrid mode `score` is that blended value. It is relative to the query's own
candidates — it orders the results but does not say how good a match is, and
`--threshold` is not applied. Each result then also carries `vector_score`
(cosine similarity) and `bm25_score` (raw keyword score); either is `null` when
the result came from the other search only. When the keyword search finds
nothing, hybrid returns the vector results as they are: `score` is the cosine
similarity and the two extra fields are absent.

To find where something is defined, put its exact name in the query. When a
query word is written the way code names are — with an underscore or with a
capital inside it: `gather_and_write`, `detectPlatform`, `BM25Index`,
`_enforce` — and a fragment is defined under exactly that name, hybrid mode
ranks that fragment as the best match and marks it `"name_match": true`. A
plain, capitalized or all-capitals word (`load`, `Reranker`, `JSON`) is never
treated as a name, and neither is a name that more than three fragments share.

Output:
```json
{
  "query": "how does authentication work?",
  "results": [
    {
      "rank": 1,
      "score": 0.847,
      "file_path": "src/auth/middleware.py",
      "start_line": 15,
      "end_line": 48,
      "chunk_type": "function",
      "symbol_name": "verify_jwt_token",
      "language": "python",
      "content": "def verify_jwt_token(request):\n    ..."
    }
  ],
  "total_results": 7,
  "search_duration_ms": 34
}
```

Text and queries may be in any human language. One limit: languages written
without spaces between words (Chinese, Japanese, Thai) are not matched by
keyword — for such text only the vector half of the search works, so use
`--mode vector` or rely on `hybrid`.

#### Which language to write the query in

Results lean towards the language of the query. Write the query in the
language of the text you are looking for, not in the language of the
conversation.

1. Read `human_languages` in the status output before the first search.
2. One language in the index: write every query in it.
3. Several languages, and you can tell which one the wanted text is in:
   write the query in that language.
4. Several languages, and you cannot tell: put the question into one query
   in every language of the index, separated by " / ". If the first results
   do not hold what you need, search once per language instead and read the
   lists side by side.
5. Names from code stay as written in every wording.

The languages of the index are those in `human_languages.declared`. When
that list is empty, go by `scripts`: each writing system there is at least one
language, usually the one the conversation or the first results are in; and
`latin_non_english_letters` from about 0.01 up means the Latin text is not
all English. `human_languages` covers documents only — code is not counted.

What this rests on, measured on a test set of articles in three languages: a
query in the text's own language put the wanted fragment first in 49 of 54
cases, a query in another language in 90 of 108. When the text's language was
not known, the wanted fragment was among the first three read in 155 of 162
cases for one query in the conversation's language, 159 for every wording in
one query, and 160 for one search per language — three searches instead of
one.

### Status

To check index health:

```bash
<skill-path>/scripts/.venv/bin/python <skill-path>/scripts/index_status.py \
  --project-dir <project-root>
```

Output:
```json
{
  "indexed": true,
  "total_files": 222,
  "total_chunks": 1847,
  "last_indexed": "2026-03-19T14:30:00+00:00",
  "stale_files": 3,
  "embedding_model": "BAAI/bge-m3",
  "embedding_dimensions": 1024,
  "index_size_mb": 12.4,
  "languages": {"python": 120, "typescript": 80, "markdown": 22},
  "human_languages": {
    "declared": ["en", "ru"],
    "scripts": {"latin": 0.59, "cyrillic": 0.41},
    "fragments_counted": 22,
    "latin_non_english_letters": 0.0001
  }
}
```

`languages` counts fragments per programming language or file format.
`human_languages` says which human languages the indexed **documents** are
written in. It is counted over markdown, plain text, reStructuredText, DITA,
PDF, DOCX and PPTX fragments only; code and configuration are left out,
because code is Latin whatever language its authors speak.

- `scripts` — share of those fragments by writing system (`latin`,
  `cyrillic`, `greek`, ...). A fragment counts toward the writing system most
  of its letters belong to; anything under 1% is summed as `other`.
- `fragments_counted` — how many fragments the shares rest on. `0` means the
  index holds no document text, and the shares say nothing.
- `latin_non_english_letters` — share of Latin letters that are not `a`–`z`
  (`á`, `ő`, `ß`, `ø`...). English text gives about 0. From about 0.01 up,
  part of the Latin text is in another language. A low value proves nothing:
  some languages are written almost without such letters. `null` when there
  is no Latin text.
- `declared` — the languages the project owner listed in
  `indexing.human_languages`; empty when not set. When it is set, it is the
  better source: writing systems cannot tell English from Hungarian, or
  Russian from Ukrainian.

This is a count of writing systems, not language detection.

## Error Handling

All scripts use consistent exit codes:
- `0`: Success
- `1`: Configuration error (`.index/config.json` cannot be read or holds an
  invalid value)
- `2`: Runtime error (API failure, missing API key, parse error, I/O error,
  no index)

Error output (stdout, JSON):
```json
{
  "status": "error",
  "error": "No API key found. Set OPENROUTER_API_KEY environment variable or add api_key to .index/config.json",
  "error_type": "EmbeddingError"
}
```

One case prints no JSON: an option the script does not accept, or a required
one left out. The script then exits with `2` and a usage message on stderr.

## Search Strategy

When helping users explore a codebase, use a layered approach:

1. **First**: Use semantic search via this skill for conceptual queries
2. **Then**: Use Grep/Glob to narrow down or verify specific findings
3. **Finally**: Use Read to examine the actual files in detail

For example, if a user asks "how does authentication work?":
1. `semantic_search.py --query "authentication flow and user login"` → get relevant files/chunks
2. Read the top results to understand the architecture
3. Use Grep if you need to trace specific function calls

## Configuration

The index configuration lives at `.index/config.json` in the project root.
If it doesn't exist, `build_index.py` creates one from defaults on first run.

Key settings the user might want to change:
- `embedding.model`: which model to use (default: `BAAI/bge-m3`)
- `embedding.dimensions`: vector size (default: 1024)
- `embedding.max_embed_tokens`: the embedding model's context window in
  tokens; the chunker counts tokens with this model's own tokenizer
  when available (via the `tokenizers` package + Hugging Face cache)
  and refuses to send anything larger (default: 8192, the context
  window for `BAAI/bge-m3`).
- `embedding.token_safety_factor`: when the chunker falls back to
  tiktoken `cl100k_base` (because `tokenizers` is not installed or
  the model's Hugging Face repo is not reachable), the chunking
  budget is shrunk by this factor to account for the measured
  ~1.30x (median) to ~2.13x (worst case) ratio between bge-m3 and
  cl100k tokens (default: 1.6).
- `chunking.max_tokens`: maximum chunk size (default: 512)
- `chunking.overlap_tokens`: overlap between chunks (default: 50)
- `indexing.file_extensions`: which file types to index
- `indexing.exclude_patterns`: additional ignore patterns beyond .gitignore
- `indexing.max_file_size_kb`: max size for text files (default: 500)
- `indexing.max_office_file_size_kb`: max size for office files (default: 50000)
- `indexing.human_languages`: the human languages of the project's documents,
  e.g. `["en", "hu"]` (default: `[]`). It changes nothing about indexing or
  search; `index_status.py` reports it as `human_languages.declared`. Worth
  setting when the documents hold languages that share one writing system
- `search.default_top_k`: default number of results (default: 10)
- `search.default_threshold`: minimum similarity score (default: 0.3)
- `search.mode`: search mode — `vector`, `keyword`, or `hybrid` (default: `hybrid`)
- `search.hybrid_alpha`: hybrid balance 0.0–1.0 (default: 0.7)
- `search.rerank_enabled`: enable cross-encoder reranking (default: false)
- `search.rerank_model`: reranker model (default: `BAAI/bge-reranker-v2-m3`)

Environment variable overrides:
- `OPENROUTER_API_KEY` → overrides `embedding.api_key`
- `SEMANTIC_INDEX_PROVIDER` → overrides `embedding.provider`
- `SEMANTIC_INDEX_MODEL` → overrides `embedding.model`
- `SEMANTIC_INDEX_DIMENSIONS` → overrides `embedding.dimensions`
- `HF_HUB_CACHE` → HuggingFace model cache directory (default `~/.cache/huggingface/hub`)

## Troubleshooting

- **PermissionError or "No such file or directory"**: The `--project-dir`
  path is wrong. Run `pwd` to get the actual workspace root and use that
  exact path. Do not guess paths from IDE context, Machine ID, or
  environment variables — they often point to non-existent locations.
- **"No .index/ directory found" when index exists**: Same cause — the
  `--project-dir` is pointing to a different directory than where `.index/`
  lives. Verify with `ls <project-root>/.index/` before running commands.
- **"No index found"**: Run `build_index.py` first to create the `.index/` directory
- **"No API key found"**: Either set `OPENROUTER_API_KEY` env var / add to config, or switch to `"huggingface"` provider in `.index/config.json` for local embedding with no API key
- **Slow indexing**: Large projects (>1000 files) take time on first run; subsequent runs are incremental
- **Poor search results**: Try adjusting `chunking.max_tokens` (smaller = more precise, larger = more context) or switching to a code-specific embedding model
- **"Module not found" errors**: Re-run `setup.sh` to ensure venv is properly configured
- **Keyword search misses non-English text or finds callers instead of a definition**: the index was built by a version before 0.4.0. Run `build_index.py` once (no `--full` needed, nothing is re-embedded)
- **Partial index corruption**: Run `build_index.py --full` to force a complete rebuild

Начну с изучения проекта: архитектура, правила, код клиента и прокси, прошлые обсуждения.

Архитектура понятна. Теперь читаю парсеры и логику поиска — именно их придётся повторить в MCP-сервере.

Архитектура понятна. Теперь читаю парсеры и логику поиска — именно их придётся повторить в MCP-сервере.

*Files: `/Users/eobomik/src/iptv-epg-search/public/scripts/utils/m3uParser.js`*

Теперь смотрю реальные данные провайдера в `tmp/` — от них зависит, что сервер сможет отдавать модели.

**Коротко.** Проект хорошо подходит для MCP (протокола, через который чат-модель вызывает внешние инструменты). Почти всю логику кинотеатра можно взять в сервер без изменений. Разбор телепрограммы и всё, что связано со временем, придётся написать заново. Для начала советую **один локальный сервер**. Второй стоит добавлять только для «памяти вкуса» (что смотрели, что понравилось): он, в отличие от первого, записывает данные.

## Что я выяснил

**Данные провайдера** (снимок в `tmp/` от июня 2026, сейчас цифры могут быть другими):
- **Телепрограмма** [tmp/4a27b28d](tmp/4a27b28d): 321 787 передач, 1 303 канала, 10 дней, 146 МБ в распакованном виде. У передачи есть **только название и описание** (описание у 211 693). Жанра, года и рейтинга нет.
- **Плейлист каналов** [tmp/playlist.m3u](tmp/playlist.m3u): 22 группы, в группе «Кино» 160 каналов (около 28 тыс. передач за 10 дней). Группа — единственный надёжный признак того, что в эфире фильм.
  - Сайт её не читает: `parseLiveM3u` берёт только `tvg-id`, логотип, `tvg-rec` и название ([m3uParser.js:428-435](public/scripts/utils/m3uParser.js#L428-L435)).
  - Фильтр каналов угадывает категорию по словам в названии ([channelFilter.js:10-24](public/scripts/components/channelFilter.js#L10-L24)).
- **Каталог кинотеатра** [tmp/index.m3u](tmp/index.m3u): 67 088 записей. Это 6 303 фильма и 1 553 сериала (60 785 серий), 11 категорий, 27 жанров. Рейтинг есть у 61 161 записи, описание у 64 255. Откуда рейтинг, в данных не указано (шкала до 10).
- **Два атрибута, которые сайт не читает** ([m3uParser.js:123-192](public/scripts/utils/m3uParser.js#L123-L192)):
  - `censored="1"` стоит ровно у 786 записей «Эротика (18+)». Подходит, чтобы по умолчанию не показывать модели такие записи.
  - `duration` у серий, в минутах.
- **Совпадения эфира и каталога:** 1 137 названий из телепрограммы точно совпадают с названиями в каталоге. Поэтому каталог может подсказать жанр, год и рейтинг фильма в эфире, а сервер сможет ответить: «идёт в четверг в 21:00, а в кинотеатре доступен уже сейчас».
- **Личный ключ:** в адресах потоков зашит ваш ключ доступа к провайдеру. Всё, что вернёт сервер, попадёт в историю чата.

**Код:**
- **Берётся в Node.js как есть:**
  - `parseM3u`, `groupSeriesEpisodes`, `filterCinemaItems`, `sortCinemaItems`, `parseLiveM3u`. Браузер нужен только внутри `fetchM3uData` ([m3uParser.js:13-16](public/scripts/utils/m3uParser.js#L13-L16)).
  - `epgRawToEpochSeconds` ([epgParser.js:240](public/scripts/utils/epgParser.js#L240)) и `sanitizeUrl` ([sanitize.js:44](public/scripts/utils/sanitize.js#L44)).
- **Придётся писать заново:**
  - Разбор XMLTV. `parseEpgXml` использует `DOMParser` ([epgParser.js:67](public/scripts/utils/epgParser.js#L67)), которого нет в Node, а строить дерево из 146 МБ слишком тяжело. Нужен разбор по ходу чтения файла.
  - Работу со временем. `filterByTime` и `filterUniqueByClosestTime` используют `program.start`, где часовой пояс потерян ([search.js:48-57](public/scripts/utils/search.js#L48-L57), [search.js:98-128](public/scripts/utils/search.js#L98-L128)). На сервере время считается только через `startRaw`.
  - Нечёткий поиск переносится с оговоркой: `fuzzySearch.js` ждёт глобальные `Fuse` и `snowballFactory` ([fuzzySearch.js:71](public/scripts/utils/fuzzySearch.js#L71), [fuzzySearch.js:141](public/scripts/utils/fuzzySearch.js#L141)). В Node их нужно подключить отдельно, сами библиотеки те же.
- **Ссылка Catch-up:** правило, когда её показывать, и сборка ссылки уже есть в [results.js:268-297](public/scripts/components/results.js#L268-L297). Сервер должен повторить их точно.
- **Оценки на сайте** привязаны к конкретному показу (`название|канал|время`, [ratings.js:14-25](public/scripts/utils/ratings.js#L14-L25)) и хранятся в браузере. Для «вкуса» от них мало пользы.

**Что сейчас умеет MCP** (по context7 и support.claude.com):
- **Библиотека:** официальная `@modelcontextprotocol/server` v2, стабильная с 27.07.2026. Нужна Node ≥ 20, у вас v24.17.0. Писать можно на обычном JavaScript.
- **Локальный сервер** (приложение само запускает его на Mac) работает в Claude Desktop и Claude Code.
- **Сервер в интернете** работает в claude.ai, Desktop и на телефоне. Но Claude подключается к нему **из облака Anthropic**, поэтому сервер должен быть доступен из интернета.
- **MCP Apps** — расширение, которое показывает в чате свою страницу, например карточки с постерами. Поддерживается в claude.ai, VS Code Insiders и Goose. Его примеры написаны для старой библиотеки v1, совместимость с v2 нужно проверить.

## Инструменты для модели

Повторять интерфейс сайта один в один не нужно: модель сама превращает «что-нибудь лёгкое, не старше 2015» в фильтры. Списки должны быть короткими: id, название, год, рейтинг, жанры и 1–2 предложения описания. Подробности модель запрашивает отдельно, иначе 100 полных описаний займут бо́льшую часть того, что модель может держать в памяти за раз.

| Инструмент | Что делает | Откуда логика |
|---|---|---|
| `cinema_facets` | категории, жанры, годы, количество записей | `parseM3u` |
| `cinema_search` | фильтры как на сайте, плюс фильм/сериал, страна, режиссёр, «без 18+» | `filterCinemaItems` / `sortCinemaItems` |
| `cinema_details`, `cinema_episodes` | описание, постер, ссылка на просмотр, сезоны и серии | `groupSeriesEpisodes` |
| `tv_search` | нечёткий поиск по программе; время (сейчас, вечер, интервал, архив), группы каналов, только HD, без повторов | Fuse+Snowball; время пишется заново |
| `tv_now` | что идёт сейчас и что дальше | новое |
| `tv_program_details` | описание и ссылки Watch Live / Catch-up | правило из `results.js` |
| `where_to_watch` | по названию: есть ли в кинотеатре, когда в эфире, есть ли в архиве | новое, на сайте такого нет |

## Варианты

**1. Где работает сервер**
- **A. Локально на Mac.** Работает в Desktop и Code. Вся телепрограмма в памяти, вход не нужен. Может одной командой открыть поток в VLC или IINA. Сделать просто.
- **B. В интернете, на Vercel рядом с `api/proxy.js`.** Работает в claude.ai и на телефоне. Минусы:
  - каждый новый экземпляр функции заново скачивает и разбирает 146 МБ; лимиты Vercel я не проверял;
  - скорее всего, понадобятся предварительная обработка данных по расписанию и отдельное хранилище;
  - обязателен вход (OAuth, стандартный вход с выдачей разрешения), иначе ваши ключи окажутся в открытом доступе.
- **C. Один код с двумя способами подключения:** сейчас A, B потом. Для телефона есть промежуточный путь: локальный сервер плюс туннель (Cloudflare Tunnel, Tailscale Funnel), но тогда Mac должен быть включён.

**2. Один или два сервера**
- **Один** (телевидение и кинотеатр, около 9 инструментов). Самый простой, и `where_to_watch` в нём на своём месте. **Советую начать с него.**
- **Два по источнику** (телепрограмма отдельно, кинотеатр отдельно). Настройку придётся повторять, а «где посмотреть» не относится ни к одному из них.
- **Два по роли:** «каталог» только читает данные провайдера, «мой вкус» хранит в файле список «хочу посмотреть», просмотренное и оценки. Если делать два сервера, то так: сервер каталога можно спокойно выставить в интернет, а записывающий остаётся отдельно.

**3. Насколько умным делать поиск**
1. **Фильтры и нечёткий поиск, как на сайте.** Основную работу делает модель, добавляя собственное знание фильмов. Но запрос «фильм про одиночество в космосе» не сработает, если этих слов нет в описании.
2. **Смысловой поиск.** Каждый текст превращается в набор чисел (embeddings), и тексты, близкие по смыслу, находятся даже без общих слов.
   - Кинотеатр — около 7,9 тыс. карточек: посчитать один раз, потом досчитывать только новые.
   - Телепрограмма — 60 447 уникальных пар «название + описание» за 10 дней; разумно ограничиться группами «Кино» и «Познавательные».
   - Модель для этого — `BAAI/bge-m3` через OpenRouter, та же, что в `.index/config.json`, или локальная без ключа.
3. **Внешние рейтинги и карточки с постерами** через MCP Apps. Рейтинги не обязательны: в claude.ai модель сама ищет отзывы в интернете.

## Что советую
1. **Этап 1:** один локальный сервер в папке `mcp/` этого репозитория, на JavaScript, с функциями из `public/scripts/utils/`. Инструменты из таблицы, поиск уровня 1, «без 18+» по умолчанию, время в вашем часовом поясе.
2. **Этап 2:** смысловой поиск по кинотеатру.
3. **Этап 3, по необходимости:** доступ из claude.ai и с телефона, второй сервер «мой вкус».

**Это меняет правила проекта, нужно ваше согласие:**
- В `package.json` появятся первые зависимости npm (MCP, `zod`, разбор XML по ходу чтения).
- Адреса провайдера переедут в локальный файл настроек вне git. Сейчас CLAUDE.md говорит, что настроек окружения нет.
- Нужны новый `AI_MCP.md`, раздел в `ARCHITECTURE.md` и `mcp/` в `.vercelignore`.
- В ссылке Catch-up параметр `lutc` равен моменту, когда ссылка создана. Работа такой ссылки проверена только сразу после создания (план §5); если открыть её через несколько часов, поведение не проверено.

## Что нужно решить
1. Где вы общаетесь с моделью: Claude Desktop/Code на Mac, claude.ai, телефон или другой клиент?
2. Один сервер или сразу два (каталог и «мой вкус»)?
3. Нужен ли смысловой поиск на первом этапе, и можно ли использовать ключ OpenRouter?
4. Нужна ли команда «открой в плеере» на Mac?

После ваших ответов подготовлю подробный план: файлы, параметры инструментов, проверки на данных из `tmp/`. Код без вашего подтверждения писать не начну. Если план удобнее читать страницей, могу оформить его так.

---

👤 **USER:**
> я бы подумал о возможности задания рабочей директории для MCP и хранить там данные в базе данных с возможностью embeddings

Проверю по context7 варианты хранилища с векторным поиском для Node.js и то, как MCP-сервер может получить рабочую папку.

**Коротко.** Идея хорошая и меняет устройство сервера к лучшему:
- данные провайдера скачиваются и разбираются заранее, а не при каждом запуске;
- векторы для смыслового поиска (embeddings) считаются один раз, потом только для новых текстов;
- появляется место для «моего вкуса»: что хотите посмотреть, что уже смотрели, оценки.

Советую SQLite с расширением `sqlite-vec`, разложенное на три файла в рабочей папке. Есть важное следствие: база в локальной папке означает, что сервер работает там же, где папка, то есть на Mac. Вариант с Vercel тогда отпадает: у функций Vercel нет постоянного диска. Для claude.ai и телефона остаётся Mac плюс туннель.

## Как задать рабочую папку

Папку передаём через аргумент `--data-dir` или переменную `IPTV_MCP_HOME` в настройках чат-клиента. Например, для Claude Desktop:

```json
"mcpServers": {
  "iptv": {
    "command": "node",
    "args": ["/Users/eobomik/src/iptv-epg-search/mcp/server.js", "--data-dir", "/Users/eobomik/IPTV"],
    "env": { "OPENROUTER_API_KEY": "…" }
  }
}
```

- **Если папка не указана**, сервер берёт `~/.iptv-mcp`. Лучше держать её вне репозитория: там личные ключи провайдера и сотни мегабайт данных.
- **Механизм roots в MCP** (клиент сам сообщает серверу, какие папки ему доступны) для этого не подходит. Он задуман для файлов проекта, и решает здесь клиент, а не вы.
- **Если серверов будет два** (каталог и «мой вкус»), они могут указывать на одну папку.

## Что лежит в папке

```
<data-dir>/
  config.json       адреса EPG и плейлистов, часовой пояс, настройки поиска
  raw/              последние скачанные файлы + дата и контрольная сумма
  catalog.sqlite    каналы, передачи, фильмы, сериалы, серии, полнотекстовый индекс
  vectors.sqlite    векторы описаний, ключ — хеш текста + название модели
  personal.sqlite   «хочу посмотреть», просмотренное, оценки, заметки
  logs/
```

Файлов три, потому что у данных разная ценность:
- **catalog.sqlite** можно удалить и пересобрать из `raw/` за минуты;
- **vectors.sqlite** пересчитывать долго и, если через OpenRouter, платно;
- **personal.sqlite** не восстановить вообще, его стоит копировать.

SQLite умеет работать с несколькими файлами в одном запросе (`ATTACH`), так что разделение ничего не усложняет.

## Какую базу взять

| | 1. SQLite + `sqlite-vec` (советую) | 2. LanceDB | 3. Обе |
|---|---|---|---|
| Что это | SQLite встроен в Node; `sqlite-vec` — небольшое расширение для векторов | база для векторного поиска; вы уже пользуетесь ей в semantic-index (`.index/lancedb`) | SQLite для данных, LanceDB для поиска |
| Фильтры (время, канал, жанр, год, 18+) | обычный SQL | есть, но связанные данные (сериал → серии, ваши списки) хранить неудобно | SQL |
| Поиск по словам с учётом русских словоформ | FTS5 не знает русский язык, поэтому храним текст, уже приведённый к основе через Snowball (тот же, что на сайте) | встроен, русский поддерживается | LanceDB |
| Поиск по смыслу | сравнение с векторами отобранных строк | встроен, вместе с поиском по словам и фильтром | LanceDB |
| На диске | один файл на каждую часть | папка с файлами | обе |
| Код поиска | объединение двух списков результатов пишем сами | меньше своего кода | больше всего |

Почему советую первый вариант. В вашей Node 24.17 встроенный `node:sqlite` работает без предупреждений: SQLite 3.53.0, FTS5 включён, загрузка расширений разрешена (проверил). Расширение `sqlite-vec` официально поддерживает `node:sqlite` начиная с Node 23.5, и это единственная внешняя зависимость для хранения. Сравнение с векторами идёт перебором всех строк, без особого индекса. Но при наших объёмах и фильтрах, которые заранее оставляют несколько тысяч строк, это мгновенно.

## Как будет работать поиск
1. SQL отбирает подходящие строки по времени (через `startRaw`, с учётом часового пояса), группе каналов, жанрам, году, рейтингу и `censored = 0`.
2. Среди них поиск по словам находит совпадения с учётом словоформ.
3. Среди тех же строк поиск по смыслу находит близкие описания.
4. Два списка сливаются с весами, как в вашем semantic-index.

Если векторы ещё не посчитаны, поиск работает только по словам, ничего не ломается.

## Векторы: что и сколько

Посчитано по снимку в `tmp/`:

- **Повторы:** 321 787 передач дают всего 60 447 уникальных пар «название + описание». Поэтому ключ вектора — хеш текста: при ежедневном обновлении считаются только новые тексты.
- **Кинотеатр:** около 7,9 тыс. карточек (6 303 фильма и 1 553 сериала). Для каждой берём название, год, жанры, страну, режиссёра и описание.
- **Телепрограмма по группам каналов:**

  | Группы | Уникальных текстов |
  |---|---|
  | «Кино» | 6 221 |
  | «Кино» + «Познавательные» | 11 392 |
  | все | 60 447 |

- **Размер** для `bge-m3` (1 024 числа, около 4 КБ на текст): кинотеатр плюс «Кино» и «Познавательные» — около 19 тыс. векторов, примерно 80 МБ; всё целиком — около 280 МБ. Сжатие поддерживается и экономит в 4 или 32 раза ценой точности.
- **Передачи без описания:** у 10 035 передач на каналах «Кино» описания нет. Для них поиск по смыслу бесполезен, но совпадение названия с каталогом даёт описание, жанры и рейтинг.
- **Модель:**
  - `BAAI/bge-m3` через OpenRouter, как в `.index/config.json`: хорошо понимает русский, но нужны ключ и интернет;
  - локальная модель без ключа: работает медленнее, конкретную выберу и проверю при планировании.

  Название модели входит в ключ вектора, потому что при её смене всё придётся пересчитать.

## Обновление данных
- **Как запускается:**
  - отдельной командой `node mcp/cli.js refresh`, которую можно поставить в расписание macOS (launchd);
  - инструментом `refresh_data` из чата;
  - автоматически при старте, если данные старше N часов.
- **Шаги:** скачать файлы → сравнить контрольную сумму → обновить записи → удалить передачи старше окна архива (`tvg-rec` = 7 дней) → досчитать векторы для новых текстов.
- **Чего нет на сайте:**
  - дата, когда фильм впервые появился у вас в базе, и пометка, что он пропал из каталога;
  - «что нового за неделю» без опоры на поле `added` провайдера;
  - поиск по уже прошедшим передачам в пределах архива.

## Что это меняет в правилах проекта
- **База данных.** `ARCHITECTURE.md` §8.5 п. 4 («только localStorage, без базы») и CLAUDE.md («No database») прямо запрещают базу. Сайт остаётся как есть, база появляется только у MCP-сервера. Это нужно записать в документацию, и мне нужно ваше явное «да» на это отступление.
- **Зависимости:** `@modelcontextprotocol/server`, `zod`, `sqlite-vec` и разбор XML по ходу чтения. Требование к Node — не ниже 23.5.
- **Ключ OpenRouter** хранится в переменной окружения в настройках клиента, не в репозитории и не в `config.json`.

## Что нужно решить
1. Подходит ли папка по умолчанию `~/.iptv-mcp`, или у вас есть своё место?
2. SQLite + `sqlite-vec` или LanceDB?
3. Векторы через OpenRouter или локальной моделью?
4. Какие группы каналов включать в смысловой поиск: только «Кино», «Кино» + «Познавательные» или все?
5. Остаются открытыми вопросы из прошлого ответа: в каком клиенте вы общаетесь с моделью, один сервер или два, нужна ли команда «открой в плеере».

После ответов могу записать всё это планом в `docs/design/mcp-server-plan.md`, как оформлен план Live TV: схема таблиц, параметры инструментов, этапы и проверки на данных из `tmp/`. Файл создам только с вашего согласия.

---

👤 **USER:**
> Где вы общаетесь с моделью: Claude Desktop/Code на Mac, claude.ai, телефон или другой клиент? - Sqowe Pilot  из ~/src/open-cowork
Один сервер или сразу два (каталог и «мой вкус»)?  Я думал о двух. Один для цифрового ТВ и второй для кинотеатра. В нашем случае TV Guide and Cinema
Нужен ли смысловой поиск на первом этапе, и можно ли использовать ключ OpenRouter? rk.x vj;yj bcgjkmpjdfnm
Нужна ли команда «открой в плеере» на Mac? - нет

Вариант с Vercel тогда отпадает - и это правильно. MCP server это отдельный продукт. Мы просто тут разговариваем. 

1. Да 
2. SQLite
3. Openrouter
4. В теории все. Но.вопрос интересный. Поиск ведь должен это разделять. Например: найди мне соренования по биотлону в Шведции. или - французские фильмы

Наверно еще надо поговорить о том какие параметры должны быть для конфигурирования и какие tools

Сначала посмотрю, как Sqowe Pilot подключает MCP-серверы, чтобы параметры настройки сразу подходили под него. Параллельно проверю на данных ваши примеры («биатлон в Швеции», «французские фильмы»).

Принято:
- серверов два, TV Guide и Cinema, и это отдельный продукт;
- клиент — Sqowe Pilot;
- хранилище — SQLite с `sqlite-vec`, векторы считаются через OpenRouter;
- команды «открыть в плеере» не будет.

Ниже: что из устройства Sqowe Pilot влияет на сервер, как поиск будет различать смысл запроса, затем параметры настройки и инструменты.

## Что важно в Sqowe Pilot

Это я прочитал в `~/src/open-cowork`:
- **Подключение.** Сервер запускается как локальная программа. Pilot передаёт ему команду, аргументы, переменные окружения и рабочую папку процесса ([mcp-manager.ts:898-903](../open-cowork/src/main/mcp/mcp-manager.ts#L898-L903)). Так же передаются `--data-dir` и ключ OpenRouter.
- **Имена инструментов.** Pilot добавляет к имени инструмента имя сервера: `mcp__TV_Guide__search_programs` ([mcp-manager.ts:1435-1436](../open-cowork/src/main/mcp/mcp-manager.ts#L1435-L1436)). Имена двух серверов не пересекутся.
- **Подтверждения.** При политике `allow-reads` Pilot без вопросов разрешает инструменты, в имени которых есть глагол чтения (`get`, `list`, `search`, `find`…). Глаголы `update`, `set`, `start`, `run` всегда требуют подтверждения ([mcp-tool-classification.ts:59-126](../open-cowork/src/shared/mcp-tool-classification.ts#L59-L126)). Пометка сервера `readOnlyHint` может только запретить, но не разрешить. Отсюда правило:
  - всё, что только читает, начинается с `search_`, `get_`, `list_` или `find_`;
  - обновление данных называется `refresh_…`, и на него Pilot будет спрашивать подтверждение. Так и должно быть.
- **Время ожидания ответа инструмента** — 240 секунд по умолчанию ([config-store.ts:685](../open-cowork/src/main/config/config-store.ts#L685)). Скачать 146 МБ и посчитать векторы за это время не получится. Поэтому обновление всегда идёт в фоне, а инструмент только запускает его.
- **Как модель выбирает сервер.** Я не нашёл, чтобы Pilot читал поле `instructions` сервера. Когда обращаться к серверу, модель узнаёт из поля «Description» в настройках Pilot, поэтому всё нужное для выбора должно быть в описаниях самих инструментов.
- **Размер описаний.** Pilot работает с разными моделями, а описания инструментов занимают место в контексте модели. Поэтому инструментов немного, а параметры простые: строка, число, да/нет, список строк, выбор из перечня.

## Как поиск различает смысл запроса

Ваши примеры показывают главное: «в Швеции» и «французские» — это разные вопросы, и в данных ответы лежат в разных местах.

| Что имеют в виду | Пример | Где это в данных | Сервер |
|---|---|---|---|
| страна производства | «французские фильмы» | Cinema: атрибут `country`; TV: конец описания фильма | оба |
| место события | «биатлон в Швеции» | название: «…Трансляция из Мексики» | TV |
| участник | «матч сборной Швеции» | название: «Швеция – Тунис» | TV |
| страна канала | «что идёт на немецких каналах» | группа канала: Deutschland, UK, Baltic… | TV |
| тип передачи | «соревнования», «мультики» | пометка в названии и тема канала | TV |

Биатлона в июньском снимке нет, тогда не сезон. Но то же устройство видно на футболе. В названии «ЧМ-2026. Швеция – Тунис. Трансляция из Мексики» Швеция — участник, а место проведения — Мексика.

Что нашлось в [tmp/4a27b28d](tmp/4a27b28d), [tmp/playlist.m3u](tmp/playlist.m3u) и [tmp/index.m3u](tmp/index.m3u):
- **Тип передачи указан в названии.** Пометок «х/ф» 8 455, «т/с» 6 859, «м/ф» 6 025, «м/с» 5 648, «д/с» 2 700, «д/ф» 2 011. Ещё 1 107 названий начинаются со знака «⋗»; похоже на пометку прямой трансляции, но это надо уточнить.
- **Описание фильма в телепрограмме заканчивается данными о нём**, например: «Реж.: … В ролях: … Россия, 2024, драма, комедия». Режиссёр и год есть у 5 244 из 7 358 фильмов с описанием. Значит, при загрузке можно извлечь страну, год, жанры и режиссёра, и «французские фильмы по ТВ» станут обычным фильтром.
- **Страны в каталоге записаны вперемешку**, всего 143 разных значения. Например, «United States of America» 16 143, «США» 2 243, «USA» 185; «France» 1 859 и «Франция» 89. Нужен словарь, который сводит всё к кодам стран, тогда модель может писать страну на любом языке.
- **Группы каналов смешивают тему и страну:**
  - «Кино» и «Спорт» — это темы, «Deutschland» и «Baltic» — страны;
  - «Россия +2ч/+4ч/+7ч» — те же каналы со сдвигом по времени («Первый канал (+2)»), их передачи по умолчанию скрываем как повторы;
  - в «Ultra HD» есть и кино, и спорт (Eleven Sports 4K).

Поэтому при загрузке каждая передача получает отдельные поля, и в инструменте каждому полю соответствует свой параметр:
- **`kind`** — фильм, сериал, мультфильм, документальное, спорт, новости, детское, музыка, другое. Источники проверяются по порядку: пометка в названии, затем шаблоны вроде «Футбол.», затем тема канала. Если ничего не подошло, вектор передачи сравнивается с векторами этих понятий.
- **`production_countries`, `year`, `genres`, `director`, `cast`** — из конца описания.
- **`venue`** — из «Трансляция из …».
- **`channel_theme`, `channel_region`, `timeshift_hours`** — из группы канала.

Какой смысл имел в виду человек, решает модель, и она же заполняет нужные параметры. Например, «биатлон в Швеции» превращается в `kinds=[sport]`, `query="биатлон"`, `keywords=["Эстерсунд","Швеция"]`: модель сама знает, где проходят этапы. Такие примеры я пропишу прямо в описаниях инструментов.

## Параметры настройки

Если параметр задан в нескольких местах, побеждает аргумент запуска, затем переменная окружения, затем `config.json` в рабочей папке, затем значение по умолчанию. В Pilot задаются только запуск, `--data-dir` и ключ:
- **Command:** `node`, **Args:** `<путь>/tv-guide/server.js --data-dir ~/.iptv-mcp/tv-guide`
- **Env:** `OPENROUTER_API_KEY=…`
- **Политика инструментов:** `allow-reads`

**Общие для обоих серверов**

| Параметр | По умолчанию | Зачем |
|---|---|---|
| `--data-dir` / `IPTV_MCP_HOME` | `~/.iptv-mcp/tv-guide` и `~/.iptv-mcp/cinema` | рабочая папка: база, скачанные файлы, журнал |
| `timezone` | часовой пояс системы | в каком поясе понимать и показывать время |
| `refresh.every_hours` | TV — 12, Cinema — 24 | как часто обновлять данные |
| `refresh.on_start` | да, в фоне | обновлять ли при запуске, если данные устарели |
| `adult.include` | нет | показывать ли 18+ |
| `search.default_limit` / `max_limit` | 20 / 50 | сколько результатов отдавать модели |
| `search.snippet_chars` | 200 | длина отрывка описания в списках |
| `search.meaning_weight` | 0.7 | вес поиска по смыслу относительно поиска по словам |
| `embeddings.enabled` | да | если выключить, останется только поиск по словам |
| `embeddings.model` | `BAAI/bge-m3` | модель OpenRouter для векторов |
| `embeddings.api_key_env` | `OPENROUTER_API_KEY` | из какой переменной окружения брать ключ |
| `embeddings.batch_size` | 50 | сколько текстов отправлять за один запрос |
| `log_level` | `info` | подробность журнала |

**Только TV Guide**

| Параметр | По умолчанию | Зачем |
|---|---|---|
| `sources.epg_url` | обязателен | телепрограмма XMLTV (.gz) |
| `sources.live_playlist_url` | по сути обязателен | даёт ссылки Watch Live / Catch-up **и** группы каналов; без него не будет тем и стран каналов |
| `retention.past_days` | = `tvg-rec` (7) | сколько дней хранить прошедшие передачи |
| `channels.exclude_groups` | `["XXX (18+)"]` | какие группы не загружать |
| `channels.timeshift_groups` | группы с «+Nч» в имени | какие группы считать повторами |
| `channels.group_map` | встроенный словарь | группа → тема или страна (Deutschland → DE, Спорт → sport) |
| `embeddings.groups` | все (около 60 тыс. текстов, около 250 МБ) | для каких групп считать векторы |
| `embeddings.min_text_chars` | 40 | для более коротких текстов — только поиск по словам |

**Только Cinema**

| Параметр | По умолчанию | Зачем |
|---|---|---|
| `sources.catalog_url` | обязателен | M3U-файл каталога |
| `catalog.exclude_categories` | пусто (18+ отсекается по атрибуту `censored`) | какие категории не загружать |
| `catalog.country_aliases` | встроенный словарь | дополнения к словарю стран |
| `catalog.track_changes` | да | запоминать, когда фильм появился в каталоге и когда пропал |

В адресах провайдера зашит ваш личный ключ доступа. Поэтому `config.json` создаётся с доступом только для владельца, а ключ OpenRouter хранится только в настройках Pilot.

## Инструменты

Общие правила:
- **Списки короткие**, подробности приходят отдельным вызовом. Ссылки на просмотр есть только в подробностях (`get_program`, `get_title`, `list_episodes`): так списки меньше, а ключ провайдера реже попадает в чат.
- **Допустимые значения фильтров** (темы, жанры, страны) модель берёт из `list_channels` и `list_facets`.
- **Время** на входе — дата в формате ISO или готовый период. На выходе — время в вашем поясе со смещением. Прошла передача, идёт или ещё впереди, сервер считает по `startRaw`.
- **Ошибки** — понятным текстом, по которому модель может исправить запрос. Например: «жанра "фантастика" нет, есть: Фантастика, …» или «данные загружаются, будут готовы примерно через 3 мин».
- **Длинные списки** продолжаются через параметр `cursor`, который приходит в предыдущем ответе.

**TV Guide — 8 инструментов**

| Инструмент | Главные параметры | Что возвращает |
|---|---|---|
| `search_programs` | `query`, `keywords`, `kinds`, `period` (now / tonight / today / tomorrow / next_7d / past_7d) или `from`/`to`, `channel_themes`, `channel_regions`, `channels`, `production_countries`, `year_from`/`year_to`, `person`, `only_catchup`, `hide_repeats` (да), `prefer_hd` (да), `limit`, `cursor` | id, название, тип, канал, начало и конец, статус, год, страны, отрывок, есть ли эфир и архив |
| `get_program` | `program_id` | полное описание, режиссёр, актёры, другие показы того же названия, ссылки Watch Live / Catch-up (собираются в момент вызова) |
| `get_now_and_next` | `channel_themes`, `channel_regions`, `channels` | что идёт сейчас и что будет следом |
| `get_channel_schedule` | `channel`, `date` или `from`/`to` | программа одного канала |
| `find_airings` | `title`, `year` | все показы этого названия, впереди и в архиве («когда покажут…») |
| `list_channels` | `theme`, `region`, `query` | темы и страны с количеством каналов, сами каналы, есть ли эфир, сколько дней архива |
| `get_status` | — | за какой период данные, сколько записей, сколько векторов готово, последняя ошибка |
| `refresh_guide` | `force` | запускает обновление в фоне; Pilot спросит подтверждение |

**Cinema — 7 инструментов**

| Инструмент | Главные параметры | Что возвращает |
|---|---|---|
| `search_titles` | `query`, `keywords`, `type` (film / series / any), `categories`, `genres`, `exclude_genres`, `countries`, `year_from`/`year_to`, `min_rating`, `person`, `max_minutes`, `added_since`, `sort` (relevance / rating / year / added / title), `limit`, `cursor` | id, тип, название, год, рейтинг, жанры, страны, отрывок, число сезонов и серий |
| `get_title` | `title_id` | полное описание, постер, режиссёр, длительность; для фильма — ссылка на просмотр, для сериала — список сезонов |
| `list_episodes` | `title_id`, `season` | серии сезона со ссылками |
| `find_similar_titles` | `title_id` или `description`, плюс те же фильтры | ближайшие по смыслу («что-то похожее на…») |
| `list_facets` | — | категории, жанры и страны с количеством, диапазон лет и рейтингов |
| `get_status` | — | то же, что у TV Guide |
| `refresh_catalog` | `force` | то же, что у TV Guide |

Отдельный инструмент «что нового» не нужен: это `search_titles` с `added_since` и сортировкой `added`.

## Что осталось решить
1. **Где будет новый репозиторий и как он называется** (например, `~/src/iptv-mcp`)? План реализации и образцы `config.json` я запишу туда, а не в этот проект.
2. **На чём писать:** на обычном JavaScript, как сайт, или на TypeScript, как Sqowe Pilot? У серверов много общего: разбор M3U, SQLite с векторами, OpenRouter, поиск с учётом словоформ, загрузка настроек. Поэтому предлагаю один репозиторий с общей частью и двумя серверами.
3. **С какого сервера начать?** Я бы начал с Cinema: там проще данные, больше сведений о фильмах, около 8 тыс. векторов, и результат будет быстро. TV Guide сложнее: разбор XML по ходу чтения, часовые пояса, определение типа передачи.
4. **«Мой вкус»** (хочу посмотреть, уже смотрел, оценки) сейчас не входит ни в один сервер. Отложить или добавить в Cinema таблицу «хочу посмотреть»?
5. **Что убрать или добавить** в списке инструментов и параметров?

Код и файлы не создаю, пока вы не скажете.

---

👤 **USER:**
> для универсальности нужно что-юы параметры 
EPG URL, Cinema M3U URL и возможно  Live TV M3U URL задавались как в Settings web приложения

Сначала посмотрю, как именно устроены эти поля в Settings сайта: подписи, проверки, обязательность. Так серверы смогут повторить их точно.

Сначала посмотрю, как именно устроены эти поля в Settings сайта: подписи, проверки, обязательность. Так серверы смогут повторить их точно.

Да, так и сделаем. В серверах будут те же три поля, что в Settings сайта, с такими же названиями и проверками. Я предлагаю один общий файл настроек на оба сервера, по аналогии с одной панелью Settings. Задать адреса можно в нём, в Pilot или из чата. Но для универсальности одних адресов мало: часть правил я раньше вывел из данных именно вашего провайдера, их нужно сделать необязательными.

## Как эти поля устроены на сайте

| Поле | Подпись на сайте | Обязательно | Для чего |
|---|---|---|---|
| EPG URL | «EPG URL *», «gzipped EPG XML file. Required for TV Guide tab.» ([index.html:72-82](public/index.html#L72-L82)) | помечено звёздочкой | телепрограмма; файл обязан быть сжат gzip, сайт всегда его распаковывает ([epgParser.js:39](public/scripts/utils/epgParser.js#L39)) |
| Cinema M3U URL | «Used in the Cinema tab.» ([index.html:87-97](public/index.html#L87-L97)) | нет | каталог кинотеатра |
| Live TV M3U URL | «Used by the TV Guide "Watch Live" button.» ([index.html:102-112](public/index.html#L102-L112)) | нет | кнопки Watch Live и Catch-up |

Проверки при сохранении ([settings.js:219-265](public/scripts/components/settings.js#L219-L265)):
- пробелы по краям убираются;
- нужен хотя бы один из двух адресов: EPG или Cinema;
- каждый заполненный адрес должен быть правильным и начинаться с `http://` или `https://`.

Есть одна странность, которую повторять не стоит. Если очистить поле EPG и сохранить, старый адрес остаётся ([settings.js:268](public/scripts/components/settings.js#L268)). Два других поля при этом очищаются ([settings.js:271-274](public/scripts/components/settings.js#L271-L274)).

## Где задавать адреса

**Один файл `~/.iptv-mcp/settings.json` для обоих серверов.** Названия полей те же, что на сайте:

```json
{
  "epgUrl": "http://…/epg.xml.gz",
  "cinemaUrl": "http://…/cinema/index.m3u",
  "liveUrl": "http://…/live.m3u8"
}
```

- Оба сервера запускаются с `--data-dir ~/.iptv-mcp`.
- TV Guide берёт `epgUrl` и `liveUrl`, Cinema берёт `cinemaUrl`.
- Каждый сервер хранит свою базу в своей подпапке: `tv-guide/` и `cinema/`.
- Это заменяет раздел `sources.*` из прошлого ответа.

Заполнить адреса можно тремя способами, результат одинаковый:

| Способ | Как это выглядит | Когда удобно |
|---|---|---|
| 1. Файл `settings.json` | правится вручную | основной способ: одно место для обоих серверов |
| 2. Переменные окружения в Pilot: `EPG_URL`, `CINEMA_M3U_URL`, `LIVE_TV_M3U_URL` | поле Environment variables в настройках сервера; если они заданы, файл не учитывается | при первом подключении |
| 3. Из чата: `get_settings` и `update_settings` | «поменяй адрес кинотеатра на …» | быстро, но адрес с личным ключом попадёт в историю чата |

Можно сделать, чтобы второй способ выглядел точно как Settings сайта. Для этого надо добавить оба сервера в список готовых серверов Pilot (`MCP_SERVER_PRESETS` в [mcp-config-store.ts:13](../open-cowork/src/main/mcp/mcp-config-store.ts#L13)). Тогда Pilot покажет форму с подписью у каждого поля ([SettingsConnectors.tsx:298-301](../open-cowork/src/renderer/components/settings/SettingsConnectors.tsx#L298-L301)). Это изменение в самом Pilot.

`get_settings` показывает адреса, скрывая их середину, где обычно зашит ключ. На `update_settings` Pilot всегда спросит подтверждение: `update` есть в его списке глаголов, которые меняют данные.

## Проверки адресов: как на сайте, но строже
- **Как на сайте:** обрезать пробелы, проверить, что адрес правильный и начинается с `http://` или `https://`. Пустое поле очищает значение, в том числе для EPG.
- **Обязательность у каждого сервера своя**, вместо правила «хотя бы один из двух». TV Guide нужен `epgUrl`, Cinema нужен `cinemaUrl`. Если адреса нет, сервер всё равно запускается, а инструменты отвечают: «Не задан EPG URL — укажите его в settings.json или в Pilot».
- **Проверка содержимого** при сохранении и обновлении. EPG принимается и сжатым gzip, и обычным XML с `<tv>`; сайт принимает только сжатый. M3U должен начинаться с `#EXTM3U`, как сайт и проверяет ([m3uParser.js:33](public/scripts/utils/m3uParser.js#L33)).
- **Смена адреса.** Данные этого источника перезагружаются в фоне. Векторы сохраняются: их ключ — хеш текста, поэтому повторно они не пересчитываются.

## Что ещё нужно для универсальности

| Правило | Откуда я его взял | Как сделать универсальным |
|---|---|---|
| Адрес EPG можно взять из плейлиста | в первой строке [tmp/playlist.m3u](tmp/playlist.m3u) есть `url-tvg` и `x-tvg-url`; сайт эту строку пропускает ([m3uParser.js:426](public/scripts/utils/m3uParser.js#L426)) | если `epgUrl` пуст, брать адрес оттуда; тогда хватит одного Live TV M3U URL |
| Ссылка Catch-up `?utc=…&lutc=…` | в плейлисте указан `catchup-type="shift"`; у сайта этот формат записан в коде жёстко ([results.js:285-287](public/scripts/components/results.js#L285-L287)) | читать `catchup-type` и строить ссылку только для проверенного `shift`; для других типов ссылки на архив нет, пока их не проверим |
| Пометки «х/ф», «т/с» и конец описания «Реж.: … Страна, год» | телепрограмма вашего провайдера | если их нет, тип передачи определяется по группе канала или по смыслу, а фильтры по стране и году для ТВ просто недоступны |
| Названия групп («Кино», «Спорт», «Deutschland») | ваш плейлист | встроенный словарь известных названий, затем сравнение названия группы с темами по смыслу; плюс `groupMap` в `settings.json` для ручных поправок |
| Атрибуты каталога (`genres`, `rating`, `year`, `country`, `director`, `added`, `censored`) | расширенный M3U вашего кинотеатра | если атрибута нет, фильтр по нему не предлагается; `list_facets` показывает только то, что есть в данных |
| Сжатие EPG | у вас gzip | определять по первым байтам файла |

## Остальные настройки сайта

| На сайте | В серверах |
|---|---|
| Нечёткий поиск и его порог ([index.html:117-138](public/index.html#L117-L138)) | порог нечёткого поиска в `settings.json`; поиск по смыслу закрывает большую часть случаев |
| Поиск только по Enter | не нужен: поля ввода нет |
| Управление оценками | пока нет, это часть «моего вкуса» |

Остальные параметры из прошлого ответа (часовой пояс, обновление, 18+, лимиты, векторы) тоже переезжают в этот файл. Имена пишутся в том же стиле, что поля сайта:

```json
{
  "epgUrl": "", "cinemaUrl": "", "liveUrl": "",
  "timezone": "auto",
  "includeAdult": false,
  "embeddings": { "enabled": true, "model": "BAAI/bge-m3", "apiKeyEnv": "OPENROUTER_API_KEY" },
  "tvGuide": { "refreshHours": 12, "pastDays": 7, "excludeGroups": ["XXX (18+)"], "groupMap": {} },
  "cinema": { "refreshHours": 24, "trackChanges": true }
}
```

## Что решить
1. Один общий `settings.json` на оба сервера подходит, или каждому серверу нужен свой?
2. Нужен ли `update_settings` из чата, или достаточно файла и Pilot?
3. Добавлять ли оба сервера в список готовых в Pilot, чтобы получилась форма как в Settings сайта?
4. Остаются открытыми вопросы из прошлого ответа: где будет репозиторий, JavaScript или TypeScript, с какого сервера начать, нужен ли «мой вкус».

Код и файлы не создаю, пока вы не скажете.

---

👤 **USER:**
> 1. Каждому свой
2. достаточно файла 
3. нет
4. Мой вкус пока не нужен - буду пользоватся памятью Pilot. репо пока оставим тут - просто отдельной папкой в корне. Наверно Typescript

И отдельный вопрос - по замечанию 
instructions сервера приложением не используется
* Как модель выбирает сервер. Я не нашёл, чтобы Pilot читал поле instructions сервера. Когда обращаться к серверу, модель узнаёт из поля «Description» в настройках Pilot, поэтому всё нужное для выбора должно быть в описаниях самих инструментов.
Я могу исправить Pilot - имеет смысл?

Сначала проверю на коде Pilot, как именно сейчас используется «Description» и действительно ли поле `instructions` нигде не читается: от этого зависит ответ, стоит ли исправлять.

## Стоит ли исправлять Pilot, чтобы он читал `instructions`

**Да, стоит.** Изменение небольшое, а пользу получат все подключённые серверы, а не только наши.

**Как сейчас (по коду Pilot):**
- В системные инструкции модели Pilot добавляет блок `<mcp_server_directory>`. В нём на каждый подключённый сервер одна строка: «имя: Description» ([session-mcp-tools.ts:67-93](../open-cowork/src/main/claude/session-mcp-tools.ts#L67-L93)).
- Если Description не заполнено, его составляет модель по списку инструментов: одно предложение, не больше 25 слов ([mcp-description-generator.ts:24-29](../open-cowork/src/main/mcp/mcp-description-generator.ts#L24-L29)). Потом текст обрезается до 200 символов, а угловые скобки заменяются ([mcp-description-generator.ts:282-295](../open-cowork/src/main/mcp/mcp-description-generator.ts#L282-L295)).
- Библиотека MCP, которую использует Pilot (v1.32.1), уже умеет отдавать инструкции сервера через `client.getInstructions()` ([index.d.ts:167](../open-cowork/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts#L167)). Но в `src/main` её никто не вызывает.
- По спецификации эти инструкции — подсказка модели, как пользоваться сервером, и клиент может добавлять их в системные инструкции. Документация библиотеки v2 прямо советует так и делать.

**Зачем это нашим серверам.** В 200 символов помещается только ответ на вопрос «к какому серверу идти». Правила совместной работы не помещаются никуда, кроме инструкций:
- «где и когда посмотреть X» — спросить и TV Guide (`find_airings`), и Cinema (`search_titles`);
- «в Швеции» может значить страну производства, место события или страну канала, и для каждого случая свой параметр;
- в списках нет ссылок на просмотр, за ними нужно вызвать `get_*`;
- если данные ещё загружаются, сначала вызвать `get_status`.

Без инструкций всё это придётся повторять в описании каждого инструмента. А описания отправляются модели в каждом запросе.

**Польза не только для нас.** Многие серверы присылают свои инструкции. Например, context7 и Claude Docs в нашем текущем разговоре прислали их, и я ими пользуюсь. В Pilot всё это сейчас пропадает.

**Как сделать безопасно.** Pilot считает данные от серверов недоверенными ([session-mcp-tools.ts:64-65](../open-cowork/src/main/claude/session-mcp-tools.ts#L64-L65), [mcp-tool-classification.ts:17-21](../open-cowork/src/shared/mcp-tool-classification.ts#L17-L21)), и инструкции нужно обрабатывать так же:
- **очистка текста:** как у Description, только с бо́льшим пределом длины (например, 2 000 символов) и с сохранением переносов строк;
- **отдельный блок для каждого сервера:** с явной пометкой, что это текст от сервера, а не от пользователя;
- **только для нужных серверов:** подключённых и включённых в этом чате;
- **контроль у пользователя:** в настройках сервера видно сам текст, и его можно отключить переключателем;
- **дополнительная польза:** инструкции можно передавать и в генератор Description, тогда и однострочное описание станет точнее.

**Что менять в Pilot:**
- после подключения сервера вызвать `getInstructions()` в `mcp-manager.ts`;
- выводить инструкции рядом с `buildMcpServerDirectory`;
- добавить новую функцию очистки рядом с `sanitizeDescription`;
- показать текст в `SettingsConnectors.tsx`;
- написать тесты.

Это делается в репозитории Pilot по его правилам, отдельно от нашей работы.

**Для наших серверов это ничего не ломает.** Инструкции мы напишем в любом случае, а описания инструментов всё равно должны быть понятны без них: по спецификации клиент вправе их не читать.

## Обновлённые решения
- **Настройки — у каждого сервера свои.** Файлы `~/.iptv-mcp/tv-guide/settings.json` (поля `epgUrl`, `liveUrl` и параметры TV) и `~/.iptv-mcp/cinema/settings.json` (поле `cinemaUrl` и параметры кинотеатра). Адреса задаются только в файле: без инструмента настройки и без переменных окружения.
  - В Pilot остаются только команда запуска, `--data-dir` и `OPENROUTER_API_KEY`.
  - Если файла нет, сервер создаёт пустой образец, а инструменты отвечают: «заполните settings.json по такому-то пути».
- **«Мой вкус» не делаем**, вместо него память Pilot.
- **Папка в корне этого репозитория.** Название предлагаю `mcp-servers/`:

  ```
  mcp-servers/
    package.json      свой, отдельно от сайта
    tsconfig.json     только для проверки типов
    src/shared/       M3U, SQLite и векторы, OpenRouter, словоформы, настройки, журнал
    src/tv-guide/server.ts
    src/cinema/server.ts
    tests/
    docs/             план и описание
  ```

  Из `public/` ничего не импортируем: нужные функции переносим в `src/shared/`. Тогда папку позже можно будет вынести в отдельный репозиторий как есть.
- **TypeScript без сборки.** Ваша Node 24.17 запускает `.ts` напрямую, я проверил: типы и импорты с расширением `.ts` работают без предупреждений. Не работает только то, что нельзя просто стереть, например `enum`. Поэтому пишем на этом подмножестве, запускаем как `node src/cinema/server.ts`, а типы проверяем `tsc --noEmit`. Так шага сборки нет, как и у сайта.

## Что поправить в этом репозитории, когда начнём
- **CLAUDE.md** сейчас прямо говорит «No database, backend framework, React, TypeScript or Docker is part of this project», а раздел Tooling описывает только сайт и прокси. Нужно оговорить, что это относится к сайту, а `mcp-servers/` живёт по своим правилам.
- **ARCHITECTURE.md:** добавить папку в структуру репозитория. Плюс новый файл правил `AI_MCP.md`.
- **`.vercelignore`:** добавить `mcp-servers`, чтобы папка не уходила на Vercel.
- **`.gitignore`:** сейчас там стоит общее правило `package-lock.json`, и файл с точными версиями зависимостей серверов тоже не попал бы в git. Нужно исключение `!mcp-servers/package-lock.json`.

## Что ещё решить
1. Название папки `mcp-servers/` подходит?
2. С какого сервера начать? Я по-прежнему советую Cinema.
3. Записать подробный план в `mcp-servers/docs/plan.md`? В нём будут схема таблиц, параметры каждого инструмента, тексты `instructions`, этапы и проверки на данных из `tmp/`. Сейчас это был бы единственный новый файл, кода не будет.

---

👤 **USER:**
> 1. подходит
2. Начнем в другом чате
3. да пишем но в папку mcp-servers/docы/design/ - посмотри примеры в томже Pilot

Посмотрю, как оформлены планы в `docs/design/` у Pilot, чтобы повторить их устройство.

Общий документ готов. Пишу план сервера Cinema, с которого начнётся работа.

Пишу план сервера TV Guide.

Написано для того, кто будет делать серверы в новом чате, то есть для вас и ИИ-ассистента. Документы на английском, как остальные документы репозитория.

Записал план в `mcp-servers/docs/design/`, по образцу документов в `docs/design/` у Pilot: шапка со статусом и ссылками, таблица решений D1–D15, этапы с тестами, список проверок для ревью, риски, открытые вопросы и то, что в задачу не входит. Получилось три файла, чтобы новый чат начинал с Cinema и не читал про телепрограмму:

- **[iptv-mcp-servers.md](mcp-servers/docs/design/iptv-mcp-servers.md)** — общая часть:
  - что выяснено о данных, сайте, Sqowe Pilot и библиотеках, со ссылками на строки кода;
  - решения, устройство папки, рабочая папка и `settings.json`, хранение, поиск, правила для инструментов;
  - Phase 0: заготовка проекта и правки в этом репозитории.
- **[cinema-server.md](mcp-servers/docs/design/cinema-server.md)** — сервер кинотеатра: данные, схема таблиц, загрузка, 7 инструментов с параметрами, черновики `instructions` и текста Description для Pilot, этапы C1–C5, проверочные вопросы для Pilot.
- **[tv-guide-server.md](mcp-servers/docs/design/tv-guide-server.md)** — сервер телепрограммы: данные, как запрос разбирается на поля (ваши примеры с Швецией и французскими фильмами), схема, загрузка, правило ссылок Catch-up, 8 инструментов, этапы T1–T6, проверочные вопросы.

Пока писал, всплыли новые факты, они уже в документах:
- **Фильмы в 4K.** 601 фильм лежит в каталоге дважды, в обычном качестве и в 4K. План объединяет их в одну запись с вариантами качества.
- **Описания сериалов.** У 1 551 из 1 553 сериалов все серии несут одно и то же описание, так что на сериал нужен один вектор.
- **Пометка 18+.** Атрибут `censored="1"` стоит только у записей в формате серий, у фильмов его нет вообще.
- **Каналы без архива.** У 160 каналов нет архива, это в основном музыкальные, XXX и новости. У всех каналов «Кино» архив на 7 дней есть.
- **Плейлист без заголовка.** У варианта плейлиста с потоками MPEG-TS пустой заголовок, без `url-tvg` и без `catchup-type`. Поэтому эти данные в плане необязательные.

Проверки:
- все ссылки в трёх документах ведут на существующие файлы, номера строк в пределах файлов;
- реальных адресов и ключей провайдера в тексте нет;
- три фразы поправил после перечитывания. Смещение `+0300` я проверял только у времени начала передач. То, что длительность фильма указана в секундах, а серии в минутах, я вывел из значений, а не прочитал в описании формата; в план добавлена проверка на этапе C1.

Код не писал. CLAUDE.md, ARCHITECTURE.md, `.gitignore` и `.vercelignore` не трогал: эти правки записаны в план как Phase 0. Ничего не добавлено в git и не закоммичено, папка `mcp-servers/` пока не отслеживается git.

Для нового чата хватит одной фразы: «Прочитай `mcp-servers/docs/design/iptv-mcp-servers.md` и `cinema-server.md`, начинаем с Phase 0 и C1».

