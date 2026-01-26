/**
 * search.js - Search and Filter Utility
 * Handles searching and filtering EPG programs
 */

import { getProgramStatus } from './epgParser.js';
import { getRating, getProgramId } from './ratings.js';

/**
 * Search programs by title, description, or channel
 * @param {Array} programs - Array of program objects
 * @param {string} query - Search query
 * @param {string} scope - Search scope: 'both', 'title', 'description', 'channel'
 * @returns {Array} - Filtered programs
 */
export function searchPrograms(programs, query, scope = 'both') {
  if (!query || query.trim().length === 0) {
    return programs;
  }

  const searchTerm = query.toLowerCase().trim();

  return programs.filter(program => {
    const title = program.title.toLowerCase();
    const description = program.description.toLowerCase();
    const channel = program.channelName.toLowerCase();

    switch (scope) {
      case 'title':
        return title.includes(searchTerm);
      case 'description':
        return description.includes(searchTerm);
      case 'channel':
        return channel.includes(searchTerm);
      case 'both':
      default:
        return title.includes(searchTerm) || description.includes(searchTerm);
    }
  });
}

/**
 * Filter programs by time status
 * @param {Array} programs - Array of program objects
 * @param {string} timeFilter - Filter: 'all', 'past', 'current', 'future'
 * @returns {Array} - Filtered programs
 */
export function filterByTime(programs, timeFilter) {
  if (timeFilter === 'all') {
    return programs;
  }

  return programs.filter(program => {
    const status = getProgramStatus(program.start, program.stop);
    return status === timeFilter;
  });
}

/**
 * Filter programs by selected channels
 * @param {Array} programs - Array of program objects
 * @param {Set|null} selectedChannels - Set of selected channel IDs, or null for all
 * @returns {Array} - Filtered programs
 */
export function filterByChannels(programs, selectedChannels) {
  // If no selection or empty, return all programs
  if (!selectedChannels || selectedChannels.size === 0) {
    return programs;
  }

  return programs.filter(program => selectedChannels.has(program.channelId));
}

/**
 * Get channel quality score
 * Higher score = better quality
 * @param {string} channelName - Channel name to evaluate
 * @returns {number} - Quality score (0=SD, 1=Regular, 2=HD, 3=UHD, 4=4K)
 */
function getChannelQuality(channelName) {
  if (!channelName) return 1;

  const name = channelName.toUpperCase();

  if (name.includes('4K')) return 4;
  if (name.includes('UHD')) return 3;
  if (name.includes('HD')) return 2;
  if (name.includes('SD')) return 0;

  return 1; // Regular/standard quality
}

/**
 * Filter programs to show only unique ones (by title + channel), keeping the one closest to current time
 * @param {Array} programs - Array of program objects
 * @returns {Array} - Filtered programs with only unique title+channel combinations
 */
export function filterUniqueByClosestTime(programs) {
  const now = new Date();
  const grouped = new Map();

  programs.forEach(program => {
    // Validate program.start is a valid Date
    if (!program.start || !(program.start instanceof Date) || isNaN(program.start.getTime())) {
      console.warn('Skipping program with invalid start time:', program.title, program.channelName);
      return; // Skip invalid programs
    }

    // Validate required fields for key generation
    if (!program.title || !program.channelName) {
      console.warn('Skipping program with missing title or channelName:', program);
      return;
    }

    const key = `${program.title}|${program.channelName}`;
    const timeDiff = Math.abs(program.start - now);

    // For ties in timeDiff, prefer earlier start time (deterministic)
    const existing = grouped.get(key);
    if (!existing ||
        timeDiff < existing.timeDiff ||
        (timeDiff === existing.timeDiff && program.start < existing.program.start)) {
      grouped.set(key, { program, timeDiff });
    }
  });

  return Array.from(grouped.values()).map(item => item.program);
}

/**
 * Filter programs to prefer HD channels over SD/regular
 * Groups by title + start time, keeps highest quality channel
 * @param {Array} programs - Array of program objects
 * @returns {Array} - Filtered programs with HD preferred
 */
export function filterPreferHD(programs) {
  const grouped = new Map();

  programs.forEach(program => {
    // Validate program.start is a valid Date
    if (!program.start || !(program.start instanceof Date) || isNaN(program.start.getTime())) {
      console.warn('Skipping program with invalid start time:', program.title, program.channelName);
      return;
    }

    // Validate required fields
    if (!program.title || !program.channelName) {
      console.warn('Skipping program with missing title or channelName:', program);
      return;
    }

    // Group by title + start time (ignore channel name)
    const key = `${program.title}|${program.start.getTime()}`;
    const quality = getChannelQuality(program.channelName);

    const existing = grouped.get(key);

    if (!existing || quality > existing.quality) {
      // Keep this program if no existing or higher quality
      grouped.set(key, { program, quality });
    } else if (quality === existing.quality && program.channelName < existing.program.channelName) {
      // If same quality, prefer alphabetically first channel (deterministic)
      grouped.set(key, { program, quality });
    }
  });

  return Array.from(grouped.values()).map(item => item.program);
}

/**
 * Apply all filters and search
 * @param {Array} programs - Array of program objects
 * @param {Object} options - Filter options
 * @param {string} options.searchQuery - Search query
 * @param {string} options.searchScope - Search scope
 * @param {string} options.timeFilter - Time filter
 * @param {Set|null} options.selectedChannels - Selected channel IDs
 * @returns {Array} - Filtered and searched programs
 */
export function applyFilters(programs, options = {}) {
  const {
    searchQuery = '',
    searchScope = 'both',
    timeFilter = 'all',
    selectedChannels = null
  } = options;

  let filtered = programs;

  // Apply channel filter first (most selective)
  filtered = filterByChannels(filtered, selectedChannels);

  // Apply time filter
  filtered = filterByTime(filtered, timeFilter);

  // Apply search
  filtered = searchPrograms(filtered, searchQuery, searchScope);

  return filtered;
}

/**
 * Sort programs by various criteria
 * @param {Array} programs - Array of program objects
 * @param {string} sortBy - Sort criteria: 'time-asc', 'time-desc', 'channel-asc', 'title-asc'
 * @returns {Array} - Sorted programs
 */
export function sortPrograms(programs, sortBy = 'time-asc') {
  return [...programs].sort((a, b) => {
    switch (sortBy) {
      case 'time-asc':
        return a.start.getTime() - b.start.getTime();

      case 'time-desc':
        return b.start.getTime() - a.start.getTime();

      case 'channel-asc':
        // Sort by channel first, then by time
        const channelCompare = a.channelName.localeCompare(b.channelName);
        if (channelCompare !== 0) return channelCompare;
        return a.start.getTime() - b.start.getTime();

      case 'title-asc':
        // Sort by title first, then by time
        const titleCompare = a.title.localeCompare(b.title);
        if (titleCompare !== 0) return titleCompare;
        return a.start.getTime() - b.start.getTime();

      default:
        return a.start.getTime() - b.start.getTime();
    }
  });
}

/**
 * Group programs by channel
 * @param {Array} programs - Array of program objects
 * @returns {Object} - Programs grouped by channel name
 */
export function groupByChannel(programs) {
  return programs.reduce((groups, program) => {
    const channel = program.channelName;

    if (!groups[channel]) {
      groups[channel] = [];
    }

    groups[channel].push(program);
    return groups;
  }, {});
}

/**
 * Get unique channels from programs
 * @param {Array} programs - Array of program objects
 * @returns {Array} - Unique channel names
 */
export function getUniqueChannels(programs) {
  const channelSet = new Set(programs.map(p => p.channelName));
  return Array.from(channelSet).sort();
}

/**
 * Paginate results
 * @param {Array} items - Array of items
 * @param {number} page - Current page (1-indexed)
 * @param {number} perPage - Items per page
 * @returns {Object} - Pagination info and items
 */
export function paginate(items, page = 1, perPage = 20) {
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / perPage);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * perPage;
  const endIndex = startIndex + perPage;

  return {
    items: items.slice(startIndex, endIndex),
    currentPage,
    totalPages,
    totalItems,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1
  };
}

/**
 * Apply rating boost to search results
 * Higher-rated programs appear first among equal search scores
 * @param {Array} programs - Array of program objects (may have fuzzyScore)
 * @returns {Array} - Programs sorted with rating boost
 */
export function applyRatingBoost(programs) {
  return [...programs].sort((a, b) => {
    // If both have fuzzy scores, use those first
    const scoreA = a.fuzzyScore !== undefined ? a.fuzzyScore : 1;
    const scoreB = b.fuzzyScore !== undefined ? b.fuzzyScore : 1;
    
    // Lower fuzzy score = better match (Fuse.js convention)
    const scoreDiff = scoreA - scoreB;
    
    // If scores are very close (within 0.05), use rating as tiebreaker
    if (Math.abs(scoreDiff) < 0.05) {
      const ratingA = getRating(getProgramId(a)) || 0;
      const ratingB = getRating(getProgramId(b)) || 0;
      
      // Higher rating comes first
      return ratingB - ratingA;
    }
    
    return scoreDiff;
  });
}
