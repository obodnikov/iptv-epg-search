/**
 * channelFilter.js - Channel Filter Component
 * Handles channel selection with grouping, quick filters, and persistence
 */

// Storage key for localStorage
const STORAGE_KEY = 'iptv-channel-filter';

// Channel categories with detection patterns
const CHANNEL_CATEGORIES = {
  hd: {
    name: 'HD Channels',
    patterns: [/hd$/i, /\sHD$/i, /HD\s/i],
    keywords: ['HD', 'UHD', '4K']
  },
  news: {
    name: 'News',
    patterns: [],
    keywords: ['News', 'Новости', '24', 'РБК', 'CNN', 'BBC', 'RT', 'Дождь', 'Euronews', 'RTVI']
  },
  movies: {
    name: 'Movies',
    patterns: [],
    keywords: ['TV1000', 'Кино', 'кино', 'Viju', 'Премьера', 'Movie', 'Film', 'Cinema', 'Остросюжетное', 'Премиальное', 'Душевное']
  },
  sports: {
    name: 'Sports',
    patterns: [],
    keywords: ['Спорт', 'Sport', 'Матч', 'Футбол', 'Football', 'ESPN', 'Евроспорт']
  },
  kids: {
    name: 'Kids',
    patterns: [],
    keywords: ['Детский', 'Карусель', 'Мульт', 'Disney', 'Nickelodeon', 'JimJam', 'Детям', 'Cartoon', 'Nick']
  }
};

// Component state
let state = {
  channels: [],           // All available channels
  selectedChannels: new Set(), // Selected channel IDs
  groupedChannels: {},    // Channels grouped by category
  collapsedGroups: new Set(), // Collapsed group IDs
  filterText: '',         // Current filter text
  isOpen: false,          // Popup open state
  showOnlyInResults: false, // Toggle for showing only channels in results
  channelsInResults: new Set() // Channel IDs present in current search results
};

// Callbacks
let onSelectionChange = null;

/**
 * Initialize the channel filter component
 * @param {Object} options - Configuration options
 * @param {Function} options.onSelectionChange - Callback when selection changes
 */
export function initChannelFilter(options = {}) {
  onSelectionChange = options.onSelectionChange || null;

  // Set up event listeners
  setupEventListeners();

  // Load saved state from localStorage
  loadSavedState();

  console.log('Channel filter initialized');
}

/**
 * Set up event listeners for the component
 */
function setupEventListeners() {
  // Channel filter button
  const filterButton = document.getElementById('channelFilterBtn');
  filterButton?.addEventListener('click', togglePopup);

  // Close button
  const closeButton = document.getElementById('channelFilterClose');
  closeButton?.addEventListener('click', closePopup);

  // Cancel button
  const cancelButton = document.getElementById('channelFilterCancel');
  cancelButton?.addEventListener('click', closePopup);

  // Apply button
  const applyButton = document.getElementById('channelFilterApply');
  applyButton?.addEventListener('click', applySelection);

  // Select All button
  const selectAllButton = document.getElementById('channelSelectAll');
  selectAllButton?.addEventListener('click', selectAllChannels);

  // Clear All button
  const clearAllButton = document.getElementById('channelClearAll');
  clearAllButton?.addEventListener('click', clearAllChannels);

  // Invert button
  const invertButton = document.getElementById('channelInvert');
  invertButton?.addEventListener('click', invertSelection);

  // Filter input
  const filterInput = document.getElementById('channelFilterInput');
  filterInput?.addEventListener('input', (e) => {
    state.filterText = e.target.value;
    renderChannelList();
  });

  // Quick filter buttons
  document.querySelectorAll('[data-quick-filter]').forEach(button => {
    button.addEventListener('click', (e) => {
      const filter = e.target.dataset.quickFilter;
      applyQuickFilter(filter);
    });
  });

  // Show in Results toggle button
  const showInResultsButton = document.getElementById('channelShowInResults');
  showInResultsButton?.addEventListener('click', toggleShowOnlyInResults);

  // Click outside to close
  const popup = document.getElementById('channelFilterPopup');
  popup?.addEventListener('click', (e) => {
    if (e.target === popup) {
      closePopup();
    }
  });

  // ESC key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.isOpen) {
      closePopup();
    }
  });
}

/**
 * Update channels list when EPG data is loaded
 * @param {Array} channelsArray - Array of channel objects with id and name
 */
export function updateChannels(channelsArray) {
  if (!channelsArray || channelsArray.length === 0) {
    state.channels = [];
    state.groupedChannels = {};
    updateButtonBadge();
    return;
  }

  // Map channel array to internal format
  state.channels = channelsArray.map(channel => ({
    id: channel.id,
    name: channel.name,
    icon: channel.icon
  }));

  // Sort channels alphabetically by name
  state.channels.sort((a, b) => a.name.localeCompare(b.name));

  // Group channels by category
  state.groupedChannels = groupChannelsByCategory(state.channels);

  // Load saved selection or select all by default
  const saved = loadSavedState();
  if (saved && saved.selectedChannels && saved.selectedChannels.length > 0) {
    // Filter saved channels to only include existing ones
    const existingIds = new Set(state.channels.map(c => c.id));
    state.selectedChannels = new Set(
      saved.selectedChannels.filter(id => existingIds.has(id))
    );

    // If no valid channels remain, select all
    if (state.selectedChannels.size === 0) {
      selectAllChannelsInternal();
    }
  } else {
    // Select all channels by default
    selectAllChannelsInternal();
  }

  // Load collapsed groups
  if (saved && saved.collapsedGroups) {
    state.collapsedGroups = new Set(saved.collapsedGroups);
  }

  // Update UI
  updateButtonBadge();
  renderChannelList();

  console.log(`Channel filter updated with ${state.channels.length} channels`);
}

/**
 * Group channels by category
 * @param {Array} channels - Array of channel objects
 * @returns {Object} - Grouped channels
 */
function groupChannelsByCategory(channels) {
  const groups = {
    hd: [],
    news: [],
    movies: [],
    sports: [],
    kids: [],
    general: []
  };

  channels.forEach(channel => {
    const category = detectCategory(channel);
    groups[category].push(channel);
  });

  // Remove empty groups
  Object.keys(groups).forEach(key => {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  });

  return groups;
}

/**
 * Detect channel category based on name patterns
 * @param {Object} channel - Channel object
 * @returns {string} - Category key
 */
function detectCategory(channel) {
  // Validate channel object
  if (!channel || typeof channel !== 'object') {
    return 'general';
  }

  const name = typeof channel.name === 'string' ? channel.name : '';
  const id = typeof channel.id === 'string' || typeof channel.id === 'number'
    ? String(channel.id)
    : '';

  // Check each category
  for (const [category, config] of Object.entries(CHANNEL_CATEGORIES)) {
    // Check patterns
    for (const pattern of config.patterns) {
      if (pattern.test(name) || pattern.test(id)) {
        return category;
      }
    }

    // Check keywords
    for (const keyword of config.keywords) {
      if (name.includes(keyword) || id.toLowerCase().includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  return 'general';
}

/**
 * Toggle popup visibility
 */
function togglePopup() {
  if (state.isOpen) {
    closePopup();
  } else {
    openPopup();
  }
}

/**
 * Open the popup
 */
function openPopup() {
  const popup = document.getElementById('channelFilterPopup');
  if (popup) {
    popup.style.display = 'flex';
    state.isOpen = true;

    // Update "Show in Results" button state
    updateShowInResultsButton();

    renderChannelList();

    // Focus filter input
    const filterInput = document.getElementById('channelFilterInput');
    filterInput?.focus();
  }
}

/**
 * Close the popup without applying
 */
function closePopup() {
  const popup = document.getElementById('channelFilterPopup');
  if (popup) {
    popup.style.display = 'none';
    state.isOpen = false;
    state.filterText = '';
    state.showOnlyInResults = false;

    // Clear filter input
    const filterInput = document.getElementById('channelFilterInput');
    if (filterInput) {
      filterInput.value = '';
    }
  }
}

/**
 * Apply selection and close popup
 */
function applySelection() {
  // Validate minimum selection
  if (state.selectedChannels.size === 0) {
    showValidationError('Select at least 1 channel');
    return;
  }

  // Hide validation error
  hideValidationError();

  // Save to localStorage
  saveState();

  // Update button badge
  updateButtonBadge();

  // Close popup
  closePopup();

  // Trigger callback
  if (onSelectionChange) {
    onSelectionChange(getSelectedChannelIds());
  }
}

/**
 * Show validation error message
 * @param {string} message - Error message
 */
function showValidationError(message) {
  const errorDiv = document.getElementById('channelFilterError');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }

  // Disable apply button
  const applyButton = document.getElementById('channelFilterApply');
  if (applyButton) {
    applyButton.disabled = true;
  }
}

/**
 * Hide validation error message
 */
function hideValidationError() {
  const errorDiv = document.getElementById('channelFilterError');
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }

  // Enable apply button
  const applyButton = document.getElementById('channelFilterApply');
  if (applyButton) {
    applyButton.disabled = false;
  }
}

/**
 * Select all channels
 */
function selectAllChannels() {
  selectAllChannelsInternal();
  renderChannelList();
  updateSelectionCount();
}

/**
 * Internal function to select all channels
 */
function selectAllChannelsInternal() {
  state.selectedChannels = new Set(state.channels.map(c => c.id));
}

/**
 * Clear all channel selections
 */
function clearAllChannels() {
  state.selectedChannels.clear();
  renderChannelList();
  updateSelectionCount();
}

/**
 * Invert current selection
 */
function invertSelection() {
  const newSelection = new Set();
  state.channels.forEach(channel => {
    if (!state.selectedChannels.has(channel.id)) {
      newSelection.add(channel.id);
    }
  });
  state.selectedChannels = newSelection;
  renderChannelList();
  updateSelectionCount();
}

/**
 * Toggle "Show only in results" filter
 */
function toggleShowOnlyInResults() {
  // Only toggle if there are channels in results
  if (state.channelsInResults.size === 0) return;

  state.showOnlyInResults = !state.showOnlyInResults;
  updateShowInResultsButton();
  renderChannelList();
}

/**
 * Update the "Show in Results" button state
 */
function updateShowInResultsButton() {
  const button = document.getElementById('channelShowInResults');
  const countSpan = document.getElementById('channelResultsCount');

  if (!button) return;

  const count = state.channelsInResults.size;

  // Update count
  if (countSpan) {
    countSpan.textContent = `(${count})`;
  }

  // Enable/disable button
  if (count > 0) {
    button.disabled = false;
    button.title = 'Show only channels present in search results';
  } else {
    button.disabled = true;
    button.title = 'Run a search first';
    state.showOnlyInResults = false;
  }

  // Update active state
  if (state.showOnlyInResults) {
    button.classList.add('active');
  } else {
    button.classList.remove('active');
  }
}

/**
 * Update channels present in current search results
 * @param {Array} results - Array of search result programs
 */
export function updateChannelsInResults(results) {
  state.channelsInResults.clear();

  if (results && Array.isArray(results)) {
    results.forEach(program => {
      if (program.channelId) {
        state.channelsInResults.add(program.channelId);
      }
    });
  }

  // Reset toggle if no results
  if (state.channelsInResults.size === 0) {
    state.showOnlyInResults = false;
  }

  updateShowInResultsButton();

  // Re-render if popup is open
  if (state.isOpen) {
    renderChannelList();
  }
}

/**
 * Apply quick filter
 * @param {string} filter - Quick filter type
 */
function applyQuickFilter(filter) {
  // Map filter to category key
  const filterToCategory = {
    'all-hd': 'hd',
    'news': 'news',
    'movies': 'movies',
    'general': 'general'
  };

  const categoryKey = filterToCategory[filter];
  if (!categoryKey) return;

  const categoryChannels = state.groupedChannels[categoryKey];

  // Check if category has channels before clearing selection
  if (!categoryChannels || categoryChannels.length === 0) {
    showValidationError(`No ${categoryKey} channels available`);
    return;
  }

  // Safe to clear and select category channels
  state.selectedChannels.clear();
  categoryChannels.forEach(c => state.selectedChannels.add(c.id));

  renderChannelList();
  updateSelectionCount();
}

/**
 * Toggle group collapse state
 * @param {string} groupKey - Group key
 */
function toggleGroup(groupKey) {
  if (state.collapsedGroups.has(groupKey)) {
    state.collapsedGroups.delete(groupKey);
  } else {
    state.collapsedGroups.add(groupKey);
  }
  renderChannelList();
}

/**
 * Toggle group selection (select/deselect all in group)
 * @param {string} groupKey - Group key
 */
function toggleGroupSelection(groupKey) {
  const groupChannels = state.groupedChannels[groupKey] || [];
  const allSelected = groupChannels.every(c => state.selectedChannels.has(c.id));

  if (allSelected) {
    // Deselect all in group
    groupChannels.forEach(c => state.selectedChannels.delete(c.id));
  } else {
    // Select all in group
    groupChannels.forEach(c => state.selectedChannels.add(c.id));
  }

  renderChannelList();
  updateSelectionCount();
}

/**
 * Toggle individual channel selection
 * @param {string} channelId - Channel ID
 */
function toggleChannel(channelId) {
  if (state.selectedChannels.has(channelId)) {
    state.selectedChannels.delete(channelId);
  } else {
    state.selectedChannels.add(channelId);
  }

  renderChannelList();
  updateSelectionCount();
}

/**
 * Update selection count display and validate
 */
function updateSelectionCount() {
  const countElement = document.getElementById('channelSelectionCount');
  if (countElement) {
    countElement.textContent = `${state.selectedChannels.size} / ${state.channels.length} selected`;
  }

  // Validate selection
  if (state.selectedChannels.size === 0) {
    showValidationError('Select at least 1 channel');
  } else {
    hideValidationError();
  }
}

/**
 * Update the filter button badge
 */
function updateButtonBadge() {
  const badge = document.getElementById('channelFilterBadge');
  if (badge) {
    const selected = state.selectedChannels.size;
    const total = state.channels.length;

    if (total === 0) {
      badge.textContent = '';
      badge.style.display = 'none';
    } else if (selected === total) {
      badge.textContent = 'All';
      badge.style.display = 'inline';
    } else {
      badge.textContent = `${selected}/${total}`;
      badge.style.display = 'inline';
    }
  }
}

/**
 * Render the channel list in the popup
 */
function renderChannelList() {
  const container = document.getElementById('channelListContainer');
  if (!container) return;

  container.innerHTML = '';

  const filterText = state.filterText.toLowerCase();

  // Get category display order
  const categoryOrder = ['hd', 'news', 'movies', 'sports', 'kids', 'general'];
  const categoryNames = {
    hd: 'HD Channels',
    news: 'News',
    movies: 'Movies',
    sports: 'Sports',
    kids: 'Kids',
    general: 'General'
  };

  categoryOrder.forEach(groupKey => {
    const channels = state.groupedChannels[groupKey];
    if (!channels || channels.length === 0) return;

    // Filter channels by search text and "show in results" toggle
    let filteredChannels = channels;

    // Apply text filter
    if (filterText) {
      filteredChannels = filteredChannels.filter(c => c.name.toLowerCase().includes(filterText));
    }

    // Apply "show only in results" filter
    if (state.showOnlyInResults && state.channelsInResults.size > 0) {
      filteredChannels = filteredChannels.filter(c => state.channelsInResults.has(c.id));
    }

    if (filteredChannels.length === 0) return;

    // Create group element
    const groupElement = document.createElement('div');
    groupElement.className = 'channel-group';

    // Calculate group selection state
    const selectedInGroup = filteredChannels.filter(c => state.selectedChannels.has(c.id)).length;
    const allSelected = selectedInGroup === filteredChannels.length;
    const someSelected = selectedInGroup > 0 && selectedInGroup < filteredChannels.length;

    const isCollapsed = state.collapsedGroups.has(groupKey);

    // Group header
    const header = document.createElement('div');
    header.className = 'channel-group-header';
    header.innerHTML = `
      <div class="channel-group-checkbox-wrapper">
        <input type="checkbox"
               class="channel-group-checkbox"
               id="group-${groupKey}"
               ${allSelected ? 'checked' : ''}
               ${someSelected ? 'data-indeterminate="true"' : ''}>
        <label for="group-${groupKey}" class="channel-group-label">
          <span class="channel-group-toggle ${isCollapsed ? 'collapsed' : ''}">${isCollapsed ? '+' : '-'}</span>
          <span class="channel-group-name">${categoryNames[groupKey]}</span>
          <span class="channel-group-count">(${selectedInGroup}/${filteredChannels.length})</span>
        </label>
      </div>
    `;

    // Handle indeterminate state
    const checkbox = header.querySelector('.channel-group-checkbox');
    if (someSelected) {
      checkbox.indeterminate = true;
    }

    // Group checkbox click
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleGroupSelection(groupKey);
    });

    // Group header click (toggle collapse)
    const label = header.querySelector('.channel-group-label');
    label.addEventListener('click', (e) => {
      e.preventDefault();
      toggleGroup(groupKey);
    });

    groupElement.appendChild(header);

    // Channel list (if not collapsed)
    if (!isCollapsed) {
      const list = document.createElement('div');
      list.className = 'channel-list';

      filteredChannels.forEach(channel => {
        const isSelected = state.selectedChannels.has(channel.id);

        const item = document.createElement('div');
        item.className = 'channel-item';
        item.innerHTML = `
          <label class="channel-item-label">
            <input type="checkbox"
                   class="channel-checkbox"
                   value="${channel.id}"
                   ${isSelected ? 'checked' : ''}>
            <span class="channel-name">${escapeHtml(channel.name)}</span>
          </label>
        `;

        // Channel checkbox click
        const channelCheckbox = item.querySelector('.channel-checkbox');
        channelCheckbox.addEventListener('change', () => {
          toggleChannel(channel.id);
        });

        list.appendChild(item);
      });

      groupElement.appendChild(list);
    }

    container.appendChild(groupElement);
  });

  // Update selection count
  updateSelectionCount();
}

/**
 * Get array of selected channel IDs
 * @returns {Array} - Array of selected channel IDs
 */
export function getSelectedChannelIds() {
  return Array.from(state.selectedChannels);
}

/**
 * Check if a channel is selected
 * @param {string} channelId - Channel ID
 * @returns {boolean} - True if selected
 */
export function isChannelSelected(channelId) {
  return state.selectedChannels.has(channelId);
}

/**
 * Save state to localStorage
 */
function saveState() {
  try {
    const data = {
      selectedChannels: Array.from(state.selectedChannels),
      collapsedGroups: Array.from(state.collapsedGroups)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('Failed to save channel filter state:', error);
  }
}

/**
 * Load state from localStorage
 * @returns {Object|null} - Saved state or null
 */
function loadSavedState() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn('Failed to load channel filter state:', error);
  }
  return null;
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
