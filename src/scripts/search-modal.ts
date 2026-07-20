// 検索モーダル。開閉と、ハイブリッド検索 Edge Function の呼び出し。
import { supabaseBrowser } from '../lib/supabase-browser';

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
    modal.showModal();
    input.focus();
  });

  // バックドロップのクリックで閉じる(dialog 自身の領域外を押したとき)
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

  // input[type="search"] にはブラウザ標準の「Escape で検索欄をクリアする」
  // 挙動があり、文字が入力されている状態だと最初の Escape はその clear に
  // 消費されて dialog まで届かない(=閉じるのに2回押す必要が生じる)。
  // ここで Escape を横取りして常に modal.close() を呼ぶことで、入力の
  // 有無に関わらず1回目の Escape で閉じるようにする。
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      modal.close();
    }
  });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
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

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    abortController?.abort();

    if (!q) {
      resultsEl.hidden = true;
      statusEl.textContent = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      abortController = new AbortController();
      statusEl.textContent = '検索中…';
      try {
        const { data, error } = await supabaseBrowser.functions.invoke('search-articles', {
          body: { query: q },
          signal: abortController.signal,
        });
        if (error) throw error;
        render((data?.results ?? []) as SearchResult[]);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        statusEl.textContent = '検索に失敗しました。';
        console.error(err);
      }
    }, 250);
  });
}
