// 記事ページの「保存(ブックマーク)」ボタン。読者はログイン不要。
// localStorage の client_token を鍵に toggle_bookmark RPC を呼ぶ。表示はアイコンのみ
// (件数・文言は出さない)。付け外しは左サイドバーにも即時反映させるため、成功時に
// BOOKMARKS_CHANGED_EVENT を発火する。保存数は左「読者に人気」・CMS 側で見せる。
import { supabaseBrowser } from '../lib/supabase-browser';
import { toggleBookmark, isBookmarkedLocal, notifyBookmarksChanged } from '../lib/bookmarks';

const btn = document.getElementById('bookmark-button') as HTMLButtonElement | null;

if (btn) {
  const articleId = btn.dataset.articleId ?? '';

  const render = (bookmarked: boolean) => {
    btn.setAttribute('aria-pressed', String(bookmarked));
    btn.setAttribute('aria-label', bookmarked ? 'この記事の保存を外す' : 'この記事を保存する');
    btn.classList.toggle('is-bookmarked', bookmarked);
  };

  // 初期表示: 自分が保存したかは localStorage が真実。
  render(isBookmarkedLocal(articleId, localStorage));
  btn.hidden = false;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { bookmarked } = await toggleBookmark(supabaseBrowser, articleId, localStorage);
      render(bookmarked);
      notifyBookmarksChanged(); // 左サイドバーの「保存した記事」/「読者に人気」を再描画させる
    } catch (err) {
      console.error('[bookmark] 保存の切り替えに失敗', err);
    } finally {
      btn.disabled = false;
    }
  });
}
