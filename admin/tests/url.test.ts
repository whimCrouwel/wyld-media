import { describe, it, expect } from 'vitest';
import { safeUrl } from '../src/lib/url';

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('rejects javascript:, malformed, empty, non-string', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});
