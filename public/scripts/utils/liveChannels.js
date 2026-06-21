/**
 * liveChannels.js - Live TV Channel Loader
 * Fetches and parses the live-channel M3U playlist into a Map stored on
 * window.appState.liveChannels. Kept in its own module to avoid growing main.js.
 */

import { fetchM3uData, parseLiveM3u } from './m3uParser.js';
import { getLiveUrl, saveLiveLastUpdated } from './storage.js';

/**
 * Fetch the live-channel playlist and populate window.appState.liveChannels.
 * Non-blocking: errors are logged but never propagated to the caller.
 * If no Live URL is configured, sets liveChannels to null and returns.
 *
 * @returns {Promise<void>}
 */
export async function loadLiveChannels() {
  const url = getLiveUrl();

  if (!url) {
    window.appState.liveChannels = null;
    return;
  }

  try {
    const text = await fetchM3uData(url); // routes via /api/proxy in production
    window.appState.liveChannels = parseLiveM3u(text);
    saveLiveLastUpdated(Date.now());
    console.log(`Live channels loaded: ${window.appState.liveChannels.size}`);
  } catch (e) {
    console.error('Live channels load failed (non-blocking):', e);
  }
}
