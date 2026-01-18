# Requirements Document

## Introduction

This feature implements semantic search for EPG programs using text embeddings and vector similarity. Unlike keyword-based search, semantic search understands meaning and context, handling synonyms, paraphrases, and morphological variations naturally. This solution requires a backend service for embedding generation and vector search.

## Glossary

- **Embedding_Service**: A backend service that converts text into numerical vector representations
- **Vector_Store**: A storage system optimized for similarity search on embedding vectors
- **Semantic_Search**: Search based on meaning similarity rather than exact keyword matching
- **Search_API**: The backend API endpoint for processing search queries
- **Rating_Service**: A backend service for storing and retrieving user program ratings
- **Program**: An EPG entry containing title, description, channel, and time information

## Requirements

### Requirement 1: Semantic Search

**User Story:** As a user, I want to search for programs using natural language, so that I can find relevant results based on meaning rather than exact keywords.

#### Acceptance Criteria

1. WHEN a user searches for "Убийство в" THEN the Search_API SHALL return programs containing semantically similar content including "Убийства в", "криминальный детектив", and related concepts
2. WHEN a user searches for a term THEN the Embedding_Service SHALL convert the query to a vector representation
3. WHEN searching THEN the Vector_Store SHALL find programs with similar embedding vectors
4. THE Search_API SHALL return results ranked by semantic similarity score

### Requirement 2: Multilingual Support

**User Story:** As a user, I want to search in Russian or English, so that I can find programs regardless of the language I use.

#### Acceptance Criteria

1. WHEN a user searches in Russian THEN the Embedding_Service SHALL process the query correctly
2. WHEN a user searches in English THEN the Embedding_Service SHALL process the query correctly
3. THE Embedding_Service SHALL use a multilingual embedding model that supports both Russian and English

### Requirement 3: Embedding Generation

**User Story:** As a system administrator, I want EPG data to be automatically embedded, so that semantic search is available without manual intervention.

#### Acceptance Criteria

1. WHEN EPG data is loaded THEN the Embedding_Service SHALL generate embeddings for all program titles and descriptions
2. WHEN new EPG data is loaded THEN the Embedding_Service SHALL update embeddings incrementally
3. THE Embedding_Service SHALL cache embeddings to avoid redundant computation
4. IF embedding generation fails THEN the Search_API SHALL fall back to keyword search

### Requirement 4: Search Performance

**User Story:** As a user, I want search results to appear quickly, so that I can efficiently browse the EPG data.

#### Acceptance Criteria

1. WHEN searching THEN the Search_API SHALL return results within 1000ms for datasets up to 50,000 programs
2. THE Vector_Store SHALL use efficient indexing (e.g., HNSW, IVF) for fast similarity search
3. THE Search_API SHALL support pagination for large result sets

### Requirement 5: Program Rating System

**User Story:** As a user, I want to rate programs I like or dislike, so that my preferred programs appear higher in search results.

#### Acceptance Criteria

1. WHEN viewing a program THEN the Rating_Service SHALL display a 5-star rating control
2. WHEN a user rates a program THEN the Rating_Service SHALL persist the rating to the backend
3. WHEN a user has rated programs THEN the Search_API SHALL boost highly-rated programs in search results
4. WHEN displaying search results THEN the Rating_Service SHALL show the user's rating for each program
5. THE Rating_Service SHALL allow users to remove a rating

### Requirement 6: Rating Data Management

**User Story:** As a user, I want to manage my ratings data, so that I can backup or clear my preferences.

#### Acceptance Criteria

1. THE Rating_Service SHALL provide an export function to download ratings as JSON
2. THE Rating_Service SHALL provide a clear function to remove all ratings
3. THE Rating_Service SHALL sync ratings with localStorage for offline access

### Requirement 7: Hybrid Search Mode

**User Story:** As a user, I want to combine semantic search with keyword filters, so that I can refine my search results.

#### Acceptance Criteria

1. THE Search_API SHALL support combining semantic search with time filters (past, current, future)
2. THE Search_API SHALL support combining semantic search with channel filters
3. THE Search_API SHALL support a hybrid mode that combines semantic and keyword matching

### Requirement 8: Backend Infrastructure

**User Story:** As a developer, I want a well-structured backend service, so that the system is maintainable and scalable.

#### Acceptance Criteria

1. THE Embedding_Service SHALL be deployable as a Vercel serverless function or standalone service
2. THE Vector_Store SHALL support in-memory storage for small datasets (<10,000 programs)
3. THE Vector_Store SHALL support external vector database integration for larger datasets
4. THE Search_API SHALL expose RESTful endpoints for search and ratings operations
