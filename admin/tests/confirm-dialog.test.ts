// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initConfirmDialog } from '../src/lib/confirm-dialog';

// jsdom は <dialog> の showModal/close を実装していない(既知の制約)ので、
// 実ブラウザ相当の最小限の挙動をテスト側でポリフィルする。
function polyfillDialog(dialogEl: HTMLDialogElement) {
  dialogEl.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogEl.close = function (this: HTMLDialogElement, returnValue?: string) {
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function setup() {
  document.body.innerHTML = `
    <dialog id="confirm-dialog">
      <h2 data-confirm-title></h2>
      <p data-confirm-body></p>
      <button type="button" data-role="cancel"></button>
      <button type="button" data-role="confirm"></button>
    </dialog>
  `;
  const dialogEl = document.getElementById('confirm-dialog') as HTMLDialogElement;
  polyfillDialog(dialogEl);
  return dialogEl;
}

describe('initConfirmDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('タイトル・本文・ボタン文言を反映してダイアログを開く', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    const resultPromise = dialog.confirm({ title: '記事を削除しますか?', body: '元に戻せません。' });

    expect(dialogEl.open).toBe(true);
    expect(dialogEl.querySelector('[data-confirm-title]')!.textContent).toBe('記事を削除しますか?');
    expect(dialogEl.querySelector('[data-confirm-body]')!.textContent).toBe('元に戻せません。');
    expect(dialogEl.querySelector('[data-role="confirm"]')!.textContent).toBe('削除する');
    expect(dialogEl.querySelector('[data-role="cancel"]')!.textContent).toBe('キャンセル');

    dialogEl.close('cancel');
    await resultPromise;
  });

  it('confirm ボタンを押すと true で解決する', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    const resultPromise = dialog.confirm({ title: 't', body: 'b' });
    (dialogEl.querySelector('[data-role="confirm"]') as HTMLButtonElement).click();

    expect(await resultPromise).toBe(true);
    expect(dialogEl.open).toBe(false);
  });

  it('cancel ボタンを押すと false で解決する', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    const resultPromise = dialog.confirm({ title: 't', body: 'b' });
    (dialogEl.querySelector('[data-role="cancel"]') as HTMLButtonElement).click();

    expect(await resultPromise).toBe(false);
  });

  it('背景(dialog 自身)を押すと false で解決する', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    const resultPromise = dialog.confirm({ title: 't', body: 'b' });
    dialogEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(await resultPromise).toBe(false);
  });

  it('confirm 済みの後、Esc(returnValue を設定しない close)を挟むと次回は false になる', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    // 1回目: confirm ボタンで true
    const first = dialog.confirm({ title: 't', body: 'b' });
    (dialogEl.querySelector('[data-role="confirm"]') as HTMLButtonElement).click();
    expect(await first).toBe(true);

    // 2回目: Esc は returnValue を設定せず close するだけ(ブラウザの実挙動)
    const second = dialog.confirm({ title: 't', body: 'b' });
    dialogEl.dispatchEvent(new Event('cancel'));
    dialogEl.close();

    expect(await second).toBe(false);
  });

  it('confirmLabel/cancelLabel を指定すればそれを使う', async () => {
    const dialogEl = setup();
    const dialog = initConfirmDialog(dialogEl);

    const resultPromise = dialog.confirm({
      title: 't', body: 'b', confirmLabel: '完全に削除', cancelLabel: 'やめる',
    });

    expect(dialogEl.querySelector('[data-role="confirm"]')!.textContent).toBe('完全に削除');
    expect(dialogEl.querySelector('[data-role="cancel"]')!.textContent).toBe('やめる');

    dialogEl.close('cancel');
    await resultPromise;
  });
});
