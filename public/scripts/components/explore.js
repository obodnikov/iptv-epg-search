/**
 * explore.js - Explore Mode Component
 * Curated home screen with keyword chips, recent searches, and category-based program sections
 */

import { filterByChannels, filterUniqueByClosestTime, filterPreferHD } from '../utils/search.js';
import { getProgramStatus, formatTimeRange } from '../utils/epgParser.js';
import { showProgramModal, escapeHtml } from './results.js';
import { getGroupedChannels } from './channelFilter.js';
import { generateKeywords } from '../utils/keywords.js';
import { getRecentSearches, removeRecentSearch, clearRecentSearches } from '../utils/recentSearches.js';

// Category display configuration
const CATEGORY_CONFIG = {
  movies: { name: 'Movies', icon: '' },
  sports: { name: 'Sports', icon: '' },
  news: { name: 'News', icon: '' },
  kids: { name: 'Kids', icon: '' },
  hd: { name: 'HD Channels', icon: '' },
  general: { name: 'General', icon: '' }
};

// Category render order (skip general for discover sections)
const DISCOVER_CATEGORIES = ['movies', 'sports', 'news', 'kids'];

// Max cards per section
const MAX_CARDS_PER_SECTION = 20;

// Coming up time window (3 hours in ms)
const COMING_UP_WINDOW_MS = 3 * 60 * 60 * 1000;

// Callbacks
let callbacks = {
  onKeywordClick: null,
  onRecentSearchClick: null
};

// Component state
let state = {
  isVisible: false,
  channelCategoryMap: null
};

/**
 * Initialize Explore component
 * @param {Object} options - Configuration options
 * @param {Function} options.onKeywordClick - Callback when keyword chip is clicked
 * @param {Function} options.onRecentSearchClick - Callback when recent search chip is clicked
 */
export function initExplore(options = {}) {
  callbacks.onKeywordClick = options.onKeywordClick || null;
  callbacks.onRecentSearchClick = options.onRecentSearchClick || null;
}

/**
 * Show Explore view and render content
 */
export function showExplore() {
  const section = document.getElementById('exploreSection');
  if (!section) return;

  // Hide other content areas
  const resultsSection = document.getElementById('resultsSection');
  const noResultsState = document.getElementById('noResultsState');
  const dataLoadedInfo = document.getElementById('dataLoadedInfo');
  const errorState = document.getElementById('errorState');
  if (resultsSection) resultsSection.style.display = 'none';
  if (noResultsState) noResultsState.style.display = 'none';
  if (dataLoadedInfo) dataLoadedInfo.style.display = 'none';
  if (errorState) errorState.style.display = 'none';

  state.isVisible = true;
  section.style.display = 'block';

  renderExplore();
}

/**
 * Hide Explore view
 */
export function hideExplore() {
  const section = document.getElementById('exploreSection');
  if (section) section.style.display = 'none';
  state.isVisible = false;
}

/**
 * Refresh Explore content (re-render with current filters)
 */
export function refreshExplore() {
  if (!state.isVisible) return;
  renderExplore();
}

/**
 * Check if Explore view is currently visible
 * @returns {boolean}
 */
export function isExploreVisible() {
  return state.isVisible;
}

/**
 * Get programs filtered by shared filters (Channels, Show Once, Prefer HD)
 * @returns {Array} Filtered programs
 */
function getFilteredPrograms() {
  const appState = window.appState;
  if (!appState?.epgData?.programs) return [];

  let programs = appState.epgData.programs;

  // Apply channel filter
  if (appState.selectedChannels) {
    programs = filterByChannels(programs, appState.selectedChannels);
  }

  // Apply unique filter
  if (appState.showUniqueOnly) {
    programs = filterUniqueByClosestTime(programs);
  }

  // Apply HD preference
  if (appState.preferHD) {
    programs = filterPreferHD(programs);
  }

  return programs;
}

/**
 * Build a map from channelId to category key
 * @returns {Map<string, string>}
 */
function buildChannelCategoryMap() {
  const grouped = getGroupedChannels();
  const map = new Map();

  for (const [category, channels] of Object.entries(grouped)) {
    for (const channel of channels) {
      map.set(channel.id, category);
    }
  }

  return map;
}

/**
 * Capitalize first letter
 * @param {string} text
 * @returns {string}
 */
function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Main render function for Explore view
 */
function renderExplore() {
  const section = document.getElementById('exploreSection');
  if (!section) return;

  const programs = getFilteredPrograms();
  state.channelCategoryMap = buildChannelCategoryMap();

  if (programs.length === 0) {
    section.innerHTML = `
      <div class="explore-empty">
        <p>No programs available with current filters.</p>
      </div>
    `;
    return;
  }

  const now = new Date();
  const comingUpLimit = new Date(now.getTime() + COMING_UP_WINDOW_MS);

  // Separate programs by time status
  const currentPrograms = [];
  const comingUpPrograms = [];

  for (const program of programs) {
    const status = getProgramStatus(program.start, program.stop);
    if (status === 'current') {
      currentPrograms.push(program);
    } else if (status === 'future' && program.start <= comingUpLimit) {
      comingUpPrograms.push(program);
    }
  }

  // Sort coming up by start time
  comingUpPrograms.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Group by channel category
  const currentByCategory = groupByCategory(currentPrograms);
  const comingUpByCategory = groupByCategory(comingUpPrograms);

  // Build HTML
  const fragments = [];

  // --- Keyword chips ---
  const keywordChipsHtml = renderKeywordChips(programs);
  if (keywordChipsHtml) {
    fragments.push(keywordChipsHtml);
  }

  // --- Recent searches ---
  const recentSearchesHtml = renderRecentSearches();
  if (recentSearchesHtml) {
    fragments.push(recentSearchesHtml);
  }

  // --- "On Now" sections by category ---
  const onNowSections = renderTimeSections('On Now', currentByCategory, 'current');
  if (onNowSections) {
    fragments.push(onNowSections);
  }

  // --- Divider ---
  if (onNowSections && comingUpPrograms.length > 0) {
    fragments.push('<hr class="explore-divider">');
  }

  // --- "Coming Up" sections by category ---
  const comingUpSections = renderTimeSections('Coming Up', comingUpByCategory, 'future');
  if (comingUpSections) {
    fragments.push(comingUpSections);
  }

  // Empty state if no current or coming up
  if (!onNowSections && !comingUpSections) {
    fragments.push(`
      <div class="explore-empty">
        <p>No current or upcoming programs found with current filters.</p>
      </div>
    `);
  }

  section.innerHTML = fragments.join('');

  // Attach event listeners
  attachCardListeners(section);
}

/**
 * Render keyword chips section
 * @param {Array} programs - Filtered programs to analyze
 * @returns {string|null} HTML string or null if no keywords
 */
function renderKeywordChips(programs) {
  const keywords = generateKeywords(programs);
  if (keywords.length === 0) return null;

  const chipsHtml = keywords.map(kw =>
    `<button class="explore-chip explore-chip--keyword" data-keyword="${escapeHtml(kw.text)}" title="${kw.count} programs">${escapeHtml(kw.text)}</button>`
  ).join('');

  return `
    <div class="explore-chips-section" id="exploreKeywordChips">
      <span class="explore-chips-label">Discover</span>
      <div class="explore-chips-row">
        ${chipsHtml}
      </div>
    </div>
  `;
}

/**
 * Render recent searches section
 * @returns {string|null} HTML string or null if no recent searches
 */
function renderRecentSearches() {
  const searches = getRecentSearches();
  if (searches.length === 0) return null;

  const chipsHtml = searches.map(q =>
    `<span class="explore-chip explore-chip--recent" data-query="${escapeHtml(q)}">${escapeHtml(q)}<button class="explore-chip-remove" data-remove-query="${escapeHtml(q)}" aria-label="Remove">&#10005;</button></span>`
  ).join('');

  return `
    <div class="explore-chips-section" id="exploreRecentSearches">
      <span class="explore-chips-label">Recent Searches <button class="explore-chips-clear" id="clearRecentSearches">Clear</button></span>
      <div class="explore-chips-row">
        ${chipsHtml}
      </div>
    </div>
  `;
}

/**
 * Group programs by their channel's category
 * @param {Array} programs
 * @returns {Object} - { categoryKey: [programs] }
 */
function groupByCategory(programs) {
  const groups = {};

  for (const program of programs) {
    const category = state.channelCategoryMap?.get(program.channelId) || 'general';
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(program);
  }

  return groups;
}

/**
 * Render time-based sections (On Now / Coming Up) grouped by category
 * @param {string} timeLabel - "On Now" or "Coming Up"
 * @param {Object} categorized - Programs grouped by category
 * @param {string} badgeStatus - 'current' or 'future'
 * @returns {string|null} HTML string or null if empty
 */
function renderTimeSections(timeLabel, categorized, badgeStatus) {
  const sections = [];

  // Render discover categories first (movies, sports, news, kids)
  for (const catKey of DISCOVER_CATEGORIES) {
    const programs = categorized[catKey];
    if (programs && programs.length > 0) {
      const catName = CATEGORY_CONFIG[catKey]?.name || capitalize(catKey);
      sections.push(renderCategorySection(
        `${catName} — ${timeLabel}`,
        programs.slice(0, MAX_CARDS_PER_SECTION),
        badgeStatus
      ));
    }
  }

  // Render remaining categories (hd, general, any others)
  for (const [catKey, programs] of Object.entries(categorized)) {
    if (DISCOVER_CATEGORIES.includes(catKey)) continue;
    if (programs.length === 0) continue;

    const catName = CATEGORY_CONFIG[catKey]?.name || capitalize(catKey);
    sections.push(renderCategorySection(
      `${catName} — ${timeLabel}`,
      programs.slice(0, MAX_CARDS_PER_SECTION),
      badgeStatus
    ));
  }

  return sections.length > 0 ? sections.join('') : null;
}

/**
 * Render a single category section with horizontal card grid
 * @param {string} title - Section title
 * @param {Array} programs - Programs to display
 * @param {string} badgeStatus - 'current' or 'future'
 * @returns {string} HTML string
 */
function renderCategorySection(title, programs, badgeStatus) {
  const cardsHtml = programs.map(p => createExploreProgramCard(p, badgeStatus)).join('');

  return `
    <div class="explore-category">
      <div class="explore-category-header">
        <h3 class="explore-category-title">${escapeHtml(title)}</h3>
        <span class="explore-category-count">${programs.length} program${programs.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="explore-category-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

/**
 * Create a compact program card for Explore view
 * @param {Object} program - Program object
 * @param {string} badgeStatus - 'current' or 'future'
 * @returns {string} HTML string
 */
function createExploreProgramCard(program, badgeStatus) {
  const status = badgeStatus || getProgramStatus(program.start, program.stop);
  const badgeLabel = status === 'current' ? 'Now' : status === 'future' ? 'Soon' : 'Ended';
  const timeRange = formatTimeRange(program.start, program.stop);

  // Use encodeURIComponent for safe attribute embedding (handles quotes, special chars)
  const encodedProgram = encodeURIComponent(JSON.stringify(program, replacer));

  return `
    <div class="explore-program-card" data-program="${encodedProgram}">
      <div class="explore-program-card-top">
        <span class="explore-program-channel">${escapeHtml(program.channelName)}</span>
        <span class="explore-program-badge badge-${status}">${badgeLabel}</span>
      </div>
      <div class="explore-program-title">${escapeHtml(program.title)}</div>
      <div class="explore-program-time">${escapeHtml(timeRange)}</div>
    </div>
  `;
}

/**
 * JSON replacer to handle Date objects in program data
 */
function replacer(key, value) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

/**
 * Parse program data from card dataset (restore Date objects)
 * @param {string} jsonString - JSON string from dataset
 * @returns {Object} Program object with Date fields
 */
function parseProgram(encodedString) {
  const program = JSON.parse(decodeURIComponent(encodedString));
  if (program.start) program.start = new Date(program.start);
  if (program.stop) program.stop = new Date(program.stop);
  return program;
}

/**
 * Attach click event listeners to program cards and chips
 * @param {HTMLElement} container - Parent container
 */
function attachCardListeners(container) {
  container.addEventListener('click', (e) => {
    // Handle keyword chip clicks
    const chip = e.target.closest('.explore-chip--keyword');
    if (chip) {
      const keyword = chip.getAttribute('data-keyword');
      if (keyword && callbacks.onKeywordClick) {
        callbacks.onKeywordClick(keyword);
      }
      return;
    }

    // Handle recent search remove button
    const removeBtn = e.target.closest('.explore-chip-remove');
    if (removeBtn) {
      const query = removeBtn.getAttribute('data-remove-query');
      if (query) {
        removeRecentSearch(query);
        renderExplore();
      }
      return;
    }

    // Handle clear all recent searches
    if (e.target.id === 'clearRecentSearches') {
      clearRecentSearches();
      renderExplore();
      return;
    }

    // Handle recent search chip clicks
    const recentChip = e.target.closest('.explore-chip--recent');
    if (recentChip) {
      const query = recentChip.getAttribute('data-query');
      if (query && callbacks.onRecentSearchClick) {
        callbacks.onRecentSearchClick(query);
      }
      return;
    }

    // Handle program card clicks
    const card = e.target.closest('.explore-program-card');
    if (!card) return;

    const programData = card.getAttribute('data-program');
    if (!programData) return;

    try {
      const program = parseProgram(programData);
      showProgramModal(program);
    } catch (err) {
      console.error('Failed to parse program data:', err);
    }
  });
}
