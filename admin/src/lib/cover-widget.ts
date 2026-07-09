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
  // 選択(またはクリア)のたびに増分するトークン。非同期処理の完了時にこれと
  // 比較し、値がずれていれば「使用者が既に次の操作に進んだ」とみなして
  // 結果を静かに破棄する(古い応答が現在の状態を上書きしないようにする)。
  let selectionId = 0;
  // 現在表示中の画像の Blob URL。新しい画像選択・クリア・resetCropper() の
  // タイミングで確実に revoke し、メモリリークを防ぐ。
  let currentObjectUrl: string | null = null;

  const revokeCurrentObjectUrl = () => {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  };

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
    revokeCurrentObjectUrl();
  };

  fileInput.addEventListener('change', () => {
    // 新しい選択が始まった時点でトークンを進め、進行中の非同期処理(適用中の
    // アップロードや読み込み待ちの <img>)を無効化する。
    selectionId += 1;
    const mySelection = selectionId;
    const file = fileInput.files?.[0];
    cropper?.destroy();
    cropper = null;
    cropBox.innerHTML = '';
    applyBtn.hidden = true;
    applyBtn.disabled = false;
    revokeCurrentObjectUrl();
    if (!file) return;
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);
    currentObjectUrl = objectUrl;
    img.src = objectUrl;
    img.style.maxWidth = '100%';
    cropBox.appendChild(img);
    img.addEventListener('load', () => {
      // 読み込み完了までの間に別のファイルが選択されていたら、この img は
      // もう画面上のものと一致しないため cropper を差し替えない。
      if (mySelection !== selectionId) return;
      cropper = new Cropper(img, { viewMode: 1, autoCropArea: 1 });
      applyBtn.hidden = false;
    });
  });

  applyBtn.addEventListener('click', async () => {
    if (!cropper) return;
    const mySelection = selectionId;
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
      // 圧縮中にユーザーがクリアするか別画像を選び直していたら、この結果は
      // もう current ではないのでアップロードせず静かに破棄する。
      if (mySelection !== selectionId) return;
      const url = await uploadCover(supabase, blob);
      // アップロード完了時点でも同様に再確認する。ここで古い状態のまま
      // hidden.value / #cover-current / resetCropper() を触ると、ユーザーが
      // 既にクリアした値を復活させたり、選び直した別画像の編集状態を
      // 破壊してしまう。
      if (mySelection !== selectionId) return;
      hidden.value = url;
      renderCurrent();
      resetCropper();
      statusEl.textContent = 'アップロードしました。記事を保存すると反映されます。';
    } catch (err) {
      console.error(err);
      if (mySelection === selectionId) {
        statusEl.textContent = translateUploadError(err);
      }
    } finally {
      // 古い(既に選択し直された)フローの場合、disabled の管理は現行の
      // フローに委ねる(change ハンドラが選択時にリセットする)。
      if (mySelection === selectionId) {
        applyBtn.disabled = false;
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    // クリアも進行中の非同期処理を無効化する操作なのでトークンを進める。
    selectionId += 1;
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
