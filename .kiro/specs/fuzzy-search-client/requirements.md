# Requirements Document

## Introduction

This feature improves the EPG search functionality by implementing morphology-aware fuzzy search that handles Russian language word variations (e.g., "Убийство" vs "Убийства") and adds a program rating system. The solution is fully client-side, maintaining the current architecture without requiring a backend.

## Glossary

- **Search_Engine**: The client-side module responsible for processing search queries and matching programs
- **Stemmer**: A component that reduces words to their root/stem form for matching
- **Fuzzy_Matcher**: A component that finds approximate string matches with configurable tolerance
- **Rating_System**: The client-side module for storing and retrieving user program ratings
- **Program**: An EPG entry containing title, description, channel, and time information

## Requirements

### Requirement 1: Morphology-Aware Search

**User Story:** As a user, I want to search for programs using natural language variations, so that I can find relevant results regardless of word endings or grammatical forms.

#### Acceptance Criteria

1. WHEN a user searches for "Убийство в" THEN the Search_Engine SHALL return programs containing "Убийства в", "Убийством", and other morphological variations
2. WHEN a user searches for a term THEN the Search_Engine SHALL apply stemming to both the query and program text before matching
3. WHEN stemming is applied THEN the Search_Engine SHALL support Russian language morphology
4. WHEN stemming is applied THEN the Search_Engine SHALL also support English language morphology for mixed-language content

### Requirement 2: Fuzzy Matching

**User Story:** As a user, I want the search to tolerate minor typos and spelling variations, so that I can find programs even with imperfect queries.

#### Acceptance Criteria

1. WHEN a user enters a query with minor typos THEN the Fuzzy_Matcher SHALL return relevant results with a configurable similarity threshold
2. WHEN fuzzy matching is performed THEN the Search_Engine SHALL rank results by relevance score
3. WHEN multiple matches exist THEN the Search_Engine SHALL display higher-scoring matches first
4. THE Search_Engine SHALL allow users to adjust fuzzy matching sensitivity in settings

### Requirement 3: Search Performance

**User Story:** As a user, I want search results to appear quickly, so that I can efficiently browse the EPG data.

#### Acceptance Criteria

1. WHEN searching through EPG data THEN the Search_Engine SHALL return results within 500ms for datasets up to 50,000 programs
2. WHEN EPG data is loaded THEN the Search_Engine SHALL pre-build a search index for faster queries
3. IF the search index cannot be built THEN the Search_Engine SHALL fall back to direct search with degraded performance

### Requirement 4: Program Rating System

**User Story:** As a user, I want to rate programs I like or dislike, so that my preferred programs appear higher in search results.

#### Acceptance Criteria

1. WHEN viewing a program THEN the Rating_System SHALL display a 5-star rating control
2. WHEN a user rates a program THEN the Rating_System SHALL persist the rating to localStorage
3. WHEN a user has rated programs THEN the Search_Engine SHALL boost highly-rated programs in search results
4. WHEN displaying search results THEN the Rating_System SHALL show the user's rating for each program
5. THE Rating_System SHALL allow users to remove a rating by clicking the current rating again

### Requirement 5: Rating Data Management

**User Story:** As a user, I want to manage my ratings data, so that I can backup, restore, or clear my preferences.

#### Acceptance Criteria

1. THE Rating_System SHALL provide an export function to download ratings as JSON
2. THE Rating_System SHALL provide an import function to restore ratings from JSON
3. THE Rating_System SHALL provide a clear function to remove all ratings
4. WHEN importing ratings THEN the Rating_System SHALL validate the JSON format before applying
5. IF import validation fails THEN the Rating_System SHALL display an error message and preserve existing ratings

### Requirement 6: Backward Compatibility

**User Story:** As a user, I want the new search to work alongside existing features, so that I don't lose any current functionality.

#### Acceptance Criteria

1. WHEN the new search is enabled THEN the Search_Engine SHALL maintain existing time filter functionality
2. WHEN the new search is enabled THEN the Search_Engine SHALL maintain existing search scope options (title, description, both)
3. WHEN the new search is enabled THEN the Search_Engine SHALL maintain existing sort options
4. THE Search_Engine SHALL provide a toggle to switch between exact match and fuzzy search modes
