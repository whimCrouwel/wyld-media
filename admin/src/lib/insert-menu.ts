import { Extension, type Editor } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';

export interface BlockCommand {
  id: string;
  label: string;
  run: (editor: Editor) => void;
}

export function filterCommands(commands: BlockCommand[], query: string): BlockCommand[] {
  const q = query.toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
}

export function createSlashCommandsExtension(commands: BlockCommand[]): Extension {
  return Extension.create({
    name: 'slashCommands',
    addOptions() {
      return {
        suggestion: {
          char: '/',
          items: ({ query }: { query: string }) => filterCommands(commands, query),
          command: ({
            editor, range, props,
          }: { editor: Editor; range: { from: number; to: number }; props: BlockCommand }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
        },
      };
    },
    addProseMirrorPlugins() {
      return [Suggestion({ editor: this.editor, ...this.options.suggestion })];
    },
  });
}

// 本文の空行左に表示する「＋」ボタン。空のテキストブロックにキャレットが
// あるときだけ表示し、クリックで "/" を挿入してスラッシュメニューを開く
// (既存のコマンド一覧を流用する)。
export function initInsertButton(editor: Editor, wrapperEl: HTMLElement): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'insert-block-button';
  button.textContent = '+';
  button.hidden = true;
  wrapperEl.append(button);

  button.addEventListener('mousedown', (e) => {
    e.preventDefault();
    editor.chain().focus().insertContent('/').run();
  });

  const updateVisibility = () => {
    const { $from } = editor.state.selection;
    const isEmptyTextBlock = $from.parent.isTextblock && $from.parent.content.size === 0;
    button.hidden = !isEmptyTextBlock;
  };

  editor.on('selectionUpdate', updateVisibility);
  editor.on('transaction', updateVisibility);
  updateVisibility();
}
