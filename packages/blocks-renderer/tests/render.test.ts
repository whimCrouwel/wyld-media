import { describe, it, expect } from 'vitest';
import { renderBlocksToHtml } from '../src/render';
import type { JSONContent } from '@tiptap/core';

const BASE = 'https://img.test';

describe('renderBlocksToHtml', () => {
  it('renders blocks and strips scripts', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '強調', marks: [{ type: 'bold' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ] };
    const html = await renderBlocksToHtml(doc, BASE);
    expect(html).toContain('<h2 id="見出し">');
    expect(html).toContain('<strong>強調</strong>');
    expect(html).not.toContain('<script');
  });

  it('許可ホストの画像は残す', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: null } },
    ] };
    expect(await renderBlocksToHtml(doc, BASE)).toContain(`src="${BASE}/x.webp"`);
  });

  it('許可ホスト以外の画像は落とす', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: 'https://evil.example/x.webp', alt: '', caption: null } },
    ] };
    expect(await renderBlocksToHtml(doc, BASE)).not.toContain('<img');
  });

  it('imageBaseUrl が空なら画像を落とす', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'image', attrs: { url: `${BASE}/x.webp`, alt: '', caption: null } },
    ] };
    expect(await renderBlocksToHtml(doc, '')).not.toContain('<img');
  });
});
