/**
 * m3uParser.js - M3U Playlist Parser
 * Parses extended M3U format (online cinema) into structured objects
 */

/**
 * Fetch M3U data from URL (via proxy in production)
 * @param {string} url - M3U file URL
 * @param {AbortSignal} [signal] - Optional AbortSignal for cancellation
 * @returns {Promise<string>} - Raw M3U text content
 */
export async function fetchM3uData(url, signal) {
  const isLocalhost = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1';

  const fetchUrl = isLocalhost ? url : `/api/proxy?url=${encodeURIComponent(url)}`;

  const fetchOptions = {};
  if (signal) fetchOptions.signal = signal;

  const response = await fetch(fetchUrl, fetchOptions);

  if (!response.ok) {
    throw new Error(`Failed to fetch M3U data: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  if (!text || text.trim().length === 0) {
    throw new Error('Empty M3U response');
  }

  if (!text.startsWith('#EXTM3U')) {
    throw new Error('Invalid M3U format: missing #EXTM3U header');
  }

  return text;
}

/**
 * Parse M3U text into structured cinema items
 * Uses chunked processing to avoid blocking the main thread
 * @param {string} m3uText - Raw M3U text content
 * @param {Function} [onProgress] - Progress callback (current, total)
 * @returns {Promise<Object>} - Parsed cinema data { items, categories, stats }
 */
export function parseM3u(m3uText, onProgress) {
  return new Promise((resolve) => {
    const lines = m3uText.split('\n');
    const items = [];
    const categoriesSet = new Set();
    const genresSet = new Set();

    let currentItem = null;
    const totalLines = lines.length;
    const CHUNK_SIZE = 5000; // Process 5000 lines per chunk

    function processChunk(startIndex) {
      const endIndex = Math.min(startIndex + CHUNK_SIZE, totalLines);

      for (let i = startIndex; i < endIndex; i++) {
        const line = lines[i].trim();

        if (!line || line === '#EXTM3U') continue;

        if (line.startsWith('#EXTINF:')) {
          currentItem = parseExtInf(line);
        } else if (line.startsWith('#EXTIMG:') && currentItem) {
          currentItem.poster = line.substring(8).trim();
        } else if (line.startsWith('#EXTDESC:') && currentItem) {
          currentItem.description = line.substring(9).trim();
        } else if (!line.startsWith('#') && currentItem) {
          currentItem.streamUrl = line;
          items.push(currentItem);

          if (currentItem.category) {
            categoriesSet.add(currentItem.category);
          }
          if (currentItem.genres) {
            currentItem.genres.forEach(g => genresSet.add(g));
          }

          currentItem = null;
        }
      }

      // Report progress
      if (onProgress) {
        onProgress(endIndex, totalLines);
      }

      if (endIndex < totalLines) {
        // Yield to the event loop for UI repaints
        setTimeout(() => processChunk(endIndex), 0);
      } else {
        // Done
        const categories = Array.from(categoriesSet).sort();
        const genres = Array.from(genresSet).sort();

        resolve({
          items,
          categories,
          genres,
          stats: {
            totalItems: items.length,
            totalCategories: categories.length,
            totalGenres: genres.length
          }
        });
      }
    }

    // Start processing
    processChunk(0);
  });
}

/**
 * Parse #EXTINF line into item attributes
 * @param {string} line - #EXTINF line
 * @returns {Object} - Parsed item object
 */
function parseExtInf(line) {
  const item = {
    title: '',
    duration: 0,
    genres: [],
    rating: null,
    year: null,
    country: '',
    director: '',
    category: '',
    added: '',
    poster: '',
    description: '',
    streamUrl: ''
  };

  // Remove #EXTINF: prefix
  const content = line.substring(8);

  // Extract duration (number before first space or attribute)
  const durationMatch = content.match(/^(-?\d+)/);
  if (durationMatch) {
    item.duration = parseInt(durationMatch[1], 10);
  }

  // Extract attributes using regex
  const genresMatch = content.match(/genres="([^"]*)"/);
  if (genresMatch) {
    item.genres = genresMatch[1].split(',').map(g => g.trim()).filter(Boolean);
  }

  const ratingMatch = content.match(/rating="([^"]*)"/);
  if (ratingMatch && ratingMatch[1]) {
    const parsed = parseFloat(ratingMatch[1]);
    item.rating = isNaN(parsed) ? null : parsed;
  }

  const yearMatch = content.match(/year="([^"]*)"/);
  if (yearMatch && yearMatch[1]) {
    item.year = parseInt(yearMatch[1], 10) || null;
  }

  const countryMatch = content.match(/country="([^"]*)"/);
  if (countryMatch) {
    item.country = countryMatch[1];
  }

  const directorMatch = content.match(/director="([^"]*)"/);
  if (directorMatch) {
    item.director = directorMatch[1];
  }

  const groupMatch = content.match(/group-title="([^"]*)"/);
  if (groupMatch) {
    item.category = groupMatch[1];
  }

  const addedMatch = content.match(/added="([^"]*)"/);
  if (addedMatch) {
    item.added = addedMatch[1];
  }

  // Extract title (everything after the last comma in the EXTINF line)
  const lastCommaIndex = content.lastIndexOf(',');
  if (lastCommaIndex !== -1) {
    item.title = content.substring(lastCommaIndex + 1).trim();
  }

  return item;
}

/**
 * Filter cinema items by criteria
 * @param {Array} items - All cinema items
 * @param {Object} filters - Filter criteria
 * @param {string} [filters.query] - Search query
 * @param {string} [filters.category] - Category filter (group-title)
 * @param {number} [filters.minRating] - Minimum rating
 * @param {number} [filters.minYear] - Minimum year
 * @param {number} [filters.maxYear] - Maximum year
 * @param {Set} [filters.selectedGenres] - Selected genres (OR logic)
 * @returns {Array} - Filtered items
 */
export function filterCinemaItems(items, filters = {}) {
  let result = items;

  // Filter by category
  if (filters.category && filters.category !== 'all') {
    result = result.filter(item => item.category === filters.category);
  }

  // Filter by genres (OR logic: item must have at least one selected genre)
  if (filters.selectedGenres && filters.selectedGenres.size > 0) {
    result = result.filter(item => {
      const itemGenres = Array.isArray(item.genres) ? item.genres : [];
      return itemGenres.some(g => filters.selectedGenres.has(g));
    });
  }

  // Filter by minimum rating
  if (filters.minRating && filters.minRating > 0) {
    result = result.filter(item => item.rating !== null && item.rating >= filters.minRating);
  }

  // Filter by year range
  if (filters.minYear) {
    result = result.filter(item => item.year !== null && item.year >= filters.minYear);
  }
  if (filters.maxYear) {
    result = result.filter(item => item.year !== null && item.year <= filters.maxYear);
  }

  // Filter by text search (title + description)
  if (filters.query && filters.query.trim().length >= 2) {
    const query = filters.query.trim().toLowerCase();
    result = result.filter(item => {
      const title = (item.title || '').toLowerCase();
      const desc = (item.description || '').toLowerCase();
      return title.includes(query) || desc.includes(query);
    });
  }

  return result;
}

/**
 * Sort cinema items
 * @param {Array} items - Cinema items to sort
 * @param {string} sortBy - Sort criteria
 * @returns {Array} - Sorted items (new array)
 */
export function sortCinemaItems(items, sortBy) {
  const sorted = [...items];

  switch (sortBy) {
    case 'rating-desc':
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      break;
    case 'year-desc':
      sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      break;
    case 'year-asc':
      sorted.sort((a, b) => (a.year || 0) - (b.year || 0));
      break;
    case 'added-desc':
      sorted.sort((a, b) => {
        const dateA = a.added ? new Date(a.added).getTime() : 0;
        const dateB = b.added ? new Date(b.added).getTime() : 0;
        return dateB - dateA;
      });
      break;
    case 'title-asc':
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ru'));
      break;
    default:
      // Default: newest added first
      sorted.sort((a, b) => {
        const dateA = a.added ? new Date(a.added).getTime() : 0;
        const dateB = b.added ? new Date(b.added).getTime() : 0;
        return dateB - dateA;
      });
  }

  return sorted;
}
