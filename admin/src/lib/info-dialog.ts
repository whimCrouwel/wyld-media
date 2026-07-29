export interface InfoDialogLink {
  href: string;
  label: string;
}

export interface InfoDialogController {
  show(title: string, body: string, link?: InfoDialogLink): void;
}

// 入力項目の補足説明を表示するだけの読み取り専用ダイアログ。
// announcement-dialog.ts と同型だが、お知らせ機能とは無関係な汎用部品として分離している。
export function initInfoDialog(dialogEl: HTMLDialogElement): InfoDialogController {
  const titleEl = dialogEl.querySelector<HTMLElement>('[data-info-title]')!;
  const bodyEl = dialogEl.querySelector<HTMLElement>('[data-info-body]')!;
  const linkEl = dialogEl.querySelector<HTMLAnchorElement>('[data-info-link]')!;
  const closeBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="close"]')!;

  closeBtn.addEventListener('click', () => dialogEl.close());
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });

  function show(title: string, body: string, link?: InfoDialogLink): void {
    titleEl.textContent = title;
    bodyEl.textContent = body;
    if (link) {
      linkEl.href = link.href;
      linkEl.textContent = link.label;
      linkEl.hidden = false;
    } else {
      linkEl.hidden = true;
    }
    dialogEl.showModal();
  }

  return { show };
}
