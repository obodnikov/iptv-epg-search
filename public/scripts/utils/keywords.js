/**
 * keywords.js - Two-Tier Keyword Chip Generation
 * Tier 1: Genre chips — seed keywords validated against EPG data
 * Tier 2: Popular chips — full program titles that appear frequently
 */

// Seed genre keywords (bilingual EN/RU) with display labels
const GENRE_SEEDS = [
  // English seeds
  { match: ['movie', 'film'], label: 'Movie' },
  { match: ['series'], label: 'Series' },
  { match: ['live'], label: 'Live' },
  { match: ['news'], label: 'News' },
  { match: ['sport', 'football', 'soccer', 'hockey', 'tennis', 'basketball'], label: 'Sport' },
  { match: ['documentary'], label: 'Documentary' },
  { match: ['comedy'], label: 'Comedy' },
  { match: ['drama'], label: 'Drama' },
  { match: ['thriller'], label: 'Thriller' },
  { match: ['concert', 'music'], label: 'Music' },
  { match: ['cartoon', 'animation'], label: 'Cartoon' },
  { match: ['premiere'], label: 'Premiere' },
  { match: ['show'], label: 'Show' },
  // Russian seeds
  { match: ['фильм', 'кино'], label: 'Фильм' },
  { match: ['сериал'], label: 'Сериал' },
  { match: ['новости'], label: 'Новости' },
  { match: ['спорт', 'футбол', 'хоккей', 'матч'], label: 'Спорт' },
  { match: ['детектив'], label: 'Детектив' },
  { match: ['комедия'], label: 'Комедия' },
  { match: ['драма'], label: 'Драма' },
  { match: ['мелодрама'], label: 'Мелодрама' },
  { match: ['боевик'], label: 'Боевик' },
  { match: ['триллер'], label: 'Триллер' },
  { match: ['мультфильм'], label: 'Мультфильм' },
  { match: ['концерт', 'музыка'], label: 'Музыка' },
  { match: ['документальный'], label: 'Документальный' },
  { match: ['премьера'], label: 'Премьера' },
  { match: ['шоу', 'передача'], label: 'Шоу' }
];

// Minimum title occurrences to qualify as "popular"
const MIN_POPULAR_COUNT = 3;

/**
 * Generate genre chips — seed keywords validated against EPG titles
 * @param {Array} programs - Array of program objects with title field
 * @param {Object} options
 * @param {number} options.maxGenre - Maximum genre chips (default: 10)
 * @returns {Array<{text: string, count: number, type: string}>}
 */
export function generateGenreChips(programs, options = {}) {
  const { maxGenre = 10 } = options;

  if (!programs || programs.length === 0) return [];

  // Build a lowercase concatenation of all titles for fast matching
  const allTitlesLower = programs.map(p => (p.title || '').toLowerCase());

  const results = [];

  for (const seed of GENRE_SEEDS) {
    let count = 0;
    for (const title of allTitlesLower) {
      if (seed.match.some(word => title.includes(word))) {
        count++;
      }
    }
    if (count > 0) {
      results.push({ text: seed.label, count, type: 'genre' });
    }
  }

  // Deduplicate by label (EN and RU seeds may produce same-meaning genres,
  // but labels are distinct so no actual dupes expected)
  // Sort by count descending
  results.sort((a, b) => b.count - a.count);

  return results.slice(0, maxGenre);
}

/**
 * Generate popular chips — full program titles that appear most frequently
 * @param {Array} programs - Array of program objects with title field
 * @param {Object} options
 * @param {number} options.maxPopular - Maximum popular chips (default: 10)
 * @param {number} options.minCount - Minimum occurrences (default: 3)
 * @returns {Array<{text: string, count: number, type: string}>}
 */
export function generatePopularChips(programs, options = {}) {
  const {
    maxPopular = 10,
    minCount = MIN_POPULAR_COUNT
  } = options;

  if (!programs || programs.length === 0) return [];

  // Count occurrences of each normalized title
  const titleCounts = new Map();
  // Track the original (first-seen) casing for display
  const titleDisplay = new Map();

  for (const program of programs) {
    if (!program.title) continue;

    const normalized = program.title.trim().toLowerCase();
    if (normalized.length < 3) continue;

    const current = titleCounts.get(normalized) || 0;
    titleCounts.set(normalized, current + 1);

    // Keep first-seen casing
    if (!titleDisplay.has(normalized)) {
      titleDisplay.set(normalized, program.title.trim());
    }
  }

  // Filter by minimum count, build results
  const results = [];
  for (const [normalized, count] of titleCounts) {
    if (count < minCount) continue;
    results.push({
      text: titleDisplay.get(normalized),
      count,
      type: 'popular'
    });
  }

  // Sort by count descending, then alphabetically
  results.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.text.localeCompare(b.text);
  });

  return results.slice(0, maxPopular);
}
