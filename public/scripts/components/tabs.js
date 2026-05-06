/**
 * tabs.js - Tab Navigation Component
 * Manages tab switching between TV Guide and Cinema views
 */

import { saveActiveTab, getActiveTab } from '../utils/storage.js';

/**
 * Initialize tab navigation
 * @param {Object} callbacks - Event callbacks
 * @param {Function} callbacks.onTabChange - Called when active tab changes (tabId)
 */
export function initTabs(callbacks = {}) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      activateTab(tabId, tabButtons, tabPanels, callbacks.onTabChange);
    });
  });

  // Restore last active tab (with validation)
  const savedTab = getActiveTab();
  const validTabs = Array.from(tabButtons).map(btn => btn.dataset.tab);
  const tabToActivate = validTabs.includes(savedTab) ? savedTab : 'tv-guide';
  activateTab(tabToActivate, tabButtons, tabPanels, callbacks.onTabChange);
}

/**
 * Activate a specific tab
 * @param {string} tabId - Tab identifier to activate
 * @param {NodeList} tabButtons - All tab button elements
 * @param {NodeList} tabPanels - All tab panel elements
 * @param {Function} [onTabChange] - Callback when tab changes
 */
function activateTab(tabId, tabButtons, tabPanels, onTabChange) {
  // Update button states
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('tab-btn-active', isActive);
    btn.setAttribute('aria-selected', isActive.toString());
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  // Update panel visibility
  tabPanels.forEach(panel => {
    const isActive = panel.id === `tab-panel-${tabId}`;
    panel.style.display = isActive ? 'block' : 'none';
    panel.setAttribute('aria-hidden', (!isActive).toString());
  });

  // Save preference
  saveActiveTab(tabId);

  // Notify callback
  if (typeof onTabChange === 'function') {
    onTabChange(tabId);
  }
}

/**
 * Get current active tab ID
 * @returns {string} - Active tab identifier
 */
export function getActiveTabId() {
  return getActiveTab();
}
