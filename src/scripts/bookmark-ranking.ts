// 左カラム(NavDrawer)の「よく保存されている記事(今月)」ランキング。
// anon で top_bookmarked_articles RPC を呼び、上位を実行時に描画する。
// 保存がまだ無ければセクションは隠したまま。編集部の Featured帯 とは別物(読者の反応)。
import { supabaseBrowser } from '../lib/supabase-browser';
import { fetchTopBookmarkedArticles } from '../lib/bookmarks';

const section = document.getElementById('bookmark-ranking');
const list = document.getElementById('bookmark-ranking-list');

if (section && list) {
  (async () => {
    let top;
    try {
      top = await fetchTopBookmarkedArticles(supabaseBrowser, 30, 5);
    } catch (err) {
      console.error('[bookmark-ranking] 取得に失敗', err);
      return;
    }
    if (!top || top.length === 0) return; // 保存がまだ無い間は非表示のまま

    list.innerHTML = '';
    for (const a of top) {
      const li = document.createElement('li');

      const link = document.createElement('a');
      link.href = `/articles/${a.slug}`;
      link.className = 'flex items-center justify-between gap-2 text-sm transition-opacity hover:opacity-60';

      const title = document.createElement('span');
      title.className = 'text-ink truncate';
      title.textContent = a.title;

      const count = document.createElement('span');
      count.className = 'text-meta shrink-0 tabular-nums';
      count.textContent = `♡ ${a.bookmarkCount}`;

      link.appendChild(title);
      link.appendChild(count);
      li.appendChild(link);
      list.appendChild(li);
    }
    section.hidden = false;
  })();
}
