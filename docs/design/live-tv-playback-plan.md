# Live TV Playback — Implementation Plan

**Status:** Proposed (awaiting implementation approval)
**Branch:** `feat/live-tv-playback`
**Author:** design session, 2026-06-21
**Scope:** Add "Watch Live" (and later catch-up) playback to **TV Guide** search results, mirroring the Cinema tab's play behavior.

---

## 1. Goal

Today the **Cinema** tab can play a video directly from a search result, but the **TV Guide** tab cannot. This plan adds a **▶ Watch Live** action to TV Guide program results so a user can jump straight to the live channel stream — using the **same open-in-new-tab mechanism the Cinema tab already uses** (no in-page player, no new dependencies).

Catch-up (playing a *past* program from the channel archive) is designed here but deferred to **Phase 2**.

---

## 2. Why this is now possible (verified facts)

The EPG (XMLTV) contains **no stream URLs** — it is a schedule only (`channel` + `programme` with `title`/`desc`/`start`/`stop`). Playback requires a **second source**: the provider's live‑channel M3U playlist. That playlist is now confirmed available and verified:

| Fact | Evidence |
|------|----------|
| Live playlist URL | `http://248on.com/x/4a27b28d.m3u8` — a hosted alias, byte‑for‑byte identical to the local `tmp/playlist.m3u` (282,482 bytes, 1,214 channels) |
| It links to *this* EPG | Header `url-tvg="http://s03.wsbof.com:8080/xml/4a27b28d.gz"` — same `4a27b28d` EPG file |
| Channel join is exact | **1,214 / 1,214** playlist `tvg-id`s match an EPG `<channel id>` (0 unmatched). The EPG has 1,303 channels; 89 have no stream (handled gracefully). |
| Stream format | HLS: `http://s03.wsbof.com:8080/s/6d6310b8/{tvg-id}.m3u8` |
| Catch‑up advertised | Header `catchup-type="shift"`, per‑channel `tvg-rec="7"` (~7‑day archive) → enables Phase 2 |

**Join key:** EPG `program.channelId` → playlist `tvg-id` → `streamUrl`.

---

## 3. Two known gotchas this plan must respect

### 3.1 Timezone bug in `parseEpgTime` (affects Phase 2 only)
`parseEpgTime()` ([epgParser.js:134](../../public/scripts/utils/epgParser.js)) **discards the `+0300` offset** — it splits it off and builds a timezone‑naive local `Date`. Therefore:
- The `program.start` / `program.stop` `Date`s are **not reliable absolute timestamps**.
- The original strings are preserved as `program.startRaw` / `program.stopRaw` (e.g. `"20260614091000 +0300"`), which **do** carry the offset.
- **Phase 2 catch-up must compute the `utc` epoch from `startRaw`, not from the `start` Date.**

This also makes `getProgramStatus()` (current/past/future) timezone‑skewed when the browser is not in `+0300`. **Phase 1 deliberately does not depend on program status** (see 4.3).

### 3.2 Operator EPG times are imprecise (Phase 2 design driver)
The operator's EPG timestamps are shifted **earlier by a variable 1–3 minutes**, so a program's `start`/`stop` don't exactly match the broadcast. Decisions from the design discussion:
- **No start offset / lead‑in.** Starting a minute or two early (in the tail of the previous program) is acceptable — the user will wait.
- **Never impose a stop.** The real pain is *cutting off the finale*. Because catch‑up is a continuous archive stream and we open it in an external player, playback **rolls into the next program automatically** — we simply must not stop it. This solves the "stops before the end" problem for free.
- Because the error is *variable*, a fixed correction would overshoot; padding/continuous play is the robust choice.

---

## 4. Phase 1 — Live "Watch Live" (this deliverable)

### 4.1 Behavior
- Add a third source URL in Settings: **Live TV M3U URL** (alongside the existing Cinema M3U URL).
- The live map is loaded by the **existing "Load EPG data" button** (decision #1): `loadEpgData()` also fetches + parses the playlist into a `Map(tvg-id → channel)` held on `window.appState.liveChannels`. The live fetch is **non-blocking** — if it fails, the EPG still loads (error logged only). If no Live URL is configured, it is skipped and `liveChannels` stays `null`.
- In the **program details modal** (TV Guide), if the program's channel exists in the map, render a **▶ Watch Live** link: `<a href="{streamUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">` — **identical to Cinema's Play button** ([cinemaTab.js:591](../../public/scripts/components/cinemaTab.js)).
- If no Live URL is configured, the channel isn't in the playlist, or the map hasn't loaded → **no button** (graceful, no errors).

### 4.2 Data model
```
window.appState.liveChannels : Map<string, LiveChannel> | null

LiveChannel = {
  tvgId:     string,   // e.g. "pervyj-hd-orig"  (= EPG channelId)
  name:      string,   // EXTINF display name
  streamUrl: string,   // http://s03.wsbof.com:8080/s/6d6310b8/<id>.m3u8
  logo:      string,   // tvg-logo (optional, unused in Phase 1)
  tvgRec:    number     // tvg-rec days (0 if absent) — used by Phase 2
}
```

### 4.3 Button visibility decision — **DECIDED: Option A**
**Show "Watch Live" for any result whose `channelId` is in the live map — regardless of program status.**
Rationale: a live stream always plays the *current* broadcast, so it is valid no matter which program (past/now/future) the user clicked. This also sidesteps the timezone‑naive `getProgramStatus()` bug (3.1). The label "Watch Live" makes clear it's the live channel, not that specific program. (Per‑program "is airing now" gating is rejected for Phase 1 because status is unreliable; precise past playback is Phase 2's job.)

### 4.4 Files to change

| File | Change | Stability zone | Notes |
|------|--------|----------------|-------|
| `public/scripts/utils/storage.js` | Add `LIVE_URL` + `LIVE_LAST_UPDATED` keys and `saveLiveUrl`/`getLiveUrl`/`hasLiveUrl`/`saveLiveLastUpdated`/`getLiveLastUpdated` (mirror the Cinema functions) | ✅ Stable | +~50 lines |
| `public/scripts/utils/m3uParser.js` (408 ln) | Add `parseLiveM3u(text) → Map` capturing `tvg-id`, `tvg-logo`, `tvg-rec`, name, streamUrl. Reuses line-splitting; does **not** touch the existing `parseM3u`/cinema code | 🔄 Semi‑stable | +~40 lines, stays under 800 |
| `public/scripts/utils/liveChannels.js` **(new)** | `loadLiveChannels()` — fetch via existing `fetchM3uData`, build map, store on `window.appState.liveChannels`; fail quietly (log only). Called **from `loadEpgData()`**. Keeps `main.js` thin | new (~60 ln) | `main.js` is already 734/800 — do **not** add load logic there |
| `public/scripts/utils/sanitize.js` **(new)** | Export `escapeHtml`, `escapeAttr`, `sanitizeUrl` (http/https only) for new code | new (~30 ln) | See 4.6 — avoids a 3rd copy of these helpers |
| `public/scripts/components/results.js` (444 ln) | In `showProgramModal()`, compute `watchLiveHtml` from `window.appState.liveChannels` and insert it in the modal body | 🔄 Semi‑stable | uses `sanitize.js` |
| `public/scripts/components/settings.js` | Load/save the Live URL field (mirror `loadSavedCinemaUrl` + the Cinema validation/save block in `handleSaveSettings`) | 🔄 Semi‑stable | |
| `public/scripts/main.js` (734 ln) | Import `loadLiveChannels()` and call it inside the existing **`loadEpgData()`** handler (the "Load EPG data" button), after the EPG parse, non-blocking | 🔄 Semi‑stable | one call site added |
| `public/index.html` | Add a **Live TV M3U URL** text input in the Settings form, after the Cinema URL block (id `liveUrl`) | 🔄 Semi‑stable | no new modal — reuse `#programModal` |
| `public/styles/components/modal.css` (or `results.css`) | Optional spacing class `.modal-watch-live` (margin-top) | 🔄 Semi‑stable | button reuses `.btn .btn-primary`; minimal CSS |

### 4.5 Key code sketches (illustrative)

**`parseLiveM3u` (m3uParser.js):**
```js
// Returns Map<tvgId, {tvgId, name, streamUrl, logo, tvgRec}>
export function parseLiveM3u(text) {
  const map = new Map();
  const lines = text.split('\n');
  let cur = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U') || line.startsWith('#EXTGRP')) continue;
    if (line.startsWith('#EXTINF:')) {
      const content = line.substring(8);
      const tvgId = (content.match(/tvg-id="([^"]*)"/) || [])[1] || '';
      const logo  = (content.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
      const rec   = parseInt((content.match(/tvg-rec="([^"]*)"/) || [])[1], 10) || 0;
      const comma = content.lastIndexOf(',');
      const name  = comma !== -1 ? content.substring(comma + 1).trim() : '';
      cur = { tvgId, name, logo, tvgRec: rec, streamUrl: '' };
    } else if (!line.startsWith('#') && cur) {
      cur.streamUrl = line;
      if (cur.tvgId) map.set(cur.tvgId, cur);
      cur = null;
    }
  }
  return map;
}
```

**Modal button (results.js, inside `showProgramModal`):**
```js
import { sanitizeUrl, escapeAttr } from '../utils/sanitize.js';

const liveCh = window.appState?.liveChannels?.get(program.channelId);
const streamUrl = liveCh ? sanitizeUrl(liveCh.streamUrl) : null;
const watchLiveHtml = streamUrl
  ? `<a href="${escapeAttr(streamUrl)}" target="_blank" rel="noopener noreferrer"
        class="btn btn-primary modal-watch-live">▶ Watch Live</a>`
  : '';
// → insert ${watchLiveHtml} right after the modal-info-grid block
```

### 4.6 Shared escaping helpers (note)
`escapeHtml`/`escapeAttr`/`sanitizeUrl` are currently **duplicated locally in `cinemaTab.js`**, and `results.js` has only `escapeHtml`. Rather than add a third copy, Phase 1 introduces `utils/sanitize.js` and uses it in the **new** code (`results.js` Watch Live link). Migrating Cinema to the shared util is **out of scope** here (AI.md: "no unsolicited refactors") and can be a separate cleanup.

### 4.7 Security / correctness
- **XSS:** stream URL passed through `sanitizeUrl` (http/https only) and `escapeAttr`. Same guarantees as Cinema.
- **Mixed content:** streams are `http://` and prod is `https://`. A top‑level `<a target="_blank">` navigation is **not** blocked (only in‑page subresources are). Cinema already relies on this. ✅
- **Relative-path rule (AI.md):** that rule governs *our* API/module/asset URLs — the live `fetchM3uData` call already routes through the relative `/api/proxy` in production. The absolute `http://…m3u8` is *user playlist content* (a media URL), exactly like Cinema's `streamUrl`; not a violation.
- **File-size rule (AI.md ~800):** load logic goes in new `liveChannels.js` to keep `main.js` (734) under limit; nothing added to `cinemaTab.js` (already 837).

### 4.8 Developer task breakdown
Implement in order. Each task is independently testable; the **Done when** line is its acceptance check. No build step — edit files and reload the browser.

**Task 1 — `utils/storage.js`: Live URL persistence**
- Add to `STORAGE_KEYS`: `LIVE_URL: 'iptv_live_url'`, `LIVE_LAST_UPDATED: 'iptv_live_last_updated'`.
- Add (mirror the existing Cinema functions exactly):
  - `saveLiveUrl(url: string): boolean` — empty string removes the key (like `saveCinemaUrl`).
  - `getLiveUrl(): string | null`
  - `hasLiveUrl(): boolean`
  - `saveLiveLastUpdated(ts: number): boolean`
  - `getLiveLastUpdated(): number | null`
- **Done when:** in console, `saveLiveUrl('http://x')` then `getLiveUrl()` round-trips; `saveLiveUrl('')` clears it.

**Task 2 — `public/index.html`: Settings input**
- After the Cinema URL form group (≈ lines 85–98), add a form group with `<label for="liveUrl">Live TV M3U URL</label>`, `<input type="url" id="liveUrl" name="liveUrl" class="form-input" placeholder="http://248on.com/x/4a27b28d.m3u8">`, and `<p class="form-help">URL to your live‑channel M3U playlist. Used by the TV Guide "Watch Live" button.</p>`.
- No inline styles; reuse existing form classes.
- **Done when:** field renders in the Settings panel.

**Task 3 — `components/settings.js`: load / validate / save Live URL**
- Import `saveLiveUrl, getLiveUrl` from storage.
- Add `loadSavedLiveUrl()` (mirror `loadSavedCinemaUrl`); call it in `initSettings()` and in the Cancel handler alongside `loadSavedCinemaUrl()`.
- In `handleSaveSettings()`: read `#liveUrl`, if non-empty validate `http:`/`https:` (mirror the Cinema validation block), then `saveLiveUrl(liveUrl || '')`.
- **Done when:** a saved Live URL persists and reloads into the field; a non‑http(s) value shows the existing inline error.

**Task 4 — `utils/m3uParser.js`: `parseLiveM3u`**
- Add `export function parseLiveM3u(text: string): Map<string, LiveChannel>` per the sketch in §4.5. **Do not modify** `parseM3u`/`parseExtInf` (cinema path).
- **Done when:** `parseLiveM3u(<tmp/playlist.m3u text>).size === 1214` and a sample entry has `streamUrl` + `tvgId`.

**Task 5 — `utils/sanitize.js` (new)**
- Export `escapeHtml(v): string`, `escapeAttr(v): string`, `sanitizeUrl(url): string | null` (allow `http://`/`https://` only) — copy semantics from the helpers currently in `cinemaTab.js`.
- **Done when:** `sanitizeUrl('javascript:x') === null`, `sanitizeUrl('http://a') === 'http://a'`.

**Task 6 — `utils/liveChannels.js` (new)**
```js
import { fetchM3uData, parseLiveM3u } from './m3uParser.js';
import { getLiveUrl, saveLiveLastUpdated } from './storage.js';

export async function loadLiveChannels() {
  const url = getLiveUrl();
  if (!url) { window.appState.liveChannels = null; return; }
  try {
    const text = await fetchM3uData(url);          // routes via /api/proxy in prod
    window.appState.liveChannels = parseLiveM3u(text);
    saveLiveLastUpdated(Date.now());
    console.log(`Live channels loaded: ${window.appState.liveChannels.size}`);
  } catch (e) {
    console.error('Live channels load failed (non-blocking):', e);
  }
}
```
- **Done when:** with a valid URL, `window.appState.liveChannels.size === 1214`; with no URL it is `null`; a fetch error logs but does not throw.

**Task 7 — `main.js`: wire into Load EPG**
- Add `liveChannels: null` to the `window.appState` initializer (≈ line 41).
- `import { loadLiveChannels } from './utils/liveChannels.js';`
- Inside `loadEpgData()`, after the EPG is parsed and stored, call `loadLiveChannels()`. It must **not block** the EPG UI — let the live load run after EPG results render (fire‑and‑forget, or `await` only after EPG success is shown).
- **Done when:** clicking **Load EPG data** populates both `appState.epgData` and `appState.liveChannels`; an EPG-only setup (no Live URL) still works.

**Task 8 — `components/results.js`: Watch Live in modal**
- `import { sanitizeUrl, escapeAttr } from '../utils/sanitize.js';`
- In `showProgramModal()`, build `watchLiveHtml` per §4.5 from `window.appState.liveChannels?.get(program.channelId)`, and inject it **after** the `.modal-info-grid` block and **before** the rating section.
- **Done when:** a result on a mapped channel shows **▶ Watch Live** (opens stream in a new tab); a result on an unmapped channel (one of the 89) shows no button; English label.

**Task 9 — CSS (optional)**
- Add `.modal-watch-live { margin-top: var(--space-lg); }` to `styles/components/modal.css`. Button otherwise uses `.btn .btn-primary`.
- **Done when:** button has consistent spacing in the modal.

### 4.9 Test plan (manual, no build step)
Run locally (`python3 -m http.server 8000` from `public/`, direct fetch path):
1. Settings → paste `http://248on.com/x/4a27b28d.m3u8` into Live TV M3U URL, save.
2. Click **Load EPG data** → confirm `window.appState.liveChannels.size === 1214` in console (and EPG still loads if the live fetch were to fail).
3. Search e.g. "Новости", open a result on a mapped channel (e.g. Первый HD) → **▶ Watch Live** appears.
4. Open a result on an unmapped channel (one of the 89) → **no** button.
5. Click Watch Live → opens the `.m3u8` in a new tab, same as Cinema Play.
6. Clear Live URL, click Load EPG data again → button gone for all; EPG unaffected; no console errors.
7. Verify behavior parity with Cinema Play (new tab, external player).

---

## 5. Phase 2 — Catch‑up (past programs) — design (verified)

Not built yet, but the two server unknowns are now **empirically confirmed** (probe of `pervyj-hd-orig`, 2026-06-21). Reuses Phase 1's `liveChannels` map and the same open‑in‑new‑tab mechanism — only the URL construction and a "▶ Catch‑up" label differ.

### 5.1 Confirmed server behavior
- **Catch‑up URL — ✅ confirmed:** append `?utc={programStartEpochSeconds}&lutc={nowEpochSeconds}` to the channel `streamUrl`.
  ```
  http://s03.wsbof.com:8080/s/6d6310b8/pervyj-hd-orig.m3u8?utc=1782055863&lutc=1782063063
  ```
  Evidence: requesting `utc = now−2h` returned a manifest with `#EXT-X-PROGRAM-DATE-TIME` = the requested time (≈2h before live) and segments on a `…/dvr-YYYY/MM/DD/HH/MM/…ts` archive path. The server injects per‑segment tokens into the returned manifest — nothing for the client to compute.
- **Continuous play past the boundary — ✅ confirmed:** the catch‑up manifest has **no `#EXT-X-ENDLIST`** (rolling DVR window, `MEDIA-SEQUENCE:0` advancing). An external player keeps pulling segments and **flows through the program boundary into the next program** automatically. → No client‑side stop logic and **no duration param** needed; this *is* the "see the finale" fix (decision §3.2).
- **Ground truth:** the DVR manifest exposes `#EXT-X-PROGRAM-DATE-TIME`, the authoritative wall‑clock of what's playing — useful insurance against the operator's ±1–3 min EPG drift.

### 5.2 `utc` computation — the one real code task (timezone-correct)
The server expects a **true UTC epoch** of the program start. `program.start` is timezone‑naive (§3.1) and must **not** be used. Derive from `program.startRaw` (which carries the `+0300` offset):
```js
// "20260614091000 +0300"  ->  epoch seconds (UTC)
export function epgRawToEpochSeconds(raw) {
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/);
  if (!m) return NaN;
  const [, Y, Mo, D, H, Mi, S, tz] = m;
  const off = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z';   // +0300 -> +03:00
  return Math.floor(Date.parse(`${Y}-${Mo}-${D}T${H}:${Mi}:${S}${off}`) / 1000);
}
// catch-up URL:
// `${streamUrl}?utc=${epgRawToEpochSeconds(program.startRaw)}&lutc=${Math.floor(Date.now()/1000)}`
```
- **No start offset** (decision §3.2): `utc = start` exactly.
- Suggested home: `utils/epgParser.js` (alongside the other time helpers), exported for the catch‑up button.

### 5.3 When the Catch‑up button shows
- A *past* program on a mapped channel with `tvgRec > 0` whose start is within `tvgRec` (≈7) days.
- Requires reliable past/now detection → fix or work around the timezone issue in §3.1 first (the same `epgRawToEpochSeconds` makes status reliable: compare `epgRawToEpochSeconds(stopRaw)` to `Date.now()/1000`).
- With decision §4.3 (Option A) keeping "▶ Watch Live" on all mapped channels, a past program may show **both** "▶ Watch Live" (jump to live) and "▶ Catch‑up" (play that program). Acceptable; labels disambiguate.

### 5.4 Validation checklist before/after building Phase 2
1. **Conversion sanity:** `epgRawToEpochSeconds("20260614091000 +0300") === Date.parse("2026-06-14T06:10:00Z")/1000` (09:10 MSK = 06:10 UTC).
2. **Ground‑truth round‑trip:** build the `?utc=` URL from a recent program's `startRaw`, fetch it, confirm the returned `#EXT-X-PROGRAM-DATE-TIME` ≈ the program's real start.
3. **In‑player smoke test:** open a catch‑up URL for a program ending soon in the Cinema external‑player path; confirm playback continues into the next program without stopping.

---

## 6. Out of scope / non-goals
- In‑page HTML5 `<video>` + hls.js player (would require proxying the HLS manifest **and** every `.ts` segment through `/api/proxy` due to mixed content — large scope, against the lightweight/no‑build architecture).
- A dedicated "Live TV" tab or channel browser. Phase 1 augments existing TV Guide results only.
- Reminders/notifications for future programs.
- Migrating Cinema to the shared `sanitize.js`.

---

## 7. Resolved decisions
1. **Load trigger:** the live map loads via the existing **"Load EPG data"** button (`loadEpgData()` also calls `loadLiveChannels()`), non-blocking. *(Not auto-loaded on init / not reloaded on settings save.)*
2. **Naming:** module `utils/liveChannels.js`, storage key `iptv_live_url`. ✔
3. **Button visibility:** **Option A** — show "Watch Live" on every result whose channel is in the live map, regardless of program status. ✔
4. **Escaping helpers:** introduce shared `utils/sanitize.js` for the new code; **do not** refactor Cinema's local copies (out of scope). ✔
5. **Button label:** English only — `▶ Watch Live`. ✔
6. **Button placement / CSS:** after the modal info-grid; reuse `.btn .btn-primary` with optional `.modal-watch-live` spacing. ✔

### Phase 2 — verified 2026-06-21 (see §5)
- ✅ Catch-up URL format confirmed: `?utc={start}&lutc={now}` (server returns the `dvr-` archive at the requested time).
- ✅ Continuous play confirmed: catch-up manifest has no `#EXT-X-ENDLIST` → external player rolls into the next program; no stop logic / duration param needed.
- ✅ Timezone fix specified: use `epgRawToEpochSeconds(startRaw)` for `utc` (§5.2) — do **not** use the timezone-naive `program.start`.

Remaining for Phase 2 implementation (no blocking unknowns): wire the helper + "▶ Catch‑up" button, gate by `tvgRec`/past-status, and run the §5.4 validation checklist.

---

## 8. Architecture / AI-rule compliance checklist
- [x] No build step; vanilla ES6 modules.
- [x] No inline CSS/JS in HTML (input + button use classes/external JS).
- [x] JS files kept ≤ ~800 lines (new module instead of growing `main.js`/`cinemaTab.js`).
- [x] Dynamic HTML sanitized (`sanitizeUrl` + `escapeAttr`).
- [x] localStorage‑only persistence; CORS via existing `/api/proxy`.
- [x] sqowe/Material button reused (`.btn .btn-primary`); 8px spacing for any new CSS.
- [x] Reuses existing `#programModal`, `fetchM3uData`, Cinema patterns — minimal new surface.
