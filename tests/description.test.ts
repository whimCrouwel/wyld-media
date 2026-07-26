import { describe, expect, it } from 'vitest';
import { fallbackDescription } from '../src/lib/description';

describe('fallbackDescription', () => {
  it('returns empty string for empty input', () => {
    expect(fallbackDescription('')).toBe('');
    expect(fallbackDescription('   ')).toBe('');
  });

  it('strips HTML tags and collapses whitespace', () => {
    const html = '<p>森の中で<strong>鳥</strong>を  観察した。</p>';
    expect(fallbackDescription(html)).toBe('森の中で鳥を 観察した。');
  });

  it('truncates at maxLen and appends an ellipsis when longer', () => {
    const html = '<p>' + 'あ'.repeat(200) + '</p>';
    const result = fallbackDescription(html, 160);
    expect(result.endsWith('…')).toBe(true);
    // 160 body chars + the ellipsis
    expect([...result].length).toBe(161);
  });

  it('does not append an ellipsis when input already fits', () => {
    const html = '<p>短い文章です。</p>';
    expect(fallbackDescription(html, 160)).toBe('短い文章です。');
  });

  it('handles nested tags and entities', () => {
    const html = '<p>A &amp; B<br/><em>C</em></p>';
    expect(fallbackDescription(html)).toBe('A & B C');
  });
});
