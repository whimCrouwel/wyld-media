// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { filterCommands, initInsertButton, type BlockCommand } from '../src/lib/insert-menu';
import { createBlockEditor } from '../src/lib/block-editor';

const commands: BlockCommand[] = [
  { id: 'heading', label: '見出し', run: () => {} },
  { id: 'image', label: '画像を挿入', run: () => {} },
  { id: 'quote', label: '引用', run: () => {} },
];

describe('filterCommands', () => {
  it('returns all commands for an empty query', () => {
    expect(filterCommands(commands, '')).toHaveLength(3);
  });
  it('filters by label substring', () => {
    expect(filterCommands(commands, '画像').map((c) => c.id)).toEqual(['image']);
  });
  it('filters by id substring (english query)', () => {
    expect(filterCommands(commands, 'quo').map((c) => c.id)).toEqual(['quote']);
  });
  it('returns empty array when nothing matches', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});

describe('initInsertButton', () => {
  it('shows the button immediately when the caret already starts in an empty textblock', () => {
    const el = document.createElement('div');
    const editor = createBlockEditor({
      element: el,
      content: [{ type: 'paragraph' }],
      extraExtensions: [],
    });

    const wrapper = document.createElement('div');
    initInsertButton(editor, wrapper);

    const button = wrapper.querySelector('button.insert-block-button') as HTMLButtonElement;
    expect(button.hidden).toBe(false);

    editor.destroy();
  });
});
