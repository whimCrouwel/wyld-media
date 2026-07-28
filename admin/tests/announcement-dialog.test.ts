// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { initAnnouncementDialog } from '../src/lib/announcement-dialog';

function polyfillDialog(dialogEl: HTMLDialogElement) {
  dialogEl.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  dialogEl.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

function setup() {
  document.body.innerHTML = `
    <dialog id="announcement-dialog">
      <p data-announcement-date hidden></p>
      <h2 data-announcement-title></h2>
      <p data-announcement-body></p>
      <button type="button" data-role="close"></button>
    </dialog>
  `;
  const dialogEl = document.getElementById('announcement-dialog') as HTMLDialogElement;
  polyfillDialog(dialogEl);
  return dialogEl;
}

describe('initAnnouncementDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('show() でタイトルと本文を反映してダイアログを開く', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);

    dialog.show('お知らせ タイトル', 'お知らせ 本文');

    expect(dialogEl.open).toBe(true);
    expect(dialogEl.querySelector('[data-announcement-title]')!.textContent).toBe('お知らせ タイトル');
    expect(dialogEl.querySelector('[data-announcement-body]')!.textContent).toBe('お知らせ 本文');
  });

  it('show() に日付を渡すと表示し、渡さなければ隠す', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);
    const dateEl = dialogEl.querySelector<HTMLElement>('[data-announcement-date]')!;

    dialog.show('t', 'b', '2026/7/28');
    expect(dateEl.hidden).toBe(false);
    expect(dateEl.textContent).toBe('2026/7/28');

    dialog.show('t', 'b');
    expect(dateEl.hidden).toBe(true);
  });

  it('閉じるボタンでダイアログが閉じる', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);
    dialog.show('t', 'b');

    (dialogEl.querySelector('[data-role="close"]') as HTMLButtonElement).click();

    expect(dialogEl.open).toBe(false);
  });

  it('背景クリックで閉じる', () => {
    const dialogEl = setup();
    const dialog = initAnnouncementDialog(dialogEl);
    dialog.show('t', 'b');

    dialogEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dialogEl.open).toBe(false);
  });
});
