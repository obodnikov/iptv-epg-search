/**
 * sanitize.js - Shared HTML/attribute escaping and URL sanitization helpers.
 * Use these in any new code that builds dynamic HTML or inserts user-controlled URLs.
 *
 * NOTE: cinemaTab.js has its own local copies of these helpers (not migrated — out of scope).
 */

/**
 * Escape a string for safe insertion as HTML text content.
 * @param {string|null|undefined} str - Value to escape
 * @returns {string} - HTML-escaped string
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * Escape a string for safe insertion inside an HTML attribute value (double-quoted).
 * @param {string|null|undefined} str - Value to escape
 * @returns {string} - Attribute-safe escaped string
 */
export function escapeAttr(str) {
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
 * Sanitize a URL — only allow http:// and https:// protocols.
 * Rejects javascript:, data:, vbscript:, and other dangerous schemes.
 * @param {string} url - URL to sanitize
 * @returns {string|null} - Sanitized URL, or null if the scheme is unsafe
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return null;
}
