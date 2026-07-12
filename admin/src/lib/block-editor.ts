import { Editor, type Extension, type JSONContent } from '@tiptap/core';
import { blockExtensions } from '@wild-media/blocks-renderer/extensions';

export interface CreateBlockEditorOptions {
  element: HTMLElement;
  content: JSONContent[];
  extraExtensions: Extension[];
}

export function createBlockEditor(opts: CreateBlockEditorOptions): Editor {
  return new Editor({
    element: opts.element,
    extensions: [...blockExtensions, ...opts.extraExtensions],
    content: { type: 'doc', content: opts.content },
  });
}

export function getBodyBlocks(editor: Editor): JSONContent[] {
  return editor.getJSON().content ?? [];
}
