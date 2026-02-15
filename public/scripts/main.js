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
import { getEpgUrl, saveLastUpdated, getShowUniqueOnly, saveShowUniqueOnly, getPreferHD, savePreferHD } from './utils/storage.js';
import { applyFilters, sortPrograms, applyRatingBoost, filterByChannels, filterUniqueByClosestTime, filterPreferHD } from './utils/search.js';
import {
  initSearchIndex,
  fuzzySearch,
  isFuzzySearchAvailable,
  getFuzzySearchStatus
} from './utils/fuzzySearch.js';
import {
  initChannelFilter,
  updateChannels,
  getSelectedChannelIds,
  updateChannelsInResults
} from './components/channelFilter.js';
import {
  initExplore,
  showExplore,
  hideExplore,
  refreshExplore,
  isExploreVisible
} from './components/explore.js';
import { addRecentSearch } from './utils/recentSearches.js';

// Expose performSearch globally for settings component
window.performSearch = null; // Will be set after function definition

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
  searchDebounceMs: 300, // Debounce delay for search input (configurable)
  manualSearchOnly: true, // Manual search only mode (default: true)
  selectedChannels: null, // Selected channel IDs for filtering (null = all channels)
  showUniqueOnly: getShowUniqueOnly(), // Show only unique programs by title+channel (closest to current time)
  preferHD: getPreferHD() // Prefer HD channels over SD/regular (deduplicates by title+time, keeps highest quality)
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

  // Initialize channel filter
  initChannelFilter({
    onSelectionChange: handleChannelSelectionChange
  });

  // Initialize explore view
  initExplore({
    onKeywordClick: handleKeywordClick,
    onRecentSearchClick: handleRecentSearchClick
  });

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

    // Update Best Match option availability as user types
    updateBestMatchOption();

    // Only trigger auto-search if manual search mode is disabled
    if (!appState.manualSearchOnly) {
      // Debounce search (configurable delay after user stops typing)
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        if (appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
          performSearch();
        }
      }, appState.searchDebounceMs);
    }
  });

  // Clear search button
  clearSearchButton?.addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    toggleClearButton('');
    updateBestMatchOption();
    // Return to Explore view if EPG data is loaded
    if (appState.epgData) {
      hideResults();
      hideError();
      showExplore();
      toggleBackToExplore(false);
    } else if (!appState.manualSearchOnly) {
      performSearch();
    }
  });

  // Back to Explore button
  const backToExploreButton = document.getElementById('backToExploreButton');
  backToExploreButton?.addEventListener('click', () => {
    searchInput.value = '';
    appState.searchQuery = '';
    toggleClearButton('');
    updateBestMatchOption();
    hideResults();
    hideError();
    showExplore();
    toggleBackToExplore(false);
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
      // In manual mode, user must click Search button or press Enter
      // In auto mode, trigger search immediately
      if (!appState.manualSearchOnly) {
        performSearch();
      }
    });
  });

  // Time filter radios
  timeFilterRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      appState.timeFilter = e.target.value;
      // In manual mode, user must click Search button or press Enter
      // In auto mode, trigger search immediately
      if (!appState.manualSearchOnly) {
        performSearch();
      }
    });
  });

  // Sort select
  sortSelect?.addEventListener('change', (e) => {
    appState.sortBy = e.target.value;
    performSearch();
  });

  // Show unique only checkbox
  const showUniqueCheckbox = document.getElementById('showUniqueCheckbox');
  if (showUniqueCheckbox) {
    // Initialize checkbox state from appState (loaded from localStorage)
    showUniqueCheckbox.checked = appState.showUniqueOnly;

    // Handle checkbox change
    showUniqueCheckbox.addEventListener('change', (e) => {
      appState.showUniqueOnly = e.target.checked;
      saveShowUniqueOnly(e.target.checked);
      // Refresh Explore if visible, otherwise re-run search
      if (isExploreVisible()) {
        refreshExplore();
      } else if (appState.currentResults.length > 0 || appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
        performSearch();
      }
    });
  }

  // Prefer HD checkbox
  const preferHDCheckbox = document.getElementById('preferHDCheckbox');
  if (preferHDCheckbox) {
    // Initialize checkbox state from appState (loaded from localStorage)
    preferHDCheckbox.checked = appState.preferHD;

    // Handle checkbox change
    preferHDCheckbox.addEventListener('change', (e) => {
      appState.preferHD = e.target.checked;
      savePreferHD(e.target.checked);
      // Refresh Explore if visible, otherwise re-run search
      if (isExploreVisible()) {
        refreshExplore();
      } else if (appState.currentResults.length > 0 || appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
        performSearch();
      }
    });
  }

  // Initialize Best Match option state
  updateBestMatchOption();

  // Fuzzy search toggle - only update UI, don't trigger search
  // Actual appState update happens on Save in settings
  fuzzyToggle?.addEventListener('change', (e) => {
    updateFuzzySearchUI();
  });

  // Fuzzy threshold slider - only update display, don't trigger search
  // Actual appState update happens on Save in settings
  fuzzyThresholdSlider?.addEventListener('input', (e) => {
    updateThresholdDisplay();
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
 * Toggle Back to Explore button visibility
 * @param {boolean} visible - Whether to show the button
 */
function toggleBackToExplore(visible) {
  const btn = document.getElementById('backToExploreButton');
  if (btn) {
    btn.style.display = visible ? 'inline-flex' : 'none';
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
    }
  }

  // Use checkbox value for UI display (shows/hides threshold slider)
  const isChecked = fuzzyToggle?.checked ?? false;

  if (fuzzySettings) {
    fuzzySettings.style.display = isChecked && isAvailable ? 'block' : 'none';
  }

  if (fuzzyStatus) {
    fuzzyStatus.textContent = getFuzzySearchStatus();
    fuzzyStatus.className = isAvailable ? 'text-small text-success' : 'text-small text-warning';
  }

  updateThresholdDisplay();
}

/**
 * Update threshold display
 * Reads value from slider element for UI preview
 */
function updateThresholdDisplay() {
  const display = document.getElementById('fuzzyThresholdValue');
  const slider = document.getElementById('fuzzyThreshold');
  if (display && slider) {
    const threshold = parseFloat(slider.value);
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
 * Update Best Match sort option availability
 * Enables when: fuzzy search is enabled AND there's a search query (2+ chars)
 * Auto-selects Best Match when it becomes available
 */
function updateBestMatchOption() {
  const sortSelect = document.getElementById('sortSelect');
  const bestMatchOption = sortSelect?.querySelector('option[value="best-match"]');

  if (!bestMatchOption) return;

  const query = appState.searchQuery?.trim() || '';
  const canUseBestMatch = appState.useFuzzySearch &&
                          appState.fuseIndex &&
                          query.length >= 2;

  const wasDisabled = bestMatchOption.disabled;
  bestMatchOption.disabled = !canUseBestMatch;

  // Auto-select Best Match when it becomes available
  if (canUseBestMatch && wasDisabled) {
    appState.sortBy = 'best-match';
    if (sortSelect) {
      sortSelect.value = 'best-match';
    }
  }

  // If Best Match is currently selected but becomes unavailable, switch to time-asc
  if (!canUseBestMatch && appState.sortBy === 'best-match') {
    appState.sortBy = 'time-asc';
    if (sortSelect) {
      sortSelect.value = 'time-asc';
    }
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
 * Handle channel selection change
 * @param {Array} selectedChannelIds - Array of selected channel IDs
 */
function handleChannelSelectionChange(selectedChannelIds) {
  console.log('Channel selection changed:', selectedChannelIds.length, 'channels selected');
  appState.selectedChannels = new Set(selectedChannelIds);

  // Refresh Explore if visible, otherwise re-run search
  if (isExploreVisible()) {
    refreshExplore();
  } else if (appState.currentResults.length > 0 || appState.searchQuery.length >= 2 || appState.timeFilter !== 'all') {
    performSearch();
  }
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

  // Remove old info card if it exists
  const oldInfoCard = document.getElementById('dataLoadedInfo');
  if (oldInfoCard) oldInfoCard.remove();

  // Show shared filter bar
  const sharedFilterBar = document.getElementById('sharedFilterBar');
  if (sharedFilterBar) sharedFilterBar.style.display = 'flex';

  // Show Explore view
  showExplore();

  console.log(`EPG loaded: ${totalPrograms.toLocaleString()} programs, ${totalChannels} channels`);
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
  hideExplore();

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

    // Update channel filter with available channels
    updateChannels(epgData.channels);

    // Get initial selected channels
    const selectedIds = getSelectedChannelIds();
    if (selectedIds.length > 0) {
      appState.selectedChannels = new Set(selectedIds);
    }

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

    // Update Best Match option availability (now that index is ready)
    updateBestMatchOption();

    console.log('EPG data loaded successfully');
  } catch (error) {
    console.error('Failed to load EPG data:', error);
    hideLoading();
    showError(error.message || 'Failed to load EPG data. Please check your URL and try again.');
  }
}

/**
 * Show search in progress indicator
 */
function showSearching() {
  const searchButton = document.getElementById('searchButton');
  const sortSelect = document.getElementById('sortSelect');

  if (searchButton) {
    searchButton.classList.add('btn-loading');
    searchButton.disabled = true;
  }

  if (sortSelect) {
    sortSelect.disabled = true;
  }
}

/**
 * Hide search in progress indicator
 */
function hideSearching() {
  const searchButton = document.getElementById('searchButton');
  const sortSelect = document.getElementById('sortSelect');

  if (searchButton) {
    searchButton.classList.remove('btn-loading');
    searchButton.disabled = false;
  }

  if (sortSelect) {
    sortSelect.disabled = false;
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

  // Update Best Match option availability
  updateBestMatchOption();

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

  // Hide Explore view when searching
  hideExplore();

  // Show searching indicator
  showSearching();

  console.log('Performing search with:', {
    query: appState.searchQuery,
    scope: appState.searchScope,
    timeFilter: appState.timeFilter,
    sortBy: appState.sortBy,
    useFuzzySearch: appState.useFuzzySearch,
    fuzzyThreshold: appState.fuzzyThreshold,
    selectedChannels: appState.selectedChannels ? appState.selectedChannels.size : 'all'
  });

  hideError();
  hideNoData();

  // Use setTimeout to allow UI to update before heavy search operation
  setTimeout(() => {
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
          timeFilter: appState.timeFilter,
          selectedChannels: appState.selectedChannels
        });
      } else {
        // Perform fuzzy search
        const fuzzyResults = fuzzySearch(appState.fuseIndex, query, {
          scope: appState.searchScope,
          threshold: appState.fuzzyThreshold
        });

        // Apply time filter and channel filter to fuzzy results
        filtered = applyFilters(fuzzyResults, {
          searchQuery: '', // Already searched
          searchScope: appState.searchScope,
          timeFilter: appState.timeFilter,
          selectedChannels: appState.selectedChannels
        });

        console.log(`Fuzzy search found ${fuzzyResults.length} matches, ${filtered.length} after time filter`);
      }
    } else {
      console.log('Using exact search');

      // Use exact match search
      filtered = applyFilters(appState.epgData.programs, {
        searchQuery: appState.searchQuery,
        searchScope: appState.searchScope,
        timeFilter: appState.timeFilter,
        selectedChannels: appState.selectedChannels
      });
    }

    // Apply unique filter if enabled (filter duplicates by title+channel, keep closest to current time)
    if (appState.showUniqueOnly) {
      filtered = filterUniqueByClosestTime(filtered);
      console.log(`After unique filter: ${filtered.length} unique programs`);
    }

    // Apply prefer HD filter if enabled (filter duplicates by title+time, keep highest quality)
    if (appState.preferHD) {
      filtered = filterPreferHD(filtered);
      console.log(`After prefer HD filter: ${filtered.length} programs (HD preferred)`);
    }

    // Apply rating boost (for fuzzy results with scores)
    const boosted = applyRatingBoost(filtered);

    // Sort by selected criteria
    let sorted;
    const isFuzzyActive = appState.useFuzzySearch && appState.fuseIndex && query.length >= 2;

    if (appState.sortBy === 'best-match' && isFuzzyActive) {
      // Best Match: use fuzzy scores + rating boost (already applied)
      sorted = boosted;
    } else if (appState.sortBy === 'best-match' && !isFuzzyActive) {
      // Fallback if Best Match selected but fuzzy not active
      sorted = sortPrograms(boosted, 'time-asc');
    } else {
      // Other sort options: apply standard sorting
      sorted = sortPrograms(boosted, appState.sortBy);
    }

    // Limit results to prevent browser freeze
    const limited = sorted.slice(0, appState.maxResults);
    const hasMore = sorted.length > appState.maxResults;

    // Store current results
    appState.currentResults = limited;

    // Update channel filter with channels present in results
    updateChannelsInResults(sorted);

    // Display results
    displayResults(limited, hasMore, sorted.length);
    toggleBackToExplore(true);

    // Save to recent searches
    if (query.length >= 2) {
      addRecentSearch(query);
    }

    console.log(`Found ${sorted.length} results, displaying ${limited.length}`);

    // Hide searching indicator
    hideSearching();
  }, 0);
}

// Expose performSearch globally for settings component
window.performSearch = performSearch;

/**
 * Handle keyword chip click from Explore view
 * @param {string} keyword - Keyword to search
 */
function handleKeywordClick(keyword) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = keyword;
  appState.searchQuery = keyword;
  toggleClearButton(keyword);
  performSearch();
}

/**
 * Handle recent search chip click from Explore view
 * @param {string} query - Search query to re-run
 */
function handleRecentSearchClick(query) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = query;
  appState.searchQuery = query;
  toggleClearButton(query);
  performSearch();
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
