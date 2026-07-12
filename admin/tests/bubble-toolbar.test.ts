// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { deriveActiveButtons, initBubbleToolbar, type ActiveEditor } from '../src/lib/bubble-toolbar';
import { createBlockEditor } from '../src/lib/block-editor';

// NOTE: fixed from the task brief's literal fakeEditor. The brief's version did
// `active.has(name)` in the no-attrs branch, which does an object-identity Set
// lookup and can never match when `name` is an object (as it is for real Tiptap
// "object-form" isActive calls, e.g. `editor.isActive({ textAlign: 'left' })`).
// Verified against node_modules/@tiptap/core/src/Editor.ts (isActive overloads,
// lines 519-527): the real Editor only correctly checks attributes when called
// with ONE argument (`isActive(attributes)`) or a string name plus attrs
// (`isActive(name, attributes)`); calling `isActive(undefined, attrs)` silently
// drops `attrs` (falls through to the `nameOrAttributes` branch) and matches
// any active node/mark. So deriveActiveButtons must use the single-arg form for
// alignment, and this mock must stringify non-string names to test that form.
function fakeEditor(active: Set<string>): ActiveEditor {
  return {
    isActive: (name: string, attrs?: Record<string, unknown>) => {
      if (!attrs) return active.has(typeof name === 'string' ? name : JSON.stringify(name));
      return active.has(`${name}:${JSON.stringify(attrs)}`);
    },
  };
}

describe('deriveActiveButtons', () => {
  it('reports bold/strike active when the editor says so', () => {
    const state = deriveActiveButtons(fakeEditor(new Set(['bold', 'strike'])));
    expect(state.bold).toBe(true);
    expect(state.strike).toBe(true);
    expect(state.bulletList).toBe(false);
  });

  it('reports heading level via attrs-keyed isActive calls', () => {
    const state = deriveActiveButtons(fakeEditor(new Set(['heading:{"level":2}'])));
    expect(state.headingH2).toBe(true);
    expect(state.headingH3).toBe(false);
  });

  it('reports text align via object-form isActive calls', () => {
    const state = deriveActiveButtons(fakeEditor(new Set([JSON.stringify({ textAlign: 'center' })])));
    expect(state.alignCenter).toBe(true);
    expect(state.alignLeft).toBe(false);
  });
});

describe('initBubbleToolbar', () => {
  it('syncs aria-pressed state immediately on attach (not only on later selection changes)', () => {
    const el = document.createElement('div');
    const editor = createBlockEditor({
      element: el,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type: 'bold' }] }] }],
      extraExtensions: [],
    });
    // Select the bold text so isActive('bold') is true before initBubbleToolbar runs.
    editor.commands.setTextSelection({ from: 1, to: 3 });

    const toolbarEl = document.createElement('div');
    const boldButton = document.createElement('button');
    boldButton.dataset.action = 'bold';
    toolbarEl.append(boldButton);

    initBubbleToolbar(editor, toolbarEl);

    // Must reflect current selection state immediately, without waiting for
    // a subsequent selectionUpdate/transaction event.
    expect(boldButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('wires the link button to prompt for a URL and set the link mark', () => {
    const el = document.createElement('div');
    const editor = createBlockEditor({
      element: el,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      extraExtensions: [],
    });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    const toolbarEl = document.createElement('div');
    const linkButton = document.createElement('button');
    linkButton.dataset.action = 'link';
    toolbarEl.append(linkButton);

    const promptSpy = () => 'https://example.com';
    (window as unknown as { prompt: () => string }).prompt = promptSpy;

    initBubbleToolbar(editor, toolbarEl);
    linkButton.click();

    expect(editor.isActive('link', { href: 'https://example.com' })).toBe(true);
  });
});
