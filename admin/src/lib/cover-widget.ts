import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_EDGE, encodeUnderLimit, scaledSize, uploadCover, translateUploadError,
} from './images';

export interface CoverWidget {
  getUrl(): string;
  setUrl(url: string | null): void;
}

// 固定 ID の要素(cover / cover-file / cover-crop / cover-apply /
// cover-clear / cover-status / cover-current)を配線する。
export function initCoverWidget(supabase: SupabaseClient): CoverWidget {
  const hidden = document.getElementById('cover') as HTMLInputElement;
  const fileInput = document.getElementById('cover-file') as HTMLInputElement;
  const cropBox = document.getElementById('cover-crop')!;
  const applyBtn = document.getElementById('cover-apply') as HTMLButtonElement;
  const clearBtn = document.getElementById('cover-clear') as HTMLButtonElement;
  const statusEl = document.getElementById('cover-status')!;
  const currentEl = document.getElementById('cover-current')!;

  let cropper: Cropper | null = null;

  const renderCurrent = () => {
    currentEl.innerHTML = '';
    if (hidden.value) {
      const img = document.createElement('img');
      img.src = hidden.value;
      img.alt = '現在のカバー画像';
      img.style.maxWidth = '240px';
      currentEl.appendChild(img);
    } else {
      currentEl.textContent = 'カバー画像は未設定です。';
    }
  };

  const resetCropper = () => {
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    applyBtn.hidden = true;
    fileInput.value = '';
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    applyBtn.hidden = true;
    if (!file) return;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.maxWidth = '100%';
    cropBox.appendChild(img);
    img.addEventListener('load', () => {
      cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1 });
      applyBtn.hidden = false;
    });
  });

  applyBtn.addEventListener('click', async () => {
    if (!cropper) return;
    statusEl.textContent = 'アップロード中…';
    applyBtn.disabled = true;
    try {
      const canvas = cropper.getCroppedCanvas({
        maxWidth: MAX_EDGE,
        maxHeight: MAX_EDGE,
        imageSmoothingQuality: 'high',
      });
      const blob = await encodeUnderLimit(
        (attempt) => encodeCanvas(canvas, attempt.quality, attempt.scale),
      );
      hidden.value = await uploadCover(supabase, blob);
      renderCurrent();
      resetCropper();
      statusEl.textContent = 'アップロードしました。記事を保存すると反映されます。';
    } catch (err) {
      statusEl.textContent = translateUploadError(err);
      console.error(err);
    } finally {
      applyBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    hidden.value = '';
    renderCurrent();
    resetCropper();
    statusEl.textContent = '';
  });

  renderCurrent();
  return {
    getUrl: () => hidden.value,
    setUrl: (url) => {
      hidden.value = url ?? '';
      renderCurrent();
    },
  };
}

function encodeCanvas(
  source: HTMLCanvasElement, quality: number, scale: number,
): Promise<Blob | null> {
  let canvas = source;
  if (scale < 1) {
    const { width, height } = scaledSize(source.width, source.height, scale);
    const scaled = document.createElement('canvas');
    scaled.width = width;
    scaled.height = height;
    scaled.getContext('2d')!.drawImage(source, 0, 0, width, height);
    canvas = scaled;
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}
