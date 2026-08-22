// 記事ページの「保存(ブックマーク)」ボタン。読者はログイン不要。
// localStorage の client_token を鍵に toggle_bookmark RPC を呼び、保存数を表示する。
// 表示はアイコン＋件数のみ(文言は出さない)。付け外しは左サイドバーにも即時反映させる
// ため、成功時に BOOKMARKS_CHANGED_EVENT を発火する。
import { supabaseBrowser } from '../lib/supabase-browser';
import {
  toggleBookmark, fetchBookmarkCount, isBookmarkedLocal, notifyBookmarksChanged,
} from '../lib/bookmarks';

const btn = document.getElementById('bookmark-button') as HTMLButtonElement | null;
const countEl = document.getElementById('bookmark-count');

if (btn && countEl) {
  const articleId = btn.dataset.articleId ?? '';

  const render = (bookmarked: boolean, count: number) => {
    btn.setAttribute('aria-pressed', String(bookmarked));
    btn.setAttribute('aria-label', bookmarked ? 'この記事の保存を外す' : 'この記事を保存する');
    btn.classList.toggle('is-bookmarked', bookmarked);
    countEl.textContent = String(count);
  };

  // 初期表示: 自分が保存したかは localStorage、件数はサーバー。
  (async () => {
    const bookmarked = isBookmarkedLocal(articleId, localStorage);
    let count = 0;
    try {
      count = await fetchBookmarkCount(supabaseBrowser, articleId);
    } catch (err) {
      console.error('[bookmark] 件数取得に失敗', err);
    }
    render(bookmarked, count);
    btn.hidden = false;
  })();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { bookmarked, count } = await toggleBookmark(supabaseBrowser, articleId, localStorage);
      render(bookmarked, count);
      notifyBookmarksChanged(); // 左サイドバーの「保存した記事」/「読者に人気」を再描画させる
    } catch (err) {
      console.error('[bookmark] 保存の切り替えに失敗', err);
    } finally {
      btn.disabled = false;
    }
  });
}
