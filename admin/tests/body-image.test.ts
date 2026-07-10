import { describe, it, expect, vi } from 'vitest';
import { fitWithin } from '../src/lib/body-image';

describe('fitWithin', () => {
  it('長辺が上限以内ならそのまま', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('横長は幅を上限に合わせる', () => {
    expect(fitWithin(2400, 1800, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('縦長は高さを上限に合わせる', () => {
    expect(fitWithin(1800, 2400, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('拡大はしない', () => {
    expect(fitWithin(100, 100, 1600)).toEqual({ width: 100, height: 100 });
  });
});
