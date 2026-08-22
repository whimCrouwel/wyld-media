// 左サイドバー(NavDrawer)の「保存した記事」カルーセル。この読者(このブラウザ)が
// 保存した記事を localStorage の記事IDから引き、公開中のものだけをカバー画像主役の
// カードで横並びに描画する。ログイン不要 — 「自分が保存したか」は localStorage が真実。
// 保存が無ければ隠したまま。記事ページで保存が付け外しされたら
// (BOOKMARKS_CHANGED_EVENT)再描画する。
import { supabaseBrowser } from '../lib/supabase-browser';
import {
  getLocalBookmarks, fetchSavedArticles, BOOKMARKS_CHANGED_EVENT, type SavedArticle,
} from '../lib/bookmarks';

const section = document.getElementById('bookmark-saved');
const list = document.getElementById('bookmark-saved-list');

const PLACEHOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/>' +
  '<path d="M21 15l-5-5L5 20"/></svg>';

function cover(a: SavedArticle): HTMLElement {
  if (!a.coverImageUrl) {
    const empty = document.createElement('span');
    empty.className = 'bookmark-cara-cover bookmark-cara-cover--empty';
    empty.innerHTML = PLACEHOLDER_ICON;
    return empty;
  }
  const box = document.createElement('span');
  box.className = 'bookmark-cara-cover';
  const img = document.createElement('img');
  img.src = a.coverImageUrl;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  // 読み込み失敗時は空白のままにせずアイコン枠に差し替える。
  img.addEventListener('error', () => {
    box.classList.add('bookmark-cara-cover--empty');
    box.innerHTML = PLACEHOLDER_ICON;
  }, { once: true });
  box.appendChild(img);
  return box;
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
    const card = document.createElement('a');
    card.className = 'bookmark-cara-card';
    card.href = `/articles/${a.slug}`;

    const title = document.createElement('span');
    title.className = 'bookmark-cara-title';
    title.textContent = a.title;

    card.append(cover(a), title);
    li.appendChild(card);
    list.appendChild(li);
  }
  section.hidden = false;
}

if (section && list) {
  render();
  window.addEventListener(BOOKMARKS_CHANGED_EVENT, () => void render());
}
