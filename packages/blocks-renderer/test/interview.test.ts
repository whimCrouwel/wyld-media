// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateHTML, generateJSON } from '@tiptap/html';
import { Editor } from '@tiptap/core';
import { blockExtensions } from '../src/extensions';
import { renderBlocksToHtml } from '../src/render';

const sampleDoc = {
  type: 'doc',
  content: [
    {
      type: 'interview',
      attrs: {
        speakers: [
          { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
          { key: 'B', name: '川崎', role: 'Kaeru 代表', avatarUrl: 'https://img.test/b.webp' },
        ],
      },
      content: [
        { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'こんにちは' }] },
        { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'よろしく' }] },
      ],
    },
  ],
};

describe('interview node', () => {
  it('generates HTML with turn wrappers keyed by speaker', () => {
    const html = generateHTML(sampleDoc, blockExtensions);
    expect(html).toContain('<section');
    expect(html).toContain('class="interview-block"');
    expect(html).toContain('data-speaker="A"');
    expect(html).toContain('data-speaker="B"');
    expect(html).toContain('こんにちは');
    expect(html).toContain('よろしく');
  });

  it('roundtrips speakers attrs through JSON', () => {
    const html = generateHTML(sampleDoc, blockExtensions);
    const roundtripped = generateJSON(html, blockExtensions);
    const interview = roundtripped.content?.[0];
    expect(interview?.type).toBe('interview');
    expect(interview?.attrs?.speakers).toHaveLength(2);
    expect(interview?.attrs?.speakers?.[0]).toEqual({
      key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp',
    });
    const firstTurn = interview?.content?.[0];
    expect(firstTurn?.type).toBe('turn');
    expect(firstTurn?.attrs?.speaker).toBe('A');
  });

  it('rejects a top-level turn (schema disallows outside of interview)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let contentError: Error | null = null;
    const editor = new Editor({
      element: el,
      extensions: blockExtensions,
      enableContentCheck: true,
      onContentError: ({ error }) => { contentError = error; },
      content: {
        type: 'doc',
        content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'x' }] }],
      },
    });
    expect(contentError).not.toBeNull();  // schema rejected the top-level turn
    editor.destroy();
  });
});

describe('renderBlocksToHtml — interview', () => {
  it('preserves section/turn wrappers and data attributes after sanitize', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toContain('<section');
    expect(html).toContain('class="interview-block"');
    expect(html).toContain('data-block="interview"');
    expect(html).toContain('data-block="turn"');
    expect(html).toContain('data-speaker="A"');
    expect(html).toContain('data-speaker="B"');
    expect(html).toContain('こんにちは');
  });

  it('preserves avatar URLs inside data-speakers JSON attribute', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toMatch(/data-speakers=['"]?\[.*avatarUrl.*\]/);
  });

  it('injects avatar img and name/role spans inside each turn', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toContain('class="turn__avatar"');
    expect(html).toContain('src="https://img.test/a.webp"');
    expect(html).toContain('alt="米田"');
    expect(html).toContain('class="turn__name"');
    expect(html).toContain('米田');
    expect(html).toContain('川崎');
    expect(html).toContain('聞き手');
    expect(html).toContain('Kaeru 代表');
  });

  it('wraps each turn text in a bubble div for chat-style styling', async () => {
    const html = await renderBlocksToHtml(sampleDoc, 'https://img.test');
    expect(html).toContain('class="turn__bubble"');
    // 発話テキストが bubble の中にある
    expect(html).toMatch(/class="turn__bubble">\s*こんにちは\s*<\/div>/);
    expect(html).toMatch(/class="turn__bubble">\s*よろしく\s*<\/div>/);
  });

  it('marks consecutive same-speaker turns with turn--cont and skips avatar/name reinjection', async () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'first-a' }] },
          { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'first-b' }] },
          { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'second-b' }] },
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'back-to-a' }] },
        ],
      }],
    };
    const html = await renderBlocksToHtml(doc, 'https://img.test');
    // 連続する 2 発言目の B に turn--cont が付く
    expect(html).toMatch(/class="turn turn--B turn--cont"/);
    // 連続 B の 2 発言目には avatar / who を再注入しない
    // (bubble 内の 'second-b' 直前に turn__avatar が入っていないことを確認)
    const secondBIndex = html.indexOf('second-b');
    const firstBIndex = html.indexOf('first-b');
    const avatarBIndex = html.indexOf('src="https://img.test/b.webp"');
    expect(avatarBIndex).toBeGreaterThan(-1);
    expect(avatarBIndex).toBeLessThan(firstBIndex);        // B の avatar は 1 発言目の側にのみ
    expect(html.indexOf('src="https://img.test/b.webp"', firstBIndex + 1)).toBe(-1);
    // 話者が変わった A の 3 発言目 (back-to-a) は cont ではない
    expect(html).not.toMatch(/class="turn turn--A turn--cont"/);
    // ちゃんと bubble には全発言のテキスト
    expect(html).toContain('second-b');
    expect(html).toContain('back-to-a');
    expect(secondBIndex).toBeGreaterThan(-1);
  });

  it('trims a trailing empty paragraph so the published HTML has no stray <p></p>', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'hi' }] }],
        },
        { type: 'paragraph' },  // TrailingNode がエディタで足す空段落
      ],
    };
    const html = await renderBlocksToHtml(doc, 'https://img.test');
    expect(html).not.toMatch(/<p><\/p>\s*$/);
    expect(html.trimEnd().endsWith('</section>')).toBe(true);
  });

  it('handles speakers with <, >, & and " characters in names/roles', async () => {
    const doc = {
      type: 'doc',
      content: [{
        type: 'interview',
        attrs: {
          speakers: [
            { key: 'A', name: 'A <b>bold</b>', role: 'R & D', avatarUrl: 'https://img.test/a.webp' },
            { key: 'B', name: 'B "quote"', role: 'a>b', avatarUrl: 'https://img.test/b.webp' },
          ],
        },
        content: [
          { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'hi' }] },
          { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'hey' }] },
        ],
      }],
    };
    const html = await renderBlocksToHtml(doc, 'https://img.test');
    // Avatar injection ran (regex not broken by < > & " in names)
    expect(html).toContain('class="turn__avatar"');
    expect(html).toMatch(/src="https:\/\/img\.test\/a\.webp"/);
    expect(html).toMatch(/src="https:\/\/img\.test\/b\.webp"/);
    // Names appear escaped in the visible HTML (not as literal tags)
    expect(html).toContain('A &lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('R &amp; D');
    expect(html).toContain('B &quot;quote&quot;');
    expect(html).toContain('a&gt;b');
    // No unescaped injection
    expect(html).not.toContain('<b>bold</b>');
  });
});
