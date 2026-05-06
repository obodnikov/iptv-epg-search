/**
 * storage.js - localStorage Management Utility
 * Handles storing and retrieving EPG settings from browser localStorage
 */

const STORAGE_KEYS = {
  EPG_URL: 'iptv_epg_url',
  LAST_UPDATED: 'iptv_epg_last_updated',
  MANUAL_SEARCH: 'iptv_manual_search_only',
  FUZZY_SEARCH_ENABLED: 'iptv_fuzzy_search_enabled',
  FUZZY_THRESHOLD: 'iptv_fuzzy_threshold',
  SHOW_UNIQUE_ONLY: 'iptv_show_unique_only',
  PREFER_HD: 'iptv_prefer_hd',
  CINEMA_URL: 'iptv_cinema_url',
  CINEMA_LAST_UPDATED: 'iptv_cinema_last_updated',
  ACTIVE_TAB: 'iptv_active_tab'
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

/**
 * Save show unique only preference
 * @param {boolean} enabled - Whether to show only unique programs (closest to current time)
 * @returns {boolean} - Success status
 */
export function saveShowUniqueOnly(enabled) {
  try {
    localStorage.setItem(STORAGE_KEYS.SHOW_UNIQUE_ONLY, enabled.toString());
    return true;
  } catch (error) {
    console.error('Error saving show unique only preference:', error);
    return false;
  }
}

/**
 * Get show unique only preference
 * @returns {boolean} - Whether to show only unique programs (default: false)
 */
export function getShowUniqueOnly() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.SHOW_UNIQUE_ONLY);
    // Default to false (show all) if not set
    return value === null ? false : value === 'true';
  } catch (error) {
    console.error('Error retrieving show unique only preference:', error);
    return false; // Default to show all on error
  }
}

/**
 * Save prefer HD channels preference
 * @param {boolean} enabled - Whether to prefer HD channels over SD/regular
 * @returns {boolean} - Success status
 */
export function savePreferHD(enabled) {
  try {
    localStorage.setItem(STORAGE_KEYS.PREFER_HD, enabled.toString());
    return true;
  } catch (error) {
    console.error('Error saving prefer HD preference:', error);
    return false;
  }
}

/**
 * Get prefer HD channels preference
 * @returns {boolean} - Whether to prefer HD channels (default: false)
 */
export function getPreferHD() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.PREFER_HD);
    // Default to false (show all qualities) if not set
    return value === null ? false : value === 'true';
  } catch (error) {
    console.error('Error retrieving prefer HD preference:', error);
    return false; // Default to show all on error
  }
}


/**
 * Save Cinema M3U URL to localStorage
 * @param {string} url - Cinema M3U URL to save (empty string to clear)
 * @returns {boolean} - Success status
 */
export function saveCinemaUrl(url) {
  try {
    if (typeof url !== 'string') {
      throw new Error('Invalid URL');
    }
    if (url === '') {
      localStorage.removeItem(STORAGE_KEYS.CINEMA_URL);
    } else {
      localStorage.setItem(STORAGE_KEYS.CINEMA_URL, url);
    }
    return true;
  } catch (error) {
    console.error('Error saving Cinema URL:', error);
    return false;
  }
}

/**
 * Get Cinema M3U URL from localStorage
 * @returns {string|null} - Stored Cinema URL or null
 */
export function getCinemaUrl() {
  try {
    return localStorage.getItem(STORAGE_KEYS.CINEMA_URL);
  } catch (error) {
    console.error('Error retrieving Cinema URL:', error);
    return null;
  }
}

/**
 * Check if Cinema URL is configured
 * @returns {boolean} - Whether Cinema URL exists
 */
export function hasCinemaUrl() {
  const url = getCinemaUrl();
  return url !== null && url.trim().length > 0;
}

/**
 * Save cinema last updated timestamp
 * @param {number} timestamp - Unix timestamp
 * @returns {boolean} - Success status
 */
export function saveCinemaLastUpdated(timestamp) {
  try {
    localStorage.setItem(STORAGE_KEYS.CINEMA_LAST_UPDATED, timestamp.toString());
    return true;
  } catch (error) {
    console.error('Error saving cinema last updated timestamp:', error);
    return false;
  }
}

/**
 * Get cinema last updated timestamp
 * @returns {number|null} - Last updated timestamp or null
 */
export function getCinemaLastUpdated() {
  try {
    const timestamp = localStorage.getItem(STORAGE_KEYS.CINEMA_LAST_UPDATED);
    return timestamp ? parseInt(timestamp, 10) : null;
  } catch (error) {
    console.error('Error retrieving cinema last updated timestamp:', error);
    return null;
  }
}

/**
 * Save active tab preference
 * @param {string} tabId - Active tab identifier
 * @returns {boolean} - Success status
 */
export function saveActiveTab(tabId) {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId);
    return true;
  } catch (error) {
    console.error('Error saving active tab:', error);
    return false;
  }
}

/**
 * Get active tab preference
 * @returns {string} - Active tab identifier (default: 'tv-guide')
 */
export function getActiveTab() {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'tv-guide';
  } catch (error) {
    console.error('Error retrieving active tab:', error);
    return 'tv-guide';
  }
}
