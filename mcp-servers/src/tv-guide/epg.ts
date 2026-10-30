/**
 * epg.ts - the streaming reader of the XMLTV programme guide.
 *
 * The guide is a 140 MB XML file with 321,787 programmes; a DOM would not
 * fit comfortably into the memory, and the web app's `DOMParser` does not
 * exist in Node (iptv-mcp-servers.md §2.2). The file is therefore read as
 * a stream and fed to a streaming XML parser.
 *
 * The parser is **saxes** (chosen in phase T1; the benchmark and the
 * reasons are recorded in tv-guide-server.md §10 T1: about 2.5 times
 * faster than `sax` on the real file, a smaller memory footprint, strict,
 * and it reports broken input instead of guessing).
 *
 * The import consumes two callbacks: one per `<channel>` and one per
 * `<programme>`. The programmes stream through; nothing of them is held.
 */

import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { SaxesParser } from 'saxes';

import { stripBom } from '../shared/m3u.ts';

/** A `<channel>` element of the guide. */
export interface EpgChannel {
  id: string;
  /** The first `<display-name>`. */
  name: string;
  /** The `src` of the first `<icon>`. */
  icon: string;
}

/** A `<programme>` element of the guide. */
export interface EpgProgramme {
  channel: string;
  /** The `start` attribute, exactly as written (`20260614091000 +0300`). */
  startRaw: string;
  /** The `stop` attribute, exactly as written. */
  stopRaw: string;
  /** The first `<title>`. */
  title: string;
  /** The first `<desc>`. */
  description: string;
}

/** What the guide reader calls back. */
export interface EpgHandlers {
  onChannel(channel: EpgChannel): void;
  onProgramme(programme: EpgProgramme): void;
}

/** The counts of one run of the guide reader. */
export interface EpgCounts {
  channels: number;
  programmes: number;
}

/**
 * True when a file starts with the gzip magic `1f 8b`.
 *
 * The web app always gunzips the download (epgParser.js:39); the server
 * accepts gzip **and** plain XML and detects by the first two bytes
 * (design: tv-guide-server.md §5 step 3).
 */
export async function fileIsGzip(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(2);
    const { bytesRead } = await handle.read(buffer, 0, 2, 0);
    return bytesRead === 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

/**
 * True when a head of a file starts with the gzip magic.
 *
 * The download check uses this on the raw head bytes: the magic does not
 * survive the UTF-8 decoding of the text head.
 */
export function headIsGzip(headBytes: Buffer): boolean {
  return headBytes.length >= 2 && headBytes[0] === 0x1f && headBytes[1] === 0x8b;
}

/**
 * The check of the download (design §9): after the optional gunzip the
 * text must start — after a BOM or whitespace — with `<?xml` or `<tv`,
 * and it must contain `<tv`. A gzip file passes when the magic is there;
 * the XML check happens when it is decompressed.
 *
 * @returns the reason the file is not a guide, or null when it can be one.
 */
export function validateEpgHead(head: string, headBytes: Buffer): string | null {
  if (headIsGzip(headBytes)) return null;

  const text = stripBom(head).replace(/^\s+/, '');
  if (!text.startsWith('<?xml') && !text.startsWith('<tv')) {
    return 'the file does not start with XML';
  }
  if (!text.includes('<tv')) {
    return 'the file holds no <tv> element';
  }
  return null;
}

/**
 * Open an EPG file as a stream of text, gunzipping it when the magic is
 * there.
 *
 * The errors of the file stream travel through the gunzip stream, so that
 * a read failure fails the read instead of hanging or vanishing. The
 * caller destroys the stream it gets when it is done with it (or when the
 * parse failed), so that no file handle is left open.
 */
export async function openEpgTextStream(path: string): Promise<Readable> {
  if (!(await fileIsGzip(path))) {
    return createReadStream(path, { encoding: 'utf8' });
  }

  const gunzip = createGunzip();
  gunzip.setEncoding('utf8');
  const file = createReadStream(path);
  // pipeline() destroys the whole chain — also the file stream, when the
  // reader destroys the gunzip stream — and rejects with the error. The
  // reader gets the error through the gunzip stream, so the rejection of
  // the pipeline promise is silenced here.
  void pipeline(file, gunzip).catch(() => {});
  return gunzip;
}

type CaptureTarget = 'display-name' | 'title' | 'desc' | null;

/**
 * The synchronous core of the guide reader.
 *
 * Chunks of XML go in through `write`; `close` ends the document and
 * returns the counts. A broken document makes `close` throw.
 */
export class EpgReader {
  private readonly parser: SaxesParser;
  private readonly handlers: EpgHandlers;
  private readonly counts: EpgCounts = { channels: 0, programmes: 0 };
  private parseError: string | null = null;

  // The state of the two elements that are read.
  private channel: EpgChannel | null = null;
  private programme: EpgProgramme | null = null;
  private capture: CaptureTarget = null;
  private captured: string[] = [];

  constructor(handlers: EpgHandlers) {
    this.handlers = handlers;

    // The position bookkeeping of the parser costs time on a guide of
    // 320,000 programmes; the error message stays clear without it.
    const parser = new SaxesParser({ position: false });
    this.parser = parser;

    parser.on('error', (error: Error) => {
      // The first error is the reason; the parser keeps going and the
      // rest of the noise stays out of the log.
      if (this.parseError === null) this.parseError = error.message;
    });

    parser.on('opentag', (element) => {
      this.onOpen(element);
    });

    parser.on('text', (textPart: string) => {
      if (this.capture !== null) this.captured.push(textPart);
    });

    // CDATA arrives as its own event, not as a text event; a guide that
    // wraps its titles in `<![CDATA[...]]>` would otherwise be stored
    // with an empty title.
    parser.on('cdata', (chunk: string) => {
      if (this.capture !== null) this.captured.push(chunk);
    });

    parser.on('closetag', (element) => {
      this.onClose(element);
    });
  }

  /** Feed one chunk of XML text. */
  write(chunk: string): void {
    this.parser.write(chunk);
  }

  /**
   * End the document.
   *
   * @returns the channels and programmes that were seen.
   * @throws when the XML was broken.
   */
  close(): EpgCounts {
    this.parser.close();
    if (this.parseError !== null) {
      throw new Error(`the guide could not be parsed: ${this.parseError}`);
    }
    return this.counts;
  }

  private onOpen(element: {
    name: string;
    attributes: unknown;
    isSelfClosing: boolean;
  }): void {
    const name = element.name;
    const attributes = element.attributes as Record<string, string>;

    if (name === 'channel' && this.programme === null) {
      // The ids are trimmed, the same way the playlist `tvg-id` is: the
      // join of the two sources runs over one value.
      this.channel = { id: (attributes['id'] ?? '').trim(), name: '', icon: '' };
      return;
    }

    if (name === 'programme') {
      this.programme = {
        channel: (attributes['channel'] ?? '').trim(),
        startRaw: (attributes['start'] ?? '').trim(),
        stopRaw: (attributes['stop'] ?? '').trim(),
        title: '',
        description: '',
      };
      return;
    }

    if (this.channel !== null && name === 'display-name' && !this.channel.name && !element.isSelfClosing) {
      this.capture = 'display-name';
      this.captured = [];
      return;
    }

    if (this.channel !== null && name === 'icon') {
      // The icon carries its value in an attribute and is usually
      // self-closing: nothing to capture.
      if (!this.channel.icon) this.channel.icon = attributes['src'] ?? '';
      return;
    }

    if (this.programme !== null && name === 'title' && !this.programme.title && !element.isSelfClosing) {
      this.capture = 'title';
      this.captured = [];
      return;
    }

    if (this.programme !== null && name === 'desc' && !this.programme.description && !element.isSelfClosing) {
      this.capture = 'desc';
      this.captured = [];
    }
  }

  private onClose(element: { name: string }): void {
    const name = element.name;

    if (this.capture !== null && name === this.capture) {
      const value = this.captured.join('');
      if (this.capture === 'display-name' && this.channel !== null && !this.channel.name) {
        this.channel.name = value.trim();
      } else if (this.capture === 'title' && this.programme !== null && !this.programme.title) {
        this.programme.title = value.trim();
      } else if (this.capture === 'desc' && this.programme !== null && !this.programme.description) {
        this.programme.description = value.trim();
      }
      this.capture = null;
      this.captured = [];
    }

    if (name === 'channel' && this.channel !== null) {
      this.counts.channels += 1;
      this.handlers.onChannel(this.channel);
      this.channel = null;
      return;
    }

    if (name === 'programme' && this.programme !== null) {
      this.counts.programmes += 1;
      this.handlers.onProgramme(this.programme);
      this.programme = null;
    }
  }
}

/**
 * Read a guide from a text stream and call the handlers.
 *
 * @throws when the XML is broken. The caller is expected to be inside a
 *   transaction that it throws back, so that a half-read guide never
 *   replaces the data in the database.
 */
export async function streamEpg(textStream: Readable, handlers: EpgHandlers): Promise<EpgCounts> {
  const reader = new EpgReader(handlers);
  let firstChunk = true;

  for await (const chunk of textStream) {
    const text = typeof chunk === 'string' ? chunk : String(chunk);
    if (firstChunk) {
      firstChunk = false;
      // A byte order mark is allowed (design §9 content check).
      reader.write(stripBom(text));
      continue;
    }
    reader.write(text);
  }

  return reader.close();
}

/**
 * Read a guide from a string of XML. The tests and the local import use
 * it; the refresh reads from a stream.
 */
export function parseEpgText(text: string, handlers: EpgHandlers): EpgCounts {
  const reader = new EpgReader(handlers);
  reader.write(stripBom(text));
  return reader.close();
}
