import { describe, it, expect } from 'vitest';
import { usedRegions } from '../src/lib/regions';

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
