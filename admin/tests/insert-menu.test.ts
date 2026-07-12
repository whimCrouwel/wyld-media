// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  filterCommands, initInsertButton, createSlashCommandsExtension, type BlockCommand,
} from '../src/lib/insert-menu';
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

describe('createSlashCommandsExtension popup', () => {
  const makeEditor = (runSpies: Record<string, ReturnType<typeof vi.fn>>) => {
    const el = document.createElement('div');
    document.body.append(el);
    const testCommands: BlockCommand[] = [
      { id: 'heading', label: '見出し', run: runSpies.heading },
      { id: 'image', label: '画像を挿入', run: runSpies.image },
      { id: 'quote', label: '引用', run: runSpies.quote },
    ];
    const editor = createBlockEditor({
      element: el,
      content: [{ type: 'paragraph' }],
      extraExtensions: [createSlashCommandsExtension(testCommands)],
    });
    return { editor, el };
  };

  // @tiptap/suggestion's plugin view `update()` handler is declared `async` and
  // does `props.items = await items(...)` before invoking onStart/onUpdate, so
  // even though our `items` callback is synchronous, the render callbacks land
  // one microtask tick after the transaction that triggered them. Flush that
  // tick before asserting on the popup DOM (mirrors what happens naturally in
  // a browser between one macrotask/event and the next).
  const flushMicrotasks = () => new Promise<void>((resolve) => { queueMicrotask(resolve); });

  const typeSlash = async (editor: ReturnType<typeof createBlockEditor>, query = '') => {
    editor.commands.focus('end');
    editor.commands.insertContent(`/${query}`);
    await flushMicrotasks();
  };

  it('renders a popup with the filtered items when "/" is typed', async () => {
    const runSpies = { heading: vi.fn(), image: vi.fn(), quote: vi.fn() };
    const { editor } = makeEditor(runSpies);

    await typeSlash(editor);

    const popup = document.querySelector('.slash-menu-popup');
    expect(popup).not.toBeNull();
    const buttons = popup!.querySelectorAll('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].dataset.commandId).toBe('heading');

    editor.destroy();
  });

  it('filters items as the query narrows', async () => {
    const runSpies = { heading: vi.fn(), image: vi.fn(), quote: vi.fn() };
    const { editor } = makeEditor(runSpies);

    await typeSlash(editor, '画像');

    const popup = document.querySelector('.slash-menu-popup');
    const buttons = popup!.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].dataset.commandId).toBe('image');

    editor.destroy();
  });

  it('ArrowDown/ArrowUp move the selected item, wrapping around', async () => {
    const runSpies = { heading: vi.fn(), image: vi.fn(), quote: vi.fn() };
    const { editor } = makeEditor(runSpies);

    await typeSlash(editor);

    const view = editor.view;
    const selectedId = () => document.querySelector('.slash-menu-popup button.is-selected') as HTMLButtonElement;

    expect(selectedId().dataset.commandId).toBe('heading');

    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowDown' })));
    expect(selectedId().dataset.commandId).toBe('image');

    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowDown' })));
    expect(selectedId().dataset.commandId).toBe('quote');

    // Wrap around past the last item.
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowDown' })));
    expect(selectedId().dataset.commandId).toBe('heading');

    // Wrap around backwards past the first item.
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowUp' })));
    expect(selectedId().dataset.commandId).toBe('quote');

    editor.destroy();
  });

  it('Enter invokes the selected command\'s run and removes the popup', async () => {
    const runSpies = { heading: vi.fn(), image: vi.fn(), quote: vi.fn() };
    const { editor } = makeEditor(runSpies);

    await typeSlash(editor);
    const view = editor.view;
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'ArrowDown' })));
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Enter' })));

    expect(runSpies.image).toHaveBeenCalledTimes(1);
    expect(runSpies.heading).not.toHaveBeenCalled();
    expect(document.querySelector('.slash-menu-popup')).toBeNull();

    editor.destroy();
  });

  it('Escape removes the popup without invoking any command', async () => {
    const runSpies = { heading: vi.fn(), image: vi.fn(), quote: vi.fn() };
    const { editor } = makeEditor(runSpies);

    await typeSlash(editor);
    const view = editor.view;
    view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: 'Escape' })));

    expect(document.querySelector('.slash-menu-popup')).toBeNull();
    expect(runSpies.heading).not.toHaveBeenCalled();
    expect(runSpies.image).not.toHaveBeenCalled();
    expect(runSpies.quote).not.toHaveBeenCalled();

    editor.destroy();
  });
});
