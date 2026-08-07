import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Node, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      caption: { default: null },
      alt: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-block="image"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', { 'data-block': 'image', src: HTMLAttributes.url, alt: HTMLAttributes.alt }];
  },
});

const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      provider: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-block="embed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    // X/Twitterは通常のURLベースの<iframe>埋め込みに対応していない
    // (実際の埋め込みにはwidgets.jsのスクリプト実行が必要で、script非実行の
    // sanitize-htmlパイプラインとは相容れない)。動作しない空のiframeを
    // 出すよりも、正直にリンクとして表示する。
    if (HTMLAttributes.provider === 'twitter') {
      return ['div', { 'data-block': 'embed', 'data-provider': 'twitter' },
        ['a', { href: HTMLAttributes.url, target: '_blank', rel: 'noopener noreferrer' },
          `Xの投稿を見る: ${HTMLAttributes.url}`]];
    }
    return ['div', { 'data-block': 'embed', 'data-provider': HTMLAttributes.provider },
      ['iframe', {
        src: HTMLAttributes.url, sandbox: 'allow-scripts allow-same-origin allow-presentation',
        referrerpolicy: 'no-referrer', loading: 'lazy',
      }]];
  },
});

const FileBlock = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      url: { default: null },
      filename: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'a[data-block="file"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', { 'data-block': 'file', href: HTMLAttributes.url, download: HTMLAttributes.filename },
      HTMLAttributes.filename ?? ''];
  },
});

const Toc = Node.create({
  name: 'toc',
  group: 'block',
  atom: true,
  parseHTML() {
    return [{ tag: 'div[data-block="toc"]' }];
  },
  renderHTML() {
    // 目次はクライアント側(admin/src/lib/toc-panel.ts)/ビルド時に別途生成する
    // プレースホルダ。公開HTML自体には何も出力しない(空のdivのみ)。
    return ['div', { 'data-block': 'toc' }];
  },
});

const Interview = Node.create({
  name: 'interview',
  group: 'block',
  content: 'turn+',
  defining: true,
  addAttributes() {
    return {
      speakers: { default: null },
    };
  },
  parseHTML() {
    return [{
      tag: 'section[data-block="interview"]',
      getAttrs: (el) => {
        const raw = (el as HTMLElement).getAttribute('data-speakers');
        try {
          return { speakers: raw ? JSON.parse(raw) : null };
        } catch {
          return { speakers: null };
        }
      },
    }];
  },
  renderHTML({ node }) {
    const speakers = node.attrs.speakers ?? [];
    // <, >, & を JSON の \uXXXX エスケープに変換してから属性値に埋め込む。
    // これにより data-speakers の属性値の中に literal な <, >, & が
    // 一切現れなくなるので、render.ts の regex ベース post-processor
    // (injectInterviewSpeakers) が属性値中の < で誤って section タグの
    // 終端と誤認したり、名前中の & が二重エスケープされたりする問題を防ぐ。
    // JSON.parse は \uXXXX を通常のエスケープとして解釈するので、
    // parseHTML 側は変更不要 (JSON.parse でそのまま元の文字に戻る)。
    const safeJson = JSON.stringify(speakers).replace(
      /[<>&]/g,
      (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
    );
    return [
      'section',
      {
        'data-block': 'interview',
        'data-speakers': safeJson,
        class: 'interview-block',
      },
      0,
    ];
  },
});

const Turn = Node.create({
  name: 'turn',
  // 意図的にグループ指定なし: doc の 'block+' から漏れ出ないようにする。
  // Interview.content = 'turn+' が型名で直接参照するため、これでも問題ない。
  //
  // content は 'inline*' ではなく 'paragraph+' にする(2026-08-07修正)。
  // 'inline*' のままだと、クリップボードのHTMLが改行を別々の<p>として書き出す
  // アプリ(macOSの各種エディタ・Notion等)からペーストしたとき、turn(inline*)にも
  // interview(turn+)にも段落を収められず、ProseMirrorが段落をドキュメント直下まで
  // 押し出してしまい、1つのinterviewブロックが「interview→段落→interview」に
  // 分裂して見えるバグがあった。paragraph+ にすることで複数行ペーストがそのまま
  // turn内の複数paragraphとして収まる。
  content: 'paragraph+',
  defining: true,
  addAttributes() {
    return {
      speaker: { default: 'A' },
    };
  },
  parseHTML() {
    return [{
      tag: 'div[data-block="turn"]',
      getAttrs: (el) => ({ speaker: (el as HTMLElement).getAttribute('data-speaker') ?? 'A' }),
    }];
  },
  renderHTML({ node }) {
    const speaker = node.attrs.speaker ?? 'A';
    return [
      'div',
      { 'data-block': 'turn', 'data-speaker': speaker, class: `turn turn--${speaker}` },
      0,
    ];
  },
});

// doc の末尾が paragraph 以外のブロック(image / embed / interview 等)だと、
// カーソルをそのブロックの「外」に出せず、後ろに文章を追加できない。
// 常に空 paragraph で終わるよう保証する。
// 公開サイト側の render.ts は末尾の空 paragraph を trim して <p></p> の出力を防ぐ。
const TrailingNode = Extension.create({
  name: 'trailingNode',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('trailingNode'),
      appendTransaction(_transactions, _oldState, newState) {
        const { doc, schema, tr } = newState;
        const last = doc.lastChild;
        if (last && last.type.name !== 'paragraph') {
          return tr.insert(doc.content.size, schema.nodes.paragraph.create());
        }
        return null;
      },
    })];
  },
});

// 要件通りH1は無効化(見出しはH2/H3のみ、記事タイトルがH1を兼ねる)。
// コードフェンスの自動変換とH1変換は StarterKit の既定を上書きしない
// (StarterKit標準のCodeBlockはそのまま使う。H1のみ levels で除外)。
export const blockExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
  }),
  Link.configure({ openOnClick: false }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image,
  Embed,
  FileBlock,
  Toc,
  Interview,
  Turn,
  TrailingNode,
];
