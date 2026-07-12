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

export async function renderBlocksToHtml(doc: JSONContent, imageBaseUrl: string): Promise<string> {
  await ensureDomGlobals();
  const filtered: JSONContent = {
    type: 'doc',
    content: (doc.content ?? []).map((n) => dropDisallowedAssets(n, imageBaseUrl)).filter((n): n is JSONContent => n !== null),
  };
  const raw = generateHTML(filtered, blockExtensions);
  const withIds = addHeadingIds(raw);
  return sanitizeHtml(withIds, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'h3', 'iframe']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      h2: ['id'], h3: ['id'],
      img: ['src', 'alt'],
      a: ['href', 'download'],
      iframe: ['src', 'sandbox', 'referrerpolicy', 'loading'],
    },
  });
}
