import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { MAX_EDGE, encodeUnderLimit, translateUploadError } from './images';
import { encodeCanvas } from './canvas-encode';

// 本文画像挿入用のトリミングモーダル。CropDialog.astro のシェル
// (1インスタンスをページに配置)を配線し、open(file) ごとに使い回す。
// 解決値: 切り抜き済み・512KB以内にエンコード済みの WebP Blob。
// キャンセル(ボタン/背景クリック/Esc)は null。

// cropperjs のうちこのダイアログが使う操作だけの窓口。テストからフェイクを
// 注入できるようにするための最小インターフェース。
export interface CropperLike {
  setAspectRatio(ratio: number): void;
  getCroppedCanvas(options?: Record<string, unknown>): HTMLCanvasElement;
  destroy(): void;
}

export interface CropDialogDeps {
  createCropper?: (img: HTMLImageElement) => CropperLike;
  cropToBlob?: (cropper: CropperLike) => Promise<Blob>;
}

export interface CropDialogController {
  open(file: File): Promise<Blob | null>;
}

// data-ratio 属性値 → cropperjs の aspectRatio。NaN = 自由。
export const RATIO_VALUES: Record<string, number> = {
  free: NaN,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
};

// 縦横比プリセットボタン群([data-ratio])を cropper に配線する。
// このダイアログとカバー画像ウィジェット(image-upload-widget)で共用。
// reset() は選択を「自由」に戻す(新しい画像の選択時などに呼ぶ)。
export function initRatioButtons(
  container: HTMLElement, getCropper: () => CropperLike | null,
): { reset: () => void } {
  const btns = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-ratio]'));
  const setPressed = (target: HTMLButtonElement | null) => {
    for (const b of btns) {
      b.setAttribute('aria-pressed', String(b === target || (!target && b.dataset.ratio === 'free')));
    }
  };
  for (const btn of btns) {
    btn.addEventListener('click', () => {
      const cropper = getCropper();
      if (!cropper) return;
      cropper.setAspectRatio(RATIO_VALUES[btn.dataset.ratio ?? 'free'] ?? NaN);
      setPressed(btn);
    });
  }
  return { reset: () => setPressed(null) };
}

function defaultCreateCropper(img: HTMLImageElement): CropperLike {
  return new Cropper(img, { viewMode: 1, autoCropArea: 1 });
}

async function defaultCropToBlob(cropper: CropperLike): Promise<Blob> {
  const canvas = cropper.getCroppedCanvas({
    maxWidth: MAX_EDGE,
    maxHeight: MAX_EDGE,
    imageSmoothingQuality: 'high',
  });
  return encodeUnderLimit(({ quality, scale }) => encodeCanvas(canvas, quality, scale));
}

export function initCropDialog(
  dialogEl: HTMLDialogElement, deps: CropDialogDeps = {},
): CropDialogController {
  const createCropper = deps.createCropper ?? defaultCreateCropper;
  const cropToBlob = deps.cropToBlob ?? defaultCropToBlob;

  const cropBox = dialogEl.querySelector<HTMLElement>('[data-role="crop-box"]')!;
  const statusEl = dialogEl.querySelector<HTMLElement>('[data-role="status"]')!;
  const cancelBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
  const applyBtn = dialogEl.querySelector<HTMLButtonElement>('[data-role="apply"]')!;

  let cropper: CropperLike | null = null;
  let objectUrl: string | null = null;
  // apply で確定した Blob。close ハンドラがこれを解決値にする(未確定なら null)。
  let result: Blob | null = null;
  // エンコード/アップロード確定処理中の close(Esc等)で二重解決しないための旗。
  let applying = false;

  const ratios = initRatioButtons(dialogEl, () => cropper);

  const cleanup = () => {
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    statusEl.textContent = '';
    ratios.reset();
  };

  cancelBtn.addEventListener('click', () => dialogEl.close());
  dialogEl.addEventListener('click', (e) => {
    if (e.target === dialogEl) dialogEl.close();
  });

  applyBtn.addEventListener('click', async () => {
    if (!cropper || applying) return;
    applying = true;
    applyBtn.disabled = true;
    statusEl.textContent = '圧縮中…';
    try {
      result = await cropToBlob(cropper);
      dialogEl.close();
    } catch (err) {
      console.error(err);
      statusEl.textContent = translateUploadError(err);
    } finally {
      applying = false;
      applyBtn.disabled = false;
    }
  });

  function open(file: File): Promise<Blob | null> {
    result = null;
    ratios.reset();
    applyBtn.disabled = true;
    statusEl.textContent = '';
    cropBox.innerHTML = '';

    const img = document.createElement('img');
    objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    img.style.maxWidth = '100%';
    cropBox.appendChild(img);
    img.addEventListener('load', () => {
      // 読み込み完了前にダイアログが閉じられていたら何もしない
      if (!dialogEl.open) return;
      cropper = createCropper(img);
      applyBtn.disabled = false;
    });

    return new Promise((resolve) => {
      dialogEl.addEventListener(
        'close',
        () => {
          const blob = result;
          cleanup();
          resolve(blob);
        },
        { once: true },
      );
      dialogEl.showModal();
    });
  }

  return { open };
}
