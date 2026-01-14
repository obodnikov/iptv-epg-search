/**
 * fuzzySearch.js - Fuzzy Search with Morphology Support
 * Handles fuzzy matching with Russian/English stemming using Snowball and Fuse.js
 */

/**
 * Common Russian words for language detection
 */
const COMMON_RUSSIAN_WORDS = new Set([
  'и', 'в', 'не', 'на', 'с', 'что', 'как', 'это', 'по', 'но',
  'из', 'за', 'для', 'от', 'до', 'при', 'без', 'под', 'над', 'про',
  'все', 'его', 'она', 'они', 'мы', 'вы', 'так', 'же', 'то', 'бы'
]);

/**
 * Detect language of text (improved heuristic with common word detection)
 * @param {string} text - Input text
 * @returns {string} - 'russian' or 'english'
 */
export function detectLanguage(text) {
  if (!text || typeof text !== 'string') return 'english';
  
  const lowerText = text.toLowerCase();
  
  // Check for common Russian words first (more reliable for short text)
  const words = lowerText.split(/\s+/);
  let russianWordCount = 0;
  for (const word of words) {
    if (COMMON_RUSSIAN_WORDS.has(word)) {
      russianWordCount++;
    }
  }
  
  // If we found common Russian words, likely Russian
  if (russianWordCount >= 2 || (russianWordCount >= 1 && words.length <= 3)) {
    return 'russian';
  }
  
  // Count Cyrillic characters
  const cyrillicMatches = text.match(/[\u0400-\u04FF]/g);
  const cyrillicCount = cyrillicMatches ? cyrillicMatches.length : 0;
  
  // Count total letters (excluding spaces, punctuation, numbers)
  const letterMatches = text.match(/[a-zA-Z\u0400-\u04FF]/g);
  const totalLetters = letterMatches ? letterMatches.length : 0;
  
  // If no letters, default to english
  if (totalLetters === 0) return 'english';
  
  // If more than 30% of letters are Cyrillic, consider it Russian
  const cyrillicRatio = cyrillicCount / totalLetters;
  return cyrillicRatio > 0.3 ? 'russian' : 'english';
}

/**
 * Stem a text string using Snowball
 * @param {string} text - Input text
 * @param {string} language - 'russian' or 'english'
 * @returns {string} - Stemmed text
 */
export function stemText(text, language = null) {
  if (!text || typeof text !== 'string') return '';
  
  // Limit text length to prevent performance issues with very long descriptions
  const MAX_TEXT_LENGTH = 2000;
  const truncatedText = text.length > MAX_TEXT_LENGTH 
    ? text.substring(0, MAX_TEXT_LENGTH) 
    : text;
  
  // Check if Snowball is available (snowballFactory from snowball-stemmers)
  if (typeof snowballFactory === 'undefined') {
    console.warn('Snowball stemmer not available, returning original text');
    return truncatedText.toLowerCase();
  }
  
  // Auto-detect language if not specified
  const lang = language || detectLanguage(truncatedText);
  
  try {
    // Create stemmer instance using snowball-stemmers API
    const stemmer = snowballFactory.newStemmer(lang);
    
    // Split text into words, stem each, and rejoin
    const words = truncatedText.toLowerCase().split(/\s+/);
    const stemmedWords = words.map(word => {
      // Remove punctuation
      const cleanWord = word.replace(/[^\w\u0400-\u04FF]/g, '');
      if (!cleanWord) return '';
      
      return stemmer.stem(cleanWord);
    });
    
    return stemmedWords.filter(w => w).join(' ');
  } catch (error) {
    console.error('Stemming error:', error);
    return truncatedText.toLowerCase();
  }
}

/**
 * Process a single chunk of programs (helper for async processing)
 * @param {Array} chunk - Array of programs to process
 * @returns {Array} - Processed programs with stemmed fields
 */
function processChunk(chunk) {
  return chunk.map(program => ({
    ...program,
    stemmedTitle: stemText(program.title),
    stemmedDescription: stemText(program.description),
    stemmedChannel: stemText(program.channelName),
    // Keep original for display
    originalTitle: program.title,
    originalDescription: program.description,
    originalChannel: program.channelName
  }));
}

/**
 * Yield control to browser using requestAnimationFrame for better UI responsiveness
 * @returns {Promise<void>}
 */
function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Initialize the fuzzy search engine with EPG data
 * @param {Array} programs - Array of program objects
 * @param {Object} options - Fuse.js configuration options
 * @param {Function} onProgress - Optional progress callback (current, total)
 * @returns {Promise<Object|null>} - Configured Fuse.js instance or null if unavailable
 */
export async function initSearchIndex(programs, options = {}, onProgress = null) {
  // Check if Fuse.js is available
  if (typeof Fuse === 'undefined') {
    console.warn('Fuse.js not available, fuzzy search disabled');
    return null;
  }
  
  if (!programs || programs.length === 0) {
    console.warn('No programs provided for indexing');
    return null;
  }
  
  console.log('Building fuzzy search index...');
  const startTime = performance.now();
  
  // Process in chunks to avoid blocking the main thread
  // Larger chunks = faster processing, smaller chunks = more responsive UI
  // 1000 is a good balance for datasets up to 50,000 programs
  const CHUNK_SIZE = 1000;
  const indexedPrograms = new Array(programs.length);
  let processedCount = 0;
  
  // Process all chunks sequentially with proper async/await
  for (let chunkStart = 0; chunkStart < programs.length; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, programs.length);
    const chunk = programs.slice(chunkStart, chunkEnd);
    
    // Process this chunk synchronously
    const processedChunk = processChunk(chunk);
    
    // Copy processed items into the result array at correct positions
    for (let j = 0; j < processedChunk.length; j++) {
      indexedPrograms[chunkStart + j] = processedChunk[j];
    }
    
    processedCount = chunkEnd;
    
    // Report progress
    if (onProgress) {
      onProgress(processedCount, programs.length);
    }
    
    // Yield to browser for UI updates after each chunk (except the last one)
    if (chunkEnd < programs.length) {
      await yieldToBrowser();
    }
  }
  
  // Verify all programs were processed
  if (processedCount !== programs.length) {
    console.error(`Index building incomplete: processed ${processedCount} of ${programs.length}`);
    return null;
  }
  
  // Configure Fuse.js options
  const fuseOptions = {
    keys: [
      { name: 'stemmedTitle', weight: 2 },
      { name: 'stemmedDescription', weight: 1 },
      { name: 'stemmedChannel', weight: 0.5 }
    ],
    threshold: options.threshold || 0.4,
    distance: options.distance || 100,
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 2,
    shouldSort: true,
    ignoreLocation: true,
    useExtendedSearch: false
  };
  
  // Create Fuse instance with the fully populated array
  const fuse = new Fuse(indexedPrograms, fuseOptions);
  
  const endTime = performance.now();
  console.log(`Search index built in ${(endTime - startTime).toFixed(2)}ms for ${programs.length} programs`);
  
  return fuse;
}

/**
 * Perform fuzzy search with stemming
 * @param {Object} fuseInstance - Initialized Fuse.js instance
 * @param {string} query - User search query
 * @param {Object} options - Search options
 * @param {string} options.scope - Search scope: 'both', 'title', 'description', 'channel'
 * @param {number} options.threshold - Fuzzy matching threshold (0-1)
 * @returns {Array} - Matched programs with scores
 */
export function fuzzySearch(fuseInstance, query, options = {}) {
  if (!fuseInstance) {
    console.warn('Fuse instance not available');
    return [];
  }
  
  if (!query || query.trim().length === 0) {
    return [];
  }
  
  const { scope = 'both', threshold } = options;
  
  // Stem the query
  const stemmedQuery = stemText(query);
  
  // Update threshold if provided
  if (threshold !== undefined) {
    fuseInstance.options.threshold = threshold;
  }
  
  // Adjust search keys based on scope
  const originalKeys = fuseInstance.options.keys;
  
  switch (scope) {
    case 'title':
      fuseInstance.options.keys = [{ name: 'stemmedTitle', weight: 1 }];
      break;
    case 'description':
      fuseInstance.options.keys = [{ name: 'stemmedDescription', weight: 1 }];
      break;
    case 'channel':
      fuseInstance.options.keys = [{ name: 'stemmedChannel', weight: 1 }];
      break;
    case 'both':
    default:
      fuseInstance.options.keys = [
        { name: 'stemmedTitle', weight: 2 },
        { name: 'stemmedDescription', weight: 1 }
      ];
  }
  
  // Perform search
  const results = fuseInstance.search(stemmedQuery);
  
  // Restore original keys
  fuseInstance.options.keys = originalKeys;
  
  // Extract items with scores
  return results.map(result => ({
    ...result.item,
    fuzzyScore: result.score,
    matches: result.matches
  }));
}

/**
 * Check if fuzzy search is available
 * @returns {boolean} - True if Snowball and Fuse.js are loaded
 */
export function isFuzzySearchAvailable() {
  return typeof snowballFactory !== 'undefined' && typeof Fuse !== 'undefined';
}

/**
 * Get fuzzy search status message
 * @returns {string} - Status message
 */
export function getFuzzySearchStatus() {
  const hasSnowball = typeof snowballFactory !== 'undefined';
  const hasFuse = typeof Fuse !== 'undefined';
  
  if (hasSnowball && hasFuse) {
    return 'Fuzzy search enabled';
  }
  
  const missing = [];
  if (!hasSnowball) missing.push('Snowball stemmer');
  if (!hasFuse) missing.push('Fuse.js');
  
  return `Fuzzy search disabled: ${missing.join(', ')} not loaded`;
}
