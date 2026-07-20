import { describe, it, expect } from 'vitest';
import { buildAreaLinks } from '../src/lib/sidebar';
import { REGIONS } from '../src/lib/regions';

describe('buildAreaLinks', () => {
  it('地域ごとに件数を数え、北から南の順で返す', () => {
    const links = buildAreaLinks(['関東', '北海道', '関東', '甲信越']);
    const byRegion = new Map(links.map((l) => [l.region, l]));

    expect(byRegion.get('北海道')).toEqual({
      region: '北海道', slug: 'hokkaido', href: '/areas/hokkaido', count: 1,
    });
    expect(byRegion.get('関東')).toEqual({
      region: '関東', slug: 'kanto', href: '/areas/kanto', count: 2,
    });
    expect(byRegion.get('甲信越')).toEqual({
      region: '甲信越', slug: 'koshinetsu', href: '/areas/koshinetsu', count: 1,
    });
  });

  // 地図は地域を1つでも欠くと日本の形として成立しないので、
  // チップ時代と違って0件の地域も返す(描画側が淡色・リンクなしにする)。
  it('記事のない地域も件数0で返す', () => {
    const links = buildAreaLinks(['沖縄']);

    expect(links.map((l) => l.region)).toEqual([...REGIONS]);
    expect(links.find((l) => l.region === '沖縄')?.count).toBe(1);
    expect(links.find((l) => l.region === '北海道')?.count).toBe(0);
  });

  it('region が null の記事は数えない', () => {
    const links = buildAreaLinks([null, null]);

    expect(links).toHaveLength(REGIONS.length);
    expect(links.every((l) => l.count === 0)).toBe(true);
  });
});
