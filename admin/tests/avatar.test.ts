import { describe, it, expect } from 'vitest';
import { toAvatarViewModel } from '../src/lib/avatar';

describe('toAvatarViewModel', () => {
  it('avatarUrl があればそのまま src に使う', () => {
    expect(toAvatarViewModel('田中 花', 'https://img.test/hana.webp')).toEqual({
      src: 'https://img.test/hana.webp', alt: '田中 花', initial: '田',
    });
  });

  it('avatarUrl が null なら名前の先頭1文字を initial にする', () => {
    expect(toAvatarViewModel('運営 太郎', null)).toEqual({
      src: null, alt: '運営 太郎', initial: '運',
    });
  });

  it('前後の空白を trim してから initial を取る', () => {
    expect(toAvatarViewModel('  花  ', null)).toEqual({
      src: null, alt: '花', initial: '花',
    });
  });

  it('名前が空文字なら initial は "?" にフォールバックする', () => {
    expect(toAvatarViewModel('', null)).toEqual({ src: null, alt: '', initial: '?' });
    expect(toAvatarViewModel('   ', null)).toEqual({ src: null, alt: '', initial: '?' });
  });
});
