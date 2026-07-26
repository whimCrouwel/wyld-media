// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { generateHTML, generateJSON } from '@tiptap/html';
import { Editor } from '@tiptap/core';
import { blockExtensions } from '../src/extensions';

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
