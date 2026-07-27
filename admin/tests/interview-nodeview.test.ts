// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { blockExtensions } from '@wild-media/blocks-renderer';
import { createInterviewPlugin, insertInterviewBlock } from '../src/lib/interview-nodeview';

const fakeDialog = { open: async () => null } as const;

describe('interview-nodeview', () => {
  it('insertInterviewBlock inserts an interview with one empty A turn', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: '<p></p>',
    });
    insertInterviewBlock(editor, [
      { key: 'A', name: '米田', role: '', avatarUrl: 'https://img.test/a.webp' },
      { key: 'B', name: '川崎', role: '', avatarUrl: 'https://img.test/b.webp' },
    ]);
    const json = editor.getJSON();
    const interview = json.content?.find((n) => n.type === 'interview');
    expect(interview).toBeDefined();
    expect(interview?.attrs?.speakers).toHaveLength(2);
    expect(interview?.content).toHaveLength(1);
    expect(interview?.content?.[0].type).toBe('turn');
    expect(interview?.content?.[0].attrs?.speaker).toBe('A');
    editor.destroy();
  });

  it('renders speaker toolbar (pills + edit button) and add-turn button over an interview block', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [
            { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'hi' }] },
          ],
        }],
      },
    });
    const dom = el.querySelector('.interview-block');
    expect(dom).not.toBeNull();
    // ピル型ツールバー: 話者チップ 2 個 + 「話者を編集」ボタン
    expect(dom!.querySelectorAll('[data-speaker-chip]')).toHaveLength(2);
    expect(dom!.querySelectorAll('.speakers-edit-btn')).toHaveLength(1);
    // ＋発言を追加
    expect(dom!.querySelectorAll('[data-add-turn]').length).toBeGreaterThanOrEqual(1);
    editor.destroy();
  });

  it('renders a per-turn delete button and clicking it removes just that turn', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: '', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [
            { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'first-a' }] },
            { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'first-b' }] },
          ],
        }],
      },
    });
    const turnsBefore = el.querySelectorAll('[data-block="turn"]');
    expect(turnsBefore).toHaveLength(2);
    turnsBefore.forEach((t) => expect(t.querySelector('.turn__delete')).not.toBeNull());
    // 1 個目 (米田) の × を mousedown で発火
    const firstDelete = turnsBefore[0].querySelector('.turn__delete') as HTMLButtonElement;
    firstDelete.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const turnsAfter = el.querySelectorAll('[data-block="turn"]');
    expect(turnsAfter).toHaveLength(1);
    expect(turnsAfter[0].getAttribute('data-speaker')).toBe('B');
    editor.destroy();
  });

  it('marks the sole remaining turn with turn--only and its delete is a no-op', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: { speakers: [{ key: 'A', name: '米田', role: '', avatarUrl: null }] },
          content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'x' }] }],
        }],
      },
    });
    const only = el.querySelector('[data-block="turn"]') as HTMLElement;
    expect(only.classList.contains('turn--only')).toBe(true);
    const btn = only.querySelector('.turn__delete') as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(el.querySelectorAll('[data-block="turn"]')).toHaveLength(1);
    editor.destroy();
  });

  it('renders a block-delete button; clicking it (with confirm=true) removes the whole interview', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: { speakers: [{ key: 'A', name: '米田', role: '', avatarUrl: null }] },
          content: [{ type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'x' }] }],
        }],
      },
    });
    expect(el.querySelector('[data-block="interview"]')).not.toBeNull();
    const deleteBtn = el.querySelector('[data-interview-delete]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    const origConfirm = window.confirm;
    window.confirm = () => false;
    deleteBtn.click();
    expect(el.querySelector('[data-block="interview"]')).not.toBeNull();

    window.confirm = () => true;
    deleteBtn.click();
    expect(el.querySelector('[data-block="interview"]')).toBeNull();
    window.confirm = origConfirm;
    editor.destroy();
  });

  it('renders each turn as a chat bubble via NodeView (avatar + who + bubble)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: [...blockExtensions, createInterviewPlugin(fakeDialog).extension],
      content: {
        type: 'doc',
        content: [{
          type: 'interview',
          attrs: {
            speakers: [
              { key: 'A', name: '米田', role: '聞き手', avatarUrl: 'https://img.test/a.webp' },
              { key: 'B', name: '川崎', role: 'Kaeru', avatarUrl: 'https://img.test/b.webp' },
            ],
          },
          content: [
            { type: 'turn', attrs: { speaker: 'A' }, content: [{ type: 'text', text: 'first-a' }] },
            { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'first-b' }] },
            { type: 'turn', attrs: { speaker: 'B' }, content: [{ type: 'text', text: 'second-b' }] },
          ],
        }],
      },
    });
    const turns = el.querySelectorAll('[data-block="turn"]');
    expect(turns).toHaveLength(3);
    // 各 turn に avatar / who / bubble が揃っている (NodeView 描画)
    turns.forEach((t) => {
      expect(t.querySelector('.turn__avatar')).not.toBeNull();
      expect(t.querySelector('.turn__who')).not.toBeNull();
      expect(t.querySelector('.turn__bubble')).not.toBeNull();
    });
    // 話者 A の 1 発言目には avatar src が入る (親 speakers から解決)
    const firstA = turns[0] as HTMLElement;
    expect((firstA.querySelector('.turn__avatar') as HTMLImageElement).src).toContain('a.webp');
    expect(firstA.querySelector('.turn__name')?.textContent).toBe('米田');
    // 話者 B の連続発言 2 個目に turn--cont クラスが付く (decorator)
    const secondB = turns[2] as HTMLElement;
    expect(secondB.classList.contains('turn--cont')).toBe(true);
    // 連続 1 個目 (話者切替後の B 最初) は cont ではない
    const firstB = turns[1] as HTMLElement;
    expect(firstB.classList.contains('turn--cont')).toBe(false);
    editor.destroy();
  });
});
