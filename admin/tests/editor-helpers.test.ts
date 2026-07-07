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
});

describe('renderMarkdownPreview', () => {
  it('renders markdown and strips scripts', () => {
    const html = renderMarkdownPreview('## 見出し\n\n**強調** <script>alert(1)</script>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });
});
