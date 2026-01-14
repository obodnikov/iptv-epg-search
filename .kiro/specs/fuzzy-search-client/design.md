# Design Document

## Overview

This design implements a client-side fuzzy search system with Russian morphology support and a program rating feature. The solution uses the Snowball stemming algorithm for morphological normalization and Fuse.js for fuzzy matching, both loaded via CDN to maintain the no-build-step architecture.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    main.js                              │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │ │
│  │  │   Settings   │  │   Search     │  │   Results   │  │ │
│  │  │  Component   │  │   Controls   │  │  Component  │  │ │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  │ │
│  │                            │                            │ │
│  │         ┌──────────────────┼──────────────────┐        │ │
│  │         │                  │                  │        │ │
│  │    ┌────▼─────┐     ┌─────▼──────┐    ┌─────▼─────┐  │ │
│  │    │ storage  │     │fuzzySearch │    │  ratings  │  │ │
│  │    │  .js     │     │    .js     │    │   .js     │  │ │
│  │    └──────────┘     └─────┬──────┘    └───────────┘  │ │
│  │                           │                           │ │
│  │              ┌────────────┼────────────┐             │ │
│  │              │            │            │             │ │
│  │         ┌────▼────┐  ┌───▼────┐  ┌───▼────┐        │ │
│  │         │Snowball │  │ Fuse.js│  │ search │        │ │
│  │         │ (CDN)   │  │ (CDN)  │  │  .js   │        │ │
│  │         └─────────┘  └────────┘  └────────┘        │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### New Module: fuzzySearch.js

```javascript
// public/scripts/utils/fuzzySearch.js

/**
 * Initialize the fuzzy search engine with EPG data
 * @param {Array} programs - Array of program objects
 * @returns {Object} - Configured Fuse.js instance
 */
export function initSearchIndex(programs);

/**
 * Perform fuzzy search with stemming
 * @param {Object} fuseInstance - Initialized Fuse.js instance
 * @param {string} query - User search query
 * @param {Object} options - Search options (scope, threshold)
 * @returns {Array} - Matched programs with scores
 */
export function fuzzySearch(fuseInstance, query, options);

/**
 * Stem a text string using Snowball
 * @param {string} text - Input text
 * @param {string} language - 'russian' or 'english'
 * @returns {string} - Stemmed text
 */
export function stemText(text, language);

/**
 * Detect language of text (simple heuristic)
 * @param {string} text - Input text
 * @returns {string} - 'russian' or 'english'
 */
export function detectLanguage(text);
```

### New Module: ratings.js

```javascript
// public/scripts/utils/ratings.js

/**
 * Get rating for a program
 * @param {string} programId - Unique program identifier (title + channel + start)
 * @returns {number|null} - Rating 1-5 or null if not rated
 */
export function getRating(programId);

/**
 * Set rating for a program
 * @param {string} programId - Unique program identifier
 * @param {number} rating - Rating 1-5
 */
export function setRating(programId, rating);

/**
 * Remove rating for a program
 * @param {string} programId - Unique program identifier
 */
export function removeRating(programId);

/**
 * Get all ratings
 * @returns {Object} - Map of programId to rating
 */
export function getAllRatings();

/**
 * Export ratings to JSON string
 * @returns {string} - JSON string of all ratings
 */
export function exportRatings();

/**
 * Import ratings from JSON string
 * @param {string} jsonString - JSON string of ratings
 * @returns {boolean} - Success status
 */
export function importRatings(jsonString);

/**
 * Clear all ratings
 */
export function clearAllRatings();

/**
 * Generate unique program ID
 * @param {Object} program - Program object
 * @returns {string} - Unique identifier
 */
export function getProgramId(program);
```

### New UI Component: ratingControl.js

```javascript
// public/scripts/components/ratingControl.js

/**
 * Create a star rating control element
 * @param {string} programId - Program identifier
 * @param {number|null} currentRating - Current rating or null
 * @param {Function} onRatingChange - Callback when rating changes
 * @returns {HTMLElement} - Rating control element
 */
export function createRatingControl(programId, currentRating, onRatingChange);

/**
 * Update rating display
 * @param {HTMLElement} control - Rating control element
 * @param {number|null} rating - New rating value
 */
export function updateRatingDisplay(control, rating);
```

## Data Models

### Search Index Structure

```javascript
// Fuse.js configuration
const fuseOptions = {
  keys: [
    { name: 'stemmedTitle', weight: 2 },
    { name: 'stemmedDescription', weight: 1 },
    { name: 'channelName', weight: 0.5 }
  ],
  threshold: 0.4,           // 0 = exact, 1 = match anything
  distance: 100,            // How far to search for match
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
  shouldSort: true
};

// Indexed program structure
const indexedProgram = {
  ...originalProgram,
  stemmedTitle: 'убийств москв',      // Stemmed version
  stemmedDescription: 'детектив...',   // Stemmed version
  programId: 'title|channel|timestamp' // Unique ID for ratings
};
```

### Ratings Storage Structure

```javascript
// localStorage key: 'epg_ratings'
const ratingsData = {
  version: 1,
  ratings: {
    'programId1': 5,
    'programId2': 3,
    'programId3': 1
  },
  lastUpdated: '2026-01-14T12:00:00Z'
};
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Stemming Consistency

*For any* Russian word, stemming the word twice SHALL produce the same result as stemming it once (idempotence).

**Validates: Requirements 1.2**

### Property 2: Search Result Inclusion

*For any* search query that exactly matches a program title, that program SHALL appear in the fuzzy search results.

**Validates: Requirements 1.1, 2.1**

### Property 3: Rating Persistence Round-Trip

*For any* valid rating (1-5) set for a program, retrieving the rating SHALL return the same value.

**Validates: Requirements 4.2**

### Property 4: Export/Import Round-Trip

*For any* set of ratings, exporting then importing SHALL restore the exact same ratings.

**Validates: Requirements 5.1, 5.2**

### Property 5: Score Ordering

*For any* search results, programs SHALL be ordered by descending relevance score (lower Fuse.js score = better match = higher position).

**Validates: Requirements 2.2, 2.3**

### Property 6: Rating Boost Effect

*For any* two programs with equal search scores, the program with a higher user rating SHALL appear first in results.

**Validates: Requirements 4.3**

## Error Handling

| Error Condition | Handling Strategy |
|-----------------|-------------------|
| Snowball CDN fails to load | Fall back to exact match search, show warning |
| Fuse.js CDN fails to load | Fall back to exact match search, show warning |
| localStorage quota exceeded | Show error, suggest exporting and clearing old data |
| Invalid import JSON | Reject import, show validation error, preserve existing |
| Empty search query | Return all programs (no filtering) |
| Search timeout (>500ms) | Return partial results, show warning |

## Testing Strategy

### Unit Tests

- Stemmer produces expected stems for known Russian words
- Fuzzy matcher finds variations within threshold
- Rating CRUD operations work correctly
- Export/import preserves data integrity
- Program ID generation is deterministic

### Property-Based Tests

- Stemming idempotence (Property 1)
- Exact match inclusion (Property 2)
- Rating round-trip (Property 3)
- Export/import round-trip (Property 4)
- Score ordering invariant (Property 5)
- Rating boost ordering (Property 6)

### Integration Tests

- Full search flow with stemming + fuzzy + ratings
- Settings persistence across page reloads
- CDN fallback behavior

### Performance Tests

- Search latency with 50,000 programs
- Index build time
- Memory usage with large datasets
