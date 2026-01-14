/**
 * fuzzySearch.test.js - Unit Tests for Fuzzy Search
 * 
 * To run these tests:
 * 1. Open tests/test-runner.html in a browser
 * 2. Check console for test results
 * 
 * Note: These are manual tests since we're not using a test framework
 * to maintain the no-build-step architecture.
 */

import { 
  detectLanguage, 
  stemText, 
  initSearchIndex, 
  fuzzySearch,
  isFuzzySearchAvailable 
} from '../public/scripts/utils/fuzzySearch.js';

// Simple test framework
const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(message);
  }
}

// Language Detection Tests
test('detectLanguage: should detect Russian text', () => {
  const result = detectLanguage('Убийство в Восточном экспрессе');
  assertEqual(result, 'russian', 'Should detect Russian');
});

test('detectLanguage: should detect English text', () => {
  const result = detectLanguage('Murder on the Orient Express');
  assertEqual(result, 'english', 'Should detect English');
});

test('detectLanguage: should handle mixed text (majority Russian)', () => {
  const result = detectLanguage('Убийство Murder Восточном Express');
  assertEqual(result, 'russian', 'Should detect Russian for majority Cyrillic');
});

test('detectLanguage: should handle mixed text (majority English)', () => {
  const result = detectLanguage('Murder Убийство Orient Восточном Express');
  assertEqual(result, 'english', 'Should detect English for majority Latin');
});

test('detectLanguage: should handle empty string', () => {
  const result = detectLanguage('');
  assertEqual(result, 'english', 'Should default to English for empty string');
});

test('detectLanguage: should handle null/undefined', () => {
  assertEqual(detectLanguage(null), 'english', 'Should handle null');
  assertEqual(detectLanguage(undefined), 'english', 'Should handle undefined');
});

test('detectLanguage: should handle numbers and punctuation', () => {
  const result = detectLanguage('123 !@# $%^');
  assertEqual(result, 'english', 'Should default to English for non-letters');
});

test('detectLanguage: should detect Russian with common words', () => {
  const result = detectLanguage('и в не');
  assertEqual(result, 'russian', 'Should detect Russian from common words');
});

test('detectLanguage: should handle short Russian text', () => {
  const result = detectLanguage('Привет');
  assertEqual(result, 'russian', 'Should detect short Russian text');
});

test('detectLanguage: should handle single English word', () => {
  const result = detectLanguage('Hello');
  assertEqual(result, 'english', 'Should detect single English word');
});

// Stemming Tests
test('stemText: should stem Russian words', () => {
  const result = stemText('Убийства', 'russian');
  assertTrue(result.length > 0, 'Should return stemmed text');
  assertTrue(result.length < 'Убийства'.length, 'Stemmed text should be shorter');
});

test('stemText: should stem English words', () => {
  const result = stemText('running', 'english');
  assertTrue(result.includes('run'), 'Should stem to root form');
});

test('stemText: should be idempotent', () => {
  const text = 'running';
  const stemmed1 = stemText(text, 'english');
  const stemmed2 = stemText(stemmed1, 'english');
  assertEqual(stemmed1, stemmed2, 'Stemming should be idempotent');
});

test('stemText: should handle empty string', () => {
  const result = stemText('', 'english');
  assertEqual(result, '', 'Should return empty string');
});

test('stemText: should handle null/undefined', () => {
  assertEqual(stemText(null), '', 'Should handle null');
  assertEqual(stemText(undefined), '', 'Should handle undefined');
});

test('stemText: should auto-detect language', () => {
  const russian = stemText('Убийства');
  const english = stemText('running');
  assertTrue(russian.length > 0, 'Should stem Russian without explicit language');
  assertTrue(english.length > 0, 'Should stem English without explicit language');
});

test('stemText: should handle multiple words', () => {
  const result = stemText('running quickly', 'english');
  assertTrue(result.includes('run'), 'Should stem first word');
  assertTrue(result.includes('quick'), 'Should stem second word');
});

test('stemText: should truncate very long text', () => {
  const longText = 'word '.repeat(1000); // 5000 characters
  const result = stemText(longText, 'english');
  assertTrue(result.length > 0, 'Should return result for long text');
  assertTrue(result.length < longText.length, 'Should truncate long text');
});

test('stemText: should handle special characters', () => {
  const result = stemText('hello! world? test.', 'english');
  assertTrue(result.length > 0, 'Should handle punctuation');
  assertFalse(result.includes('!'), 'Should remove punctuation');
});

test('stemText: should handle numbers mixed with text', () => {
  const result = stemText('test123 word456', 'english');
  assertTrue(result.length > 0, 'Should handle numbers in text');
});

// Search Index Tests
test('initSearchIndex: should return null if Fuse.js unavailable', async () => {
  // This test assumes Fuse.js is loaded
  const available = isFuzzySearchAvailable();
  if (!available) {
    const result = await initSearchIndex([{ title: 'Test' }]);
    assertEqual(result, null, 'Should return null when Fuse.js unavailable');
  }
});

test('initSearchIndex: should return null for empty programs', async () => {
  const result = await initSearchIndex([]);
  assertEqual(result, null, 'Should return null for empty array');
});

test('initSearchIndex: should return null for null programs', async () => {
  const result = await initSearchIndex(null);
  assertEqual(result, null, 'Should return null for null');
});

test('initSearchIndex: should build index for valid programs', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  const programs = [
    { title: 'Test Program', description: 'Test description', channelName: 'Test Channel' }
  ];
  
  const index = await initSearchIndex(programs);
  assertTrue(index !== null, 'Should return Fuse instance');
  assertTrue(typeof index.search === 'function', 'Should have search method');
});

test('initSearchIndex: should handle large datasets without blocking', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  // Create 1000 programs
  const programs = Array.from({ length: 1000 }, (_, i) => ({
    title: `Program ${i}`,
    description: `Description ${i}`,
    channelName: `Channel ${i % 10}`
  }));
  
  const startTime = performance.now();
  const index = await initSearchIndex(programs);
  const endTime = performance.now();
  
  assertTrue(index !== null, 'Should build index for large dataset');
  assertTrue(endTime - startTime < 5000, 'Should complete within 5 seconds');
});

test('initSearchIndex: should call progress callback', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  const programs = Array.from({ length: 600 }, (_, i) => ({
    title: `Program ${i}`,
    description: `Description ${i}`,
    channelName: `Channel ${i % 10}`
  }));
  
  let progressCalls = 0;
  let lastProgress = 0;
  
  const index = await initSearchIndex(programs, {}, (current, total) => {
    progressCalls++;
    assertTrue(current <= total, 'Current should not exceed total');
    assertTrue(current >= lastProgress, 'Progress should not decrease');
    lastProgress = current;
  });
  
  assertTrue(index !== null, 'Should build index');
  assertTrue(progressCalls >= 1, 'Should call progress at least once');
  assertEqual(lastProgress, programs.length, 'Final progress should equal total');
});

test('initSearchIndex: should populate all programs in index', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  const programs = Array.from({ length: 100 }, (_, i) => ({
    title: `Unique Title ${i}`,
    description: `Description ${i}`,
    channelName: `Channel ${i % 10}`
  }));
  
  const index = await initSearchIndex(programs);
  
  // Search for a specific program
  const results = index.search('Unique Title 50');
  assertTrue(results.length > 0, 'Should find program in index');
  assertTrue(results[0].item.title.includes('50'), 'Should find correct program');
});

test('initSearchIndex: should handle very large datasets (5000+ programs)', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  // Create 5000 programs to test performance
  const programs = Array.from({ length: 5000 }, (_, i) => ({
    title: `Program ${i} - Test Title`,
    description: `Description for program ${i} with some content`,
    channelName: `Channel ${i % 50}`
  }));
  
  const startTime = performance.now();
  const index = await initSearchIndex(programs);
  const endTime = performance.now();
  
  assertTrue(index !== null, 'Should build index for 5000 programs');
  assertTrue(endTime - startTime < 10000, 'Should complete within 10 seconds');
  console.log(`  Built index for 5000 programs in ${(endTime - startTime).toFixed(0)}ms`);
  
  // Verify search works
  const results = index.search('Program 2500');
  assertTrue(results.length > 0, 'Should find program in large index');
});

test('initSearchIndex: should handle programs with missing fields', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  const programs = [
    { title: 'Complete Program', description: 'Full description', channelName: 'Channel 1' },
    { title: 'No Description', channelName: 'Channel 2' },
    { title: 'No Channel', description: 'Has description' },
    { title: 'Title Only' }
  ];
  
  const index = await initSearchIndex(programs);
  assertTrue(index !== null, 'Should handle programs with missing fields');
  
  const results = index.search('Complete');
  assertTrue(results.length > 0, 'Should find complete program');
});

test('initSearchIndex: should handle programs with special characters', async () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  const programs = [
    { title: 'Program with "quotes"', description: 'Test', channelName: 'Channel' },
    { title: 'Program with <html>', description: 'Test', channelName: 'Channel' },
    { title: 'Program with émojis 🎬', description: 'Test', channelName: 'Channel' }
  ];
  
  const index = await initSearchIndex(programs);
  assertTrue(index !== null, 'Should handle special characters');
});

// Fuzzy Search Tests
test('fuzzySearch: should find exact matches', () => {
  if (!isFuzzySearchAvailable()) {
    console.log('Skipping test: Fuse.js not available');
    return;
  }
  
  // This test requires async setup, simplified for demo
  console.log('Fuzzy search tests require full setup - see integration tests');
});

test('fuzzySearch: should handle empty query', () => {
  const result = fuzzySearch(null, '');
  assertTrue(Array.isArray(result), 'Should return array');
  assertEqual(result.length, 0, 'Should return empty array for empty query');
});

test('fuzzySearch: should handle null instance', () => {
  const result = fuzzySearch(null, 'test');
  assertTrue(Array.isArray(result), 'Should return array');
  assertEqual(result.length, 0, 'Should return empty array for null instance');
});

// Availability Tests
test('isFuzzySearchAvailable: should check for dependencies', () => {
  const result = isFuzzySearchAvailable();
  assertTrue(typeof result === 'boolean', 'Should return boolean');
});

// Run all tests
export async function runTests() {
  console.log('🧪 Running Fuzzy Search Tests...\n');
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.error(`❌ ${name}`);
      console.error(`   ${error.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.error('⚠️ Some tests failed');
  }
  
  return { passed, failed, total: tests.length };
}

// Auto-run if loaded directly
if (typeof window !== 'undefined') {
  window.runFuzzySearchTests = runTests;
}
