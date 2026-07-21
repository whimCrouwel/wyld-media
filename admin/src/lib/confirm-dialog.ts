export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ConfirmDialogController {
  confirm(opts: ConfirmOptions): Promise<boolean>;
}

// ConfirmDialog.astro のシェル(1インスタンスを layout に配置)を、
// 呼び出しごとに文言を差し替えて使い回す。true = confirm クリック、
// false = cancel クリック/背景クリック/Esc。
export function initConfirmDialog(dialogEl: HTMLDialogElement): ConfirmDialogController {
  const titleEl = dialogEl.querySelector<HTMLElement>('[data-confirm-title]')!;
  const bodyEl = dialogEl.querySelector<HTMLElement>('[data-confirm-body]')!;
  const cancelBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
  const confirmBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="confirm"]')!;

  cancelBtn.addEventListener('click', () => dialogEl.close('cancel'));
  confirmBtn.addEventListener('click', () => dialogEl.close('confirm'));
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close('cancel');
  });

  function confirm(opts: ConfirmOptions): Promise<boolean> {
    titleEl.textContent = opts.title;
    bodyEl.textContent = opts.body;
    confirmBtn.textContent = opts.confirmLabel ?? '削除する';
    cancelBtn.textContent = opts.cancelLabel ?? 'キャンセル';
    // Esc は close(returnValue) を経由しないため、前回呼び出しの
    // returnValue が残ったままだと誤って true 判定されてしまう。
    dialogEl.returnValue = '';

    return new Promise((resolve) => {
      dialogEl.addEventListener(
        'close',
        () => resolve(dialogEl.returnValue === 'confirm'),
        { once: true },
      );
      dialogEl.showModal();
    });
  }

  return { confirm };
}
