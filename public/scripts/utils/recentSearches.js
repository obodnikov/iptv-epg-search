/**
 * recentSearches.js - Recent Searches Persistence
 * Stores and retrieves recent search queries in localStorage
 */

const STORAGE_KEY = 'iptv_recent_searches';
const MAX_ITEMS = 10;
const MIN_QUERY_LENGTH = 2;

/**
 * Get recent searches from localStorage
 * @returns {Array<string>} - Array of search query strings (most recent first)
 */
export function getRecentSearches() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to load recent searches:', error);
    return [];
  }
}

/**
 * Add a search query to recent searches
 * Deduplicates case-insensitively, prepends to front, trims to max
 * @param {string} query - Search query to add
 */
export function addRecentSearch(query) {
  if (!query || typeof query !== 'string') return;

  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return;

  try {
    let searches = getRecentSearches();

    // Remove existing duplicate (case-insensitive)
    const lowerQuery = trimmed.toLowerCase();
    searches = searches.filter(s => s.toLowerCase() !== lowerQuery);

    // Prepend new query
    searches.unshift(trimmed);

    // Trim to max items
    if (searches.length > MAX_ITEMS) {
      searches = searches.slice(0, MAX_ITEMS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch (error) {
    console.warn('Failed to save recent search:', error);
  }
}

/**
 * Remove a specific search query from recent searches
 * @param {string} query - Search query to remove
 */
export function removeRecentSearch(query) {
  if (!query) return;

  try {
    let searches = getRecentSearches();
    const lowerQuery = query.toLowerCase();
    searches = searches.filter(s => s.toLowerCase() !== lowerQuery);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch (error) {
    console.warn('Failed to remove recent search:', error);
  }
}

/**
 * Clear all recent searches
 */
export function clearRecentSearches() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Failed to clear recent searches:', error);
  }
}
