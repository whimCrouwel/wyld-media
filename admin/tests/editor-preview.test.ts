// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBlockEditor } from '../src/lib/block-editor';
import { renderPreviewHtml } from '../src/lib/editor-preview';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

describe('renderPreviewHtml', () => {
  it('matches renderBlocksToHtml for the same content', () => {
    const el = document.createElement('div');
    const content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    ];
    const editor = createBlockEditor({ element: el, content, extraExtensions: [] });
    const expected = renderBlocksToHtml({ type: 'doc', content }, 'https://img.test');
    expect(renderPreviewHtml(editor, 'https://img.test')).toBe(expected);
    editor.destroy();
  });
});
