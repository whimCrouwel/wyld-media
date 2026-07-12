import type { Editor, Extension } from '@tiptap/core';
import BubbleMenu from '@tiptap/extension-bubble-menu';

export function createBubbleMenuExtension(toolbarEl: HTMLElement): Extension {
  return BubbleMenu.configure({
    element: toolbarEl,
    tippyOptions: { duration: 100 },
  }) as unknown as Extension;
}

export interface ToolbarButtonState {
  bold: boolean;
  strike: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  link: boolean;
  headingH2: boolean;
  headingH3: boolean;
  alignLeft: boolean;
  alignCenter: boolean;
  alignRight: boolean;
}

export interface ActiveEditor {
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean;
}

export function deriveActiveButtons(editor: ActiveEditor): ToolbarButtonState {
  return {
    bold: editor.isActive('bold'),
    strike: editor.isActive('strike'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    blockquote: editor.isActive('blockquote'),
    codeBlock: editor.isActive('codeBlock'),
    link: editor.isActive('link'),
    headingH2: editor.isActive('heading', { level: 2 }),
    headingH3: editor.isActive('heading', { level: 3 }),
    alignLeft: editor.isActive({ textAlign: 'left' } as unknown as string),
    alignCenter: editor.isActive({ textAlign: 'center' } as unknown as string),
    alignRight: editor.isActive({ textAlign: 'right' } as unknown as string),
  };
}

export function initBubbleToolbar(editor: Editor, toolbarEl: HTMLElement): void {
  const q = (action: string) => toolbarEl.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
  const buttons = {
    bold: q('bold'), strike: q('strike'), bulletList: q('bulletList'), orderedList: q('orderedList'),
    blockquote: q('blockquote'), codeBlock: q('codeBlock'), link: q('link'), unlink: q('unlink'),
    headingH2: q('headingH2'), headingH3: q('headingH3'), paragraph: q('paragraph'),
    alignLeft: q('alignLeft'), alignCenter: q('alignCenter'), alignRight: q('alignRight'),
    delete: q('delete'),
  };

  buttons.bold?.addEventListener('click', () => editor.chain().focus().toggleBold().run());
  buttons.strike?.addEventListener('click', () => editor.chain().focus().toggleStrike().run());
  buttons.bulletList?.addEventListener('click', () => editor.chain().focus().toggleBulletList().run());
  buttons.orderedList?.addEventListener('click', () => editor.chain().focus().toggleOrderedList().run());
  buttons.blockquote?.addEventListener('click', () => editor.chain().focus().toggleBlockquote().run());
  buttons.codeBlock?.addEventListener('click', () => editor.chain().focus().toggleCodeBlock().run());
  buttons.headingH2?.addEventListener('click', () => editor.chain().focus().toggleHeading({ level: 2 }).run());
  buttons.headingH3?.addEventListener('click', () => editor.chain().focus().toggleHeading({ level: 3 }).run());
  buttons.paragraph?.addEventListener('click', () => editor.chain().focus().setParagraph().run());
  buttons.alignLeft?.addEventListener('click', () => editor.chain().focus().setTextAlign('left').run());
  buttons.alignCenter?.addEventListener('click', () => editor.chain().focus().setTextAlign('center').run());
  buttons.alignRight?.addEventListener('click', () => editor.chain().focus().setTextAlign('right').run());
  buttons.link?.addEventListener('click', () => {
    const url = window.prompt('リンク先のURL');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  });
  buttons.unlink?.addEventListener('click', () => editor.chain().focus().unsetLink().run());
  buttons.delete?.addEventListener('click', () => editor.chain().focus().deleteSelection().run());

  const syncActiveState = () => {
    const state = deriveActiveButtons(editor);
    buttons.bold?.setAttribute('aria-pressed', String(state.bold));
    buttons.strike?.setAttribute('aria-pressed', String(state.strike));
    buttons.bulletList?.setAttribute('aria-pressed', String(state.bulletList));
    buttons.orderedList?.setAttribute('aria-pressed', String(state.orderedList));
    buttons.blockquote?.setAttribute('aria-pressed', String(state.blockquote));
    buttons.codeBlock?.setAttribute('aria-pressed', String(state.codeBlock));
    buttons.link?.setAttribute('aria-pressed', String(state.link));
    buttons.headingH2?.setAttribute('aria-pressed', String(state.headingH2));
    buttons.headingH3?.setAttribute('aria-pressed', String(state.headingH3));
    buttons.alignLeft?.setAttribute('aria-pressed', String(state.alignLeft));
    buttons.alignCenter?.setAttribute('aria-pressed', String(state.alignCenter));
    buttons.alignRight?.setAttribute('aria-pressed', String(state.alignRight));
  };

  editor.on('selectionUpdate', syncActiveState);
  editor.on('transaction', syncActiveState);
  syncActiveState();
}
