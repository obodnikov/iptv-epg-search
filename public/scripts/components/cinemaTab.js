/**
 * cinemaTab.js - Cinema Tab Component
 * Manages cinema M3U catalog: loading, searching, filtering, and displaying results
 */

import { fetchM3uData, parseM3u, filterCinemaItems, sortCinemaItems } from '../utils/m3uParser.js';
import { getCinemaUrl, saveCinemaLastUpdated } from '../utils/storage.js';

// Cinema state (module-scoped)
const cinemaState = {
  data: null,         // Parsed M3U data { items, categories, genres, stats }
  filteredResults: [],
  query: '',
  category: 'all',
  minRating: 0,
  minYear: null,
  maxYear: null,
  sortBy: 'added-desc',
  maxResults: 100,
  isLoading: false,   // Guard against concurrent loads
  loadAbortController: null // AbortController for current load request
};

/**
 * Initialize cinema tab component
 */
export function initCinemaTab() {
  initCinemaControls();
}

/**
 * Initialize cinema search and filter controls
 */
function initCinemaControls() {
  const searchInput = document.getElementById('cinemaSearchInput');
  const clearBtn = document.getElementById('cinemaClearSearch');
  const searchBtn = document.getElementById('cinemaSearchButton');
  const loadBtn = document.getElementById('loadCinemaButton');
  const categorySelect = document.getElementById('cinemaCategorySelect');
  const ratingSlider = document.getElementById('cinemaRatingFilter');
  const yearMinSelect = document.getElementById('cinemaYearMin');
  const yearMaxSelect = document.getElementById('cinemaYearMax');
  const sortSelect = document.getElementById('cinemaSortSelect');

  // Search input
  searchInput?.addEventListener('input', (e) => {
    cinemaState.query = e.target.value;
    toggleCinemaClearButton(e.target.value);
  });

  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performCinemaSearch();
    }
  });

  // Clear search
  clearBtn?.addEventListener('click', () => {
    if (searchInput) searchInput.value = '';
    cinemaState.query = '';
    toggleCinemaClearButton('');
    performCinemaSearch();
  });

  // Search button
  searchBtn?.addEventListener('click', performCinemaSearch);

  // Load cinema button
  loadBtn?.addEventListener('click', loadCinemaData);

  // Category filter
  categorySelect?.addEventListener('change', (e) => {
    cinemaState.category = e.target.value;
    performCinemaSearch();
  });

  // Rating filter
  ratingSlider?.addEventListener('input', (e) => {
    cinemaState.minRating = parseFloat(e.target.value);
    updateRatingDisplay();
  });
  ratingSlider?.addEventListener('change', () => {
    performCinemaSearch();
  });

  // Year filters
  yearMinSelect?.addEventListener('change', (e) => {
    cinemaState.minYear = e.target.value ? parseInt(e.target.value, 10) : null;
    performCinemaSearch();
  });
  yearMaxSelect?.addEventListener('change', (e) => {
    cinemaState.maxYear = e.target.value ? parseInt(e.target.value, 10) : null;
    performCinemaSearch();
  });

  // Sort
  sortSelect?.addEventListener('change', (e) => {
    cinemaState.sortBy = e.target.value;
    performCinemaSearch();
  });

  // Populate year dropdowns
  populateYearDropdowns();
}

/**
 * Toggle cinema clear search button visibility
 * @param {string} value - Current input value
 */
function toggleCinemaClearButton(value) {
  const clearBtn = document.getElementById('cinemaClearSearch');
  if (clearBtn) {
    clearBtn.style.display = value.trim().length > 0 ? 'block' : 'none';
  }
}

/**
 * Update rating display value
 */
function updateRatingDisplay() {
  const display = document.getElementById('cinemaRatingValue');
  if (display) {
    const val = cinemaState.minRating;
    display.textContent = val > 0 ? `${val}+` : 'Any';
  }
}

/**
 * Populate year dropdown options
 */
function populateYearDropdowns() {
  const currentYear = new Date().getFullYear();
  const startYear = 1990;
  const yearMinSelect = document.getElementById('cinemaYearMin');
  const yearMaxSelect = document.getElementById('cinemaYearMax');

  if (!yearMinSelect || !yearMaxSelect) return;

  // Build options
  let options = '<option value="">Any</option>';
  for (let y = currentYear; y >= startYear; y--) {
    options += `<option value="${y}">${y}</option>`;
  }

  yearMinSelect.innerHTML = options;
  yearMaxSelect.innerHTML = options;
}

/**
 * Load cinema M3U data
 */
async function loadCinemaData() {
  const url = getCinemaUrl();

  if (!url) {
    showCinemaError('Please configure Cinema M3U URL in settings first');
    return;
  }

  // Cancel-and-replace: abort any previous in-flight request
  if (cinemaState.loadAbortController) {
    cinemaState.loadAbortController.abort();
  }

  const controller = new AbortController();
  cinemaState.isLoading = true;
  cinemaState.loadAbortController = controller;
  const { signal } = controller;

  // Disable load button
  const loadBtn = document.getElementById('loadCinemaButton');
  if (loadBtn) loadBtn.disabled = true;

  console.log('Loading cinema data from:', url);

  showCinemaLoading();
  hideCinemaError();

  try {
    const m3uText = await fetchM3uData(url, signal);

    // Check if aborted during fetch
    if (signal.aborted) return;

    console.log('Cinema M3U data fetched, parsing...');

    const data = await parseM3u(m3uText, (current, total) => {
      if (signal.aborted) return;
      const percent = Math.round((current / total) * 100);
      updateCinemaLoadingProgress(percent);
    });

    // Check if aborted during parsing
    if (signal.aborted) return;

    console.log('Cinema data parsed:', data.stats);

    // Store in state
    cinemaState.data = data;

    // Save timestamp
    saveCinemaLastUpdated(Date.now());

    // Populate category dropdown
    populateCategoryDropdown(data.categories);

    // Hide loading, show success
    hideCinemaLoading();
    showCinemaDataLoaded(data.stats);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Cinema load aborted');
      return;
    }
    console.error('Failed to load cinema data:', error);
    // Clear stale data on failure to prevent misleading search results
    cinemaState.data = null;
    cinemaState.filteredResults = [];
    hideCinemaLoading();
    showCinemaError(error.message || 'Failed to load cinema data. Check URL and try again.');
  } finally {
    // Only clean up if this is still the active request
    if (cinemaState.loadAbortController === controller) {
      cinemaState.isLoading = false;
      cinemaState.loadAbortController = null;
      if (loadBtn) loadBtn.disabled = false;
    }
  }
}

/**
 * Populate category dropdown with available categories
 * @param {Array} categories - Available category names
 */
function populateCategoryDropdown(categories) {
  const select = document.getElementById('cinemaCategorySelect');
  if (!select) return;

  // Clear existing options
  select.innerHTML = '';

  // Add "All" option
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All Categories';
  select.appendChild(allOption);

  // Add category options safely
  categories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });
}

/**
 * Perform cinema search with current filters
 */
function performCinemaSearch() {
  if (!cinemaState.data) {
    return;
  }

  const filtered = filterCinemaItems(cinemaState.data.items, {
    query: cinemaState.query,
    category: cinemaState.category,
    minRating: cinemaState.minRating,
    minYear: cinemaState.minYear,
    maxYear: cinemaState.maxYear
  });

  const sorted = sortCinemaItems(filtered, cinemaState.sortBy);

  // Limit results
  const limited = sorted.slice(0, cinemaState.maxResults);
  const hasMore = sorted.length > cinemaState.maxResults;

  cinemaState.filteredResults = limited;

  // Display
  displayCinemaResults(limited, hasMore, sorted.length);
}

/**
 * Display cinema results
 * @param {Array} items - Items to display
 * @param {boolean} hasMore - Whether there are more results
 * @param {number} totalResults - Total matching results
 */
function displayCinemaResults(items, hasMore, totalResults) {
  const resultsSection = document.getElementById('cinemaResultsSection');
  const resultsContainer = document.getElementById('cinemaResultsContainer');
  const resultsCount = document.getElementById('cinemaResultsCount');
  const noResults = document.getElementById('cinemaNoResults');
  const dataLoaded = document.getElementById('cinemaDataLoaded');

  // Hide data loaded message
  if (dataLoaded) dataLoaded.style.display = 'none';

  if (!items || items.length === 0) {
    if (resultsSection) resultsSection.style.display = 'block';
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (noResults) noResults.style.display = 'block';
    if (resultsCount) resultsCount.textContent = '0 results';
    return;
  }

  if (noResults) noResults.style.display = 'none';
  if (resultsSection) resultsSection.style.display = 'block';

  // Update count
  if (resultsCount) {
    const moreText = hasMore ? ` (showing ${items.length} of ${totalResults.toLocaleString()})` : '';
    resultsCount.textContent = `${totalResults.toLocaleString()} results${moreText}`;
  }

  // Render cards
  if (resultsContainer) {
    resultsContainer.innerHTML = items.map(item => renderCinemaCard(item)).join('');

    // Attach click and keyboard handlers
    resultsContainer.querySelectorAll('.cinema-card').forEach((card, index) => {
      card.addEventListener('click', () => {
        showCinemaModal(items[index]);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showCinemaModal(items[index]);
        }
      });
    });
  }
}

/**
 * Render a single cinema card
 * @param {Object} item - Cinema item
 * @returns {string} - HTML string (all values escaped)
 */
function renderCinemaCard(item) {
  const escapedTitle = escapeHtml(item.title);
  const ratingBadge = item.rating
    ? `<span class="cinema-card-rating">★ ${escapeHtml(item.rating.toFixed(1))}</span>`
    : '';

  const yearText = item.year ? escapeHtml(String(item.year)) : '';
  const categoryTag = item.category
    ? `<span class="cinema-card-category">${escapeHtml(item.category)}</span>`
    : '';

  // Validate poster URL (only allow http/https)
  const posterUrl = sanitizeUrl(item.poster);
  const posterHtml = posterUrl
    ? `<div class="cinema-card-poster">
        <img src="${escapeAttr(posterUrl)}" alt="${escapeAttr(item.title)}" loading="lazy" onerror="this.parentElement.classList.add('poster-error')">
       </div>`
    : `<div class="cinema-card-poster poster-placeholder">
        <span class="poster-placeholder-icon">🎬</span>
       </div>`;

  return `
    <div class="cinema-card card card-interactive" tabindex="0" role="button" aria-label="${escapeAttr(item.title)}">
      ${posterHtml}
      <div class="cinema-card-body">
        <h3 class="cinema-card-title">${escapedTitle}</h3>
        <div class="cinema-card-meta">
          ${ratingBadge}
          ${yearText ? `<span class="cinema-card-year">${yearText}</span>` : ''}
        </div>
        ${categoryTag}
      </div>
    </div>
  `;
}

/**
 * Show cinema item details in modal
 * @param {Object} item - Cinema item
 */
function showCinemaModal(item) {
  const modal = document.getElementById('programModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');

  if (!modal || !modalTitle || !modalBody) return;

  modalTitle.textContent = item.title;

  const genresList = Array.isArray(item.genres) ? item.genres : [];
  const genres = genresList.length > 0
    ? `<p><strong>Genres:</strong> ${escapeHtml(genresList.join(', '))}</p>`
    : '';

  const rating = item.rating
    ? `<p><strong>Rating:</strong> ★ ${escapeHtml(item.rating.toFixed(1))}</p>`
    : '';

  const year = item.year
    ? `<p><strong>Year:</strong> ${escapeHtml(String(item.year))}</p>`
    : '';

  const country = item.country
    ? `<p><strong>Country:</strong> ${escapeHtml(item.country)}</p>`
    : '';

  const director = item.director
    ? `<p><strong>Director:</strong> ${escapeHtml(item.director)}</p>`
    : '';

  const category = item.category
    ? `<p><strong>Category:</strong> ${escapeHtml(item.category)}</p>`
    : '';

  const description = item.description
    ? `<p class="cinema-modal-description">${escapeHtml(item.description)}</p>`
    : '';

  // Validate stream URL (only allow http/https)
  const streamUrl = sanitizeUrl(item.streamUrl);
  const playBtn = streamUrl
    ? `<a href="${escapeAttr(streamUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary mt-md">▶ Play</a>`
    : '';

  modalBody.innerHTML = `
    <div class="cinema-modal-details">
      ${rating}${year}${country}${director}${genres}${category}
    </div>
    ${description}
    ${playBtn}
  `;

  modal.style.display = 'flex';
}

/**
 * Show cinema loading state
 */
function showCinemaLoading() {
  const loading = document.getElementById('cinemaLoadingState');
  const noData = document.getElementById('cinemaNoDataState');
  const results = document.getElementById('cinemaResultsSection');
  const dataLoaded = document.getElementById('cinemaDataLoaded');

  if (loading) {
    loading.innerHTML = `
      <div class="card-body">
        <p>Loading cinema catalog...</p>
        <p class="text-small text-light" id="cinemaLoadingProgress">Preparing...</p>
      </div>
    `;
    loading.style.display = 'block';
  }
  if (noData) noData.style.display = 'none';
  if (results) results.style.display = 'none';
  if (dataLoaded) dataLoaded.style.display = 'none';
}

/**
 * Hide cinema loading state
 */
function hideCinemaLoading() {
  const loading = document.getElementById('cinemaLoadingState');
  if (loading) loading.style.display = 'none';
}

/**
 * Update cinema loading progress (throttled, text-only update)
 * @param {number} percent - Progress percentage
 */
let lastProgressUpdate = 0;
function updateCinemaLoadingProgress(percent) {
  // Throttle: update at most every 100ms
  const now = Date.now();
  if (now - lastProgressUpdate < 100 && percent < 100) return;
  lastProgressUpdate = now;

  const progressEl = document.getElementById('cinemaLoadingProgress');
  if (progressEl) {
    progressEl.textContent = `${percent}% complete`;
  }
}

/**
 * Show cinema error
 * @param {string} message - Error message
 */
function showCinemaError(message) {
  const errorEl = document.getElementById('cinemaErrorState');
  const errorMsg = document.getElementById('cinemaErrorMessage');
  if (errorEl) errorEl.style.display = 'block';
  if (errorMsg) errorMsg.textContent = message;
}

/**
 * Hide cinema error
 */
function hideCinemaError() {
  const errorEl = document.getElementById('cinemaErrorState');
  if (errorEl) errorEl.style.display = 'none';
}

/**
 * Show cinema data loaded message
 * @param {Object} stats - Data statistics
 */
function showCinemaDataLoaded(stats) {
  const noData = document.getElementById('cinemaNoDataState');
  const dataLoaded = document.getElementById('cinemaDataLoaded');

  if (noData) noData.style.display = 'none';

  if (dataLoaded) {
    dataLoaded.innerHTML = `
      <div class="card-body" style="text-align: left;">
        <h3 class="card-title">Cinema Catalog Loaded</h3>
        <p class="card-description mb-lg">
          Loaded <strong>${stats.totalItems.toLocaleString()}</strong> items
          in <strong>${stats.totalCategories}</strong> categories.
        </p>
        <p class="card-description">
          Use search and filters to find movies and series.
        </p>
      </div>
    `;
    dataLoaded.style.display = 'block';
  }
}

/**
 * Escape HTML special characters
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} - Escaped string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Escape string for use in HTML attributes
 * @param {*} str - Value to escape (coerced to string)
 * @returns {string} - Escaped string safe for attribute values
 */
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sanitize URL - only allow http:// and https:// protocols
 * Rejects javascript:, data:, vbscript:, and other dangerous schemes
 * @param {string} url - URL to sanitize
 * @returns {string|null} - Sanitized URL or null if unsafe
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return null;
}
