import { Extension, type Editor } from '@tiptap/core';
import Suggestion, {
  type SuggestionKeyDownProps, type SuggestionProps,
} from '@tiptap/suggestion';
import type { EditorState } from '@tiptap/pm/state';

// interview は自己完結ブロック: 中で他のブロックを挿入する導線を持たない。
// スラッシュメニューを発火させない(見出し・画像・目次などの誤挿入を防ぐ)。
export function isInsideInterview(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'interview') return true;
  }
  return false;
}

export interface BlockCommand {
  id: string;
  label: string;
  run: (editor: Editor) => void;
}

export function filterCommands(commands: BlockCommand[], query: string): BlockCommand[] {
  const q = query.toLowerCase();
  return commands.filter((c) => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
}

// "/" 入力で開くコマンド一覧のポップアップ。@tiptap/suggestion は状態管理のみ
// 行い、DOM描画・キー操作は render() が返すコールバックの責務(標準パターン)。
// onKeyDown は SuggestionKeyDownProps (view/event/range のみ) しか受け取らず
// command() を含まないため、onStart/onUpdate で受け取った props を閉じ込めて
// 使い回す。
function createSlashMenuRenderer() {
  let popupEl: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;
  let items: BlockCommand[] = [];
  let selectedIndex = 0;
  let latestProps: SuggestionProps<BlockCommand, BlockCommand> | null = null;

  const positionPopup = (clientRect: DOMRect | null | undefined) => {
    if (!popupEl || !clientRect) return;
    popupEl.style.position = 'fixed';
    popupEl.style.left = `${clientRect.left}px`;
    popupEl.style.top = `${clientRect.bottom}px`;
  };

  const selectItem = (item: BlockCommand) => {
    latestProps?.command(item);
  };

  const renderItems = () => {
    if (!listEl) return;
    listEl.replaceChildren();
    items.forEach((item, index) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.dataset.commandId = item.id;
      const isSelected = index === selectedIndex;
      button.setAttribute('aria-selected', String(isSelected));
      button.classList.toggle('is-selected', isSelected);
      // mousedown ではなく click だとエディタが先にフォーカスを失い、
      // suggestion の状態がクリック前に閉じてしまう可能性があるため mousedown を使う。
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(item);
      });
      li.append(button);
      listEl!.append(li);
    });
  };

  const closePopup = () => {
    popupEl?.remove();
    popupEl = null;
    listEl = null;
  };

  return {
    onStart(props: SuggestionProps<BlockCommand, BlockCommand>) {
      latestProps = props;
      items = props.items;
      selectedIndex = 0;

      popupEl = document.createElement('div');
      popupEl.className = 'slash-menu-popup';
      listEl = document.createElement('ul');
      popupEl.append(listEl);
      document.body.append(popupEl);

      renderItems();
      positionPopup(props.clientRect?.());
    },
    onUpdate(props: SuggestionProps<BlockCommand, BlockCommand>) {
      latestProps = props;
      items = props.items;
      if (selectedIndex >= items.length) {
        selectedIndex = items.length === 0 ? 0 : items.length - 1;
      }

      renderItems();
      positionPopup(props.clientRect?.());
    },
    onKeyDown(props: SuggestionKeyDownProps): boolean {
      if (!popupEl) return false;

      if (props.event.key === 'ArrowDown') {
        if (items.length > 0) selectedIndex = (selectedIndex + 1) % items.length;
        renderItems();
        return true;
      }
      if (props.event.key === 'ArrowUp') {
        if (items.length > 0) selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        renderItems();
        return true;
      }
      if (props.event.key === 'Enter') {
        const item = items[selectedIndex];
        if (item) selectItem(item);
        return true;
      }
      if (props.event.key === 'Escape') {
        closePopup();
        return true;
      }
      return false;
    },
    onExit() {
      closePopup();
      latestProps = null;
    },
  };
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
          allow: ({ state }: { state: EditorState }) => !isInsideInterview(state),
          render: createSlashMenuRenderer,
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
    // interview 内の空 turn では出さない(スラッシュメニューが発火しないので押しても何も起きない)。
    button.hidden = !isEmptyTextBlock || isInsideInterview(editor.state);
  };

  editor.on('selectionUpdate', updateVisibility);
  editor.on('transaction', updateVisibility);
  updateVisibility();
}
