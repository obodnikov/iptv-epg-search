/**
 * settings.js - Settings Component
 * Manages EPG URL settings UI and interactions
 */

import { saveEpgUrl, getEpgUrl } from '../utils/storage.js';

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

  // Load saved URL
  loadSavedUrl();

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
    // Set default URL if none exists
    epgUrlInput.value = 'http://s03.wsbof.com:8080/xml/4a27b28d.gz';
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

  // Save to localStorage
  const success = saveEpgUrl(url);

  if (success) {
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
