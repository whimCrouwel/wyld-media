import { describe, it, expect } from 'vitest';
import { safeUrl, parseSnsLinks, buildProfileUpdate } from '../src/lib/profile';

describe('safeUrl', () => {
  it('accepts http and https', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/x')).toBe('https://example.com/x');
  });
  it('rejects javascript: and malformed and empty', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('')).toBeNull();
  });
});

describe('parseSnsLinks', () => {
  it('splits lines, keeps safe urls, drops blanks and unsafe', () => {
    const raw = 'https://a.example\n\n javascript:bad \nhttps://b.example\nnope';
    expect(parseSnsLinks(raw)).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('buildProfileUpdate', () => {
  it('builds a payload without role or commission_code', () => {
    const payload = buildProfileUpdate({
      name: '田中 花', bio: '自己紹介',
      homepageUrl: 'https://hana.example', snsRaw: 'https://x.example',
      priceInfo: '1本 3万円', contactUrl: 'https://contact.example',
    });
    expect(payload).toEqual({
      name: '田中 花', bio: '自己紹介',
      homepage_url: 'https://hana.example',
      sns_links: ['https://x.example'],
      price_info: '1本 3万円',
      contact_url: 'https://contact.example',
    });
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('commission_code');
  });
  it('nulls out empty optional fields and unsafe urls', () => {
    const payload = buildProfileUpdate({
      name: '佐藤', bio: '', homepageUrl: 'javascript:x', snsRaw: '',
      priceInfo: '', contactUrl: '',
    });
    expect(payload.homepage_url).toBeNull();
    expect(payload.sns_links).toEqual([]);
    expect(payload.price_info).toBeNull();
    expect(payload.contact_url).toBeNull();
    expect(payload.bio).toBe('');
  });
});
