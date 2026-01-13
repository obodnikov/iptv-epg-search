/**
 * epgParser.js - EPG XML Parsing and Decompression Utility
 * Handles fetching, decompressing, and parsing gzipped EPG XML data
 */

/**
 * Fetch and decompress gzipped EPG data
 * @param {string} url - URL to gzipped EPG XML file
 * @returns {Promise<string>} - Decompressed XML string
 */
export async function fetchEpgData(url) {
  try {
    // Fetch the gzipped file
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Get the response as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Convert ArrayBuffer to Uint8Array
    const compressedData = new Uint8Array(arrayBuffer);

    // Decompress using pako
    if (typeof pako === 'undefined') {
      throw new Error('Pako library not loaded');
    }

    const decompressed = pako.inflate(compressedData, { to: 'string' });

    return decompressed;
  } catch (error) {
    console.error('Error fetching EPG data:', error);

    // Provide user-friendly error messages
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Failed to fetch EPG data. This might be a CORS issue. The EPG server may not allow cross-origin requests.');
    } else if (error.message.includes('HTTP error')) {
      throw new Error(`Failed to download EPG file: ${error.message}`);
    } else if (error.message.includes('Pako')) {
      throw new Error('Failed to decompress EPG data. Make sure the file is gzipped.');
    }

    throw error;
  }
}

/**
 * Parse EPG XML string into structured data
 * @param {string} xmlString - XML string to parse
 * @returns {Object} - Parsed EPG data with channels and programs
 */
export function parseEpgXml(xmlString) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // Check for parsing errors
    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('XML parsing error: ' + parserError.textContent);
    }

    // Extract channels
    const channels = {};
    const channelElements = xmlDoc.querySelectorAll('channel');

    channelElements.forEach(channel => {
      const id = channel.getAttribute('id');
      const displayName = channel.querySelector('display-name');

      if (id && displayName) {
        channels[id] = {
          id,
          name: displayName.textContent.trim()
        };
      }
    });

    // Extract programs
    const programs = [];
    const programElements = xmlDoc.querySelectorAll('programme');

    programElements.forEach(program => {
      const channelId = program.getAttribute('channel');
      const start = program.getAttribute('start');
      const stop = program.getAttribute('stop');
      const title = program.querySelector('title');
      const desc = program.querySelector('desc');

      if (channelId && start && stop && title) {
        programs.push({
          channelId,
          channelName: channels[channelId]?.name || channelId,
          title: title.textContent.trim(),
          description: desc ? desc.textContent.trim() : '',
          start: parseEpgTime(start),
          stop: parseEpgTime(stop),
          startRaw: start,
          stopRaw: stop
        });
      }
    });

    return {
      channels: Object.values(channels),
      programs,
      totalChannels: Object.keys(channels).length,
      totalPrograms: programs.length
    };
  } catch (error) {
    console.error('Error parsing EPG XML:', error);
    throw new Error('Failed to parse EPG XML: ' + error.message);
  }
}

/**
 * Parse EPG time format (YYYYMMDDHHmmss +ZZZZ) to JavaScript Date
 * @param {string} epgTime - EPG time string
 * @returns {Date} - JavaScript Date object
 */
function parseEpgTime(epgTime) {
  try {
    // Format: 20240115103000 +0000
    // or just: 20240115103000
    const timeStr = epgTime.split(' ')[0];

    const year = parseInt(timeStr.substring(0, 4), 10);
    const month = parseInt(timeStr.substring(4, 6), 10) - 1; // JS months are 0-indexed
    const day = parseInt(timeStr.substring(6, 8), 10);
    const hour = parseInt(timeStr.substring(8, 10), 10);
    const minute = parseInt(timeStr.substring(10, 12), 10);
    const second = parseInt(timeStr.substring(12, 14), 10);

    return new Date(year, month, day, hour, minute, second);
  } catch (error) {
    console.error('Error parsing EPG time:', epgTime, error);
    return new Date();
  }
}

/**
 * Format Date object to readable string
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDateTime(date) {
  if (!(date instanceof Date) || isNaN(date)) {
    return 'Invalid date';
  }

  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };

  return date.toLocaleString('en-US', options);
}

/**
 * Format time range for display
 * @param {Date} start - Start date
 * @param {Date} stop - Stop date
 * @returns {string} - Formatted time range
 */
export function formatTimeRange(start, stop) {
  if (!(start instanceof Date) || !(stop instanceof Date)) {
    return 'Invalid time range';
  }

  const isSameDay = start.toDateString() === stop.toDateString();

  if (isSameDay) {
    const date = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const startTime = start.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const stopTime = stop.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `${date} • ${startTime} - ${stopTime}`;
  } else {
    return `${formatDateTime(start)} - ${formatDateTime(stop)}`;
  }
}

/**
 * Get program status (past, current, future)
 * @param {Date} start - Program start time
 * @param {Date} stop - Program stop time
 * @returns {string} - Status: 'past', 'current', or 'future'
 */
export function getProgramStatus(start, stop) {
  const now = new Date();

  if (stop < now) {
    return 'past';
  } else if (start <= now && stop >= now) {
    return 'current';
  } else {
    return 'future';
  }
}
