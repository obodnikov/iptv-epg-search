/**
 * results.js - Results Display Component
 * Handles displaying search results in the UI
 */

import { formatTimeRange, getProgramStatus } from '../utils/epgParser.js';

/**
 * Display search results
 * @param {Array} programs - Array of program objects to display
 */
export function displayResults(programs) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsContainer = document.getElementById('resultsContainer');
  const resultsCount = document.getElementById('resultsCount');
  const noResultsState = document.getElementById('noResultsState');

  if (!programs || programs.length === 0) {
    showNoResults();
    return;
  }

  // Clear previous results
  resultsContainer.innerHTML = '';

  // Update count
  resultsCount.textContent = `${programs.length} result${programs.length !== 1 ? 's' : ''}`;

  // Display results
  resultsSection.style.display = 'block';
  noResultsState.style.display = 'none';

  // Create cards for each program
  programs.forEach(program => {
    const card = createProgramCard(program);
    resultsContainer.appendChild(card);
  });
}

/**
 * Show no results state
 */
export function showNoResults() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsContainer = document.getElementById('resultsContainer');
  const noResultsState = document.getElementById('noResultsState');

  resultsSection.style.display = 'block';
  resultsContainer.innerHTML = '';
  noResultsState.style.display = 'block';
}

/**
 * Hide results section
 */
export function hideResults() {
  const resultsSection = document.getElementById('resultsSection');
  resultsSection.style.display = 'none';
}

/**
 * Create a program card element
 * @param {Object} program - Program object
 * @returns {HTMLElement} - Card element
 */
function createProgramCard(program) {
  const card = document.createElement('div');
  card.className = 'card result-card';

  const status = getProgramStatus(program.start, program.stop);

  card.innerHTML = `
    <div class="result-card-channel">${escapeHtml(program.channelName)}</div>
    <h3 class="result-card-title">${escapeHtml(program.title)}</h3>
    <div class="result-card-time">
      <span class="result-card-badge badge-${status}">${capitalize(status)}</span>
      <span>${formatTimeRange(program.start, program.stop)}</span>
    </div>
    ${program.description ? `<p class="result-card-description">${escapeHtml(program.description)}</p>` : ''}
  `;

  return card;
}

/**
 * Show loading state
 */
export function showLoading() {
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const noDataState = document.getElementById('noDataState');
  const resultsSection = document.getElementById('resultsSection');

  loadingState.style.display = 'block';
  errorState.style.display = 'none';
  noDataState.style.display = 'none';
  resultsSection.style.display = 'none';
}

/**
 * Hide loading state
 */
export function hideLoading() {
  const loadingState = document.getElementById('loadingState');
  loadingState.style.display = 'none';
}

/**
 * Show error state
 * @param {string} message - Error message
 */
export function showError(message) {
  const errorState = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const loadingState = document.getElementById('loadingState');
  const noDataState = document.getElementById('noDataState');
  const resultsSection = document.getElementById('resultsSection');

  errorMessage.textContent = message;
  errorState.style.display = 'block';
  loadingState.style.display = 'none';
  noDataState.style.display = 'none';
  resultsSection.style.display = 'none';
}

/**
 * Hide error state
 */
export function hideError() {
  const errorState = document.getElementById('errorState');
  errorState.style.display = 'none';
}

/**
 * Show no data state
 */
export function showNoData() {
  const noDataState = document.getElementById('noDataState');
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const resultsSection = document.getElementById('resultsSection');

  noDataState.style.display = 'block';
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  resultsSection.style.display = 'none';
}

/**
 * Hide no data state
 */
export function hideNoData() {
  const noDataState = document.getElementById('noDataState');
  noDataState.style.display = 'none';
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Capitalize first letter
 * @param {string} text - Text to capitalize
 * @returns {string} - Capitalized text
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
