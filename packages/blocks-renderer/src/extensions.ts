import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { Node } from '@tiptap/core';

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
    return [
      'section',
      {
        'data-block': 'interview',
        'data-speakers': JSON.stringify(speakers),
        class: 'interview-block',
      },
      0,
    ];
  },
});

const Turn = Node.create({
  name: 'turn',
  group: 'block',
  content: 'inline*',
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
];
