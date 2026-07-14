import { describe, it, expect } from 'vitest';
import { parseSnsLinks, buildProfileUpdate } from '../src/lib/profile';

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
      avatarUrl: 'https://img.example/hana.jpg', coverImageUrl: 'https://img.example/hana-cover.jpg',
      location: '長野県松本市',
      homepageUrl: 'https://hana.example', snsRaw: 'https://x.example',
      priceInfo: '1本 3万円', contactUrl: 'https://contact.example',
    });
    expect(payload).toEqual({
      name: '田中 花', bio: '自己紹介',
      avatar_url: 'https://img.example/hana.jpg',
      cover_image_url: 'https://img.example/hana-cover.jpg',
      location: '長野県松本市',
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
      name: '佐藤', bio: '', avatarUrl: 'javascript:x', coverImageUrl: 'javascript:x', location: '  ',
      homepageUrl: 'javascript:x', snsRaw: '',
      priceInfo: '', contactUrl: '',
    });
    expect(payload.avatar_url).toBeNull();
    expect(payload.cover_image_url).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.homepage_url).toBeNull();
    expect(payload.sns_links).toEqual([]);
    expect(payload.price_info).toBeNull();
    expect(payload.contact_url).toBeNull();
    expect(payload.bio).toBe('');
  });
});
