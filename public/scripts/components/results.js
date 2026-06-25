/**
 * results.js - Results Display Component
 * Handles displaying search results in the UI
 */

import { formatTimeRange, getProgramStatus, formatDateTime, epgRawToEpochSeconds } from '../utils/epgParser.js';
import { createRatingControl } from './ratingControl.js';
import { sanitizeUrl, escapeAttr } from '../utils/sanitize.js';

// View mode state
let currentView = 'grid'; // 'grid' or 'list'

/**
 * Initialize view toggle controls
 */
export function initViewToggle() {
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');

  gridViewBtn?.addEventListener('click', () => {
    setViewMode('grid');
  });

  listViewBtn?.addEventListener('click', () => {
    setViewMode('list');
  });
}

/**
 * Set view mode
 * @param {string} mode - 'grid' or 'list'
 */
function setViewMode(mode) {
  currentView = mode;
  const gridViewBtn = document.getElementById('gridViewBtn');
  const listViewBtn = document.getElementById('listViewBtn');
  const resultsContainer = document.getElementById('resultsContainer');

  if (mode === 'grid') {
    gridViewBtn?.classList.remove('btn-secondary');
    gridViewBtn?.classList.add('btn-primary');
    listViewBtn?.classList.remove('btn-primary');
    listViewBtn?.classList.add('btn-secondary');
    gridViewBtn?.setAttribute('data-active', 'true');
    listViewBtn?.removeAttribute('data-active');

    resultsContainer.className = 'grid grid-auto';
  } else {
    listViewBtn?.classList.remove('btn-secondary');
    listViewBtn?.classList.add('btn-primary');
    gridViewBtn?.classList.remove('btn-primary');
    gridViewBtn?.classList.add('btn-secondary');
    listViewBtn?.setAttribute('data-active', 'true');
    gridViewBtn?.removeAttribute('data-active');

    resultsContainer.className = 'results-list';
  }

  // Re-render current results if any
  const currentResults = window.appState?.currentResults;
  if (currentResults && currentResults.length > 0) {
    renderResults(currentResults);
  }
}

/**
 * Display search results
 * @param {Array} programs - Array of program objects to display
 * @param {boolean} hasMore - Whether there are more results
 * @param {number} totalResults - Total number of results found
 */
export function displayResults(programs, hasMore = false, totalResults = 0) {
  const resultsSection = document.getElementById('resultsSection');
  const resultsCount = document.getElementById('resultsCount');
  const noResultsState = document.getElementById('noResultsState');

  // Hide the data loaded info card
  const infoCard = document.getElementById('dataLoadedInfo');
  if (infoCard) {
    infoCard.style.display = 'none';
  }

  if (!programs || programs.length === 0) {
    showNoResults();
    return;
  }

  // Update count with pagination info
  if (hasMore) {
    resultsCount.textContent = `Showing ${programs.length} of ${totalResults.toLocaleString()} results (limited for performance)`;
  } else {
    resultsCount.textContent = `${programs.length} result${programs.length !== 1 ? 's' : ''}`;
  }

  // Display results
  resultsSection.style.display = 'block';
  noResultsState.style.display = 'none';

  // Render results based on view mode
  renderResults(programs);

  // Add "refine search" message if results are limited
  const resultsContainer = document.getElementById('resultsContainer');
  if (hasMore) {
    const refineMessage = document.createElement('div');
    refineMessage.className = 'card text-center mt-lg';
    refineMessage.innerHTML = `
      <div class="card-body">
        <p class="card-description">
          Too many results to display. Please refine your search to see more specific results.
        </p>
      </div>
    `;
    resultsContainer.appendChild(refineMessage);
  }
}

/**
 * Render results based on current view mode
 * @param {Array} programs - Programs to render
 */
function renderResults(programs) {
  const resultsContainer = document.getElementById('resultsContainer');
  resultsContainer.innerHTML = '';

  programs.forEach(program => {
    const element = currentView === 'grid'
      ? createProgramCard(program)
      : createProgramListItem(program);

    resultsContainer.appendChild(element);
  });
}

/**
 * Truncate description to 1-2 sentences
 * @param {string} description - Full description
 * @returns {string} - Truncated description
 */
function truncateDescription(description) {
  if (!description) return '';

  // Split by sentence endings
  const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Take first 2 sentences
  const truncated = sentences.slice(0, 2).join('. ');

  // If there are more sentences, add ellipsis
  if (sentences.length > 2) {
    return truncated + '...';
  }

  return truncated + (truncated.endsWith('.') ? '' : '.');
}

/**
 * Create a program card element (Grid view)
 * @param {Object} program - Program object
 * @returns {HTMLElement} - Card element
 */
function createProgramCard(program) {
  const card = document.createElement('div');
  card.className = 'card result-card clickable';
  card.dataset.program = JSON.stringify(program);

  const status = getProgramStatus(program.start, program.stop);
  const shortDescription = truncateDescription(program.description);

  card.innerHTML = `
    <div class="result-card-channel">${escapeHtml(program.channelName)}</div>
    <h3 class="result-card-title">${escapeHtml(program.title)}</h3>
    <div class="result-card-time">
      <span class="result-card-badge badge-${status}">${capitalize(status)}</span>
      <span>${formatTimeRange(program.start, program.stop)}</span>
    </div>
    ${shortDescription ? `<p class="result-card-description">${escapeHtml(shortDescription)}</p>` : ''}
  `;

  // Add rating control
  const ratingControl = createRatingControl(program, (rating) => {
    console.log(`Rating changed for "${program.title}":`, rating);
  });
  card.appendChild(ratingControl);

  card.addEventListener('click', (e) => {
    // Don't open modal if clicking on rating control
    if (!e.target.closest('.rating-control')) {
      showProgramModal(program);
    }
  });

  return card;
}

/**
 * Create a program list item (List view)
 * @param {Object} program - Program object
 * @returns {HTMLElement} - List item element
 */
function createProgramListItem(program) {
  const item = document.createElement('div');
  item.className = 'result-list-item clickable';
  item.dataset.program = JSON.stringify(program);

  const status = getProgramStatus(program.start, program.stop);
  const shortDescription = truncateDescription(program.description);

  item.innerHTML = `
    <div class="result-list-channel">${escapeHtml(program.channelName)}</div>
    <div class="result-list-time">
      <span>${formatTimeRange(program.start, program.stop)}</span>
    </div>
    <div class="result-list-content">
      <div class="result-list-title">${escapeHtml(program.title)}</div>
      ${shortDescription ? `<div class="result-list-description">${escapeHtml(shortDescription)}</div>` : ''}
    </div>
    <div class="result-list-badge">
      <span class="result-card-badge badge-${status}">${capitalize(status)}</span>
    </div>
  `;

  // Add rating control
  const ratingControl = createRatingControl(program, (rating) => {
    console.log(`Rating changed for "${program.title}":`, rating);
  });
  item.appendChild(ratingControl);

  item.addEventListener('click', (e) => {
    // Don't open modal if clicking on rating control
    if (!e.target.closest('.rating-control')) {
      showProgramModal(program);
    }
  });

  return item;
}

/**
 * Show program details modal
 * @param {Object} program - Program object
 */
function showProgramModal(program) {
  const modal = document.getElementById('programModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');

  const status = getProgramStatus(program.start, program.stop);

  // Build Watch Live button if this channel has a live stream
  const liveCh = window.appState?.liveChannels?.get(program.channelId);
  const streamUrl = liveCh ? sanitizeUrl(liveCh.streamUrl) : null;
  const watchLiveHtml = streamUrl
    ? `<a href="${escapeAttr(streamUrl)}" target="_blank" rel="noopener noreferrer"
          class="btn btn-primary modal-watch-live">&#9654; Watch Live</a>`
    : '';

  // Build Catch-up button for past programs on DVR-enabled channels.
  // Uses the server's confirmed catch-up API (see docs/design/live-tv-playback-plan.md §5.1):
  //   {streamUrl}?utc={startEpoch}&lutc={nowEpoch}
  // - utc: the program's true start epoch (from timezone-correct startRaw)
  // - lutc: the current live point — empirically tested; the server uses the
  //   delta to position the DVR window and the manifest has no #EXT-X-ENDLIST,
  //   so the external player rolls continuously into the next program (§3.2).
  //   NOTE: lutc uses client clock (Date.now()); significant clock skew may
  //   affect DVR positioning. A server time endpoint would be more robust
  //   but is not yet available in the current architecture.
  let catchupHtml = '';
  if (liveCh && liveCh.tvgRec > 0 && streamUrl && program.startRaw && program.stopRaw) {
    const startEpoch = epgRawToEpochSeconds(program.startRaw);
    const stopEpoch = epgRawToEpochSeconds(program.stopRaw);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // Show Catch-up only for past programs whose start is within the archive window.
    // Use integer seconds comparison to avoid floating‑point boundary edge‑cases.
    const archiveWindowSec = liveCh.tvgRec * 86400;
    if (!isNaN(startEpoch) && !isNaN(stopEpoch)
        && stopEpoch < nowEpoch
        && (nowEpoch - startEpoch) <= archiveWindowSec) {
      // Build URL safely: use URL API to preserve any existing query params on the stream URL.
      // sanitizeUrl already blocks non-http(s) schemes; wrap new URL() in try/catch
      // in case the stream URL is malformed (prevents modal rendering breakage).
      let catchupUrl = null;
      try {
        const u = new URL(streamUrl, window.location.href);
        u.searchParams.set('utc', startEpoch);
        u.searchParams.set('lutc', nowEpoch);
        catchupUrl = sanitizeUrl(u.href);
      } catch {
        // Malformed stream URL — leave catchupUrl null (button won't render)
      }
      if (catchupUrl) {
        catchupHtml = `<a href="${escapeAttr(catchupUrl)}" target="_blank" rel="noopener noreferrer"
              class="btn btn-secondary modal-catch-up">&#9654; Catch&#8209;up</a>`;
      }
    }
  }

  modalTitle.textContent = program.title;

  modalBody.innerHTML = `
    <div class="modal-info-grid">
      <div class="modal-info-item">
        <div class="modal-info-label">Channel</div>
        <div class="modal-info-value">${escapeHtml(program.channelName)}</div>
      </div>

      <div class="modal-info-item">
        <div class="modal-info-label">Status</div>
        <div class="modal-info-value">
          <span class="result-card-badge badge-${status}">${capitalize(status)}</span>
        </div>
      </div>

      <div class="modal-info-item">
        <div class="modal-info-label">Start Time</div>
        <div class="modal-info-value">${formatDateTime(program.start)}</div>
      </div>

      <div class="modal-info-item">
        <div class="modal-info-label">End Time</div>
        <div class="modal-info-value">${formatDateTime(program.stop)}</div>
      </div>
    </div>

    ${watchLiveHtml}

    ${catchupHtml}

    ${program.description ? `
      <div class="modal-info-item" style="margin-top: var(--space-lg);">
        <div class="modal-info-label">Description</div>
        <div class="modal-info-value">${escapeHtml(program.description)}</div>
      </div>
    ` : ''}
    
    <div class="modal-rating-section">
      <label class="modal-rating-label">Your Rating</label>
      <div id="modalRatingContainer"></div>
    </div>
  `;

  // Add rating control to modal
  const ratingContainer = modalBody.querySelector('#modalRatingContainer');
  const modalRatingControl = createRatingControl(program, (rating) => {
    console.log(`Rating changed in modal for "${program.title}":`, rating);
  });
  ratingContainer.appendChild(modalRatingControl);

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

/**
 * Hide program details modal
 */
function hideProgramModal() {
  const modal = document.getElementById('programModal');
  modal.style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * Initialize modal controls
 */
export function initModal() {
  const modalClose = document.getElementById('modalClose');
  const modalOverlay = document.getElementById('modalOverlay');

  modalClose?.addEventListener('click', hideProgramModal);
  modalOverlay?.addEventListener('click', hideProgramModal);

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideProgramModal();
    }
  });
}

/**
 * Show no results state
 */
export function showNoResults() {
  const resultsSection = document.getElementById('resultsSection');
  const resultsContainer = document.getElementById('resultsContainer');
  const noResultsState = document.getElementById('noResultsState');

  // Hide the data loaded info card
  const infoCard = document.getElementById('dataLoadedInfo');
  if (infoCard) {
    infoCard.style.display = 'none';
  }

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
