/**
 * m3u.ts - reader for the extended M3U format.
 *
 * The provider's catalogue is an extended M3U: a `#EXTM3U` header, then one
 * `#EXTINF` block per entry with attributes, followed by optional `#EXTIMG`,
 * `#EXTDESC`, `#EXTGRP` lines and the stream URL.
 *
 * The web app's parser (public/scripts/utils/m3uParser.js) is the reference;
 * this reader keeps the raw attributes so that the cinema parser can use the
 * ones the web app ignores (`duration`, `censored`).
 */

/** One catalogue entry. */
export interface M3uEntry {
  /** Position in the file, starting at 0. */
  index: number;
  /** Line number of the `#EXTINF` line, starting at 1. */
  lineNumber: number;
  /** The number right after `#EXTINF:`, negative for episodes. */
  extinfNumber: number | null;
  /** All attributes of the `#EXTINF` line. */
  attributes: Record<string, string>;
  /** The title: everything after the last comma outside quotes. */
  title: string;
  /** `#EXTIMG` value. */
  poster: string;
  /** `#EXTDESC` value. */
  description: string;
  /** `#EXTGRP` value. */
  group: string;
  /** The stream line, exactly as it was in the file. */
  streamLine: string | null;
}

/** The whole file. */
export interface M3uDocument {
  /** Attributes of the `#EXTM3U` header line. */
  header: Record<string, string>;
  /** True when the file starts with `#EXTM3U` (a byte order mark is allowed). */
  hasHeader: boolean;
  entries: M3uEntry[];
  /** Number of `#EXTINF` blocks that had no stream line. */
  incomplete: number;
}

/**
 * Remove a byte order mark from the start of the text.
 */
export function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/**
 * Parse `key="value"` pairs out of a string.
 */
export function parseAttributeString(content: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Za-z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) attributes[key] = value;
  }
  return attributes;
}

/**
 * Index of the last comma that is not inside a quoted value, or -1.
 *
 * Attribute values may contain commas ("Комедия ,Детектив",
 * "Canada, United States of America"), so the title cannot be found with a
 * plain lastIndexOf.
 */
export function lastCommaOutsideQuotes(content: string): number {
  let inQuotes = false;
  let last = -1;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) last = i;
  }
  return last;
}

/**
 * True when the text starts with the `#EXTM3U` header.
 */
export function hasM3uHeader(text: string): boolean {
  const withoutBom = stripBom(text);
  const firstLine = withoutBom.split('\n', 1)[0]?.trim() ?? '';
  return firstLine === '#EXTM3U' || firstLine.startsWith('#EXTM3U ');
}

/**
 * Split an `#EXTINF` line into its number, its attributes and its title.
 */
export function parseExtInfLine(line: string): {
  number: number | null;
  attributes: Record<string, string>;
  title: string;
} {
  const content = line.startsWith('#EXTINF:') ? line.slice('#EXTINF:'.length) : line;

  const comma = lastCommaOutsideQuotes(content);
  const head = comma === -1 ? content : content.slice(0, comma);
  const title = comma === -1 ? '' : content.slice(comma + 1).trim();

  const numberMatch = head.match(/^\s*(-?\d+)/);
  const number = numberMatch?.[1] !== undefined ? Number.parseInt(numberMatch[1], 10) : null;

  return { number, attributes: parseAttributeString(head), title };
}

/**
 * Read an extended M3U file.
 *
 * An entry is only complete when a stream line follows it. A block without a
 * stream line is counted as incomplete and dropped, so that the caller never
 * sees an entry it cannot play.
 */
export function parseM3uText(text: string): M3uDocument {
  const withoutBom = stripBom(text);
  const lines = withoutBom.split(/\r?\n/);

  const document: M3uDocument = {
    header: {},
    hasHeader: false,
    entries: [],
    incomplete: 0,
  };

  let current: M3uEntry | null = null;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber]?.trim() ?? '';
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      document.hasHeader = true;
      document.header = parseAttributeString(line);
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      // A block that is followed by another #EXTINF had no stream line.
      if (current) document.incomplete += 1;
      const parsed = parseExtInfLine(line);
      current = {
        index: document.entries.length,
        lineNumber: lineNumber + 1,
        extinfNumber: parsed.number,
        attributes: parsed.attributes,
        title: parsed.title,
        poster: '',
        description: '',
        group: '',
        streamLine: null,
      };
      continue;
    }

    if (line.startsWith('#EXTIMG:')) {
      if (current) current.poster = line.slice('#EXTIMG:'.length).trim();
      continue;
    }

    if (line.startsWith('#EXTDESC:')) {
      if (current) current.description = line.slice('#EXTDESC:'.length).trim();
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      if (current) current.group = line.slice('#EXTGRP:'.length).trim();
      continue;
    }

    if (line.startsWith('#')) {
      // #EXTVLCOPT and friends: not used by the cinema catalogue.
      continue;
    }

    if (current) {
      current.streamLine = line;
      document.entries.push(current);
      current = null;
    }
  }

  if (current) document.incomplete += 1;

  return document;
}
