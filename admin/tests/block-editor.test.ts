// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBlockEditor, getBodyBlocks } from '../src/lib/block-editor';

describe('createBlockEditor / getBodyBlocks', () => {
  it('round-trips heading and paragraph content', () => {
    const el = document.createElement('div');
    const content = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    ];
    // blockExtensions (Task 6) configures TextAlign for heading/paragraph, so the
    // shared schema stamps a default `textAlign: null` attr onto both node types
    // on serialization even though the input above didn't set one.
    const expected = [
      { type: 'heading', attrs: { level: 2, textAlign: null }, content: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: '本文' }] },
    ];
    const editor = createBlockEditor({ element: el, content, extraExtensions: [] });
    expect(getBodyBlocks(editor)).toEqual(expected);
    editor.destroy();
  });
});
