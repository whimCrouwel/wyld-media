import { generateHTML } from '@tiptap/core';
import sanitizeHtml from 'sanitize-html';
import type { JSONContent } from '@tiptap/core';
import { blockExtensions } from './extensions';

// @tiptap/core の generateHTML は内部で prosemirror-model の
// DOMSerializer.serializeFragment を document オプション無しで呼ぶため、
// グローバルな `window`/`document`(ブラウザのDOM)が無いと動かない
// (prosemirror-modelのソースコメント: "When not in the browser, the
// `document` option ... should be passed" — だが@tiptap/coreはそれを
// 呼び出し元に公開していない)。admin(Vite/ブラウザ)では既にwindowが
// 存在するので何もしない。公開サイトのAstroビルド(Node.js、DOM無し)
// ではjsdomでその場限りのDOMを用意する。
//
// createRequireの取得はトップレベルの `import { createRequire } from
// 'node:module'` にせず、あえて動的import('node:module')経由にしている。
// Vite/Rollupはブラウザ向けビルドでもトップレベルimportを静的に解析し、
// node:moduleを解決しようとしてビルド自体を失敗させる(ブラウザ向けの
// node:module外部化スタブにcreateRequireが存在しないため)。動的import()は
// 静的なnamed-import解決の対象外になるため、この関数はNode実行時にのみ
// 到達する(typeof windowガード)ことと合わせて、ブラウザ向けバンドルに
// jsdomの中身(fs等のNode API)が静的に取り込まれることはない。
// なお eval('require') はCommonJS的スコープでしか解決できず、本物の
// Node ESM(Astroの本番ビルド)では ReferenceError: require is not defined に
// なるため使えない。動的import('node:module')は本物のNode ESMでも動く。
async function ensureDomGlobals(): Promise<void> {
  if (typeof (globalThis as unknown as { window?: unknown }).window !== 'undefined') return;
  const { createRequire } = await import('node:module');
  const nodeRequire = createRequire(import.meta.url);
  const { JSDOM } = nodeRequire('jsdom') as typeof import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.Element = dom.window.Element;
  g.DocumentFragment = dom.window.DocumentFragment;
}

function isAllowedAssetUrl(url: string | null | undefined, imageBaseUrl: string): boolean {
  if (!url || !imageBaseUrl) return false;
  return url.startsWith(`${imageBaseUrl}/`);
}

// image/file ノードのurlがimageBaseUrl配下でなければ、そのノードごと
// ドキュメントから取り除く(HTML生成前にJSONレベルでフィルタする方が、
// 生成後のHTML文字列を正規表現でいじるより確実)。
function dropDisallowedAssets(node: JSONContent, imageBaseUrl: string): JSONContent | null {
  if ((node.type === 'image' || node.type === 'file') && !isAllowedAssetUrl(node.attrs?.url, imageBaseUrl)) {
    return null;
  }
  if (node.content) {
    return { ...node, content: node.content.map((c) => dropDisallowedAssets(c, imageBaseUrl)).filter((c): c is JSONContent => c !== null) };
  }
  return node;
}

// generateHTMLは見出しにidを付与しないため、見出しテキストをそのままid属性
// にする後処理を行う(admin側プレビューと公開サイトの目次リンク遷移が
// 同じidを指せるようにするため)。
// 見出しは太字やリンクなどのインラインマークを含みうる(例: <h3>strongを含む<strong>太字部分</strong></h3>)。
// 内側を[^<]*だけで拾う単純な正規表現だとネストしたタグがある見出しに
// マッチせずidが付かないため、内側は非貪欲に[\s\S]*?で丸ごと拾い、
// id用のテキストだけタグを取り除いて計算する。
function addHeadingIds(html: string): string {
  return html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (match, level, inner) => {
    const text = inner.replace(/<[^>]+>/g, '');
    const id = text.replace(/"/g, '&quot;');
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

// <section data-block="interview" data-speakers='[...json...]'>...</section> を検出し、
// 内部の <div data-block="turn" data-speaker="X"> にアバター画像+名前/役職の span を
// 先頭子要素として注入する。sanitize 前(=まだタグがストリップされていない生HTML)
// に対して実行する必要がある — 注入した <img>/<span>/<div> も sanitize allowlist の
// 対象になるため、sanitize 後に実行すると意味がない。
//
// この regex の [^>]* は data-speakers 属性値の中身をまたいで走査するため、
// 属性値に literal な `<`/`>` が含まれると section タグの終端と誤認して壊れる。
// これは Interview.renderHTML (packages/blocks-renderer/src/extensions.ts) 側で
// speakers JSON の <, >, & を \uXXXX にエスケープしていることで担保している。
// Tiptap の generateHTML は " を &quot; に escape するがそれ以外の文字は
// escape しないので、以下では &quot; のみ decode すれば十分。
function injectInterviewSpeakers(html: string): string {
  return html.replace(
    /<section([^>]*data-block="interview"[^>]*)>([\s\S]*?)<\/section>/g,
    (_, sectionAttrs: string, inner: string) => {
      const match = sectionAttrs.match(/data-speakers=(?:"([^"]*)"|'([^']*)')/);
      if (!match) return `<section${sectionAttrs}>${inner}</section>`;
      const raw = match[1] ?? match[2] ?? '[]';
      let speakers: Array<{ key: string; name: string; role: string; avatarUrl: string }> = [];
      try {
        speakers = JSON.parse(raw.replace(/&quot;/g, '"'));
      } catch {
        return `<section${sectionAttrs}>${inner}</section>`;
      }
      const byKey = new Map(speakers.map((s) => [s.key, s]));
      // 直前の turn と同じ話者なら「連続発言」として class="turn--cont" を追記し、
      // アバター/名前の再注入は省略する(CSS 側で bubble のみ表示するよう畳む)。
      // Turn.content は inline* なので inner に <div> は入らない → 非貪欲 <\/div> で安全に閉じられる。
      let prevKey: string | null = null;
      const rewritten = inner.replace(
        /<div([^>]*data-block="turn"[^>]*data-speaker="([^"]+)"[^>]*)>([\s\S]*?)<\/div>/g,
        (_full, divAttrs: string, key: string, turnInner: string) => {
          const s = byKey.get(key);
          const isCont = prevKey === key;
          prevKey = key;
          const attrs = isCont
            ? divAttrs.replace(/class="([^"]*)"/, (_m, cls) => `class="${cls} turn--cont"`)
            : divAttrs;
          const bubble = `<div class="turn__bubble">${turnInner}</div>`;
          if (!s || isCont) return `<div${attrs}>${bubble}</div>`;
          const roleHtml = s.role ? `<span class="turn__role">${escapeHtml(s.role)}</span>` : '';
          return (
            `<div${attrs}>` +
            `<img class="turn__avatar" src="${escapeAttr(s.avatarUrl)}" alt="${escapeAttr(s.name)}" />` +
            `<div class="turn__who"><span class="turn__name">${escapeHtml(s.name)}</span>${roleHtml}</div>` +
            bubble +
            `</div>`
          );
        },
      );
      return `<section${sectionAttrs}>${rewritten}</section>`;
    },
  );
}

// TrailingNode 拡張が doc の末尾に必ず空 paragraph を挿入するので、公開HTML側では
// 末尾の空 paragraph だけを取り除く(スタイル上の余白ノイズを防ぐため)。
// 途中の空段落はユーザーが意図的に入れた区切りかもしれないので触らない。
function trimTrailingEmptyParagraphs(content: JSONContent[]): JSONContent[] {
  const out = [...content];
  while (out.length > 0) {
    const last = out[out.length - 1];
    if (last.type === 'paragraph' && (!last.content || last.content.length === 0)) {
      out.pop();
    } else {
      break;
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export async function renderBlocksToHtml(doc: JSONContent, imageBaseUrl: string): Promise<string> {
  await ensureDomGlobals();
  const filtered: JSONContent = {
    type: 'doc',
    content: trimTrailingEmptyParagraphs(
      (doc.content ?? []).map((n) => dropDisallowedAssets(n, imageBaseUrl)).filter((n): n is JSONContent => n !== null),
    ),
  };
  const raw = generateHTML(filtered, blockExtensions);
  const withIds = addHeadingIds(raw);
  // sanitize 前に interview セクションのアバター/名前を注入する(sanitize 前で
  // ないと、注入した img/span/div が allowlist を通らず消えてしまう)。
  const withInterview = injectInterviewSpeakers(withIds);
  return sanitizeHtml(withInterview, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'iframe', 'section']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      h2: ['id'], h3: ['id'],
      img: ['src', 'alt', 'class'],
      a: ['href', 'download', 'target', 'rel'],
      iframe: ['src', 'sandbox', 'referrerpolicy', 'loading'],
      section: ['class', 'data-block', 'data-speakers'],
      div: ['class', 'data-block', 'data-speaker'],  // turn / turn__who 用
      span: ['class'],
    },
  });
}
