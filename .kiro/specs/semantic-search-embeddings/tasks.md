# Implementation Plan: Semantic Search (Embeddings)

## Overview

This plan implements semantic search using text embeddings and vector similarity. The solution adds backend services for embedding generation (OpenAI) and vector search, with frontend integration maintaining offline capability through localStorage caching.

## Tasks

- [ ] 1. Set up backend infrastructure
  - [ ] 1.1 Create environment configuration
    - Add `.env.example` with required variables
    - Document OPENAI_API_KEY, EMBEDDING_MODEL settings
    - Update `.gitignore` for `.env` files
    - _Requirements: 8.1_

  - [ ] 1.2 Create embedding service library
    - Create `api/lib/embeddingService.js`
    - Implement `generateEmbedding()` using OpenAI API
    - Implement `generateEmbeddings()` for batch processing
    - Implement `cosineSimilarity()` calculation
    - _Requirements: 3.1, 2.3_

  - [ ]* 1.3 Write property test for embedding determinism
    - **Property 1: Embedding Determinism**
    - **Validates: Requirements 3.1**

- [ ] 2. Implement vector store
  - [ ] 2.1 Create vector store library
    - Create `api/lib/vectorStore.js`
    - Implement `VectorStore` class with add/search/remove
    - Implement efficient similarity search (brute force for MVP)
    - Support metadata filtering
    - _Requirements: 4.2, 8.2_

  - [ ] 2.2 Add vector store persistence
    - Implement `export()` and `import()` methods
    - Support JSON serialization for Vercel KV caching
    - _Requirements: 3.3_

  - [ ]* 2.3 Write property test for similarity symmetry
    - **Property 2: Similarity Symmetry**
    - **Validates: Requirements 1.4**

  - [ ]* 2.4 Write property test for self-similarity
    - **Property 3: Self-Similarity Maximum**
    - **Validates: Requirements 1.3**

- [ ] 3. Checkpoint - Core backend libraries complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Create search API endpoint
  - [ ] 4.1 Create `api/search.js` serverless function
    - Implement POST handler for search requests
    - Parse query, filters, pagination from request body
    - Generate query embedding
    - Search vector store with filters
    - Return ranked results with scores
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 4.2 Implement result ranking with ratings boost
    - Accept user ratings in request
    - Boost highly-rated programs in final ranking
    - Combine semantic score with rating boost
    - _Requirements: 5.3_

  - [ ] 4.3 Implement hybrid search mode
    - Support 'semantic', 'keyword', 'hybrid' modes
    - Combine semantic and keyword scores in hybrid mode
    - _Requirements: 7.3_

  - [ ]* 4.4 Write property test for search result ordering
    - **Property 4: Search Result Ordering**
    - **Validates: Requirements 1.4, 4.1**

  - [ ]* 4.5 Write property test for filter application
    - **Property 6: Filter Application**
    - **Validates: Requirements 7.1**

- [ ] 5. Create embedding API endpoint
  - [ ] 5.1 Create `api/embed.js` serverless function
    - Implement POST handler for embedding requests
    - Accept programs array from request body
    - Generate embeddings in batches (avoid rate limits)
    - Store embeddings in vector store
    - Return embedding status
    - _Requirements: 3.1, 3.2_

  - [ ] 5.2 Implement embedding caching
    - Check for existing embeddings before generating
    - Support `forceRefresh` parameter
    - Track embedding generation progress
    - _Requirements: 3.3_

- [ ] 6. Create ratings API endpoint
  - [ ] 6.1 Create `api/ratings.js` serverless function
    - Implement GET for fetching all ratings
    - Implement POST for setting a rating
    - Implement DELETE for removing ratings
    - Store ratings in Vercel KV or in-memory
    - _Requirements: 5.2, 5.5, 6.2_

  - [ ]* 6.2 Write property test for rating sync consistency
    - **Property 5: Rating Sync Consistency**
    - **Validates: Requirements 5.2, 6.3**

- [ ] 7. Checkpoint - Backend API complete
  - Ensure all tests pass, ask the user if questions arise.
  - Test API endpoints with curl/Postman

- [ ] 8. Create frontend search client
  - [ ] 8.1 Create `public/scripts/utils/searchClient.js`
    - Implement `semanticSearch()` calling `/api/search`
    - Implement `embedPrograms()` calling `/api/embed`
    - Implement `checkEmbeddingsReady()`
    - Handle API errors gracefully
    - _Requirements: 1.1, 3.1_

  - [ ] 8.2 Implement keyword search fallback
    - Detect when semantic search is unavailable
    - Fall back to existing `search.js` functions
    - Show user notification about fallback
    - _Requirements: 3.4_

  - [ ]* 8.3 Write property test for fallback behavior
    - **Property 7: Fallback Behavior**
    - **Validates: Requirements 3.4**

- [ ] 9. Create frontend ratings sync
  - [ ] 9.1 Create `public/scripts/utils/ratingsSync.js`
    - Implement `syncRatings()` for local-backend sync
    - Implement `getRating()` with local-first strategy
    - Implement `setRating()` updating both local and backend
    - Queue failed syncs for retry
    - _Requirements: 5.2, 6.3_

  - [ ] 9.2 Implement offline support
    - Cache ratings in localStorage
    - Sync when connection restored
    - Handle conflicts (last-write-wins)
    - _Requirements: 6.3_

- [ ] 10. Integrate with main application
  - [ ] 10.1 Update `main.js` for semantic search
    - Trigger embedding generation when EPG loads
    - Show embedding progress indicator
    - Replace search calls with `semanticSearch()`
    - Add search mode selector (semantic/keyword/hybrid)
    - _Requirements: 3.1, 7.3_

  - [ ] 10.2 Update results display
    - Show similarity score for each result
    - Indicate match type (semantic/keyword)
    - Add rating control to program cards
    - _Requirements: 1.4, 5.1, 5.4_

- [ ] 11. Update settings panel
  - [ ] 11.1 Add semantic search settings
    - Add search mode selector
    - Add embedding status indicator
    - Add "Re-embed" button for manual refresh
    - _Requirements: 7.3_

  - [ ] 11.2 Add ratings management
    - Add export ratings button
    - Add clear ratings button with confirmation
    - Show sync status indicator
    - _Requirements: 6.1, 6.2_

- [ ] 12. Checkpoint - Frontend integration complete
  - Ensure all tests pass, ask the user if questions arise.
  - Test full flow: load EPG → embed → search → rate → sync

- [ ] 13. Create rating UI component
  - [ ] 13.1 Create `public/scripts/components/ratingControl.js`
    - Implement 5-star rating control
    - Handle click events for rating selection
    - Support rating removal
    - Show loading state during sync
    - _Requirements: 5.1, 5.5_

  - [ ] 13.2 Create `public/styles/components/rating.css`
    - Style star rating following sqowe brand
    - Add hover and active states
    - Ensure accessibility
    - _Requirements: 5.1_

- [ ] 14. Update HTML structure
  - [ ] 14.1 Update `public/index.html`
    - Add search mode selector UI
    - Add embedding status indicator
    - Add rating controls container
    - Add settings for semantic search
    - _Requirements: 5.1, 7.3_

- [ ] 15. Performance optimization
  - [ ] 15.1 Optimize embedding generation
    - Batch embedding requests (max 100 per call)
    - Show progress during batch processing
    - Implement request queuing to avoid rate limits
    - _Requirements: 3.1, 4.1_

  - [ ] 15.2 Optimize vector search
    - Implement approximate nearest neighbor if needed
    - Cache frequent queries
    - Add search debouncing on frontend
    - _Requirements: 4.1, 4.2_

- [ ] 16. Documentation
  - [ ] 16.1 Update README.md
    - Document new semantic search feature
    - Add environment setup instructions
    - Document API endpoints
    - _Requirements: 8.1_

  - [ ] 16.2 Update ARCHITECTURE.md
    - Add backend services to architecture diagram
    - Document new data flows
    - Update stability zones
    - _Requirements: 8.1_

- [ ] 17. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Test full flow with real EPG data
  - Test fallback when OpenAI API unavailable
  - Test rating sync across page reloads
  - Verify performance with large datasets

## Notes

- Tasks marked with `*` are optional property-based tests
- Requires OpenAI API key for embeddings (~$0.0001 per 1K tokens)
- Consider Vercel KV for persistent storage ($0 for hobby tier)
- For production, consider dedicated vector DB (Pinecone free tier)
- This solution changes the architecture from client-only to client-server
