// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createBlockEditor } from '../src/lib/block-editor';

// ProseMirror の input rule は view の handleTextInput 経由でしか発火しない
// (insertContent では発火しない)ため、実際のタイピングを模倣する:
// 先行文字列をトランザクションで挿入し、最後のスペースを handleTextInput に渡す。
function typeMarkdownPrefix(editor: Editor, hashes: string): boolean {
  const { view } = editor;
  view.dispatch(view.state.tr.insertText(hashes, 1));
  const pos = view.state.selection.from;
  const deflt = () => view.state.tr.insertText(' ', pos);
  return view.someProp('handleTextInput', (f) => f(view, pos, pos, ' ', deflt)) === true;
}

function makeEditor(): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return createBlockEditor({ element: el, content: [{ type: 'paragraph' }], extraExtensions: [] });
}

describe('heading markdown input rules (#の数+1 = hレベル)', () => {
  it.each([
    ['#', 2],
    ['##', 3],
    ['###', 4],
    ['####', 5],
  ])('"%s " turns the block into an h%d', (hashes, level) => {
    const editor = makeEditor();
    expect(typeMarkdownPrefix(editor, hashes)).toBe(true);
    expect(editor.isActive('heading', { level })).toBe(true);
    editor.destroy();
  });

  it('"##### " does not create a heading (見出しは4段階まで)', () => {
    const editor = makeEditor();
    expect(typeMarkdownPrefix(editor, '#####')).toBe(false);
    expect(editor.isActive('heading')).toBe(false);
    editor.destroy();
  });

  it('toggleHeading accepts level 5 in the schema', () => {
    const editor = makeEditor();
    editor.commands.insertContent('text');
    editor.commands.toggleHeading({ level: 5 });
    expect(editor.isActive('heading', { level: 5 })).toBe(true);
    editor.destroy();
  });
});
