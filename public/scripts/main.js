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
  hideResults,
  initViewToggle,
  initModal
} from './components/results.js';
import { fetchEpgData, parseEpgXml, analyzeEpgXml } from './utils/epgParser.js';
import { getEpgUrl, saveLastUpdated } from './utils/storage.js';
import { applyFilters, sortPrograms, applyRatingBoost } from './utils/search.js';
import { 
  initSearchIndex, 
  fuzzySearch, 
  isFuzzySearchAvailable,
  getFuzzySearchStatus 
} from './utils/fuzzySearch.js';

// Application state (expose globally for view toggle)
window.appState = {
  epgData: null,
  fuseIndex: null, // Fuzzy search index
  currentResults: [],
  searchQuery: '',
  searchScope: 'both',
  timeFilter: 'all',
  sortBy: 'time-asc',
  maxResults: 100, // Limit results to prevent browser freeze
  useFuzzySearch: true, // Toggle for fuzzy vs exact search
  fuzzyThreshold: 0.4, // Fuzzy matching sensitivity (0 = exact, 1 = match anything)
  searchDebounceMs: 300 // Debounce delay for search input (configurable)
};

const appState = window.appState;

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

  // Initialize view toggle
  initViewToggle();

  // Initialize modal
  initModal();

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
  const sortSelect = document.getElementById('sortSelect');
  const fuzzyToggle = document.getElementById('fuzzySearchToggle');
  const fuzzyThresholdSlider = document.getElementById('fuzzyThreshold');

  // Search input with debouncing
  let searchTimeout;
  searchInput?.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    toggleClearButton(e.target.value);
    
    // Debounce search (configurable delay after user stops typing)
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
        performSearch();
      }
    }, appState.searchDebounceMs);
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
      clearTimeout(searchTimeout);
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

  // Sort select
  sortSelect?.addEventListener('change', (e) => {
    appState.sortBy = e.target.value;
    performSearch();
  });

  // Fuzzy search toggle
  fuzzyToggle?.addEventListener('change', (e) => {
    appState.useFuzzySearch = e.target.checked;
    updateFuzzySearchUI();
    performSearch();
  });

  // Fuzzy threshold slider
  fuzzyThresholdSlider?.addEventListener('input', (e) => {
    appState.fuzzyThreshold = parseFloat(e.target.value);
    updateThresholdDisplay();
  });

  fuzzyThresholdSlider?.addEventListener('change', () => {
    performSearch();
  });

  // Load EPG button
  loadEpgButton?.addEventListener('click', loadEpgData);
  
  // Initialize fuzzy search UI
  updateFuzzySearchUI();
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
 * Update fuzzy search UI elements
 */
function updateFuzzySearchUI() {
  const fuzzyToggle = document.getElementById('fuzzySearchToggle');
  const fuzzySettings = document.getElementById('fuzzySearchSettings');
  const fuzzyStatus = document.getElementById('fuzzySearchStatus');
  
  // Check if fuzzy search is available
  const isAvailable = isFuzzySearchAvailable();
  
  if (fuzzyToggle) {
    fuzzyToggle.disabled = !isAvailable;
    if (!isAvailable) {
      fuzzyToggle.checked = false;
      appState.useFuzzySearch = false;
    }
  }
  
  if (fuzzySettings) {
    fuzzySettings.style.display = appState.useFuzzySearch && isAvailable ? 'block' : 'none';
  }
  
  if (fuzzyStatus) {
    fuzzyStatus.textContent = getFuzzySearchStatus();
    fuzzyStatus.className = isAvailable ? 'text-small text-success' : 'text-small text-warning';
  }
  
  updateThresholdDisplay();
}

/**
 * Update threshold display
 */
function updateThresholdDisplay() {
  const display = document.getElementById('fuzzyThresholdValue');
  if (display) {
    const threshold = appState.fuzzyThreshold;
    let label = 'Medium';
    if (threshold <= 0.2) label = 'Very Strict';
    else if (threshold <= 0.3) label = 'Strict';
    else if (threshold <= 0.5) label = 'Medium';
    else if (threshold <= 0.7) label = 'Loose';
    else label = 'Very Loose';
    
    display.textContent = `${label} (${threshold.toFixed(2)})`;
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
 * Show data loaded message
 * @param {number} totalPrograms - Total programs loaded
 * @param {number} totalChannels - Total channels loaded
 */
function showDataLoadedMessage(totalPrograms, totalChannels) {
  const noDataState = document.getElementById('noDataState');
  const resultsSection = document.getElementById('resultsSection');
  const errorState = document.getElementById('errorState');
  const loadingState = document.getElementById('loadingState');

  // Hide all states
  noDataState.style.display = 'none';
  resultsSection.style.display = 'none';
  errorState.style.display = 'none';
  loadingState.style.display = 'none';

  // Create or update info card
  let infoCard = document.getElementById('dataLoadedInfo');
  if (!infoCard) {
    infoCard = document.createElement('div');
    infoCard.id = 'dataLoadedInfo';
    infoCard.className = 'card';
    const container = document.querySelector('.container');
    const filterControls = document.querySelector('.filter-controls');
    filterControls.insertAdjacentElement('afterend', infoCard);
  }

  infoCard.innerHTML = `
    <div class="card-body" style="text-align: left;">
      <h3 class="card-title">EPG Data Loaded Successfully</h3>
      <p class="card-description mb-lg">
        Loaded <strong>${totalPrograms.toLocaleString()}</strong> programs from <strong>${totalChannels}</strong> channels.
      </p>
      <p class="card-description">
        Use the search box and filters above to find programs. Enter at least 2 characters or select a time filter.
      </p>
    </div>
  `;
  infoCard.style.display = 'block';
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

    // Analyze EPG structure
    console.log('Analyzing EPG XML structure...');
    const analysis = analyzeEpgXml(xmlString);
    console.log('EPG Analysis Results:', analysis);
    console.log('\n=== Available Program Fields ===');
    Object.entries(analysis.programFields).forEach(([field, info]) => {
      console.log(`${field}: ${info.count} occurrences`);
      console.log('  Examples:', info.examples);
    });
    console.log('\n=== Program Attributes ===');
    Object.entries(analysis.programAttributes).forEach(([attr, info]) => {
      console.log(`${attr}: ${info.count} occurrences`);
      console.log('  Examples:', info.examples);
    });
    console.log('\n=== Sample Programs ===');
    console.log(analysis.samplePrograms);

    // Store in app state
    appState.epgData = epgData;

    // Build fuzzy search index if available
    if (isFuzzySearchAvailable()) {
      console.log('Building fuzzy search index...');
      
      // Show progress message
      const loadingState = document.getElementById('loadingState');
      if (loadingState) {
        loadingState.innerHTML = '<div class="card-body"><p>Building search index...</p><p class="text-small text-light">Processing programs...</p></div>';
        loadingState.style.display = 'block';
      }
      
      try {
        appState.fuseIndex = await initSearchIndex(
          epgData.programs, 
          { threshold: appState.fuzzyThreshold },
          (current, total) => {
            // Update progress
            const percent = Math.round((current / total) * 100);
            if (loadingState) {
              loadingState.innerHTML = `<div class="card-body"><p>Building search index...</p><p class="text-small text-light">${percent}% complete (${current.toLocaleString()} / ${total.toLocaleString()} programs)</p></div>`;
            }
          }
        );
        console.log('Fuzzy search index ready');
      } catch (error) {
        console.error('Failed to build search index:', error);
        appState.fuseIndex = null;
      }
    } else {
      console.warn('Fuzzy search not available, using exact match only');
      appState.fuseIndex = null;
    }

    // Save last updated timestamp
    saveLastUpdated(Date.now());

    // Hide loading and show success
    hideLoading();

    // Show info message instead of all results
    showDataLoadedMessage(epgData.totalPrograms, epgData.totalChannels);
    
    // Update fuzzy search UI
    updateFuzzySearchUI();

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

  // Validate search query
  const query = appState.searchQuery.trim();

  // Require minimum 2 characters for text search
  if (query.length > 0 && query.length < 2) {
    showError('Please enter at least 2 characters to search');
    return;
  }

  // If no search query and time filter is 'all', show message
  if (query.length === 0 && appState.timeFilter === 'all') {
    showError('Please enter a search term or select a time filter to narrow down results');
    return;
  }

  console.log('Performing search with:', {
    query: appState.searchQuery,
    scope: appState.searchScope,
    timeFilter: appState.timeFilter,
    sortBy: appState.sortBy,
    useFuzzySearch: appState.useFuzzySearch,
    fuzzyThreshold: appState.fuzzyThreshold
  });

  hideError();
  hideNoData();

  let filtered;

  // Use fuzzy search if enabled and available
  if (appState.useFuzzySearch && appState.fuseIndex && query.length >= 2) {
    console.log('Using fuzzy search');
    
    // Check if index is ready (not null)
    if (!appState.fuseIndex) {
      console.warn('Fuzzy search index not ready, falling back to exact search');
      filtered = applyFilters(appState.epgData.programs, {
        searchQuery: appState.searchQuery,
        searchScope: appState.searchScope,
        timeFilter: appState.timeFilter
      });
    } else {
      // Perform fuzzy search
      const fuzzyResults = fuzzySearch(appState.fuseIndex, query, {
        scope: appState.searchScope,
        threshold: appState.fuzzyThreshold
      });
      
      // Apply time filter to fuzzy results
      filtered = applyFilters(fuzzyResults, {
        searchQuery: '', // Already searched
        searchScope: appState.searchScope,
        timeFilter: appState.timeFilter
      });
      
      console.log(`Fuzzy search found ${fuzzyResults.length} matches, ${filtered.length} after time filter`);
    }
  } else {
    console.log('Using exact search');
    
    // Use exact match search
    filtered = applyFilters(appState.epgData.programs, {
      searchQuery: appState.searchQuery,
      searchScope: appState.searchScope,
      timeFilter: appState.timeFilter
    });
  }

  // Apply rating boost
  const boosted = applyRatingBoost(filtered);

  // Sort by selected criteria (if not using fuzzy scores)
  let sorted;
  if (appState.useFuzzySearch && appState.fuseIndex && query.length >= 2) {
    // Fuzzy results are already sorted by relevance + rating boost
    sorted = boosted;
  } else {
    sorted = sortPrograms(boosted, appState.sortBy);
  }

  // Limit results to prevent browser freeze
  const limited = sorted.slice(0, appState.maxResults);
  const hasMore = sorted.length > appState.maxResults;

  // Store current results
  appState.currentResults = limited;

  // Display results
  displayResults(limited, hasMore, sorted.length);

  console.log(`Found ${sorted.length} results, displaying ${limited.length}`);
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
