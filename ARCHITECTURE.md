# ARCHITECTURE.md

## 1. Purpose of This Document

**What it does:**
- Provides architectural overview of the IPTV EPG Search application
- Maps components to stability zones for safe modifications
- Documents data flows and runtime behavior
- References AI coding rules (does NOT define them)

**What it doesn't do:**
- Define coding standards (see AI*.md files)
- Duplicate implementation details (see code comments)
- Specify deployment procedures (see README.md)

**Audience:**
- AI coding assistants working on this codebase
- New developers onboarding to the project
- Future maintainers understanding system design

---

## 2. High-Level System Overview

**Project Type:** Client-side web application for searching IPTV Electronic Program Guide (EPG) data

**Characteristics:**
- Pure frontend (vanilla JavaScript ES6 modules)
- No build step required (runs directly in browser)
- Serverless proxy for CORS handling (Vercel Functions)
- Local-first (localStorage for settings, no backend database)
- Material-inspired UI following sqowe brand guidelines

**Tech Stack:**

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Vanilla JS (ES6 modules) | Application logic |
| UI Framework | None (pure HTML/CSS) | Lightweight, no dependencies |
| Styling | CSS (modular) | sqowe brand design system |
| Data Format | XMLTV (gzipped) | EPG standard format |
| Data Format | Extended M3U | Cinema catalog format |
| Decompression | Pako.js (local) | Gzip decompression |
| Fuzzy Search | Fuse.js (local) | Fuzzy string matching |
| Stemming | Snowball (local) | Russian/English morphology |
| Storage | localStorage | Settings persistence |
| Deployment | Vercel | Static hosting + serverless functions |
| CORS Proxy | Vercel Serverless Function | Bypass EPG/M3U server CORS |

**Architecture Pattern:**

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  public/index.html (Single Page)                       │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Tab Navigation: [TV Guide] [Cinema]             │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │ │
│  │  │   Settings   │  │   Search     │  │   Results   │  │ │
│  │  │  Component   │  │   Controls   │  │  Component  │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘  │ │
│  │         │                  │                  │         │ │
│  │         └──────────────────┴──────────────────┘         │ │
│  │                            │                             │ │
│  │                    ┌───────▼────────┐                   │ │
│  │                    │  main.js       │                   │ │
│  │                    │  (Bootstrap)   │                   │ │
│  │                    └───────┬────────┘                   │ │
│  │                            │                             │ │
│  │    ┌───────────────────────┼───────────────────────┐    │ │
│  │    │           │           │           │           │    │ │
│  │  ┌─▼──────┐ ┌─▼───────┐ ┌▼────────┐ ┌▼────────┐  │    │ │
│  │  │storage │ │epgParser│ │ search  │ │m3uParser│  │    │ │
│  │  │  .js   │ │   .js   │ │  .js    │ │   .js   │  │    │ │
│  │  └────────┘ └────┬────┘ └─────────┘ └─────────┘  │    │ │
│  │                   │                                │    │ │
│  └───────────────────┼────────────────────────────────┘    │ │
│                      │                                      │
│           ┌──────────▼──────────┐                          │
│           │   Pako.js (local)   │                          │
│           │  Gzip Decompression │                          │
│           └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Vercel Platform    │
                    │  ┌────────────────┐ │
                    │  │ /api/proxy.js  │ │ (Serverless Function)
                    │  └────────┬───────┘ │
                    └───────────┼─────────┘
                                │
               ┌────────────────┼────────────────┐
               │                                 │
    ┌──────────▼──────────┐       ┌──────────────▼───────┐
    │  EPG Server          │       │  Cinema M3U Server   │
    │  (External XMLTV)    │       │  (External M3U)      │
    └──────────────────────┘       └──────────────────────┘
```

---

## 3. Repository Structure

```
iptv-web/
├── .git/                          # Git repository
├── .gitignore                     # Git ignore rules
├── .vercelignore                  # Vercel deployment ignore
│
├── AI.md                          # ✅ Web interface coding rules (HTML/CSS/JS)
├── AI_FRONTEND.md                 # ✅ React/TypeScript rules (reference, not used)
├── AI_WEB_DESIGN_SQOWE.md         # ✅ sqowe brand design system
├── CLAUDE.md                      # ✅ AI behavioral rules
├── ARCHITECTURE.md                # ✅ This file
├── README.md                      # ✅ User documentation
│
├── package.json                   # ✅ Project metadata, scripts
├── vercel.json                    # ✅ Vercel deployment config
│
├── api/                           # ✅ Serverless functions
│   └── proxy.js                   # CORS proxy for EPG/M3U fetching
│
└── public/                        # ✅ Static web root
    ├── index.html                 # Single-page application entry
    │
    ├── scripts/                   # JavaScript modules
    │   ├── main.js                # Application bootstrap
    │   │
    │   ├── components/            # UI components
    │   │   ├── results.js         # Results display, modal, view toggle
    │   │   ├── settings.js        # Settings panel, URL management
    │   │   ├── channelFilter.js   # Channel filter popup, grouping, persistence
    │   │   ├── tabs.js            # Tab navigation (TV Guide / Cinema)
    │   │   └── cinemaTab.js       # Cinema tab: load, search, filter, display
    │   │
    │   └── utils/                 # Utility modules
    │       ├── epgParser.js       # XML parsing, decompression, time utils
    │       ├── m3uParser.js       # M3U parsing, series grouping, cinema filters
    │       ├── search.js          # Search, filter, sort logic (incl. channel filter)
    │       ├── fuzzySearch.js     # Fuse.js integration, stemming
    │       ├── ratings.js         # Program rating system
    │       └── storage.js         # localStorage wrapper
    │
    └── styles/                    # CSS modules
        ├── base.css               # CSS variables, resets, typography
        ├── layout.css             # Grid, containers, spacing
        │
        └── components/            # Component-specific styles
            ├── button.css         # Button variants
            ├── card.css           # Card component
            ├── channel-filter.css # Channel filter popup styles
            ├── cinema.css         # Cinema cards, series modal, genre dropdown
            ├── form.css           # Form inputs, labels
            ├── modal.css          # Modal dialog
            ├── rating.css         # Rating stars
            ├── results.css        # Results grid/list
            └── tabs.css           # Tab navigation bar

```

**Critical Paths:**
- **Entry point:** `public/index.html` → `public/scripts/main.js`
- **Configuration:** `vercel.json` (deployment), `package.json` (metadata)
- **AI Rules:** `AI.md` (primary), `AI_WEB_DESIGN_SQOWE.md` (design), `CLAUDE.md` (behavior)
- **CORS Proxy:** `api/proxy.js` (Vercel serverless function)

---

## 4. Core Components

### 4.1 Frontend (Vanilla JavaScript)

**main.js** (Bootstrap)
- Initializes all components and event listeners
- Manages global application state (`window.appState`)
- Orchestrates data flow between components
- Handles EPG data loading and search execution

**components/settings.js**
- Settings panel UI (show/hide, form handling)
- EPG URL validation and persistence
- localStorage integration via `storage.js`

**components/results.js**
- Results rendering (grid/list views)
- Program card/list item creation
- Modal dialog for program details
- View toggle controls
- State management (loading, error, no data, no results)

**components/channelFilter.js**
- Channel filter popup UI with grouping
- Auto-categorizes channels (HD, News, Movies, Sports, Kids, General)
- Quick filter buttons for category selection
- "In Results" toggle to show channels in current results
- Selection persistence via localStorage
- Bulk actions (Select All, Clear All, Invert)

**components/tabs.js**
- Tab navigation UI (TV Guide / Cinema)
- Tab switching with localStorage persistence
- ARIA attributes for accessibility
- Validates saved tab against available tabs on init

**components/cinemaTab.js**
- Cinema tab UI: search, filters, results display
- Loads and parses M3U playlists via m3uParser
- Filters: category, genre (multi-select dropdown), rating, year range
- Displays grouped series as single cards with episode count
- Series modal with season tabs and episode play links
- Film modal with metadata and play button
- Cancel-and-replace loading with AbortController

**utils/epgParser.js**
- Fetches EPG data (direct or via proxy)
- Decompresses gzipped XML using Pako.js
- Parses XMLTV format into JavaScript objects
- Time parsing and formatting utilities
- EPG structure analysis (field discovery)

**utils/search.js**
- Search by title, description, channel
- Time-based filtering (past, current, future)
- Sorting (time, channel, title)
- Result limiting (performance protection)

**utils/m3uParser.js**
- Fetches M3U data (direct or via proxy, with AbortSignal support)
- Parses extended M3U format into structured objects
- Extracts metadata: title, genres, rating, year, country, director, poster, description
- Groups serial episodes into series (S##E## detection, case-insensitive)
- Deduplicates episodes, consolidates metadata across episodes
- Filters by category, genre, rating, year, text search
- Sorts by rating, year, added date, title

**utils/fuzzySearch.js**
- Fuse.js integration for fuzzy string matching
- Russian/English stemming via Snowball
- Search index building with progress reporting

**utils/ratings.js**
- Program rating system (1-5 stars)
- Rating persistence in localStorage
- Export/import ratings as JSON
- Rating boost for search results

**utils/storage.js**
- localStorage wrapper for EPG URL
- Last updated timestamp tracking
- Storage validation and error handling

### 4.2 Backend (Serverless)

**api/proxy.js** (Vercel Function)
- Proxies EPG requests to bypass CORS
- Validates URLs (HTTP/HTTPS only)
- Streams gzipped data to client
- Error handling and logging
- Only active in production (Vercel deployment)

### 4.3 External Integrations

**Pako.js** (CDN)
- Gzip decompression library
- Loaded from `cdnjs.cloudflare.com`
- Required for EPG data processing

**Google Fonts** (CDN)
- Montserrat font family (sqowe brand)
- Weights: 300, 400, 500, 700

**EPG Servers** (External)
- XMLTV format (gzipped)
- User-configured URLs
- No authentication required

---

## 5. Data Flow & Runtime Model

### 5.1 Application Initialization

```
Browser Load
    │
    ├─> Load index.html
    │       │
    │       ├─> Load CSS (base, layout, components)
    │       ├─> Load Pako.js (CDN)
    │       └─> Load main.js (ES6 module)
    │
    └─> main.js init()
            │
            ├─> initSettings() → Load saved EPG URL from localStorage
            ├─> initControls() → Attach event listeners
            ├─> initViewToggle() → Setup grid/list toggle
            ├─> initModal() → Setup program details modal
            │
            └─> Check if EPG URL configured
                    │
                    ├─> YES: Show "Load EPG Data" button
                    └─> NO:  Show "No Data" state
```

### 5.2 EPG Data Loading Flow

```
User clicks "Load EPG Data"
    │
    ├─> getEpgUrl() from localStorage
    │
    ├─> fetchEpgData(url)
    │       │
    │       ├─> Check environment (localhost vs production)
    │       │
    │       ├─> Production: /api/proxy?url=...
    │       │       │
    │       │       └─> Vercel Function → External EPG Server
    │       │
    │       └─> Localhost: Direct fetch to EPG URL
    │
    ├─> Receive gzipped ArrayBuffer
    │
    ├─> pako.inflate() → Decompress to XML string
    │
    ├─> parseEpgXml(xmlString)
    │       │
    │       ├─> DOMParser → Parse XML
    │       ├─> Extract channels (id, name)
    │       ├─> Extract programs (title, desc, times, channel)
    │       └─> Return { channels, programs, totals }
    │
    ├─> Store in window.appState.epgData
    │
    ├─> saveLastUpdated(timestamp) to localStorage
    │
    └─> Display success message with totals
```

### 5.3 Search and Filter Flow

```
User enters search query OR selects filter OR changes channel selection
    │
    ├─> Validate: min 2 chars OR time filter selected
    │
    ├─> applyFilters(programs, options)
    │       │
    │       ├─> filterByChannels() → selected channels only
    │       ├─> filterByTime() → past/current/future
    │       └─> searchPrograms() → title/desc/channel match
    │
    ├─> sortPrograms(filtered, sortBy)
    │       │
    │       └─> Sort by time/channel/title
    │
    ├─> Limit to 100 results (performance)
    │
    ├─> Store in window.appState.currentResults
    │
    ├─> updateChannelsInResults() → Track channels in results
    │
    └─> displayResults()
            │
            ├─> Check view mode (grid/list)
            ├─> Render program cards/items
            └─> Attach click handlers → showProgramModal()
```

### 5.4 Cinema Data Loading & Search Flow

```
User clicks "Load Cinema Data" (Cinema tab)
    │
    ├─> getCinemaUrl() from localStorage
    │
    ├─> fetchM3uData(url, signal)
    │       │
    │       ├─> Production: /api/proxy?url=...
    │       └─> Localhost: Direct fetch
    │
    ├─> Receive M3U text (plain text, not gzipped)
    │
    ├─> parseM3u(text) [chunked async, yields to event loop]
    │       │
    │       ├─> Parse #EXTINF attributes (genres, rating, year, etc.)
    │       ├─> Parse #EXTIMG (poster URL)
    │       ├─> Parse #EXTDESC (description)
    │       └─> Return { items, categories, genres, stats }
    │
    ├─> groupSeriesEpisodes(items)
    │       │
    │       ├─> Detect S##E## pattern in titles (case-insensitive)
    │       ├─> Group episodes by normalized series title
    │       ├─> Deduplicate episodes (season+episode key)
    │       ├─> Consolidate metadata (merge genres, earliest year, etc.)
    │       └─> Return { films: [...], series: [...] }
    │
    ├─> Store in cinemaState (module-scoped)
    │
    └─> Populate category/genre dropdowns

Cinema Search:
    │
    ├─> filterCinemaItems(displayItems, filters)
    │       │
    │       ├─> Filter by category
    │       ├─> Filter by genres (OR logic)
    │       ├─> Filter by min rating
    │       ├─> Filter by year range
    │       └─> Filter by text (title + seriesTitle + description)
    │
    ├─> sortCinemaItems(filtered, sortBy)
    │
    ├─> Limit to 100 results
    │
    └─> displayCinemaResults()
            │
            ├─> Render film cards (poster, title, rating, year)
            ├─> Render series cards (poster, title, season/episode count)
            ├─> Click film → showFilmModal() (metadata + play button)
            └─> Click series → showSeriesModal() (season tabs + episode list)
```

### 5.5 Configuration Loading Hierarchy

```
1. Browser localStorage (persistent)
   ├─> EPG URL, Last Updated timestamp
   ├─> Cinema M3U URL, Cinema Last Updated timestamp
   ├─> Active tab preference (tv-guide / cinema)
   ├─> Channel filter selection (iptv-channel-filter key)
   └─> Search preferences (fuzzy, threshold, manual mode)

2. Application State (runtime)
   └─> window.appState
       ├─> epgData (parsed XML)
       ├─> currentResults (filtered programs)
       ├─> searchQuery, searchScope, timeFilter
       ├─> selectedChannels (Set of channel IDs)
       └─> sortBy, maxResults

3. Environment Detection (runtime)
   └─> window.location.hostname
       ├─> localhost/127.0.0.1 → Direct EPG fetch
       └─> Other → Use /api/proxy
```

---

## 6. Configuration & Environment Assumptions

### 6.1 Environment Variables

**None required.** Application is fully client-side with no secrets.

### 6.2 Configuration Files

**vercel.json**
- Rewrites: Routes `/` to `/public/`
- Headers: Sets correct MIME types for JS/CSS
- Serverless functions: Auto-detected in `/api/`

**package.json**
- Scripts: `dev` (local server), `deploy` (Vercel)
- Type: `module` (ES6 modules)

### 6.3 Deployment Assumptions

**Local Development:**
- Python HTTP server on port 8000
- Direct EPG fetching (no proxy)
- CORS may fail depending on EPG server

**Production (Vercel):**
- Static files served from `/public/`
- Serverless function at `/api/proxy`
- CORS handled by proxy
- HTTPS enforced

**Browser Requirements:**
- ES6 module support
- localStorage API
- DOMParser API
- Fetch API
- Modern CSS (Grid, Flexbox, CSS Variables)

---

## 7. Stability Zones

### ✅ Stable (Production-Ready, Low Risk)

| Component | Path | Notes |
|-----------|------|-------|
| EPG Parser | `public/scripts/utils/epgParser.js` | Core parsing logic, well-tested |
| Search Logic | `public/scripts/utils/search.js` | Filtering and sorting, stable |
| Storage Wrapper | `public/scripts/utils/storage.js` | Simple localStorage abstraction |
| CORS Proxy | `api/proxy.js` | Minimal, production-proven |
| Base Styles | `public/styles/base.css` | sqowe brand variables |
| Layout System | `public/styles/layout.css` | Grid and spacing |

**Guidance:** Safe to modify with standard testing. Core business logic is here.

### 🔄 Semi-Stable (Functional, May Evolve)

| Component | Path | Notes |
|-----------|------|-------|
| Main Bootstrap | `public/scripts/main.js` | May add features (pagination) |
| Results Component | `public/scripts/components/results.js` | UI enhancements likely |
| Settings Component | `public/scripts/components/settings.js` | May add more settings |
| Channel Filter | `public/scripts/components/channelFilter.js` | Established feature, may evolve |
| Tab Navigation | `public/scripts/components/tabs.js` | Stable, may add more tabs |
| Cinema Tab | `public/scripts/components/cinemaTab.js` | New feature, actively evolving |
| M3U Parser | `public/scripts/utils/m3uParser.js` | New, series grouping may evolve |
| Component Styles | `public/styles/components/*.css` | Design refinements expected |
| HTML Structure | `public/index.html` | May add sections/features |

**Guidance:** Modify carefully. Test UI changes across devices. Follow sqowe brand guidelines.

### ⚠️ Experimental (Working, May Be Replaced)

| Component | Path | Notes |
|-----------|------|-------|
| View Toggle | Grid/List view in `results.js` | May add more view modes |
| Result Limiting | 100-item cap in `main.js` | May implement pagination |
| EPG Analysis | `analyzeEpgXml()` in `epgParser.js` | Debug tool, may be removed |
| Series Grouping Regex | `EPISODE_REGEX` in `m3uParser.js` | May need more patterns |

**Guidance:** These features work but may be redesigned. Don't build dependencies on them.

### 🔮 Planned (Not Yet Implemented)

| Feature | Description | Priority |
|---------|-------------|----------|
| Pagination | Handle >100 results gracefully | Medium |
| Favorites | Save favorite programs/movies | Low |
| Export | Export search results | Low |
| Dark Mode | Theme toggle | Low |
| Cinema Fuzzy Search | Fuse.js index for cinema catalog | Medium |

**Guidance:** These are ideas, not commitments. Discuss before implementing.

---

## 8. AI Coding Rules and Behavioral Contracts

### 8.1 Statement

**This document does NOT define coding rules.** All coding standards, formatting rules, and stack-specific practices are defined in the AI*.md files listed below.

### 8.2 AI Guidance Files

| File | Purpose | Scope |
|------|---------|-------|
| `CLAUDE.md` | AI behavioral rules | Always check docs/, never start coding without proposal |
| `AI.md` | Web interface guidelines | HTML/CSS/JS, Material-inspired, file size limits |
| `AI_WEB_DESIGN_SQOWE.md` | sqowe brand design system | Colors, typography, components, accessibility |
| `AI_FRONTEND.md` | React/TypeScript rules | Reference only (not used in this project) |

### 8.3 Rule Precedence Hierarchy

When conflicts arise, follow this order (highest to lowest priority):

1. **User explicit request** (current conversation)
2. **Stack-specific rules** (`AI.md`, `AI_WEB_DESIGN_SQOWE.md`)
3. **Global behavioral rules** (`CLAUDE.md`)
4. **Architecture decisions** (this document)
5. **General conventions** (industry standards)

### 8.4 Conflict Resolution Process

**If rules conflict:**

1. **STOP** - Do not proceed with implementation
2. **Identify** - Note which rules conflict and why
3. **Ask** - Present options to user with trade-offs
4. **Wait** - Get explicit user decision before proceeding
5. **Document** - Update relevant AI*.md file if needed

**Example:**
```
AI.md says: "Keep JS files ~800 lines or less"
User says: "Add 500 lines of new features to main.js (currently 300 lines)"

→ STOP: This will exceed the 800-line limit
→ ASK: "This will make main.js ~800 lines. Should I:
   A) Split into multiple modules (recommended)
   B) Proceed and refactor later
   C) Reconsider the feature scope"
```

### 8.5 Key Architectural Decisions to Preserve

**DO NOT change without explicit user approval:**

1. **No build step** - Keep vanilla JS, no bundlers
2. **ES6 modules** - No CommonJS, no transpilation
3. **sqowe brand** - All UI must follow `AI_WEB_DESIGN_SQOWE.md`
4. **File size limits** - JS files ~800 lines max (split if needed)
5. **No inline styles/scripts** - Separation of concerns
6. **localStorage only** - No backend database
7. **Vercel deployment** - Static + serverless functions
8. **CORS proxy pattern** - Production uses `/api/proxy`

**MAY change with discussion:**

- View modes (grid/list → add more)
- Result limiting (100 → pagination)
- Search scope options (add more fields)
- UI enhancements (animations, transitions)

---

## 9. Quick Start for AI Assistants

### Pre-Flight Checklist Before Making Changes

- [ ] Read `CLAUDE.md` for behavioral rules
- [ ] Read `AI.md` for web coding standards
- [ ] Read `AI_WEB_DESIGN_SQOWE.md` if touching UI/CSS
- [ ] Check Section 7 (Stability Zones) for component risk level
- [ ] Verify file size limits (~800 lines for JS)
- [ ] Propose changes before implementing (per `CLAUDE.md`)
- [ ] Test in browser (no build step, direct file changes)

### Where to Find Information

| Need | Location |
|------|----------|
| Coding standards | `AI.md`, `AI_WEB_DESIGN_SQOWE.md` |
| Architecture overview | This file (Section 2, 4) |
| Data flows | This file (Section 5) |
| Component stability | This file (Section 7) |
| User documentation | `README.md` |
| Deployment config | `vercel.json`, `package.json` |
| Implementation details | Code comments in source files |

### Common Tasks

**Add a new search filter:**
1. Update `public/scripts/utils/search.js` (add filter function)
2. Update `public/scripts/main.js` (add UI control and state)
3. Update `public/index.html` (add form control)
4. Update `public/styles/components/form.css` (style if needed)

**Add a new UI component:**
1. Create `public/scripts/components/[name].js`
2. Create `public/styles/components/[name].css`
3. Import in `public/scripts/main.js`
4. Link CSS in `public/index.html`
5. Follow sqowe brand guidelines (`AI_WEB_DESIGN_SQOWE.md`)

**Add a new cinema filter:**
1. Add filter state to `cinemaState` in `cinemaTab.js`
2. Add filter logic to `filterCinemaItems()` in `m3uParser.js`
3. Add UI control in cinema tab panel in `index.html`
4. Wire up event listener in `initCinemaControls()`
5. Call `performCinemaSearch()` on filter change

**Modify EPG parsing:**
1. Update `public/scripts/utils/epgParser.js`
2. Test with real EPG data (gzipped XMLTV)
3. Check `analyzeEpgXml()` output for field availability

**Fix CORS issues:**
1. Check environment detection in `epgParser.js`
2. Verify `api/proxy.js` is deployed (Vercel only)
3. Test locally (direct fetch) vs production (proxy)

---

**Document Version:** 2.0
**Last Updated:** May 6, 2026
**Total Lines:** ~400

