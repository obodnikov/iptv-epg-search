# Design Document

## Overview

This design implements semantic search using text embeddings for meaning-based program discovery. The solution adds a backend layer with embedding generation (using OpenAI or local models) and vector similarity search. The frontend communicates with the backend via REST API while maintaining offline capability through localStorage caching.

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
│  │    │ storage  │     │searchClient│    │ratingsSync│  │ │
│  │    │  .js     │     │    .js     │    │   .js     │  │ │
│  │    └──────────┘     └─────┬──────┘    └─────┬─────┘  │ │
│  └───────────────────────────┼─────────────────┼─────────┘ │
└──────────────────────────────┼─────────────────┼───────────┘
                               │                 │
                    ┌──────────▼─────────────────▼──────────┐
                    │           Vercel Platform             │
                    │  ┌─────────────┐  ┌───────────────┐  │
                    │  │/api/search  │  │ /api/ratings  │  │
                    │  └──────┬──────┘  └───────┬───────┘  │
                    │         │                  │          │
                    │  ┌──────▼──────────────────▼───────┐ │
                    │  │      Backend Services           │ │
                    │  │  ┌───────────┐ ┌─────────────┐ │ │
                    │  │  │ Embedding │ │ Vector      │ │ │
                    │  │  │ Service   │ │ Store       │ │ │
                    │  │  └─────┬─────┘ └─────────────┘ │ │
                    │  └────────┼──────────────────────┘  │
                    └───────────┼──────────────────────────┘
                                │
                    ┌───────────▼──────────┐
                    │  OpenAI API          │
                    │  (or local model)    │
                    └──────────────────────┘
```

## Components and Interfaces

### Backend: api/search.js (Vercel Serverless Function)

```javascript
// api/search.js

/**
 * POST /api/search
 * Request body:
 * {
 *   query: string,           // Search query
 *   filters: {
 *     timeFilter: 'all' | 'past' | 'current' | 'future',
 *     channels: string[],    // Optional channel filter
 *     searchMode: 'semantic' | 'keyword' | 'hybrid'
 *   },
 *   pagination: {
 *     page: number,
 *     perPage: number
 *   },
 *   userRatings: object      // Optional: user ratings for boosting
 * }
 * 
 * Response:
 * {
 *   results: [{
 *     program: Program,
 *     score: number,         // Similarity score 0-1
 *     matchType: 'semantic' | 'keyword'
 *   }],
 *   pagination: {
 *     currentPage: number,
 *     totalPages: number,
 *     totalResults: number
 *   }
 * }
 */
export default async function handler(req, res);
```

### Backend: api/embed.js (Embedding Service)

```javascript
// api/embed.js

/**
 * POST /api/embed
 * Request body:
 * {
 *   programs: Program[],     // Programs to embed
 *   forceRefresh: boolean    // Force re-embedding
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   embedded: number,        // Count of embedded programs
 *   cached: number,          // Count of cache hits
 *   errors: string[]         // Any errors encountered
 * }
 */
export default async function handler(req, res);
```

### Backend: api/ratings.js (Ratings Service)

```javascript
// api/ratings.js

/**
 * GET /api/ratings
 * Response: { ratings: { programId: rating } }
 * 
 * POST /api/ratings
 * Request body: { programId: string, rating: number }
 * Response: { success: boolean }
 * 
 * DELETE /api/ratings/:programId
 * Response: { success: boolean }
 * 
 * DELETE /api/ratings (clear all)
 * Response: { success: boolean, deleted: number }
 */
export default async function handler(req, res);
```

### Backend: lib/embeddingService.js

```javascript
// api/lib/embeddingService.js

/**
 * Generate embedding for text using OpenAI or local model
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function generateEmbedding(text);

/**
 * Generate embeddings for multiple texts (batched)
 * @param {string[]} texts - Texts to embed
 * @returns {Promise<number[][]>} - Array of embedding vectors
 */
export async function generateEmbeddings(texts);

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score 0-1
 */
export function cosineSimilarity(a, b);
```

### Backend: lib/vectorStore.js

```javascript
// api/lib/vectorStore.js

/**
 * In-memory vector store with HNSW-like indexing
 */
export class VectorStore {
  /**
   * Add program with embedding to store
   * @param {string} id - Program ID
   * @param {number[]} embedding - Embedding vector
   * @param {object} metadata - Program metadata
   */
  add(id, embedding, metadata);

  /**
   * Search for similar programs
   * @param {number[]} queryEmbedding - Query embedding
   * @param {number} k - Number of results
   * @param {object} filters - Optional filters
   * @returns {Array} - Matching programs with scores
   */
  search(queryEmbedding, k, filters);

  /**
   * Remove program from store
   * @param {string} id - Program ID
   */
  remove(id);

  /**
   * Clear all programs
   */
  clear();

  /**
   * Export store to JSON for persistence
   * @returns {string} - JSON representation
   */
  export();

  /**
   * Import store from JSON
   * @param {string} json - JSON representation
   */
  import(json);
}
```

### Frontend: searchClient.js

```javascript
// public/scripts/utils/searchClient.js

/**
 * Search programs via backend API
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @returns {Promise<object>} - Search results
 */
export async function semanticSearch(query, options);

/**
 * Trigger embedding generation for loaded EPG data
 * @param {Array} programs - Programs to embed
 * @returns {Promise<object>} - Embedding status
 */
export async function embedPrograms(programs);

/**
 * Check if embeddings are ready
 * @returns {Promise<boolean>} - Ready status
 */
export async function checkEmbeddingsReady();
```

### Frontend: ratingsSync.js

```javascript
// public/scripts/utils/ratingsSync.js

/**
 * Sync local ratings with backend
 * @returns {Promise<void>}
 */
export async function syncRatings();

/**
 * Get rating (local first, then backend)
 * @param {string} programId - Program ID
 * @returns {Promise<number|null>} - Rating or null
 */
export async function getRating(programId);

/**
 * Set rating (local + backend)
 * @param {string} programId - Program ID
 * @param {number} rating - Rating 1-5
 * @returns {Promise<void>}
 */
export async function setRating(programId, rating);
```

## Data Models

### Embedding Storage

```javascript
// In-memory vector store structure
const vectorStore = {
  programs: Map<string, {
    id: string,
    embedding: Float32Array,  // 1536 dimensions for OpenAI
    metadata: {
      title: string,
      description: string,
      channelName: string,
      start: Date,
      stop: Date
    }
  }>,
  index: HNSWIndex  // Hierarchical Navigable Small World graph
};
```

### API Request/Response

```javascript
// Search request
const searchRequest = {
  query: "криминальный детектив",
  filters: {
    timeFilter: "future",
    channels: ["Channel 1", "Channel 2"],
    searchMode: "semantic"
  },
  pagination: {
    page: 1,
    perPage: 20
  },
  userRatings: {
    "program-id-1": 5,
    "program-id-2": 3
  }
};

// Search response
const searchResponse = {
  results: [
    {
      program: { /* program object */ },
      score: 0.92,
      matchType: "semantic"
    }
  ],
  pagination: {
    currentPage: 1,
    totalPages: 5,
    totalResults: 87
  }
};
```

### Environment Configuration

```javascript
// Required environment variables
OPENAI_API_KEY=sk-...           // For OpenAI embeddings
EMBEDDING_MODEL=text-embedding-3-small  // Model to use
VECTOR_STORE_TYPE=memory        // 'memory' or 'pinecone'
PINECONE_API_KEY=...            // If using Pinecone
PINECONE_INDEX=epg-embeddings   // If using Pinecone
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Embedding Determinism

*For any* text input, generating an embedding twice with the same model SHALL produce identical vectors.

**Validates: Requirements 3.1**

### Property 2: Similarity Symmetry

*For any* two programs A and B, the similarity score between A and B SHALL equal the similarity score between B and A.

**Validates: Requirements 1.4**

### Property 3: Self-Similarity Maximum

*For any* program, the similarity score between its embedding and itself SHALL be 1.0 (maximum).

**Validates: Requirements 1.3**

### Property 4: Search Result Ordering

*For any* search query, results SHALL be ordered by descending similarity score.

**Validates: Requirements 1.4, 4.1**

### Property 5: Rating Sync Consistency

*For any* rating set locally, after sync, the backend SHALL contain the same rating value.

**Validates: Requirements 5.2, 6.3**

### Property 6: Filter Application

*For any* search with time filter, all returned programs SHALL match the specified time filter criteria.

**Validates: Requirements 7.1**

### Property 7: Fallback Behavior

*For any* search when embedding service is unavailable, the system SHALL return keyword-based results.

**Validates: Requirements 3.4**

## Error Handling

| Error Condition | Handling Strategy |
|-----------------|-------------------|
| OpenAI API rate limit | Queue requests, retry with exponential backoff |
| OpenAI API key invalid | Return error, disable semantic search, use keyword fallback |
| Embedding generation timeout | Return partial results, continue in background |
| Vector store memory exceeded | Implement LRU eviction, warn user |
| Network error during search | Use cached results if available, show offline message |
| Rating sync failure | Queue for retry, use local ratings |

## Testing Strategy

### Unit Tests

- Embedding service generates valid vectors
- Vector store add/search/remove operations
- Cosine similarity calculation accuracy
- Rating CRUD operations
- Filter application logic

### Property-Based Tests

- Embedding determinism (Property 1)
- Similarity symmetry (Property 2)
- Self-similarity maximum (Property 3)
- Result ordering (Property 4)
- Rating sync consistency (Property 5)
- Filter application (Property 6)
- Fallback behavior (Property 7)

### Integration Tests

- Full search flow: query → embed → search → rank → return
- Rating sync between frontend and backend
- Fallback to keyword search when API unavailable
- Pagination across large result sets

### Performance Tests

- Embedding generation latency (batch vs single)
- Vector search latency with 50,000 programs
- Memory usage of vector store
- API response time under load

## Deployment Considerations

### Option A: Vercel Serverless (Recommended for MVP)

- Deploy API functions to Vercel
- Use in-memory vector store (resets on cold start)
- Cache embeddings in Vercel KV or external store
- Suitable for <10,000 programs

### Option B: Dedicated Backend

- Deploy Node.js/Python service
- Use persistent vector database (Pinecone, Weaviate, Qdrant)
- Better for large datasets and high traffic
- Requires separate hosting

### Option C: Hybrid

- Vercel for API routing
- External embedding service (OpenAI, Cohere)
- External vector DB (Pinecone free tier)
- Best balance of simplicity and scalability
