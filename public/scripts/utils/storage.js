/**
 * storage.js - localStorage Management Utility
 * Handles storing and retrieving EPG settings from browser localStorage
 */

const STORAGE_KEYS = {
  EPG_URL: 'iptv_epg_url',
  LAST_UPDATED: 'iptv_epg_last_updated',
  MANUAL_SEARCH: 'iptv_manual_search_only',
  FUZZY_SEARCH_ENABLED: 'iptv_fuzzy_search_enabled',
  FUZZY_THRESHOLD: 'iptv_fuzzy_threshold'
};

/**
 * Save EPG URL to localStorage
 * @param {string} url - EPG URL to save
 * @returns {boolean} - Success status
 */
export function saveEpgUrl(url) {
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL');
    }
    localStorage.setItem(STORAGE_KEYS.EPG_URL, url);
    return true;
  } catch (error) {
    console.error('Error saving EPG URL:', error);
    return false;
  }
}

/**
 * Get EPG URL from localStorage
 * @returns {string|null} - Stored EPG URL or null
 */
export function getEpgUrl() {
  try {
    return localStorage.getItem(STORAGE_KEYS.EPG_URL);
  } catch (error) {
    console.error('Error retrieving EPG URL:', error);
    return null;
  }
}

/**
 * Save last updated timestamp
 * @param {number} timestamp - Unix timestamp
 * @returns {boolean} - Success status
 */
export function saveLastUpdated(timestamp) {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_UPDATED, timestamp.toString());
    return true;
  } catch (error) {
    console.error('Error saving last updated timestamp:', error);
    return false;
  }
}

/**
 * Get last updated timestamp
 * @returns {number|null} - Last updated timestamp or null
 */
export function getLastUpdated() {
  try {
    const timestamp = localStorage.getItem(STORAGE_KEYS.LAST_UPDATED);
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (error) {
    console.error('Error retrieving last updated timestamp:', error);
    return null;
  }
}

/**
 * Clear all stored EPG data
 * @returns {boolean} - Success status
 */
export function clearStorage() {
  try {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
    return true;
  } catch (error) {
    console.error('Error clearing storage:', error);
    return false;
  }
}

/**
 * Check if EPG URL is configured
 * @returns {boolean} - Whether EPG URL exists
 */
export function hasEpgUrl() {
  const url = getEpgUrl();
  return url !== null && url.trim().length > 0;
}

/**
 * Save manual search preference
 * @param {boolean} enabled - Whether manual search only is enabled
 * @returns {boolean} - Success status
 */
export function saveManualSearchOnly(enabled) {
  try {
    localStorage.setItem(STORAGE_KEYS.MANUAL_SEARCH, enabled.toString());
    return true;
  } catch (error) {
    console.error('Error saving manual search preference:', error);
    return false;
  }
}

/**
 * Get manual search preference
 * @returns {boolean} - Whether manual search only is enabled (default: true)
 */
export function getManualSearchOnly() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.MANUAL_SEARCH);
    // Default to true (manual search) if not set
    return value === null ? true : value === 'true';
  } catch (error) {
    console.error('Error retrieving manual search preference:', error);
    return true; // Default to manual search on error
  }
}

/**
 * Save fuzzy search enabled preference
 * @param {boolean} enabled - Whether fuzzy search is enabled
 * @returns {boolean} - Success status
 */
export function saveFuzzySearchEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEYS.FUZZY_SEARCH_ENABLED, enabled.toString());
    return true;
  } catch (error) {
    console.error('Error saving fuzzy search preference:', error);
    return false;
  }
}

/**
 * Get fuzzy search enabled preference
 * @returns {boolean} - Whether fuzzy search is enabled (default: true)
 */
export function getFuzzySearchEnabled() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.FUZZY_SEARCH_ENABLED);
    // Default to true (fuzzy search enabled) if not set
    return value === null ? true : value === 'true';
  } catch (error) {
    console.error('Error retrieving fuzzy search preference:', error);
    return true; // Default to fuzzy search enabled on error
  }
}

/**
 * Save fuzzy search threshold preference
 * @param {number} threshold - Fuzzy threshold value (0.1 to 0.9)
 * @returns {boolean} - Success status
 */
export function saveFuzzyThreshold(threshold) {
  try {
    localStorage.setItem(STORAGE_KEYS.FUZZY_THRESHOLD, threshold.toString());
    return true;
  } catch (error) {
    console.error('Error saving fuzzy threshold:', error);
    return false;
  }
}

/**
 * Get fuzzy search threshold preference
 * @returns {number} - Fuzzy threshold value (default: 0.4)
 */
export function getFuzzyThreshold() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.FUZZY_THRESHOLD);
    // Default to 0.4 (medium) if not set
    return value === null ? 0.4 : parseFloat(value);
  } catch (error) {
    console.error('Error retrieving fuzzy threshold:', error);
    return 0.4; // Default to medium on error
  }
}
