# Implementation Plan: Fuzzy Search (Client-Side)

## Overview

This plan implements morphology-aware fuzzy search using Snowball stemmer and Fuse.js, plus a 5-star rating system with localStorage persistence. All changes are client-side, maintaining the current architecture.

## Tasks

- [ ] 1. Add CDN dependencies for Snowball and Fuse.js
  - Add Snowball stemmer CDN link to index.html
  - Add Fuse.js CDN link to index.html
  - Verify libraries load correctly
  - _Requirements: 1.2, 1.3, 1.4, 2.1_

- [ ] 2. Implement fuzzy search module
  - [ ] 2.1 Create `public/scripts/utils/fuzzySearch.js` with stemming functions
    - Implement `stemText()` using Snowball
    - Implement `detectLanguage()` for Russian/English detection
    - Support both Russian and English stemmers
    - _Requirements: 1.2, 1.3, 1.4_

  - [ ] 2.2 Implement search index initialization
    - Create `initSearchIndex()` to build Fuse.js index
    - Pre-stem all program titles and descriptions
    - Configure Fuse.js options for optimal matching
    - _Requirements: 3.2_

  - [ ] 2.3 Implement fuzzy search function
    - Create `fuzzySearch()` with stemmed query matching
    - Return results with relevance scores
    - Support search scope options (title, description, both)
    - _Requirements: 1.1, 2.1, 2.2, 6.2_

  - [ ]* 2.4 Write property test for stemming consistency
    - **Property 1: Stemming Consistency**
    - **Validates: Requirements 1.2**

  - [ ]* 2.5 Write property test for search result inclusion
    - **Property 2: Search Result Inclusion**
    - **Validates: Requirements 1.1, 2.1**

- [ ] 3. Implement ratings module
  - [ ] 3.1 Create `public/scripts/utils/ratings.js` with CRUD operations
    - Implement `getRating()`, `setRating()`, `removeRating()`
    - Implement `getProgramId()` for unique identification
    - Store ratings in localStorage with versioned schema
    - _Requirements: 4.2_

  - [ ] 3.2 Implement ratings export/import
    - Implement `exportRatings()` to JSON
    - Implement `importRatings()` with validation
    - Implement `clearAllRatings()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 3.3 Write property test for rating persistence
    - **Property 3: Rating Persistence Round-Trip**
    - **Validates: Requirements 4.2**

  - [ ]* 3.4 Write property test for export/import round-trip
    - **Property 4: Export/Import Round-Trip**
    - **Validates: Requirements 5.1, 5.2**

- [ ] 4. Checkpoint - Core modules complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement rating UI component
  - [ ] 5.1 Create `public/scripts/components/ratingControl.js`
    - Implement `createRatingControl()` with 5-star display
    - Handle click events for rating selection
    - Support rating removal on re-click
    - _Requirements: 4.1, 4.5_

  - [ ] 5.2 Create `public/styles/components/rating.css`
    - Style star rating control following sqowe brand
    - Add hover and active states
    - Ensure accessibility (keyboard navigation, ARIA)
    - _Requirements: 4.1_

- [ ] 6. Integrate with existing search flow
  - [ ] 6.1 Update `main.js` to use fuzzy search
    - Initialize search index when EPG data loads
    - Replace direct search calls with fuzzy search
    - Add search mode toggle (exact/fuzzy)
    - _Requirements: 6.4_

  - [ ] 6.2 Implement result ranking with ratings boost
    - Combine fuzzy search scores with user ratings
    - Higher-rated programs appear first among equal scores
    - _Requirements: 4.3_

  - [ ]* 6.3 Write property test for score ordering
    - **Property 5: Score Ordering**
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 6.4 Write property test for rating boost effect
    - **Property 6: Rating Boost Effect**
    - **Validates: Requirements 4.3**

- [ ] 7. Update results display
  - [ ] 7.1 Add rating control to program cards
    - Integrate rating control in results.js
    - Show current rating for each program
    - Handle rating changes with immediate feedback
    - _Requirements: 4.1, 4.4_

  - [ ] 7.2 Add rating control to program modal
    - Add larger rating control in detail modal
    - Sync rating between card and modal views
    - _Requirements: 4.1_

- [ ] 8. Update settings panel
  - [ ] 8.1 Add fuzzy search settings
    - Add toggle for exact/fuzzy search mode
    - Add slider for fuzzy threshold sensitivity
    - Persist settings to localStorage
    - _Requirements: 2.4, 6.4_

  - [ ] 8.2 Add ratings management section
    - Add export ratings button
    - Add import ratings button with file picker
    - Add clear all ratings button with confirmation
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 9. Implement CDN fallback
  - [ ] 9.1 Add fallback detection and handling
    - Detect if Snowball/Fuse.js failed to load
    - Fall back to existing exact match search
    - Show user-friendly warning message
    - _Requirements: 3.3_

- [ ] 10. Checkpoint - Integration complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Performance optimization
  - [ ] 11.1 Optimize search index building
    - Build index asynchronously to avoid UI blocking
    - Show progress indicator during indexing
    - Cache index in memory for subsequent searches
    - _Requirements: 3.1, 3.2_

  - [ ] 11.2 Add search debouncing
    - Debounce search input to reduce unnecessary searches
    - Show loading indicator during search
    - _Requirements: 3.1_

- [ ] 12. Update HTML structure
  - [ ] 12.1 Update `public/index.html`
    - Add CDN script tags for Snowball and Fuse.js
    - Add rating control container in results template
    - Add settings UI elements for new options
    - _Requirements: 1.2, 2.4, 4.1_

- [ ] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Test full flow: load EPG → search with variations → rate programs → verify boost
  - Test fallback behavior with CDN blocked
  - Test export/import cycle

## Notes

- Tasks marked with `*` are optional property-based tests
- CDN libraries: Snowball (~20KB), Fuse.js (~25KB)
- All changes maintain the no-build-step architecture
- Follow sqowe brand guidelines for all UI components
