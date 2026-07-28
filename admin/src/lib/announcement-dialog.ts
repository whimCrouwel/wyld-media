export interface AnnouncementDialogController {
  show(title: string, body: string, dateLabel?: string): void;
}

// お知らせ本文を表示するだけの読み取り専用ダイアログ。confirm-dialog.ts と違い
// 選択肢は無く「閉じる」のみ。dateLabel は整形済みの文字列を受け取る(整形は
// announcements.ts の formatAnnouncementDate に寄せる)。
export function initAnnouncementDialog(dialogEl: HTMLDialogElement): AnnouncementDialogController {
  const titleEl = dialogEl.querySelector<HTMLElement>('[data-announcement-title]')!;
  const bodyEl = dialogEl.querySelector<HTMLElement>('[data-announcement-body]')!;
  const dateEl = dialogEl.querySelector<HTMLElement>('[data-announcement-date]');
  const closeBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="close"]')!;

  closeBtn.addEventListener('click', () => dialogEl.close());
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });

  function show(title: string, body: string, dateLabel?: string): void {
    titleEl.textContent = title;
    bodyEl.textContent = body;
    if (dateEl) {
      dateEl.textContent = dateLabel ?? '';
      dateEl.hidden = !dateLabel;
    }
    dialogEl.showModal();
  }

  return { show };
}
