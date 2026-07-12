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

  it('youtube/vimeo embed は iframe として描画される', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'embed', attrs: { url: 'https://www.youtube.com/embed/abc123', provider: 'youtube' } },
    ] };
    const html = await renderBlocksToHtml(doc, BASE);
    expect(html).toContain('<iframe');
    expect(html).toContain('src="https://www.youtube.com/embed/abc123"');
  });

  it('twitter embed は動作しないiframeではなく、明示的なリンクとして描画される', async () => {
    const doc: JSONContent = { type: 'doc', content: [
      { type: 'embed', attrs: { url: 'https://x.com/user/status/1', provider: 'twitter' } },
    ] };
    const html = await renderBlocksToHtml(doc, BASE);
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<a');
    expect(html).toContain('href="https://x.com/user/status/1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('https://x.com/user/status/1');
  });
});
