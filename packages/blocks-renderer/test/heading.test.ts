// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateHTML } from '@tiptap/html';
import { blockExtensions } from '../src/extensions';
import { renderBlocksToHtml } from '../src/render';

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

describe('heading levels', () => {
  it('supports h2 through h5 (見出し1〜4)', () => {
    const html = generateHTML(
      { type: 'doc', content: [heading(2, 'A'), heading(3, 'B'), heading(4, 'C'), heading(5, 'D')] },
      blockExtensions,
    );
    expect(html).toContain('<h2>A</h2>');
    expect(html).toContain('<h3>B</h3>');
    expect(html).toContain('<h4>C</h4>');
    expect(html).toContain('<h5>D</h5>');
  });

  it('falls back to h2 for level 1 (本文にh1は置かない)', () => {
    const html = generateHTML({ type: 'doc', content: [heading(1, 'X')] }, blockExtensions);
    expect(html).toContain('<h2>X</h2>');
    expect(html).not.toContain('<h1>');
  });

  it('renderBlocksToHtml adds anchor ids to h2-h5 and keeps them through sanitize', async () => {
    const html = await renderBlocksToHtml(
      { type: 'doc', content: [heading(2, '一'), heading(3, '二'), heading(4, '三'), heading(5, '四')] },
      'https://img.test',
    );
    expect(html).toContain('<h2 id="一">一</h2>');
    expect(html).toContain('<h3 id="二">二</h3>');
    expect(html).toContain('<h4 id="三">三</h4>');
    expect(html).toContain('<h5 id="四">四</h5>');
  });
});
