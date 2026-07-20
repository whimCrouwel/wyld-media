import { describe, it, expect } from 'vitest';
import { usedRegions, regionSlug, regionFromSlug, REGIONS } from '../src/lib/regions';

describe('usedRegions', () => {
  it('keeps only regions in use, ordered north to south', () => {
    expect(usedRegions(['関東', '北海道', '甲信越', '関東'])).toEqual([
      '北海道',
      '関東',
      '甲信越',
    ]);
  });

  it('ignores null (region unset) and unknown values', () => {
    expect(usedRegions([null, '中部', '沖縄'])).toEqual(['沖縄']);
  });

  it('returns an empty list when nobody has a region', () => {
    expect(usedRegions([null, null])).toEqual([]);
  });
});

describe('地域slug', () => {
  it('地域名からslugを引ける', () => {
    expect(regionSlug('甲信越')).toBe('koshinetsu');
    expect(regionSlug('海外')).toBe('overseas');
  });

  it('slugから地域名に戻せる', () => {
    expect(regionFromSlug('kanto')).toBe('関東');
    expect(regionFromSlug('okinawa')).toBe('沖縄');
  });

  it('未知のslugは null', () => {
    expect(regionFromSlug('atlantis')).toBeNull();
    expect(regionFromSlug('')).toBeNull();
  });

  it('12区分すべてに重複のないslugがある', () => {
    const slugs = REGIONS.map(regionSlug);
    expect(slugs).toHaveLength(12);
    expect(new Set(slugs).size).toBe(12);
    for (const s of slugs) expect(s).toMatch(/^[a-z]+$/);
  });

  it('往復して元に戻る', () => {
    for (const r of REGIONS) expect(regionFromSlug(regionSlug(r))).toBe(r);
  });
});
