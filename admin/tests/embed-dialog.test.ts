import { describe, it, expect } from 'vitest';
import { detectEmbedProvider } from '../src/lib/embed-dialog';

describe('detectEmbedProvider', () => {
  it('detects youtube.com and youtu.be', () => {
    expect(detectEmbedProvider('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectEmbedProvider('https://youtu.be/abc')).toBe('youtube');
  });
  it('detects twitter.com and x.com', () => {
    expect(detectEmbedProvider('https://twitter.com/user/status/1')).toBe('twitter');
    expect(detectEmbedProvider('https://x.com/user/status/1')).toBe('twitter');
  });
  it('detects vimeo.com and player.vimeo.com', () => {
    expect(detectEmbedProvider('https://vimeo.com/12345')).toBe('vimeo');
    expect(detectEmbedProvider('https://player.vimeo.com/video/12345')).toBe('vimeo');
  });
  it('returns null for a bare host without www (matches the DB allowlist exactly)', () => {
    expect(detectEmbedProvider('https://youtube.com/watch?v=abc')).toBeNull();
  });
  it('returns null for a disallowed host', () => {
    expect(detectEmbedProvider('https://evil.example/embed/1')).toBeNull();
  });
  it('returns null for an invalid url', () => {
    expect(detectEmbedProvider('not a url')).toBeNull();
  });
});
