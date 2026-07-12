import type { Editor } from '@tiptap/core';

export function formatCharCount(total: number, selected: number): string {
  return selected > 0 ? `選択中 ${selected} / 全体 ${total} 文字` : '';
}

export function initCharCount(
  editor: Editor, totalEl: HTMLElement, selectionEl: HTMLElement,
): void {
  const update = () => {
    const total = (editor.storage.characterCount as { characters: () => number }).characters();
    const { from, to } = editor.state.selection;
    const selected = from === to ? 0 : editor.state.doc.textBetween(from, to).length;
    totalEl.textContent = `全体 ${total} 文字`;
    selectionEl.textContent = formatCharCount(total, selected);
  };

  update();
  editor.on('update', update);
  editor.on('selectionUpdate', update);
}
