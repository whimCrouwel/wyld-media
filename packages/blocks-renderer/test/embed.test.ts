// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateHTML } from '@tiptap/html';
import { blockExtensions } from '../src/extensions';
import { renderBlocksToHtml } from '../src/render';

const embed = (url: string, provider: string) => ({
  type: 'embed',
  attrs: { url, provider },
});

describe('embed iframe', () => {
  it('YouTube埋め込みは referrer(origin)を送る。no-referrer だと ' +
     'YouTube 側が Error 153(player configuration error)で再生を拒否する', () => {
    const html = generateHTML(
      { type: 'doc', content: [embed('https://www.youtube.com/embed/abc123', 'youtube')] },
      blockExtensions,
    );
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(html).not.toContain('no-referrer');
  });

  it('sanitize 後(公開サイトのHTML)でも referrerpolicy が残る', async () => {
    const html = await renderBlocksToHtml(
      { type: 'doc', content: [embed('https://www.youtube.com/embed/abc123', 'youtube')] },
      'https://img.test',
    );
    expect(html).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });
});
