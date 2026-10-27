import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { maskUrl, maskUrlsInText, sanitizeUrl } from '../../src/shared/links.ts';

describe('sanitizeUrl', () => {
  it('keeps http and https URLs', () => {
    assert.equal(sanitizeUrl('http://example.invalid/a.m3u8'), 'http://example.invalid/a.m3u8');
    assert.equal(sanitizeUrl('https://example.invalid/a.m3u8'), 'https://example.invalid/a.m3u8');
  });

  it('accepts the scheme in any case', () => {
    // checkSourceUrl reads the scheme with new URL(), which lower cases it.
    assert.equal(sanitizeUrl('HTTP://example.invalid/a'), 'HTTP://example.invalid/a');
    assert.equal(sanitizeUrl('Https://example.invalid/a'), 'Https://example.invalid/a');
  });

  it('trims the URL', () => {
    assert.equal(sanitizeUrl('  https://example.invalid/a  '), 'https://example.invalid/a');
  });

  it('rejects every other scheme', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('data:text/html,<script>'), null);
    assert.equal(sanitizeUrl('vbscript:msgbox'), null);
    assert.equal(sanitizeUrl('file:///etc/passwd'), null);
    assert.equal(sanitizeUrl('ftp://example.invalid/a'), null);
  });

  it('rejects a URL that only starts with the scheme later', () => {
    assert.equal(sanitizeUrl('fmpeg http://example.invalid/a.m3u8'), null);
  });

  it('rejects empty and non-string values', () => {
    assert.equal(sanitizeUrl(''), null);
    assert.equal(sanitizeUrl(null), null);
    assert.equal(sanitizeUrl(undefined), null);
  });
});

describe('maskUrl', () => {
  it('keeps scheme and host and hides the tail', () => {
    const masked = maskUrl('https://s03.example.invalid/hls/abc123.m3u8?token=f8b2');
    assert.ok(masked.startsWith('https://s03.example.invalid'), masked);
    assert.ok(masked.endsWith('f8b2'), masked);
    assert.ok(!masked.includes('abc123'), masked);
    assert.ok(!masked.includes('token='), masked);
  });

  it('hides a short URL completely', () => {
    // Only the scheme and the host stay visible; there is no tail to show.
    assert.equal(maskUrl('http://a.co'), 'http://a.co/…');
  });

  it('hides the key of a URL with a query', () => {
    const masked = maskUrl('http://example.invalid/x?token=SECRET');
    assert.ok(!masked.includes('SECRET'), masked);
    assert.ok(!masked.includes('token='), masked);
  });

  it('does not throw on a broken URL', () => {
    assert.equal(typeof maskUrl('not a url'), 'string');
  });

  it('masks every URL of a text', () => {
    const masked = maskUrlsInText('loading http://s03.example.invalid/x/abc123.m3u8 now');
    assert.ok(!masked.includes('abc123'), masked);
    assert.ok(masked.includes('loading'), masked);
  });

  it('masks a URL with an upper case scheme', () => {
    const masked = maskUrlsInText('loading HTTP://s03.example.invalid/x/abc123.m3u8?token=SECRET');
    assert.ok(!masked.includes('SECRET'), masked);
    assert.ok(!masked.includes('abc123'), masked);
  });
});
