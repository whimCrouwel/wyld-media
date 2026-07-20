import { describe, it, expect } from 'vitest';
import { buildAreaLinks } from '../src/lib/sidebar';

describe('buildAreaLinks', () => {
  it('地域ごとに件数を数え、北から南の順で返す', () => {
    const links = buildAreaLinks(['関東', '北海道', '関東', '甲信越']);
    expect(links).toEqual([
      { region: '北海道', slug: 'hokkaido', href: '/areas/hokkaido', count: 1 },
      { region: '関東', slug: 'kanto', href: '/areas/kanto', count: 2 },
      { region: '甲信越', slug: 'koshinetsu', href: '/areas/koshinetsu', count: 1 },
    ]);
  });

  it('記事のない地域は落とす', () => {
    const links = buildAreaLinks(['沖縄']);
    expect(links.map((l) => l.slug)).toEqual(['okinawa']);
  });

  it('region が null の記事は数えない', () => {
    expect(buildAreaLinks([null, null])).toEqual([]);
  });
});
