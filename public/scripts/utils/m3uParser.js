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
      const seriesTitle = (item.seriesTitle || '').toLowerCase();
      const desc = (item.description || '').toLowerCase();
      return title.includes(query) || seriesTitle.includes(query) || desc.includes(query);
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

/** Regex to detect S##E## pattern in titles (case-insensitive, tolerant) */
const EPISODE_REGEX = /^(.+?)\s+[Ss](\d+)\s*[Ee](\d+)(?:\s*[-:].*)?$/;

/**
 * Group serial episodes into series objects
 * Items with S##E## in title are grouped; others remain as films.
 * @param {Array} items - All parsed cinema items
 * @returns {Object} - { films: [...], series: [...] }
 *   Each series: { seriesTitle, poster, genres, rating, year, country, director,
 *                  category, added, description, totalEpisodes, seasonCount,
 *                  seasons: { 1: [{episode, streamUrl, duration}], 2: [...] } }
 */
export function groupSeriesEpisodes(items) {
  const films = [];
  const seriesMap = new Map(); // key: "seriesTitle|category" → series object

  for (const item of items) {
    const match = (item.title || '').match(EPISODE_REGEX);

    if (match) {
      const seriesTitle = match[1].trim();
      const season = parseInt(match[2], 10);
      const episode = parseInt(match[3], 10);

      // Group by normalized title (trim + lowercase) to avoid fragmentation
      // when category metadata differs across episodes
      const key = seriesTitle.toLowerCase();

      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          type: 'series',
          seriesTitle,
          title: seriesTitle, // For compatibility with filter/sort functions
          poster: item.poster || '',
          genres: Array.isArray(item.genres) ? [...item.genres] : [],
          rating: item.rating,
          year: item.year,
          country: item.country || '',
          director: item.director || '',
          category: item.category || '',
          added: item.added || '',
          description: item.description || '',
          totalEpisodes: 0,
          seasonCount: 0,
          seasons: {},
          _episodeKeys: new Set() // Track seen episodes for deduplication
        });
      }

      const series = seriesMap.get(key);

      // Consolidate metadata from all episodes
      if (!series.poster && item.poster) series.poster = item.poster;
      if (!series.description && item.description) series.description = item.description;
      if (!series.rating && item.rating) series.rating = item.rating;
      if (!series.director && item.director) series.director = item.director;
      if (!series.country && item.country) series.country = item.country;
      // Use earliest year (series start year)
      if (item.year && (!series.year || item.year < series.year)) {
        series.year = item.year;
      }
      // Merge genres (deduplicate)
      if (Array.isArray(item.genres)) {
        for (const g of item.genres) {
          if (!series.genres.includes(g)) {
            series.genres.push(g);
          }
        }
      }
      // Use most recent added date (compare as timestamps)
      if (item.added) {
        const itemTime = Date.parse(item.added) || 0;
        const seriesTime = Date.parse(series.added) || 0;
        if (itemTime > seriesTime) {
          series.added = item.added;
        }
      }

      // Add episode to season (deduplicate by season+episode number)
      if (!series.seasons[season]) {
        series.seasons[season] = [];
      }

      const episodeKey = `${season}-${episode}`;
      if (!series._episodeKeys.has(episodeKey)) {
        series._episodeKeys.add(episodeKey);
        series.seasons[season].push({
          episode,
          season,
          title: item.title,
          streamUrl: item.streamUrl || '',
          duration: item.duration || 0
        });
        series.totalEpisodes++;
      }
    } else {
      // Regular film/item
      films.push({ ...item, type: 'film' });
    }
  }

  // Finalize series: sort episodes within seasons, compute seasonCount, clean up
  const series = [];
  for (const s of seriesMap.values()) {
    s.seasonCount = Object.keys(s.seasons).length;

    // Sort episodes within each season
    for (const seasonNum of Object.keys(s.seasons)) {
      s.seasons[seasonNum].sort((a, b) => a.episode - b.episode);
    }

    // Remove internal deduplication tracker
    delete s._episodeKeys;

    series.push(s);
  }

  return { films, series };
}

/**
 * Parse a live-channel M3U playlist into a Map keyed by tvg-id.
 * Handles standard IPTV playlists (tvg-id, tvg-logo, tvg-rec, stream URL).
 * Does not modify the existing parseM3u / cinema path.
 *
 * @param {string} text - Raw M3U text content
 * @returns {Map<string, {tvgId: string, name: string, streamUrl: string, logo: string, tvgRec: number}>}
 */
export function parseLiveM3u(text) {
  const map = new Map();
  const lines = text.split('\n');
  let cur = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (!line || line.startsWith('#EXTM3U') || line.startsWith('#EXTGRP')) continue;

    if (line.startsWith('#EXTINF:')) {
      const content = line.substring(8);
      const tvgId = (content.match(/tvg-id="([^"]*)"/) || [])[1] || '';
      const logo  = (content.match(/tvg-logo="([^"]*)"/) || [])[1] || '';
      const rec   = parseInt((content.match(/tvg-rec="([^"]*)"/) || [])[1], 10) || 0;
      const comma = content.lastIndexOf(',');
      const name  = comma !== -1 ? content.substring(comma + 1).trim() : '';
      cur = { tvgId, name, logo, tvgRec: rec, streamUrl: '' };
    } else if (!line.startsWith('#') && cur) {
      cur.streamUrl = line;
      if (cur.tvgId) {
        map.set(cur.tvgId, cur);
      }
      cur = null;
    }
  }

  return map;
}
