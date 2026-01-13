/**
 * main.js - Application Bootstrap
 * Main entry point for the IPTV EPG Search application
 */

import { initSettings, hasConfiguredUrl, showSettings } from './components/settings.js';
import {
  displayResults,
  showLoading,
  hideLoading,
  showError,
  hideError,
  showNoData,
  hideNoData,
  hideResults
} from './components/results.js';
import { fetchEpgData, parseEpgXml } from './utils/epgParser.js';
import { getEpgUrl, saveLastUpdated } from './utils/storage.js';
import { applyFilters, sortPrograms } from './utils/search.js';

// Application state
const appState = {
  epgData: null,
  currentResults: [],
  searchQuery: '',
  searchScope: 'both',
  timeFilter: 'all'
};

/**
 * Initialize the application
 */
function init() {
  console.log('Initializing IPTV EPG Search application...');

  // Initialize settings component
  initSettings({
    onSave: handleSettingsSaved
  });

  // Initialize search and filter controls
  initControls();

  // Check if EPG URL is configured
  if (!hasConfiguredUrl()) {
    showNoData();
  } else {
    // Optionally auto-load EPG data on startup
    // loadEpgData();
    showNoData();
  }
}

/**
 * Initialize search and filter controls
 */
function initControls() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchButton = document.getElementById('clearSearch');
  const searchButton = document.getElementById('searchButton');
  const loadEpgButton = document.getElementById('loadEpgButton');
  const searchScopeRadios = document.querySelectorAll('input[name="searchScope"]');
  const timeFilterRadios = document.querySelectorAll('input[name="timeFilter"]');

  // Search input
  searchInput?.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    toggleClearButton(e.target.value);
  });

  // Clear search button
  clearSearchButton?.addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    toggleClearButton('');
    performSearch();
  });

  // Search button
  searchButton?.addEventListener('click', performSearch);

  // Enter key on search input
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  // Search scope radios
  searchScopeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      appState.searchScope = e.target.value;
      performSearch();
    });
  });

  // Time filter radios
  timeFilterRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      appState.timeFilter = e.target.value;
      performSearch();
    });
  });

  // Load EPG button
  loadEpgButton?.addEventListener('click', loadEpgData);
}

/**
 * Toggle clear search button visibility
 * @param {string} value - Current search value
 */
function toggleClearButton(value) {
  const clearSearchButton = document.getElementById('clearSearch');
  if (clearSearchButton) {
    clearSearchButton.style.display = value.trim().length > 0 ? 'block' : 'none';
  }
}

/**
 * Handle settings saved event
 */
function handleSettingsSaved() {
  console.log('Settings saved, EPG URL updated');
  // Optionally auto-load after saving settings
  // loadEpgData();
}

/**
 * Load EPG data from configured URL
 */
async function loadEpgData() {
  const url = getEpgUrl();

  if (!url) {
    showError('Please configure EPG URL in settings first');
    showSettings();
    return;
  }

  console.log('Loading EPG data from:', url);

  showLoading();
  hideError();
  hideNoData();
  hideResults();

  try {
    // Fetch and decompress
    const xmlString = await fetchEpgData(url);
    console.log('EPG data fetched and decompressed');

    // Parse XML
    const epgData = parseEpgXml(xmlString);
    console.log('EPG data parsed:', {
      channels: epgData.totalChannels,
      programs: epgData.totalPrograms
    });

    // Store in app state
    appState.epgData = epgData;

    // Save last updated timestamp
    saveLastUpdated(Date.now());

    // Hide loading and show success
    hideLoading();

    // Show initial results (all programs)
    performSearch();

    console.log('EPG data loaded successfully');
  } catch (error) {
    console.error('Failed to load EPG data:', error);
    hideLoading();
    showError(error.message || 'Failed to load EPG data. Please check your URL and try again.');
  }
}

/**
 * Perform search with current filters
 */
function performSearch() {
  if (!appState.epgData) {
    console.log('No EPG data loaded');
    showNoData();
    return;
  }

  console.log('Performing search with:', {
    query: appState.searchQuery,
    scope: appState.searchScope,
    timeFilter: appState.timeFilter
  });

  hideError();
  hideNoData();

  // Apply filters
  const filtered = applyFilters(appState.epgData.programs, {
    searchQuery: appState.searchQuery,
    searchScope: appState.searchScope,
    timeFilter: appState.timeFilter
  });

  // Sort by start time (ascending)
  const sorted = sortPrograms(filtered, 'asc');

  // Store current results
  appState.currentResults = sorted;

  // Display results
  displayResults(sorted);

  console.log(`Found ${sorted.length} results`);
}

/**
 * Handle errors globally
 */
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

/**
 * Handle unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
