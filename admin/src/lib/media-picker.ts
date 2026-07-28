import type { SupabaseClient } from '@supabase/supabase-js';
import { listMyMedia, deleteMedia, translateMediaError, type MediaItem } from './media';

export interface MediaPicker {
  // onPickOverride を渡すと、その回の選択だけ既定の onPick の代わりに呼ばれる
  // (カバー画像など、本文挿入以外の用途で同じモーダルを使い回すため)。
  open(onPickOverride?: (url: string) => void): Promise<void>;
}

export interface MediaPickerOptions {
  modalEl: HTMLElement;
  gridEl: HTMLElement;
  statusEl: HTMLElement;
  closeBtn: HTMLButtonElement;
  onPick: (url: string) => void;
}

export function initMediaPicker(
  supabase: SupabaseClient, opts: MediaPickerOptions,
): MediaPicker {
  const { modalEl, gridEl, statusEl, closeBtn, onPick } = opts;
  // open() のたびに上書き(または既定に戻す)される現在の選択ハンドラ。
  let activeOnPick = onPick;

  const close = () => {
    modalEl.hidden = true;
    gridEl.replaceChildren();
    statusEl.textContent = '';
  };

  closeBtn.addEventListener('click', close);

  const render = (items: MediaItem[]) => {
    gridEl.replaceChildren();
    if (items.length === 0) {
      statusEl.textContent = 'まだ画像がありません。「画像を挿入」からアップロードしてください。';
      return;
    }
    for (const item of items) {
      const figure = document.createElement('figure');

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.dataset.role = 'pick';
      const img = document.createElement('img');
      // URL は DB のトリガーで許可ホスト配下に限定済み。
      img.src = item.url;
      img.alt = '';
      img.width = 160;
      img.loading = 'lazy';
      pick.append(img);
      pick.addEventListener('click', () => {
        activeOnPick(item.url);
        close();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.dataset.role = 'delete';
      del.textContent = '削除';
      // 記事削除と同じ2クリック確認
      let armed = false;
      del.addEventListener('click', async () => {
        statusEl.textContent = '';
        if (!armed) {
          armed = true;
          del.textContent = '本当に削除?(もう一度押す)';
          return;
        }
        del.disabled = true;
        try {
          await deleteMedia(supabase, item);
          await refresh();
        } catch (err) {
          statusEl.textContent = translateMediaError(err);
          console.error(err);
          del.disabled = false;
          armed = false;
          del.textContent = '削除';
        }
      });

      const caption = document.createElement('figcaption');
      caption.textContent = `${Math.round(item.bytes / 1024)} KB`;

      figure.append(pick, caption, del);
      gridEl.append(figure);
    }
  };

  const refresh = async () => {
    statusEl.textContent = '読み込み中…';
    try {
      const items = await listMyMedia(supabase);
      statusEl.textContent = '';
      render(items);
    } catch (err) {
      statusEl.textContent = translateMediaError(err);
      console.error(err);
    }
  };

  return {
    async open(onPickOverride) {
      activeOnPick = onPickOverride ?? onPick;
      modalEl.hidden = false;
      await refresh();
    },
  };
}
