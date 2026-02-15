/**
 * keywords.js - Keyword Chip Generation
 * Extracts meaningful keywords from EPG program titles using frequency analysis
 */

// Seed keywords that are boosted in ranking (bilingual EN/RU)
const SEED_KEYWORDS = [
  // English
  'movie', 'film', 'series', 'live', 'news', 'sport', 'football',
  'documentary', 'comedy', 'drama', 'thriller', 'horror', 'concert',
  'premiere', 'final', 'championship', 'season', 'show', 'music',
  'cartoon', 'animation', 'interview', 'weather', 'travel',
  // Russian
  'фильм', 'сериал', 'новости', 'спорт', 'футбол', 'хоккей',
  'детектив', 'комедия', 'драма', 'мультфильм', 'концерт',
  'премьера', 'финал', 'чемпионат', 'матч', 'шоу', 'музыка',
  'мелодрама', 'боевик', 'триллер', 'документальный', 'погода',
  'кино', 'передача', 'программа'
];

// Build a Set for fast lookup (lowercase)
const SEED_SET = new Set(SEED_KEYWORDS.map(w => w.toLowerCase()));

// Stop words to exclude (common words with no discovery value)
const STOP_WORDS = new Set([
  // English
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was',
  'will', 'has', 'have', 'had', 'not', 'all', 'can', 'her', 'his',
  'you', 'but', 'they', 'she', 'him', 'how', 'its', 'who', 'did',
  'been', 'said', 'each', 'which', 'their', 'than', 'other', 'into',
  'could', 'would', 'make', 'like', 'just', 'over', 'such', 'take',
  'year', 'them', 'some', 'time', 'very', 'when', 'come', 'what',
  'also', 'back', 'after', 'use', 'two', 'way', 'about', 'many',
  'then', 'first', 'any', 'new', 'now', 'our', 'out', 'day', 'get',
  'made', 'may', 'part', 'episode', 'season',
  // Russian
  'и', 'в', 'на', 'с', 'по', 'из', 'не', 'что', 'как', 'это',
  'для', 'от', 'до', 'все', 'так', 'но', 'за', 'он', 'она', 'они',
  'его', 'ее', 'их', 'мы', 'вы', 'при', 'уже', 'или', 'быть',
  'был', 'была', 'были', 'будет', 'есть', 'нет', 'если', 'когда',
  'где', 'тоже', 'между', 'через', 'после', 'перед', 'под', 'над',
  'без', 'обо', 'про', 'серия', 'часть', 'выпуск', 'сезон'
]);

// Tokenization regex: split on whitespace, punctuation, digits
const TOKEN_REGEX = /[\s\-:,;!?.()[\]"'«»„"#№@%&*+=/<>{}|\\~`0-9]+/;

// Minimum token length
const MIN_TOKEN_LENGTH = 3;

// Minimum frequency threshold
const MIN_FREQUENCY = 3;

// Seed boost multiplier
const SEED_BOOST = 1.5;

/**
 * Generate keyword chips from EPG program data
 * @param {Array} programs - Array of program objects with title field
 * @param {Object} options - Generation options
 * @param {number} options.maxKeywords - Maximum keywords to return (default: 15)
 * @param {number} options.minFrequency - Minimum occurrences (default: 3)
 * @returns {Array<{text: string, count: number}>} - Sorted keyword objects
 */
export function generateKeywords(programs, options = {}) {
  const {
    maxKeywords = 15,
    minFrequency = MIN_FREQUENCY
  } = options;

  if (!programs || programs.length === 0) return [];

  // Count token frequency across all titles
  const frequency = new Map();

  for (const program of programs) {
    if (!program.title) continue;

    const tokens = program.title.split(TOKEN_REGEX);

    for (const raw of tokens) {
      const token = raw.toLowerCase().trim();

      if (token.length < MIN_TOKEN_LENGTH) continue;
      if (STOP_WORDS.has(token)) continue;

      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }

  // Build scored keyword list
  const keywords = [];

  for (const [token, count] of frequency) {
    if (count < minFrequency) continue;

    // Boost seed keywords
    const isSeed = SEED_SET.has(token);
    const score = isSeed ? count * SEED_BOOST : count;

    keywords.push({
      text: capitalize(token),
      count,
      score
    });
  }

  // Sort by score descending, then alphabetically for ties
  keywords.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.text.localeCompare(b.text);
  });

  // Return top N without score field
  return keywords.slice(0, maxKeywords).map(({ text, count }) => ({ text, count }));
}

/**
 * Capitalize first letter of a string
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
