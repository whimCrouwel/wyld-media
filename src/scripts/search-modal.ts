// 検索モーダル。開閉と、ハイブリッド検索 Edge Function の呼び出し。
import { supabaseBrowser } from '../lib/supabase-browser';
import { lockPageScroll, unlockPageScroll } from './scroll-lock';

const modal = document.getElementById('search-modal') as HTMLDialogElement | null;
const openBtn = document.getElementById('search-open');
const input = document.getElementById('search-input') as HTMLInputElement | null;
const resultsEl = document.getElementById('search-results') as HTMLUListElement | null;
const statusEl = document.getElementById('search-status');

// supabase/functions/search-articles/index.ts のレスポンス形式に合わせる。
// excerptHtml は search_articles_hybrid()(supabase/migrations/
// 20260713100100_search_articles_hybrid.sql)内で
// extensions.pgroonga_highlight_html(pc.content, pgroonga_query_extract_keywords(query_text))
// により生成される。pgroonga_highlight_html は本文をHTMLエスケープした上で
// マッチしたキーワードだけを <span class="keyword"> で囲む PGroonga 組込み関数
// であり、ユーザーの生クエリ文字列はキーワード抽出(pgroonga_query_extract_keywords)
// を経由するのみで、出力にそのまま現れることはない。そのためそのまま innerHTML に
// 差し込んでよい。一方 title はユーザー入力を経由しないが、念のため常に
// エスケープしてから差し込む。
interface SearchResult {
  slug: string;
  title: string;
  excerptHtml: string;
  authorName: string;
  authorSlug: string;
  region: string | null;
  score: number;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

if (modal && openBtn && input && resultsEl && statusEl) {
  openBtn.addEventListener('click', () => {
    // 検索トリガーは常設サイドバー(NavDrawer、通常の <aside>)の中にあるが、
    // NavDrawer 自体はモーダルではないのでここでの開閉を待つ必要はない。
    lockPageScroll();
    modal.showModal();
    statusEl.textContent = HINT;
    input.focus();
  });

  // 閉じる経路は4つある(×ボタンの form 送信・Esc・バックドロップ・close())。
  // どれか1つでも解除を取りこぼすと、ページがスクロール不能のまま残る。
  // close イベントはこの実装では取りこぼしが確認できたため、dialog の
  // open 属性そのものを監視して確実に解除する。
  new MutationObserver(() => {
    if (!modal.open) unlockPageScroll();
  }).observe(modal, { attributes: true, attributeFilter: ['open'] });

  // バックドロップのクリックで閉じる(dialog 自身の領域外を押したとき)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  // Escape は常に「閉じる」に倒す。入力欄が type="search" だとブラウザ標準の
  // 「Escape で内容をクリア」に1回目が消費され、閉じるのに2回押す必要が出る
  // (今は type="text" なので起きないが、将来 search に戻したときの保険)。
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.close();
    }
  });

  const HINT = 'Enter で検索';
  let abortController: AbortController | undefined;

  function render(results: SearchResult[]) {
    if (results.length === 0) {
      resultsEl!.hidden = true;
      statusEl!.textContent = '見つかりませんでした。';
      return;
    }
    // カード全体が記事へのリンク。「誰が・どこの話か」を1行のメタ行にまとめ、
    // ライター名を左・取材地を右に置いてサイドバーの AREA(地域名 左・件数 右)と
    // 同じリズムに揃える。
    resultsEl!.innerHTML = results
      .map(
        (r) => `
      <li>
        <a class="result-card" href="/articles/${encodeURIComponent(r.slug)}">
          <span class="result-title">${escapeHtml(r.title)}</span>
          <span class="result-byline">
            <span class="meta">${escapeHtml(r.authorName)}</span>
            ${r.region ? `<span class="meta">${escapeHtml(r.region)}</span>` : ''}
          </span>
          <span class="result-excerpt">${r.excerptHtml}</span>
        </a>
      </li>`,
      )
      .join('');
    resultsEl!.hidden = false;
    statusEl!.textContent = '';
  }

  // 検索は Enter でだけ走らせる。1回の検索につき OpenAI の embeddings を
  // 1回叩くので、入力のたびに走らせると打鍵の途中で何度も課金が発生する。
  async function runSearch() {
    const q = input!.value.trim();
    if (!q) return;

    abortController?.abort();
    abortController = new AbortController();
    statusEl!.textContent = '検索中…';
    try {
      const { data, error } = await supabaseBrowser.functions.invoke('search-articles', {
        body: { query: q },
        signal: abortController.signal,
      });
      if (error) throw error;
      render((data?.results ?? []) as SearchResult[]);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      statusEl!.textContent = '検索に失敗しました。';
      console.error(err);
    }
  }

  // Enter は input を包む form の submit として届く(SearchModal.astro のコメント参照)。
  // preventDefault しないとページ遷移するので必須。
  document.getElementById('search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch();
  });

  // 入力を空にしたら前回の結果を片付けて、操作方法を出し直す
  input.addEventListener('input', () => {
    if (input.value.trim()) return;
    abortController?.abort();
    resultsEl.hidden = true;
    resultsEl.innerHTML = '';
    statusEl.textContent = HINT;
  });
}
