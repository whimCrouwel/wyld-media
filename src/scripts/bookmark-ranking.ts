// 左カラム(NavDrawer)の「読者に人気」ランキング。anon で top_bookmarked_articles RPC を
// 呼び、上位をサムネイル＋タイトル＋保存数で描画する。保存がまだ無ければセクションは隠したまま。
// 記事ページで保存が付け外しされたら(BOOKMARKS_CHANGED_EVENT)再取得する。
// 編集部の Featured帯 とは別物(読者の反応)。
import { supabaseBrowser } from '../lib/supabase-browser';
import {
  fetchTopBookmarkedArticles, BOOKMARKS_CHANGED_EVENT, type TopBookmarkedArticle,
} from '../lib/bookmarks';
import { makeThumb } from './bookmark-thumb';

const section = document.getElementById('bookmark-ranking');
const list = document.getElementById('bookmark-ranking-list');

const thumb = (a: TopBookmarkedArticle): HTMLElement => makeThumb(a.coverImageUrl);

async function render(): Promise<void> {
  if (!section || !list) return;
  let top: TopBookmarkedArticle[];
  try {
    top = await fetchTopBookmarkedArticles(supabaseBrowser, 30, 3);
  } catch (err) {
    console.error('[bookmark-ranking] 取得に失敗', err);
    return;
  }
  if (!top || top.length === 0) {
    section.hidden = true; // 保存がゼロに戻ったら隠す
    return;
  }

  list.innerHTML = '';
  top.forEach((a, i) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/articles/${a.slug}`;
    link.className = 'bookmark-item';

    // 「読者に人気」はランキングなので順位番号を付ける(保存した記事一覧には付けない)。
    const rank = document.createElement('span');
    rank.className = 'bookmark-rank';
    rank.textContent = String(i + 1);

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.textContent = a.title;

    const count = document.createElement('span');
    count.className = 'bookmark-count';
    count.textContent = `♡ ${a.bookmarkCount}`;

    link.append(rank, thumb(a), title, count);
    li.appendChild(link);
    list.appendChild(li);
  });
  section.hidden = false;
}

if (section && list) {
  render();
  window.addEventListener(BOOKMARKS_CHANGED_EVENT, () => void render());
}
