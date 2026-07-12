import type { Editor } from '@tiptap/core';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

export function renderPreviewHtml(editor: Editor, imageBaseUrl: string): string {
  return renderBlocksToHtml(
    { type: 'doc', content: editor.getJSON().content ?? [] },
    imageBaseUrl,
  );
}
