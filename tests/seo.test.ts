import { describe, expect, it } from 'vitest';
import { absoluteUrl, toIsoDate } from '../src/lib/seo';

describe('toIsoDate', () => {
  it('returns null for null/undefined', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });

  it('returns null for empty string or invalid date', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });

  it('converts a timestamptz string to ISO 8601', () => {
    expect(toIsoDate('2026-07-01 09:30:00+00')).toBe('2026-07-01T09:30:00.000Z');
  });

  it('accepts a Date object', () => {
    expect(toIsoDate(new Date('2026-07-01T00:00:00Z'))).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('absoluteUrl', () => {
  it('joins a pathname to a site URL', () => {
    expect(absoluteUrl('/articles/foo', 'https://wyld-media.vercel.app'))
      .toBe('https://wyld-media.vercel.app/articles/foo');
  });

  it('preserves a trailing slash when present', () => {
    expect(absoluteUrl('/', 'https://wyld-media.vercel.app'))
      .toBe('https://wyld-media.vercel.app/');
  });

  it('handles a site value that is already a URL object', () => {
    expect(absoluteUrl('/writers/hana', new URL('https://wyld-media.vercel.app')))
      .toBe('https://wyld-media.vercel.app/writers/hana');
  });

  it('collapses double slashes at the join', () => {
    expect(absoluteUrl('/articles/foo', 'https://wyld-media.vercel.app/'))
      .toBe('https://wyld-media.vercel.app/articles/foo');
  });
});
