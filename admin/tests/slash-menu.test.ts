// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchSlashQuery, initSlashMenu } from '../src/lib/slash-menu';

describe('matchSlashQuery', () => {
  it('行頭の / で開く', () => {
    expect(matchSlashQuery('/')).toBe('');
  });

  it('改行直後の / で開く', () => {
    expect(matchSlashQuery('本文\n/')).toBe('');
  });

  it('検索語を返す', () => {
    expect(matchSlashQuery('本文\n/画像')).toBe('画像');
  });

  it('行の途中の / では開かない', () => {
    expect(matchSlashQuery('あ/')).toBe(null);
  });

  it('URL の // では開かない', () => {
    expect(matchSlashQuery('https://example.com')).toBe(null);
  });

  it('空白が入ったら閉じる', () => {
    expect(matchSlashQuery('/画像 ')).toBe(null);
  });

  it('/ がなければ null', () => {
    expect(matchSlashQuery('ただの本文')).toBe(null);
  });
});

function setup() {
  document.body.innerHTML = `
    <textarea id="body"></textarea>
    <div id="slash-menu" hidden></div>
  `;
  return {
    textarea: document.getElementById('body') as HTMLTextAreaElement,
    menu: document.getElementById('slash-menu') as HTMLElement,
  };
}

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  textarea.value = value;
  textarea.selectionStart = value.length;
  textarea.selectionEnd = value.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('initSlashMenu', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('/ でメニューが開き、コマンドが並ぶ', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [
      { id: 'image', label: '画像を挿入', run: () => {} },
      { id: 'heading', label: '見出し', run: () => {} },
    ]);
    typeInto(textarea, '/');
    expect(menu.hidden).toBe(false);
    expect(menu.querySelectorAll('button')).toHaveLength(2);
  });

  it('検索語でコマンドを絞る', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [
      { id: 'image', label: '画像を挿入', run: () => {} },
      { id: 'heading', label: '見出し', run: () => {} },
    ]);
    typeInto(textarea, '/見出');
    expect(menu.querySelectorAll('button')).toHaveLength(1);
    expect(menu.querySelector('button')!.textContent).toBe('見出し');
  });

  it('Enter で実行し、/検索語 を本文から取り除く', () => {
    const { textarea, menu } = setup();
    const run = vi.fn();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run }]);
    typeInto(textarea, '本文\n/画像');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(run).toHaveBeenCalledOnce();
    expect(textarea.value).toBe('本文\n');
    expect(menu.hidden).toBe(true);
  });

  it('Escape で閉じ、本文は変えない', () => {
    const { textarea, menu } = setup();
    const run = vi.fn();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run }]);
    typeInto(textarea, '/');
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(menu.hidden).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(textarea.value).toBe('/');
  });

  it('一致するコマンドがなければ閉じる', () => {
    const { textarea, menu } = setup();
    initSlashMenu(textarea, menu, [{ id: 'image', label: '画像を挿入', run: () => {} }]);
    typeInto(textarea, '/zzz');
    expect(menu.hidden).toBe(true);
  });
});
