// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CharacterCount } from '@tiptap/extension-character-count';
import { formatCharCount, initCharCount } from '../src/lib/char-count';
import { createBlockEditor } from '../src/lib/block-editor';

describe('formatCharCount', () => {
  it('returns empty string when nothing is selected', () => {
    expect(formatCharCount(120, 0)).toBe('');
  });
  it('returns the selected/total format when there is a selection', () => {
    expect(formatCharCount(120, 15)).toBe('選択中 15 / 全体 120 文字');
  });
});

describe('initCharCount', () => {
  function setUp(content: Parameters<typeof createBlockEditor>[0]['content']) {
    const el = document.createElement('div');
    const editor = createBlockEditor({
      element: el,
      content,
      extraExtensions: [CharacterCount],
    });
    const totalEl = document.createElement('span');
    const selectionEl = document.createElement('span');
    initCharCount(editor, totalEl, selectionEl);
    return { editor, totalEl, selectionEl };
  }

  it('renders the total count immediately on attach, with no selection text', () => {
    const { totalEl, selectionEl } = setUp([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
    ]);
    expect(totalEl.textContent).toBe('全体 5 文字');
    expect(selectionEl.textContent).toBe('');
  });

  it('updates the selection text when the selection changes', () => {
    const { editor, totalEl, selectionEl } = setUp([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
    ]);
    editor.commands.setTextSelection({ from: 1, to: 4 });
    expect(totalEl.textContent).toBe('全体 5 文字');
    expect(selectionEl.textContent).toBe('選択中 3 / 全体 5 文字');
  });

  it('updates the total count when the document changes', () => {
    const { editor, totalEl, selectionEl } = setUp([
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
    ]);
    editor.commands.insertContentAt(3, 'x');
    expect(totalEl.textContent).toBe('全体 3 文字');
    expect(selectionEl.textContent).toBe('');
  });
});
