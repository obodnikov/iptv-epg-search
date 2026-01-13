/**
 * storage.js - localStorage Management Utility
 * Handles storing and retrieving EPG settings from browser localStorage
 */

const STORAGE_KEYS = {
  EPG_URL: 'iptv_epg_url',
  LAST_UPDATED: 'iptv_epg_last_updated'
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
