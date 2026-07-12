import type { Editor } from '@tiptap/core';
import { renderBlocksToHtml } from '@wild-media/blocks-renderer';

export async function renderPreviewHtml(editor: Editor, imageBaseUrl: string): Promise<string> {
  return renderBlocksToHtml(
    { type: 'doc', content: editor.getJSON().content ?? [] },
    imageBaseUrl,
  );
}
