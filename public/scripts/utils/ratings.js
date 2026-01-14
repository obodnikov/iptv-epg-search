/**
 * ratings.js - Program Rating System
 * Handles storing and retrieving user program ratings in localStorage
 */

const STORAGE_KEY = 'epg_ratings';
const STORAGE_VERSION = 1;

/**
 * Generate unique program ID
 * @param {Object} program - Program object
 * @returns {string} - Unique identifier
 */
export function getProgramId(program) {
  if (!program) return '';
  
  // Create ID from title, channel, and start time
  const title = program.title || '';
  const channel = program.channelName || program.channel || '';
  const start = program.start instanceof Date 
    ? program.start.getTime() 
    : new Date(program.start).getTime();
  
  return `${title}|${channel}|${start}`;
}

/**
 * Load ratings from localStorage
 * @returns {Object} - Ratings data structure
 */
function loadRatings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return {
        version: STORAGE_VERSION,
        ratings: {},
        lastUpdated: new Date().toISOString()
      };
    }
    
    const data = JSON.parse(stored);
    
    // Validate structure
    if (!data.version || !data.ratings) {
      console.warn('Invalid ratings data structure, resetting');
      return {
        version: STORAGE_VERSION,
        ratings: {},
        lastUpdated: new Date().toISOString()
      };
    }
    
    return data;
  } catch (error) {
    console.error('Failed to load ratings:', error);
    return {
      version: STORAGE_VERSION,
      ratings: {},
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Save ratings to localStorage
 * @param {Object} data - Ratings data structure
 * @returns {boolean} - Success status
 */
function saveRatings(data) {
  try {
    data.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Failed to save ratings:', error);
    
    // Check if quota exceeded
    if (error.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded');
    }
    
    return false;
  }
}

/**
 * Get rating for a program
 * @param {string} programId - Unique program identifier
 * @returns {number|null} - Rating 1-5 or null if not rated
 */
export function getRating(programId) {
  if (!programId) return null;
  
  const data = loadRatings();
  const rating = data.ratings[programId];
  
  return rating !== undefined ? rating : null;
}

/**
 * Set rating for a program
 * @param {string} programId - Unique program identifier
 * @param {number} rating - Rating 1-5
 * @returns {boolean} - Success status
 */
export function setRating(programId, rating) {
  if (!programId) return false;
  
  // Validate rating
  if (typeof rating !== 'number' || rating < 1 || rating > 5) {
    console.error('Invalid rating value:', rating);
    return false;
  }
  
  const data = loadRatings();
  data.ratings[programId] = rating;
  
  return saveRatings(data);
}

/**
 * Remove rating for a program
 * @param {string} programId - Unique program identifier
 * @returns {boolean} - Success status
 */
export function removeRating(programId) {
  if (!programId) return false;
  
  const data = loadRatings();
  delete data.ratings[programId];
  
  return saveRatings(data);
}

/**
 * Get all ratings
 * @returns {Object} - Map of programId to rating
 */
export function getAllRatings() {
  const data = loadRatings();
  return { ...data.ratings };
}

/**
 * Export ratings to JSON string
 * @returns {string} - JSON string of all ratings
 */
export function exportRatings() {
  const data = loadRatings();
  return JSON.stringify(data, null, 2);
}

/**
 * Import ratings from JSON string
 * @param {string} jsonString - JSON string of ratings
 * @returns {boolean} - Success status
 */
export function importRatings(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    
    // Validate structure - must have version and ratings
    if (!data || typeof data !== 'object') {
      console.error('Invalid ratings data: not an object');
      return false;
    }
    
    if (!data.version || typeof data.version !== 'number') {
      console.error('Invalid ratings data: missing or invalid version');
      return false;
    }
    
    if (!data.ratings || typeof data.ratings !== 'object') {
      console.error('Invalid ratings data: missing or invalid ratings object');
      return false;
    }
    
    // Validate ratings is not an array
    if (Array.isArray(data.ratings)) {
      console.error('Invalid ratings data: ratings should be an object, not an array');
      return false;
    }
    
    // Validate each rating entry
    for (const [key, value] of Object.entries(data.ratings)) {
      // Key should be a non-empty string
      if (typeof key !== 'string' || key.trim().length === 0) {
        console.error(`Invalid rating key: ${key}`);
        return false;
      }
      
      // Value should be a number between 1 and 5
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
        console.error(`Invalid rating value for ${key}: ${value} (must be integer 1-5)`);
        return false;
      }
    }
    
    // Validate lastUpdated if present
    if (data.lastUpdated) {
      if (typeof data.lastUpdated !== 'string') {
        console.error('Invalid lastUpdated: must be a string');
        return false;
      }
      
      // Try to parse as date
      const date = new Date(data.lastUpdated);
      if (isNaN(date.getTime())) {
        console.error('Invalid lastUpdated: not a valid date string');
        return false;
      }
    }
    
    // All validations passed, save imported data
    return saveRatings(data);
  } catch (error) {
    console.error('Failed to import ratings:', error);
    return false;
  }
}

/**
 * Clear all ratings
 * @returns {boolean} - Success status
 */
export function clearAllRatings() {
  const data = {
    version: STORAGE_VERSION,
    ratings: {},
    lastUpdated: new Date().toISOString()
  };
  
  return saveRatings(data);
}

/**
 * Get rating statistics
 * @returns {Object} - Statistics about ratings
 */
export function getRatingStats() {
  const data = loadRatings();
  const ratings = Object.values(data.ratings);
  
  if (ratings.length === 0) {
    return {
      total: 0,
      average: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }
  
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  
  ratings.forEach(rating => {
    distribution[rating]++;
    sum += rating;
  });
  
  return {
    total: ratings.length,
    average: sum / ratings.length,
    distribution
  };
}
