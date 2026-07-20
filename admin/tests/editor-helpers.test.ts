import { describe, it, expect } from 'vitest';
import { translateSaveError, isValidArticleSlug } from '../src/lib/editor-helpers';

describe('isValidArticleSlug', () => {
  it('accepts lowercase-hyphen slugs', () => {
    expect(isValidArticleSlug('forest-2026')).toBe(true);
    expect(isValidArticleSlug('abc')).toBe(true);
  });
  it('rejects uppercase, spaces, leading/trailing/double hyphen, empty', () => {
    expect(isValidArticleSlug('Bad')).toBe(false);
    expect(isValidArticleSlug('a b')).toBe(false);
    expect(isValidArticleSlug('-x')).toBe(false);
    expect(isValidArticleSlug('x-')).toBe(false);
    expect(isValidArticleSlug('a--b')).toBe(false);
    expect(isValidArticleSlug('')).toBe(false);
  });
});

describe('translateSaveError', () => {
  it('maps known trigger error strings to Japanese', () => {
    expect(translateSaveError({ message: 'POST_INTERVAL_NOT_ELAPSED: ...' })).toMatch(/期間/);
    expect(translateSaveError({ message: 'INVALID_COMMISSION_CODE: ...' })).toMatch(/依頼者コード/);
    expect(translateSaveError({ message: 'COMMISSION_UNLINK_REQUIRES_UNPUBLISH: ...' })).toMatch(/下書き/);
  });
  it('maps unique-violation code 23505 to a slug message', () => {
    expect(translateSaveError({ code: '23505', message: 'duplicate key ... articles_slug_key' })).toMatch(/スラッグ/);
  });
  it('falls back to a generic message for unknown errors', () => {
    expect(translateSaveError({ message: 'something else' })).toMatch(/保存/);
    expect(translateSaveError(null)).toMatch(/保存/);
  });

  it('IMAGE_LIMIT_EXCEEDED を訳す', () => {
    expect(translateSaveError(new Error('IMAGE_LIMIT_EXCEEDED'))).toContain('5枚');
  });

  it('IMAGE_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('IMAGE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
  });

  it('FILE_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('FILE_HOST_NOT_ALLOWED'))).toContain('許可されていない');
  });
  it('EMBED_HOST_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('EMBED_HOST_NOT_ALLOWED'))).toContain('YouTube');
  });
  it('BODY_EMPTY_ON_PUBLISH を訳す', () => {
    expect(translateSaveError(new Error('BODY_EMPTY_ON_PUBLISH'))).toContain('本文');
  });

  it('取材地なしの公開を日本語で説明する', () => {
    expect(translateSaveError({ code: '23514', message: 'published_requires_region' }))
      .toBe('公開するには取材地を選んでください。');
  });
});
