import { describe, it, expect } from 'vitest';
import { parseSnsLinks, buildProfileUpdate, getProfileFieldLabels } from '../src/lib/profile';

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
      region: '甲信越', location: '長野県松本市',
      homepageUrl: 'https://hana.example', snsRaw: 'https://x.example',
      contactUrl: 'https://contact.example',
      serviceName: '流域再生プログラム', serviceDescription: '荒廃林の再生を支援します',
      serviceUrl: 'https://forest.example/service', serviceImageUrl: 'https://img.example/service.jpg',
    });
    expect(payload).toEqual({
      name: '田中 花', bio: '自己紹介',
      avatar_url: 'https://img.example/hana.jpg',
      cover_image_url: 'https://img.example/hana-cover.jpg',
      region: '甲信越', location: '長野県松本市',
      homepage_url: 'https://hana.example',
      sns_links: ['https://x.example'],
      contact_url: 'https://contact.example',
      service_name: '流域再生プログラム',
      service_description: '荒廃林の再生を支援します',
      service_url: 'https://forest.example/service',
      service_image_url: 'https://img.example/service.jpg',
    });
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('commission_code');
    expect(payload).not.toHaveProperty('price_info');
  });
  it('nulls out empty optional fields and unsafe urls', () => {
    const payload = buildProfileUpdate({
      name: '佐藤', bio: '', avatarUrl: 'javascript:x', coverImageUrl: 'javascript:x',
      region: '', location: '  ',
      homepageUrl: 'javascript:x', snsRaw: '',
      contactUrl: '',
      serviceName: '', serviceDescription: '', serviceUrl: 'javascript:x', serviceImageUrl: 'javascript:x',
    });
    expect(payload.avatar_url).toBeNull();
    expect(payload.cover_image_url).toBeNull();
    expect(payload.region).toBeNull();
    expect(payload.location).toBeNull();
    expect(payload.homepage_url).toBeNull();
    expect(payload.sns_links).toEqual([]);
    expect(payload.contact_url).toBeNull();
    expect(payload.bio).toBe('');
    expect(payload.service_name).toBeNull();
    expect(payload.service_description).toBeNull();
    expect(payload.service_url).toBeNull();
    expect(payload.service_image_url).toBeNull();
  });
  it('drops a region that is not in the list', () => {
    const payload = buildProfileUpdate({
      name: '佐藤', bio: '', avatarUrl: '', coverImageUrl: '',
      region: '中部', location: '',
      homepageUrl: '', snsRaw: '', contactUrl: '',
      serviceName: '', serviceDescription: '', serviceUrl: '', serviceImageUrl: '',
    });
    expect(payload.region).toBeNull();
  });
});

describe('getProfileFieldLabels', () => {
  it('uses writer-oriented labels and shows contact + pricing tab for a writer', () => {
    const labels = getProfileFieldLabels('writer', false);
    expect(labels.name).toBe('名前');
    expect(labels.bio).toBe('自己紹介');
    expect(labels.avatar).toBe('顔写真');
    expect(labels.showContactUrl).toBe(true);
    expect(labels.showPricingTab).toBe(true);
    expect(labels.showServiceTab).toBe(false);
  });
  it('uses org-oriented labels, hides contact + pricing, shows service tab for a certified provider', () => {
    const labels = getProfileFieldLabels('provider', true);
    expect(labels.name).toBe('会社・団体名');
    expect(labels.bio).toBe('事業内容');
    expect(labels.avatar).toBe('ロゴ画像');
    expect(labels.showContactUrl).toBe(false);
    expect(labels.showPricingTab).toBe(false);
    expect(labels.showServiceTab).toBe(true);
    expect(labels.certified).toBe(true);
  });
  it('hides the service tab for a not-yet-certified provider', () => {
    const labels = getProfileFieldLabels('provider', false);
    expect(labels.showServiceTab).toBe(false);
    expect(labels.showPricingTab).toBe(false);
    expect(labels.certified).toBe(false);
  });
  it('falls back to writer-oriented labels for admin (but no pricing tab)', () => {
    const labels = getProfileFieldLabels('admin', false);
    expect(labels.name).toBe('名前');
    expect(labels.showContactUrl).toBe(true);
    // admin は自分の記事も料金も持たないので、料金プランタブは出さない。
    expect(labels.showPricingTab).toBe(false);
    expect(labels.showServiceTab).toBe(false);
  });
});
