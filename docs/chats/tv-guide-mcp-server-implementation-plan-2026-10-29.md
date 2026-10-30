# Claude Chat Export
**Generated: 2026-10-30 16:31:15**

---

👤 **USER:**
> Read design document mcp-servers/docs/design/tv-guide-server.md carefully.

Turn back with confirmation that you are ready to start implementation, or ask questions.

Prefer to use the semantic-index skill to search the codebase, docs, and past conversations.

**NEVER** use find command from the root. All neccessary files place under user directory

Use context7 as the source of truth for code patterns and coding docs.

Use firecrawl skills to search and get content from the web. You should search the web also if context7 doesn't have relevant information.

Before start implementation provide report and implementation plan

**Don't start implementation without excplicit user approval.**

high level design is in mcp-servers/docs/design/iptv-mcp-servers.md common part should be already created under mcp-servers/docs/design/cinema-server.md

I'll read the design documents first, then check the current state of the codebase.

The Cinema implementation has already started (src/, scripts/, tests/ exist). Let me read the rest of the TV Guide design document.

Now let me read the shared design document and check the current implementation state.

Let me read the rest of the shared design document.

Now let me read the Cinema design document (the sibling with completed implementation) and load the semantic-index skill as instructed.

Let me read the Cinema phases section (§9) to understand what's been built, and check the semantic index status.

C1–C4 are done for Cinema. Let me read the rest of the Cinema phases (C4/C5) and the AI_MCP.md coding rules.

Now let me examine the key implementation files that TV Guide will build on.

Now let me check the web app reference files the design ports from.

Let me check the verified catch-up behaviour in the live-tv plan and the existing tmp/ samples.

Let me quickly verify the shapes of the key shared modules the TV Guide will reuse.

The samples are in place. Let me verify the current baseline (typecheck + tests green) and check the remaining shared module surfaces.

Baseline is green (467 tests, typecheck clean). Let me pin down exact line numbers for citations and check how the real-data scripts take their input.

I've read everything I need. Here is my readiness report.

---

# Readiness report — TV Guide MCP server (phases T1–T6)

## What I read

| Source | Status |
|---|---|
| `mcp-servers/docs/design/tv-guide-server.md` | Full — all 608 lines |
| `mcp-servers/docs/design/iptv-mcp-servers.md` | Full — shared decisions D1–D15, storage, search model, tool rules, phases |
| `mcp-servers/docs/design/cinema-server.md` §9 | Full — what C1–C5 built, decisions taken, review findings |
| `AI_MCP.md` | Full — coding rules (no `enum`, `~600`-line files, `import ... from './x.ts'`, masking, stdout discipline) |
| `docs/design/live-tv-playback-plan.md` §5 | Verified catch-up behaviour (probed server) |
| Web app reference code | Verified in source, not from memory |

## Current state — verified

- **Cinema C1–C4 done, C5 in progress** (live provider run 2026-10-28: 7,650 titles; all ten script checks pass). C5's remaining work is Pilot-side manual checks — separate from TV Guide.
- **Baseline green**: `npm run typecheck` clean, `npm test` → **467 pass, 0 fail**.
- **Shared base exists**: `args`, `settings` (spec + `SettingsStore`, `src/shared/settings.ts:62,381`), `log`, `download` (pluggable `validate` head-check, `src/shared/download.ts:43-57` — the EPG `<?xml`/`<tv` check fits it), `m3u` (header attributes + `#EXTGRP` already parsed, `src/shared/m3u.ts:36,125` — live playlist fits without changes), `text` (Snowball ru/en, `src/shared/text.ts:29-150`), `countries`, `db`, `lock`, `refresh`, `tool-kit`, `embeddings`, `vectors` (`vectors` + `query_vectors` tables, `src/shared/vectors.ts:25-35`).
- **Search blend lives in `src/cinema/`** (`words.ts`, `blend.ts`, `search.ts`) — parent doc §4.3 says the move to `shared/` happens in **T4**.
- **Real samples present**: `tmp/4a27b28d` (140 MB EPG), `tmp/playlist.m3u`, `tmp/playlist_mpegts.m3u` (bare header), `tmp/list.m3u` (no `#EXTGRP`) — all variants T1 must handle.
- `npm run tv-guide` currently prints "arrives in phase T1" and exits — the stub to replace.

## Key behaviours verified in web app source (ported, not imported)

- `epgRawToEpochSeconds` — `public/scripts/utils/epgParser.js:240-278`: strict regex with required `±HHMM` offset, range validation (month 13 → NaN), `Date.UTC` normalisation cross-check.
- Quality scale — `public/scripts/utils/search.js:80-91`: 4K→4, UHD→3, HD→2, SD→0, else 1. Matches the schema comment in tv-guide-server.md §4.1.
- `filterUniqueByClosestTime` / `filterPreferHD` — `search.js:98-168`: hide_repeats groups by title+channel(-family), prefer_hd by title+start-time, ties resolved deterministically. Both to be re-implemented on epoch seconds.
- Catch-up rule — `public/scripts/components/results.js:268-297`: `tvgRec > 0` ∧ valid epochs ∧ `stop < now` ∧ `now − start ≤ tvgRec·86400`; URL API sets `utc`/`lutc` keeping existing query params; re-check with `sanitizeUrl`. Provider behaviour confirmed by live-tv-playback-plan.md §5.1 (no stop time sent; rolling DVR).
- **Note**: shared `time.ts` `parseProviderTimestamp` handles `YYYY-MM-DD HH:MM:SS±HH:MM` — the EPG compact format `20260614091000 +0300` needs its own port; since only TV Guide uses it, it goes in `src/tv-guide/` per AI_MCP.md ("shared/ holds nothing that only one server uses").

## Implementation plan (mirrors design §10)

| Phase | Deliverables | New code (all in `src/tv-guide/` unless noted) |
|---|---|---|
| **T1** | Playlist + streaming EPG import, measured | `config.ts` (settings spec + template §9), `epg-time.ts` (port of `epgRawToEpochSeconds` + `epgDefaultOffset`), `playlist.ts` (header attrs, `group-title`/`#EXTGRP` fallback, `tvg-rec`, `catchup-type`), `epg.ts` (gzip detect `1f 8b`, streaming XML parser — **`saxes` vs `sax` benchmarked on `tmp/4a27b28d`, result recorded in the doc**; new dependency, justified), `schema.ts` (§4.1), `texts.ts` (hash, markers, staging), `import.ts` (pipeline §5: staging batches of 5,000, retention, swap), `scripts/import-tv-real-data.ts`; tests: time cases (+0300, −0130, missing, month 13, 24:00), gz/plain fixtures, `tvg-rec="0"`, bare header |
| **T2** | Derived fields + extractors | `group-map.ts` (§4.2 themes/regions/timeshift, `groupMap` override), `quality.ts`+`family_key`, `kind.ts` (§4.3 markers → patterns → channel theme), `extract.ts` (film ending, venue genitive-vs-stemmed, sport); real-data coverage script (kind distribution, ≈5,244/7,358 х/ф with countries+year, venues); open items: `⋗` vs airing times, Baltic region — measured and recorded |
| **T3** | Eight tools, words only | `filters.ts` (periods incl. `tonightFromHour`, themes, regions, channels, countries, years, person), `dedup.ts` (hide_repeats/prefer_hd on epochs), `links.ts` (catch-up rule, fixed-clock tests), `schemas.ts`/`descriptions.ts`/`handlers.ts`/`tools.ts`/`server.ts` + `get_status`/`refresh_guide` (Pilot name rule test like `tests/cinema/tool-names.test.ts`); Pilot description §8 |
| **T4** | Embeddings + blend | Move blend to `shared/` (design §4.3), vectors for all groups (D11), `vec_distance_cosine` measurement → `vec0` fallback if needed, kind-by-meaning with tuned threshold |
| **T5–T6** | Pilot manual checks (§11 ×12) + both servers together | Script like `scripts/manual-checks.ts`; needs the owner at Pilot |

Every phase ends with `npm run typecheck` + `npm test` green; real-data numbers recorded in `tv-guide-server.md` as C-phases did. Fixtures hand-made, `example.invalid` hosts only.

## Points I want your decision on

---

👤 **USER:**
> ask me questions once again

---

👤 **USER:**
> повтори вопросы

Вот мои вопросы ещё раз — можно ответить прямо в чате:

**1. Темп работы (Scope)**
Как проводить реализацию?
- **а) T1, затем стоп-точка (рекомендую)** — импорт плейлиста + потоковый EPG, замеры на реальных файлах `tmp/`, запись результатов в дизайн-документ, вы смотрите, потом T2. Так работал Cinema (C1→C2→… по одной фазе).
- **б) T1+T2, затем стоп-точка** — импорт и производные поля (типы, извлечение режиссёра/актёров/стран, группы) за один заход.
- **в) T1–T4 без остановок** — все кодовые фазы подряд (импорт, поля, инструменты, эмбеддинги), проверка в конце, перед T5/T6 (ручные проверки в Pilot).

**2. Review-цикл**
Запускать review-fix-loop (внешний сервис ревью) после каждой завершённой фазы, как это делалось для Cinema? (В C2/C3 цикл нашёл реальные баги — C2 прошёл пять раундов ревью.)
- **а) Да, после каждой фазы (рекомендую)**
- **б) Только после T1 и T3** (самые насыщенные логикой)
- **в) Без ревью** — вы сами смотрите код после каждой фазы

**3. Открытый вопрос дизайна §12.7**
89 каналов EPG без потока (16 601 программа — провайдер даёт программу, но в плейлисте их нет): показывать в поиске или прятать?
- **а) Показывать, с `has_live=false` (рекомендую, как предложено в дизайне)** — `find_airings` и поиск их видят, `get_program` честно скажет, что потока нет
- **б) Прятать из результатов** — в базе они есть (полная сетка), но ни один инструмент их не возвращает

И одно подтверждение по умолчанию (если не возразите, делаю так): замеры T1 (выбор XML-парсера `saxes` vs `sax`, время импорта, память, размер базы) выполняются на реальных файлах `tmp/` и записываются в `tv-guide-server.md`, как это делалось в Cinema C2/C4.

---

👤 **USER:**
> 1. - вариант а
2 - а) Да, после каждой фазы 
3 - Показывать, с has_live=false

Решения зафиксированы:

1. **T1 → стоп-точка** — после фазы показываю результаты и замеры, жду вашего просмотра перед T2.
2. **Review-fix-loop после каждой фазы.**
3. **Каналы без потока — в поиске, `has_live=false`** — я запишу это решение в `tv-guide-server.md` §12 (закрытый открытый пункт), тест покроет его.

# План T1 (финальный)

**Код** — всё в `src/tv-guide/` (кроме отмеченного):

| Модуль | Содержание |
|---|---|
| `config.ts` | spec настроек §9 + шаблон `settings.json` (`epgUrl`, `liveUrl`, `excludeGroups`, `tonightFromHour`, `epgDefaultOffset`, …) |
| `epg-time.ts` | порт `epgRawToEpochSeconds` (`epgParser.js:240`) + `epgDefaultOffset` для времён без смещения (счёт в статус) |
| `playlist.ts` | парсер живого M3U на базе `shared/m3u.ts`: атрибуты заголовка (`url-tvg`, `x-tvg-url`, `catchup-type`), `tvg-id/tvg-logo/tvg-rec`, fallback на `#EXTGRP`, вариация с голым `#EXTM3U` |
| `epg.ts` | gzip по первым байтам `1f 8b`, потоковый XML-парсер (**бенчмарк `saxes` vs `sax` на `tmp/4a27b28d`** — время, память, битый фикс`; результат в документ), чтение `<channel>`/`<programme>` |
| `schema.ts` | таблицы §4.1 (`channels`, `program_texts`, `text_countries`, `programmes` + FTS5 `program_texts_fts`) |
| `texts.ts` | хеш (title, description), снятие маркеров (х/ф, `⋗`) — классификация самого текста придёт в T2, здесь только заготовка |
| `import.ts` | конвейер §5: плейлист → EPG-URL (настройка или заголовок) → скачивание (`validate`-проверка `<?xml`/`<tv` и `#EXTM3U`) → staging пачками по 5 000 → retention (`pastDays`) → swap |
| `scripts/import-tv-real-data.ts` | импорт реальных файлов с числами фазы |

**Тесты** (фикстуры, `example.invalid`): времена `+0300`/`−0130`/без смещения/месяц 13/24:00; gz и plain; программа без описания; канал без потока; `tvg-rec="0"`; плейлист с голым заголовком; retention; повторный импорт.

**Замеры → в документ** (как в C2): время импорта, пиковая память, размер `data.sqlite`, выбор XML-парсера.

**В конце фазы:** `npm run typecheck` + `npm test` зелёные → review-fix-loop → исправления → обновляю §10 T1 и §12 (пункт 3) в `tv-guide-server.md` → отчёт вам.

**Не делаю:** инструменты (T3), классификацию/извлечение (T2), эмбеддинги (T4), ничего в Pilot.

Один нюанс: `node:sqlite` в T1 понадобится лишь на этапе staging/swap — схема БД будет применяться при первом запуске импорта, без миграций поверх Cinema (у серверов отдельные `data.sqlite`).

**Приступаю к T1?**

---

👤 **USER:**
> приступаем

Приступаю к T1. Сначала дочитаю образцы, на которые буду опираться: `config.ts` (spec настроек), `schema.ts`, `db.ts`, остаток `m3u.ts` и парсер живого плейлиста из веб-приложения.

Образцы ясны. Теперь первый шаг T1 — выбор XML-парсера. Посмотрю начало реального EPG и доступные версии `saxes`/`sax`.

EPG содержит `<!DOCTYPE tv SYSTEM "xmltv.dtd">` — важно для строгого парсера. Ставлю оба кандидата (точные версии) и пишу бенчмарк.

Парсер выбран: **saxes** — 0.8 с против 2.0 с, память почти одинакова (114 против 118 МБ), оба строго сообщают о битом вводе, счётчики точно совпали с дизайн-документом (1303 канала / 321 787 программ). Теперь дочитаю модули, паттерны которых повторю: `download.ts` (валидация head), `store.ts`/`queue.ts`/`embed-text.ts` Cinema (FTS и очередь), `import.ts`.

`validate` получает декодированную строку head — для gzip-магии (`1f 8b`) нужны байты. Посмотрю `readHead` и паттерны Cinema (store, queue, embed-text, import).

Все паттерны ясны. Начинаю писать код. Сначала два небольших расширения shared-модулей, которых требует T1:

1. `download.ts` — валидатору head нужны **сырые байты** (gzip-магия `1f 8b` не выживает UTF-8 декодирование);
2. `settings.ts` — `groupMap` это map **объектов** (group → `{theme, region, timeshiftHours}`), а `freeForm` принимает только строки.

Теперь расширение `settings.ts` для map'ов с объектными значениями (`groupMap`):

Shared-расширения готовы. Теперь модули TV Guide. Первый — `epg-time.ts` (порт `epgRawToEpochSeconds` + `epgDefaultOffset`):

Исправлю синтаксис деструктуризации в `parseEpgTime` (я написал невалидный синтаксис):

Теперь `config.ts` — настройки TV Guide (§9):

Теперь `schema.ts` — таблицы §4.1:

Проверю, что API `db.setMeta` и `addColumnIfMissing` существуют с такими сигнатурами:

API на месте. Проверю интерфейс `RawMeta` и `normalizeTitle`, затем напишу `texts.ts` и `playlist.ts`:

Теперь `playlist.ts` — парсер живого плейлиста:

Теперь `epg.ts` — потоковый XML-парсер на saxes с gzip-детекцией:

`parseEpgText` через промисы — хрупко. Перепишу `epg.ts` с синхронным ядром (`EpgReader`), который используют оба входа:

Теперь очередь текстов для эмбеддингов — посмотрю cinema/queue.ts, чтобы повторить проверенный шаблон:

`charLength` определена в cinema/queue.ts, а мне нужна и в TV Guide — по правилам shared. Перенесу её в `shared/text.ts`:

Эта правка испортила `snippet` — посмотрю и починю:

Теперь обновлю cinema/queue.ts, чтобы он брал `charLength` из shared:

Я случайно удалил интерфейс `QueuedText` — восстановлю его:

Теперь типы импорта. Гляну на cinema/import-options.ts как образец:

Теперь ядро записи — `store.ts` (класс GuideWriter: транзакция, батчи 5 000, дедуп текстов, retention, orphan-cleanup):

Исправлю три проблемы в store.ts: синтаксическая ошибка `|| ??`, импорт в середине файла, лишний re-export:

Ещё один баг: в `addEpgChannel` имя EPG должно **побеждать** имя плейлиста (design: "name = EPG display-name, else playlist name"), а у меня плейлист выигрывал:

Теперь `import.ts`. Сначала проверю семантику `withTransaction` (откат при исключении):

Откат на месте. Пишу `import.ts`:

Нашёл несколько проблем: (1) `withTransaction` синхронный, а стриминг EPG — async (COMMIT бы произошёл до окончания парсинга!); (2) `parseHeaderOf` дублирует `parseM3uHeader`; (3) мелочи. Добавлю `withTransactionAsync` в shared/db.ts:

Опять неудачная правка — прочитаю область и восстановлю корректно:

Проверю целостность db.ts после правок:

db.ts цел. Чиню ошибки: удаляю одноразовый бенчмарк (числа зафиксирую в документе), правлю типы:

Теперь исправлю `import.ts` — async-транзакция, `parseM3uHeader`, явные аргументы, упрощённая логика unchanged:

Ошибка в структуре вызова, и черновик разросся лишними реэкспортами. Перепишу `import.ts` начисто и аккуратно:

Уберу оставшийся мёртвый код в `importCore`:

Typecheck чист. Теперь фикстуры и тесты. Посмотрю стиль существующих фикстур:

Проверю broken-фикстуру и создам оставшиеся (голый заголовок, MPEG-TS вариант):

Фикстуры готовы. Пишу тесты — `epg-time.test.ts` и `playlist.test.ts`:

Обновлю сначала `store.ts` — программы исключённых групп считаются отдельно (`droppedGroupProgrammes`), не как unknown:

Добавлю маршрут `/gzip` и тест на сырые байты в download.test.ts, затем тесты freeFormObjects в settings.test.ts:

Тест поймал: дочерние значения `groupMap` проходят как строки без ошибки. Усилю валидацию детей freeFormObjects-пути:

sed не сработал — поправлю тест напрямую:

Причина — ранний `return` для freeFormObjects принимает весь объект целиком, не проверяя детей. Уберу его (общая ветка объектов теперь валидирует детей):

Shared-тесты зелёные. Теперь главный файл тестов импорта:

Забыл колонку `embed_text` в схеме — очередь читает текст из `program_texts`. Добавлю (документированное дополнение к §4.1, как `fts_rowid`):

Сделаю чище — заменю на явную пару assert-ов:

Typecheck чист. Запускаю тесты TV Guide:

Причина: FK `programmes.text_hash → program_texts` — тексты должны быть записаны до программ. Переплету writer: текст пишется сразу при первой встрече:

Два бага: `newTexts` инкрементится дважды, и FTS5 `RETURNING rowid` возвращает -1. Проверю, даёт ли `lastInsertRowid` от `run()` корректный rowid:

`lastInsertRowid` работает. Чиню store.ts:

Тест был неправ: голый `#EXTM3U` — валидный плейлист. Исправляю ожидание:

Все 517 тестов зелёные. Теперь тест настроек (`config.test.ts`):

Моя ошибка в тесте: после создания шаблона `exists` = true. Смотрю, как это проверяет Cinema, и правлю:

Тесты зелёные. Теперь скрипт замера на реальных данных:

Typecheck чист. Запускаю замер на реальных файлах (140 МБ EPG + плейлист):

Импорт работает (1303 канала = 1253 + 50 взрослых ✓), но все программы выпали из retention-окна: данные от июня 2026, а `now` — сегодня. Для замера нужен `--now` внутри окна данных. Добавлю опции:

Ровно 316,746 + 5,031 + 10 = 321,787 ✓ (совпадает с дизайном). Но текстов 100,611 вместо ожидаемых 60,447 — проверю честный подсчёт по реальному файлу:

Реальное число — 102,467 пар, а не 60,447. Проверю, может 60,447 — это различные заголовки:

75,553 заголовка, 102,466 пар — число 60,447 в дизайне неверно. Разница с импортом (100,611) объясняется исключением взрослых каналов. Гляну на 10 «битых времён»:

Все 10 «битых» времён объяснены: 2 программы нулевой длины и 8 «ANONS» с stop раньше start на baku-az-hd. Честно отбраковываются. Теперь замер повторного импорта (тот же data-dir):

Замеры готовы. Пересчитаю также групповую таблицу §2.3 (различные тексты по группам), чтобы корректно обновить документ:

Все подтверждено. Обновляю дизайн-документ — исправление §2.3 и запись T1 в §10:

Обновлю статус в шапке документа и §12 (решение по §12.7):

Финальные проверки фазы: полный typecheck + тесты, и сверка паттерна `setMeta` с cinema/schema:

Тесты: 527 зелёных. Но `saxes` не попал в dependencies! Проверю:

`saxes` в devDependencies и с `^` — по AI_MCP нужна точная версия в prod-зависимостях:

Фаза T1 готова. Теперь запускаю review-fix-loop, как договорились. Читаю skill:

Запускаю review-fix loop. Жёсткий лимит: 5 итераций. Счётчик объявляю явно.

> **ITERATION 1/5**

Отчёт: 2 HIGH, 3 MEDIUM, 2 LOW. Все замечания по делу. Основная перестройка: отказ от транзакции через await — «сначала разбор в память, затем синхронная запись». Начинаю.

**HIGH-1 + HIGH-2**: убираю `withTransactionAsync`, writer собирает всё в памяти, запись — один синхронный блок:

Теперь перестраиваю `store.ts` — запись после разбора, синхронно:

Теперь `import-options.ts` (embeddingsEnabled), `queue.ts` (LOW-1 + MEDIUM-2), `epg.ts` (MEDIUM-1, LOW-2):

Теперь `epg.ts` — корректная очистка потока и `position: false`:

Теперь `import.ts` — новый поток importCore (разбор в память → синхронная запись, try/finally):

Правлю импорты, тесты (сообщение broken-фикстуры теперь «could not be read») и скрипт:

527 зелёных. Теперь MEDIUM-3 — тесты `refreshTvGuide` с локальным HTTP-сервером:

Плейлист-фикстура указывает на `example.invalid` — в этих тестах нужен локальный заголовок. Также уберу `outcome.error` из assert-сообщений:

Перепишу тест начисто — маршрут `/playlist-local` строит заголовок с локальным `origin` на месте:

Две правки: создать `raw/` перед writeRawMeta; использовать `/playlist-local`, чтобы весь refresh прошёл:

539 тестов зелёных. Перепроверю замеры на реальных файлах с новой архитектурой:

Результаты идентичны (13.9 с, RSS вырос до 603 МБ из-за строк в памяти). Обновлю запись в дизайн-документе:

> **ITERATION 2/5**

Все замечания валидны. Чиню: retention на unchanged-пути, `embeddingsEnabled` в сигнатуре, чужие queue-строки, pipeline в gunzip, висячий JSDoc, +3 теста.

**HIGH-3 + инфраструктура**: правлю store.ts — модульный `removeOrphanTexts`, `applyRetention`, порядок queue-работ:

**HIGH-1 + HIGH-2** в import.ts (retention на unchanged-пути, `embeddingsEnabled` в сигнатуре) и **MEDIUM-1/2**:

**MEDIUM-3** — три новых теста в refresh.test.ts:

Ожидания неверны: текстов 5 (distinct), а не 6; и нужны attached vectors. Правлю тесты:

542 теста зелёные, замеры стабильны. Дополню запись T1 в документе:

> **ITERATION 3/5**

Раунд 3: CDATA (HIGH), re-queue существующих текстов при смене модели, счётчики в retention-результате, две мелочи. Чиню:

Тест CDATA — отдельным файлом (не трогая счётчики существующих фикстур):

544 зелёных. Быстрая перепроверка замера:

> **ITERATION 4/5**

Раунд 4: 6 MEDIUM, 4 LOW. Правлю всё:

M-4 — обёртка от неожиданных исключений в трёх входах импорта:

Хвост старого замыкания остался после `return imported;` — уберу его:

Проверю структуру refreshCore/refreshTvGuide и добавлю четыре теста (M-6):

Тест вскрыл реальный пробел: решение о программе принимается во время стрима, когда канал ещё не прочитан. Переношу проверку канала в фазу записи (весь гайд уже в памяти):

548 зелёных. Контрольный замер:

> **ITERATION 5/5**

**APPROVED** ✅ — цикл завершён на 5-й итерации. Неблокирующие замечания зафиксирую как отложенные задачи для T3, чтобы они не потерялись:

Правка заменила абзац вместо добавления — восстановлю оба:

# Фаза T1 завершена — стоп-точка

## Результат review-fix-loop

**APPROVED** на итерации 5/5. За пять раундов ревью найдено и исправлено ~23 замечания, включая три блокирующих:

| Раунд | Главное |
|---|---|
| 1 | **HIGH:** транзакция через `await` (поиск в том же процессе мог увидеть пустой гайд) → разбор в память + синхронная запись; каналы, объявленные после программ, роняли импорт → решение о программе перенесено в фазу записи |
| 2 | **HIGH:** retention не применялся на unchanged-пути → `applyRetention`; `embeddingsEnabled` не входил в сигнатуру настроек; чужие queue-строки при смене модели |
| 3 | **HIGH:** CDATA-заголовки записывались пустыми → отдельное событие `cdata` + тесты |
| 4 | Обрезка пробелов в XMLTV-ids, очистка очереди при выключенных эмбеддингах, защита от неожиданных исключений в импорте, set-based удаление сирот |
| 5 | APPROVED; 5 неблокирующих улучшений отложено в `tv-guide-server.md` §10 как задачи перед T3 |

## Итоги фазы

**Код** (`src/tv-guide/`): `epg-time` (порт `epgRawToEpochSeconds` + `epgDefaultOffset`), `playlist`, `epg` (saxes + gzip), `schema` (§4.1 + 3 дополнения), `texts`, `store` (GuideWriter), `queue`, `import`, `config` + `scripts/import-tv-real-data.ts`.

**Shared-расширения**: `download.ts` (сырые байты head для gzip-магии), `settings.ts` (`freeFormObjects` для `groupMap`), `text.ts` (`charLength` переехала), `db.ts` (удалён прототип async-транзакции; решение — только синхронные записи).

**Замеры** (`tmp/playlist.m3u` + `tmp/4a27b28d`, теперь в дизайн-документе):

| | |
|---|---|
| Парсер | **saxes 6.0.0** — 0.8 с vs sax 2.0 с на 140 МБ |
| Каналы | 1,253 + 50 взрослых = **1,303** ✓ дизайн |
| Программы | 316,746 + 5,031 + 10 битых времён = **321,787** ✓ дизайн |
| Тексты | **100,611** (§2.3 исправлена: в файле 102,467 пар, а не 60,447) |
| Импорт | **14–15 с** первый, **5.8 с** повторный; RSS до 600 МБ; база 503 МБ |
| Тесты | **548 зелёных** (было 467; +56 TV Guide, +12 refresh, +3 shared, +2 CDATA) |

**Открытые вопросы**: §12.7 закрыт вашим решением (searchable, `has_live=false`); §2.3 исправлена.

## Дальше — T2

Производные поля: карта групп (темы/регионы/тайм-шифты/quality/family_key), виды программ (маркеры → паттерны → канал), извлечение из описаний (режиссёр, актёры, страны, год, жанры, «Трансляция из X»), скрипт покрытия на реальных данных + два исследования (смысл `⋗`, регион Baltic).

**Приступаю к T2?**

---

👤 **USER:**
> давай закоммитим текущее состояние

Проверю состояние репозитория перед коммитом:

Большая часть уже в индексе (стейджинг сделал review-скрипт), но проверю полноту — `epg.test.ts` не виден в списке:

Всё в порядке: 31 файл в индексе, незастейжена только дизайн-документация (мои правки после ревью), untracked нет, чувствительных файлов нет (`tmp/` в gitignore, фикстуры на `example.invalid`). Коммичу в стиле репозитория:

Закоммичено ✅

```
1cb2500 feat(mcp-servers): add the TV guide import: playlist and streaming EPG (T1)
```

- **Ветка:** `feat/mcp-servers` (продолжает стиль предыдущих коммитов фаз Cinema)
- **31 файл, +4,722 строки:** 11 новых модулей `src/tv-guide/`, 12 тестовых файлов + 4 фикстуры, скрипт `import-tv-real-data.ts`, правки shared (`download`, `settings`, `text`, `db`, `cinema/queue`), package.json/lock (`saxes 6.0.0`), дизайн-документ (запись T1, исправление §2.3, закрыт §12.7)
- **Рабочее дерево чистое**, ничего не отправлено в remote (push не делал — как и в Cinema, вы это контролируете)

Готов приступать к **T2** (производные поля: карта групп, виды программ, извлечение фактов из описаний) — по прежней договорённости: реализация → review-fix-loop → стоп-точка с отчётом. Начинать?

