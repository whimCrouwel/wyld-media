// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initCropDialog, RATIO_VALUES, type CropperLike } from '../src/lib/crop-dialog';

// jsdom は <dialog> の showModal/close を実装していない(既知の制約)ので、
// confirm-dialog.test.ts と同じ最小ポリフィルを使う。
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
    <dialog id="crop-dialog">
      <div data-role="ratios">
        <button type="button" data-ratio="free" aria-pressed="true"></button>
        <button type="button" data-ratio="16:9" aria-pressed="false"></button>
        <button type="button" data-ratio="4:3" aria-pressed="false"></button>
        <button type="button" data-ratio="1:1" aria-pressed="false"></button>
      </div>
      <div data-role="crop-box"></div>
      <span data-role="status"></span>
      <button type="button" data-role="cancel"></button>
      <button type="button" data-role="apply"></button>
    </dialog>
  `;
  const dialogEl = document.getElementById('crop-dialog') as HTMLDialogElement;
  polyfillDialog(dialogEl);
  return dialogEl;
}

function fakeCropper(): CropperLike {
  return {
    setAspectRatio: vi.fn(),
    getCroppedCanvas: vi.fn(() => document.createElement('canvas')),
    destroy: vi.fn(),
  };
}

// jsdom には URL.createObjectURL がない
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

const file = () => new File(['x'], 'a.png', { type: 'image/png' });

// crop-box 内の img の load を発火させ、cropper を初期化させる
function fireImageLoad(dialogEl: HTMLDialogElement) {
  const img = dialogEl.querySelector<HTMLImageElement>('[data-role="crop-box"] img')!;
  img.dispatchEvent(new Event('load'));
}

describe('initCropDialog', () => {
  it('キャンセルで null を解決し、cropper を破棄する', async () => {
    const dialogEl = setup();
    const cropper = fakeCropper();
    const dialog = initCropDialog(dialogEl, { createCropper: () => cropper });

    const promise = dialog.open(file());
    expect(dialogEl.open).toBe(true);
    fireImageLoad(dialogEl);

    dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    expect(await promise).toBeNull();
    expect(cropper.destroy).toHaveBeenCalled();
    expect(dialogEl.open).toBe(false);
  });

  it('適用で cropToBlob の結果を解決してダイアログを閉じる', async () => {
    const dialogEl = setup();
    const blob = new Blob(['webp'], { type: 'image/webp' });
    const dialog = initCropDialog(dialogEl, {
      createCropper: fakeCropper,
      cropToBlob: async () => blob,
    });

    const promise = dialog.open(file());
    fireImageLoad(dialogEl);
    dialogEl.querySelector<HTMLButtonElement>('[data-role="apply"]')!.click();

    expect(await promise).toBe(blob);
    expect(dialogEl.open).toBe(false);
  });

  it('比率ボタンで setAspectRatio が呼ばれ aria-pressed が切り替わる', async () => {
    const dialogEl = setup();
    const cropper = fakeCropper();
    const dialog = initCropDialog(dialogEl, { createCropper: () => cropper });

    const promise = dialog.open(file());
    fireImageLoad(dialogEl);

    const btn = dialogEl.querySelector<HTMLButtonElement>('[data-ratio="16:9"]')!;
    btn.click();
    expect(cropper.setAspectRatio).toHaveBeenCalledWith(RATIO_VALUES['16:9']);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(dialogEl.querySelector('[data-ratio="free"]')!.getAttribute('aria-pressed')).toBe('false');

    dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    await promise;
  });

  it('画像の読み込みが終わるまで適用ボタンは無効', async () => {
    const dialogEl = setup();
    const dialog = initCropDialog(dialogEl, { createCropper: fakeCropper });

    const promise = dialog.open(file());
    const applyBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="apply"]')!;
    expect(applyBtn.disabled).toBe(true);
    fireImageLoad(dialogEl);
    expect(applyBtn.disabled).toBe(false);

    dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    await promise;
  });

  it('2回目の open でも前回の状態(比率選択)を持ち越さない', async () => {
    const dialogEl = setup();
    const cropper = fakeCropper();
    const dialog = initCropDialog(dialogEl, { createCropper: () => cropper });

    const first = dialog.open(file());
    fireImageLoad(dialogEl);
    dialogEl.querySelector<HTMLButtonElement>('[data-ratio="1:1"]')!.click();
    dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    await first;

    const second = dialog.open(file());
    expect(dialogEl.querySelector('[data-ratio="free"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(dialogEl.querySelector('[data-ratio="1:1"]')!.getAttribute('aria-pressed')).toBe('false');
    dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    await second;
  });
});
