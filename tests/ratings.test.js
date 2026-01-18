/**
 * ratings.test.js - Unit Tests for Ratings System
 */

import {
  getProgramId,
  getRating,
  setRating,
  removeRating,
  getAllRatings,
  exportRatings,
  importRatings,
  clearAllRatings,
  getRatingStats
} from '../public/scripts/utils/ratings.js';

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

// Setup/Teardown
function setup() {
  clearAllRatings();
}

// Program ID Tests
test('getProgramId: should generate consistent IDs', () => {
  const program = {
    title: 'Test Program',
    channelName: 'Test Channel',
    start: new Date('2024-01-15T10:00:00Z')
  };
  
  const id1 = getProgramId(program);
  const id2 = getProgramId(program);
  
  assertEqual(id1, id2, 'Should generate same ID for same program');
});

test('getProgramId: should generate different IDs for different programs', () => {
  const program1 = {
    title: 'Program 1',
    channelName: 'Channel 1',
    start: new Date('2024-01-15T10:00:00Z')
  };
  
  const program2 = {
    title: 'Program 2',
    channelName: 'Channel 1',
    start: new Date('2024-01-15T10:00:00Z')
  };
  
  const id1 = getProgramId(program1);
  const id2 = getProgramId(program2);
  
  assertTrue(id1 !== id2, 'Should generate different IDs for different programs');
});

// Rating CRUD Tests
test('setRating: should save valid rating', () => {
  setup();
  const programId = 'test-program-1';
  const result = setRating(programId, 5);
  
  assertTrue(result, 'Should return true for successful save');
  assertEqual(getRating(programId), 5, 'Should retrieve saved rating');
});

test('setRating: should reject invalid ratings', () => {
  setup();
  const programId = 'test-program-2';
  
  assertFalse(setRating(programId, 0), 'Should reject rating 0');
  assertFalse(setRating(programId, 6), 'Should reject rating 6');
  assertFalse(setRating(programId, -1), 'Should reject negative rating');
  assertFalse(setRating(programId, 3.5), 'Should reject decimal rating');
  assertFalse(setRating(programId, 'five'), 'Should reject string rating');
});

test('getRating: should return null for unrated program', () => {
  setup();
  const rating = getRating('nonexistent-program');
  assertEqual(rating, null, 'Should return null for unrated program');
});

test('removeRating: should remove existing rating', () => {
  setup();
  const programId = 'test-program-3';
  
  setRating(programId, 4);
  assertEqual(getRating(programId), 4, 'Rating should be set');
  
  removeRating(programId);
  assertEqual(getRating(programId), null, 'Rating should be removed');
});

test('setRating: should update existing rating', () => {
  setup();
  const programId = 'test-program-4';
  
  setRating(programId, 3);
  assertEqual(getRating(programId), 3, 'Initial rating should be 3');
  
  setRating(programId, 5);
  assertEqual(getRating(programId), 5, 'Updated rating should be 5');
});

// Bulk Operations Tests
test('getAllRatings: should return all ratings', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  setRating('program-3', 4);
  
  const ratings = getAllRatings();
  
  assertEqual(Object.keys(ratings).length, 3, 'Should have 3 ratings');
  assertEqual(ratings['program-1'], 5, 'Should have correct rating for program-1');
  assertEqual(ratings['program-2'], 3, 'Should have correct rating for program-2');
  assertEqual(ratings['program-3'], 4, 'Should have correct rating for program-3');
});

test('clearAllRatings: should remove all ratings', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  
  clearAllRatings();
  
  const ratings = getAllRatings();
  assertEqual(Object.keys(ratings).length, 0, 'Should have no ratings after clear');
});

// Export/Import Tests
test('exportRatings: should export as valid JSON', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  
  const json = exportRatings();
  
  assertTrue(json.length > 0, 'Should export non-empty string');
  
  // Should be valid JSON
  const parsed = JSON.parse(json);
  assertTrue(parsed.version !== undefined, 'Should have version');
  assertTrue(parsed.ratings !== undefined, 'Should have ratings');
});

test('importRatings: should import valid JSON', () => {
  setup();
  
  const validJson = JSON.stringify({
    version: 1,
    ratings: {
      'program-1': 5,
      'program-2': 3
    },
    lastUpdated: new Date().toISOString()
  });
  
  const result = importRatings(validJson);
  
  assertTrue(result, 'Should import successfully');
  assertEqual(getRating('program-1'), 5, 'Should have imported rating');
  assertEqual(getRating('program-2'), 3, 'Should have imported rating');
});

test('importRatings: should reject invalid JSON structure', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    ratings: { 'program-1': 5 }
    // Missing version
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject invalid structure');
});

test('importRatings: should reject invalid rating values', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: {
      'program-1': 10 // Invalid rating
    }
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject invalid rating values');
});

test('importRatings: should reject array instead of object', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: [5, 3, 4] // Array instead of object
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject array ratings');
});

test('importRatings: export/import round-trip', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  setRating('program-3', 4);
  
  const exported = exportRatings();
  clearAllRatings();
  
  const imported = importRatings(exported);
  
  assertTrue(imported, 'Should import successfully');
  assertEqual(getRating('program-1'), 5, 'Should preserve rating 1');
  assertEqual(getRating('program-2'), 3, 'Should preserve rating 2');
  assertEqual(getRating('program-3'), 4, 'Should preserve rating 3');
});

// Statistics Tests
test('getRatingStats: should calculate correct statistics', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  setRating('program-3', 4);
  setRating('program-4', 5);
  
  const stats = getRatingStats();
  
  assertEqual(stats.total, 4, 'Should have 4 total ratings');
  assertEqual(stats.average, 4.25, 'Should calculate correct average');
  assertEqual(stats.distribution[5], 2, 'Should have 2 five-star ratings');
  assertEqual(stats.distribution[4], 1, 'Should have 1 four-star rating');
  assertEqual(stats.distribution[3], 1, 'Should have 1 three-star rating');
});

test('getRatingStats: should handle empty ratings', () => {
  setup();
  
  const stats = getRatingStats();
  
  assertEqual(stats.total, 0, 'Should have 0 total ratings');
  assertEqual(stats.average, 0, 'Should have 0 average');
});

// Edge Case Tests for Import
test('importRatings: should reject malformed JSON string', () => {
  setup();
  
  const result = importRatings('not valid json {{{');
  assertFalse(result, 'Should reject malformed JSON');
});

test('importRatings: should reject null input', () => {
  setup();
  
  const result = importRatings(null);
  assertFalse(result, 'Should reject null');
});

test('importRatings: should reject empty string', () => {
  setup();
  
  const result = importRatings('');
  assertFalse(result, 'Should reject empty string');
});

test('importRatings: should reject negative rating values', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: { 'program-1': -1 }
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject negative ratings');
});

test('importRatings: should reject decimal rating values', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: { 'program-1': 3.5 }
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject decimal ratings');
});

test('importRatings: should reject string rating values', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: { 'program-1': 'five' }
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject string ratings');
});

test('importRatings: should reject empty program keys', () => {
  setup();
  
  const invalidJson = JSON.stringify({
    version: 1,
    ratings: { '': 5 }
  });
  
  const result = importRatings(invalidJson);
  assertFalse(result, 'Should reject empty keys');
});

test('exportRatings: should produce valid JSON structure', () => {
  setup();
  
  setRating('test-program', 4);
  
  const json = exportRatings();
  const parsed = JSON.parse(json);
  
  assertEqual(typeof parsed.version, 'number', 'Should have numeric version');
  assertEqual(typeof parsed.ratings, 'object', 'Should have ratings object');
  assertEqual(typeof parsed.lastUpdated, 'string', 'Should have lastUpdated string');
  assertTrue(parsed.ratings['test-program'] === 4, 'Should have correct rating');
});

test('clearAllRatings: should remove all ratings', () => {
  setup();
  
  setRating('program-1', 5);
  setRating('program-2', 3);
  setRating('program-3', 4);
  
  const beforeClear = getAllRatings();
  assertEqual(Object.keys(beforeClear).length, 3, 'Should have 3 ratings before clear');
  
  clearAllRatings();
  
  const afterClear = getAllRatings();
  assertEqual(Object.keys(afterClear).length, 0, 'Should have 0 ratings after clear');
});

function assertFalse(value, message) {
  if (value) {
    throw new Error(message);
  }
}

// Run all tests
export async function runTests() {
  console.log('🧪 Running Ratings Tests...\n');
  
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
  window.runRatingsTests = runTests;
}
