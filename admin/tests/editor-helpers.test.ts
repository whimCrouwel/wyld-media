import { describe, it, expect } from 'vitest';
import { translateSaveError, isValidArticleSlug, renderMarkdownPreview } from '../src/lib/editor-helpers';

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

  it('HTML_IMG_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('HTML_IMG_NOT_ALLOWED'))).toContain('<img>');
  });

  it('IMAGE_SYNTAX_NOT_ALLOWED を訳す', () => {
    expect(translateSaveError(new Error('IMAGE_SYNTAX_NOT_ALLOWED'))).toContain('/');
  });
});

describe('renderMarkdownPreview', () => {
  const BASE = 'https://img.test';

  it('markdown を描画し script を落とす', () => {
    const html = renderMarkdownPreview('## 見出し\n\n<script>alert(1)</script>', BASE);
    expect(html).toContain('<h2>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', () => {
    expect(renderMarkdownPreview(`![a](${BASE}/x.webp)`, BASE)).toContain('<img');
  });

  it('許可ホスト以外の画像は落とす', () => {
    expect(renderMarkdownPreview('![a](https://evil.example/x.webp)', BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', () => {
    expect(renderMarkdownPreview(`![a](${BASE}/x.webp)`, '')).not.toContain('<img');
  });
});
