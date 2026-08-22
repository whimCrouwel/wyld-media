// 左カラム(NavDrawer)の「保存した記事」一覧。この読者(このブラウザ)が保存した記事を
// localStorage の記事IDから引き、公開中のものだけをサムネイル＋タイトルで描画する。
// ログイン不要 — 「自分が保存したか」は localStorage が真実。保存が無ければ隠したまま。
// 記事ページで保存が付け外しされたら(BOOKMARKS_CHANGED_EVENT)再描画する。
import { supabaseBrowser } from '../lib/supabase-browser';
import {
  getLocalBookmarks, fetchSavedArticles, BOOKMARKS_CHANGED_EVENT, type SavedArticle,
} from '../lib/bookmarks';

const section = document.getElementById('bookmark-saved');
const list = document.getElementById('bookmark-saved-list');

function thumb(a: SavedArticle): HTMLElement {
  if (a.coverImageUrl) {
    const img = document.createElement('img');
    img.className = 'bookmark-thumb';
    img.src = a.coverImageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  const ph = document.createElement('span');
  ph.className = 'bookmark-thumb';
  ph.setAttribute('aria-hidden', 'true');
  return ph;
}

async function render(): Promise<void> {
  if (!section || !list) return;
  const ids = getLocalBookmarks(localStorage);
  if (ids.length === 0) {
    section.hidden = true;
    return;
  }

  let saved: SavedArticle[];
  try {
    saved = await fetchSavedArticles(supabaseBrowser, ids);
  } catch (err) {
    console.error('[bookmark-saved] 取得に失敗', err);
    return;
  }
  if (saved.length === 0) {
    section.hidden = true; // 保存IDはあるが公開記事が無い(全て非公開/削除)場合
    return;
  }

  list.innerHTML = '';
  for (const a of saved) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/articles/${a.slug}`;
    link.className = 'bookmark-item';

    const title = document.createElement('span');
    title.className = 'bookmark-title';
    title.textContent = a.title;

    link.append(thumb(a), title);
    li.appendChild(link);
    list.appendChild(li);
  }
  section.hidden = false;
}

if (section && list) {
  render();
  window.addEventListener(BOOKMARKS_CHANGED_EVENT, () => void render());
}
