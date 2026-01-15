/**
 * settings.js - Settings Component
 * Manages EPG URL settings UI and interactions
 */

import { saveEpgUrl, getEpgUrl, saveManualSearchOnly, getManualSearchOnly } from '../utils/storage.js';
import {
  exportRatings,
  importRatings,
  clearAllRatings,
  getRatingStats
} from '../utils/ratings.js';

/**
 * Initialize settings component
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onSave - Called when settings are saved
 */
export function initSettings(callbacks = {}) {
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsForm = document.getElementById('settingsForm');
  const cancelButton = document.getElementById('cancelSettings');
  const epgUrlInput = document.getElementById('epgUrl');
  const openSettingsButton = document.getElementById('openSettingsButton');

  // Ratings management buttons
  const exportRatingsBtn = document.getElementById('exportRatingsBtn');
  const importRatingsBtn = document.getElementById('importRatingsBtn');
  const clearRatingsBtn = document.getElementById('clearRatingsBtn');
  const importRatingsFile = document.getElementById('importRatingsFile');

  // Manual search checkbox
  const manualSearchCheckbox = document.getElementById('manualSearchOnly');

  // Load saved URL
  loadSavedUrl();

  // Load saved manual search preference
  loadManualSearchPreference();

  // Update ratings stats
  updateRatingsStats();

  // Toggle settings panel
  settingsToggle?.addEventListener('click', toggleSettings);
  openSettingsButton?.addEventListener('click', toggleSettings);

  // Cancel button
  cancelButton?.addEventListener('click', () => {
    hideSettings();
    loadSavedUrl();
  });

  // Form submission
  settingsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSaveSettings(callbacks.onSave);
  });
  
  // Export ratings
  exportRatingsBtn?.addEventListener('click', handleExportRatings);
  
  // Import ratings
  importRatingsBtn?.addEventListener('click', () => {
    importRatingsFile?.click();
  });
  
  importRatingsFile?.addEventListener('change', handleImportRatings);
  
  // Clear ratings
  clearRatingsBtn?.addEventListener('click', handleClearRatings);
}

/**
 * Load saved URL into form
 */
function loadSavedUrl() {
  const epgUrlInput = document.getElementById('epgUrl');
  const savedUrl = getEpgUrl();

  if (savedUrl && epgUrlInput) {
    epgUrlInput.value = savedUrl;
  } else if (epgUrlInput && !epgUrlInput.value) {
    // Clear the input if no saved URL exists
    epgUrlInput.value = '';
  }
}

/**
 * Load manual search preference into checkbox
 */
function loadManualSearchPreference() {
  const manualSearchCheckbox = document.getElementById('manualSearchOnly');
  const manualSearchEnabled = getManualSearchOnly();

  if (manualSearchCheckbox) {
    manualSearchCheckbox.checked = manualSearchEnabled;
  }

  // Update appState if it exists
  if (window.appState) {
    window.appState.manualSearchOnly = manualSearchEnabled;
  }
}

/**
 * Toggle settings panel visibility
 */
function toggleSettings() {
  const settingsPanel = document.getElementById('settingsPanel');

  if (settingsPanel.style.display === 'none') {
    showSettings();
  } else {
    hideSettings();
  }
}

/**
 * Show settings panel
 */
export function showSettings() {
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsPanel) {
    settingsPanel.style.display = 'block';
    document.getElementById('epgUrl')?.focus();
  }
}

/**
 * Hide settings panel
 */
export function hideSettings() {
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsPanel) {
    settingsPanel.style.display = 'none';
  }
}

/**
 * Handle save settings
 * @param {Function} onSaveCallback - Callback function
 */
function handleSaveSettings(onSaveCallback) {
  const epgUrlInput = document.getElementById('epgUrl');
  const manualSearchCheckbox = document.getElementById('manualSearchOnly');
  const url = epgUrlInput?.value?.trim();

  if (!url) {
    showError('Please enter a valid EPG URL');
    return;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    showError('Please enter a valid URL');
    return;
  }

  // Save EPG URL to localStorage
  const urlSuccess = saveEpgUrl(url);

  // Save manual search preference
  const manualSearchEnabled = manualSearchCheckbox?.checked ?? true;
  const manualSearchSuccess = saveManualSearchOnly(manualSearchEnabled);

  // Update appState
  if (window.appState) {
    window.appState.manualSearchOnly = manualSearchEnabled;
  }

  if (urlSuccess && manualSearchSuccess) {
    hideSettings();
    showSuccess('Settings saved successfully!');

    // Call callback if provided
    if (typeof onSaveCallback === 'function') {
      onSaveCallback(url);
    }
  } else {
    showError('Failed to save settings');
  }
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  const epgUrlInput = document.getElementById('epgUrl');

  if (epgUrlInput) {
    epgUrlInput.classList.add('is-invalid');

    // Remove existing error message
    const existingError = document.querySelector('.settings-error');
    if (existingError) {
      existingError.remove();
    }

    // Add error message
    const errorElement = document.createElement('p');
    errorElement.className = 'form-error settings-error';
    errorElement.textContent = message;
    epgUrlInput.parentElement.appendChild(errorElement);

    // Remove error after 5 seconds
    setTimeout(() => {
      epgUrlInput.classList.remove('is-invalid');
      errorElement.remove();
    }, 5000);
  }
}

/**
 * Show success message
 * @param {string} message - Success message
 */
function showSuccess(message) {
  const settingsForm = document.getElementById('settingsForm');

  if (settingsForm) {
    // Remove existing message
    const existingMessage = document.querySelector('.settings-success');
    if (existingMessage) {
      existingMessage.remove();
    }

    // Add success message
    const successElement = document.createElement('p');
    successElement.className = 'form-success settings-success';
    successElement.textContent = message;
    settingsForm.appendChild(successElement);

    // Remove message after 3 seconds
    setTimeout(() => {
      successElement.remove();
    }, 3000);
  }
}

/**
 * Check if EPG URL is configured
 * @returns {boolean} - Whether URL is configured
 */
export function hasConfiguredUrl() {
  const url = getEpgUrl();
  return url !== null && url.trim().length > 0;
}

/**
 * Handle export ratings
 */
function handleExportRatings() {
  try {
    const json = exportRatings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `epg-ratings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showSuccess('Ratings exported successfully!');
  } catch (error) {
    console.error('Export failed:', error);
    showError('Failed to export ratings');
  }
}

/**
 * Handle import ratings
 * @param {Event} event - File input change event
 */
function handleImportRatings(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = e.target.result;
      const success = importRatings(json);
      
      if (success) {
        showSuccess('Ratings imported successfully!');
        updateRatingsStats();
        
        // Refresh current results if any
        if (window.appState?.currentResults?.length > 0) {
          const performSearch = window.performSearch;
          if (typeof performSearch === 'function') {
            performSearch();
          }
        }
      } else {
        showError('Invalid ratings file format');
      }
    } catch (error) {
      console.error('Import failed:', error);
      showError('Failed to import ratings');
    }
    
    // Reset file input
    event.target.value = '';
  };
  
  reader.readAsText(file);
}

/**
 * Handle clear ratings
 */
function handleClearRatings() {
  if (!confirm('Are you sure you want to clear all ratings? This cannot be undone.')) {
    return;
  }
  
  try {
    const success = clearAllRatings();
    
    if (success) {
      showSuccess('All ratings cleared');
      updateRatingsStats();
      
      // Refresh current results if any
      if (window.appState?.currentResults?.length > 0) {
        const performSearch = window.performSearch;
        if (typeof performSearch === 'function') {
          performSearch();
        }
      }
    } else {
      showError('Failed to clear ratings');
    }
  } catch (error) {
    console.error('Clear failed:', error);
    showError('Failed to clear ratings');
  }
}

/**
 * Update ratings statistics display
 */
function updateRatingsStats() {
  const statsElement = document.getElementById('ratingsStats');
  if (!statsElement) return;
  
  const stats = getRatingStats();
  
  if (stats.total === 0) {
    statsElement.innerHTML = '<p class="text-small text-light">No ratings yet</p>';
    return;
  }
  
  statsElement.innerHTML = `
    <div class="rating-stats">
      <div class="rating-stat-row">
        <span class="rating-stat-label">Total Ratings:</span>
        <span class="rating-stat-value">${stats.total}</span>
      </div>
      <div class="rating-stat-row">
        <span class="rating-stat-label">Average Rating:</span>
        <span class="rating-stat-value">${stats.average.toFixed(1)} ★</span>
      </div>
    </div>
  `;
}
