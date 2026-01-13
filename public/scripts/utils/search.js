/**
 * search.js - Search and Filter Utility
 * Handles searching and filtering EPG programs
 */

import { getProgramStatus } from './epgParser.js';

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
 * Apply all filters and search
 * @param {Array} programs - Array of program objects
 * @param {Object} options - Filter options
 * @param {string} options.searchQuery - Search query
 * @param {string} options.searchScope - Search scope
 * @param {string} options.timeFilter - Time filter
 * @returns {Array} - Filtered and searched programs
 */
export function applyFilters(programs, options = {}) {
  const {
    searchQuery = '',
    searchScope = 'both',
    timeFilter = 'all'
  } = options;

  let filtered = programs;

  // Apply time filter
  filtered = filterByTime(filtered, timeFilter);

  // Apply search
  filtered = searchPrograms(filtered, searchQuery, searchScope);

  return filtered;
}

/**
 * Sort programs by start time
 * @param {Array} programs - Array of program objects
 * @param {string} order - Sort order: 'asc' or 'desc'
 * @returns {Array} - Sorted programs
 */
export function sortPrograms(programs, order = 'asc') {
  return [...programs].sort((a, b) => {
    const timeA = a.start.getTime();
    const timeB = b.start.getTime();

    return order === 'asc' ? timeA - timeB : timeB - timeA;
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
