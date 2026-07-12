import type { Editor } from '@tiptap/core';

// 許可ホストは DB トリガーと同期させること(権威は DB 側)。
// supabase/migrations/20260712090200_body_embed_rules.sql の
// allowed_embed_hosts と同じ6つのホスト名。
const PROVIDER_HOSTS: Record<'youtube' | 'twitter' | 'vimeo', string[]> = {
  youtube: ['www.youtube.com', 'youtu.be'],
  twitter: ['twitter.com', 'x.com'],
  vimeo: ['player.vimeo.com', 'vimeo.com'],
};

export function detectEmbedProvider(url: string): 'youtube' | 'twitter' | 'vimeo' | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [provider, hosts] of Object.entries(PROVIDER_HOSTS)) {
    if (hosts.includes(host)) return provider as 'youtube' | 'twitter' | 'vimeo';
  }
  return null;
}

// YouTube/Vimeoの「通常の視聴ページURL」はX-Frame-Options/CSPでiframe埋め込みを
// ブロックする。実際にiframeで読み込めるのは専用の埋め込みパスURLのみ
// (YouTube: /embed/{ID}、Vimeo: player.vimeo.com/video/{ID})。
// そのため貼り付けられたURLからIDを抜き出し、埋め込み可能な形に正規化してから
// 保存する(DB側のホスト許可リストは変更不要。正規化後も同じ許可ホストに収まる)。

// https://www.youtube.com/watch?v=ID (vが先頭以外の場合や他クエリと同居も可)
// https://youtu.be/ID (?si=... 等のトラッキングクエリが付くこともある)
// https://www.youtube.com/embed/ID (既に正規化済みの場合はそのままIDを返す)
export function extractYouTubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'www.youtube.com') {
    if (u.pathname === '/watch') {
      return u.searchParams.get('v') || null;
    }
    const embedMatch = u.pathname.match(/^\/embed\/([^/]+)/);
    return embedMatch ? embedMatch[1] : null;
  }
  if (host === 'youtu.be') {
    const match = u.pathname.match(/^\/([^/]+)/);
    return match ? match[1] : null;
  }
  return null;
}

// https://vimeo.com/ID (IDは数字のみ)
// https://player.vimeo.com/video/ID (既に正規化済みの場合はそのままIDを返す)
export function extractVimeoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'vimeo.com') {
    const match = u.pathname.match(/^\/(\d+)$/);
    return match ? match[1] : null;
  }
  if (host === 'player.vimeo.com') {
    const match = u.pathname.match(/^\/video\/(\d+)/);
    return match ? match[1] : null;
  }
  return null;
}

// 埋め込み可能な形にURLを正規化する。
// - youtube/vimeo: IDが抜き出せれば埋め込み専用URLに正規化する。
//   想定外のURL形状でIDが抜き出せない場合は、クラッシュさせるより
//   元のURLをそのまま保存する方が安全なのでフォールバックする
//  (どのみち埋め込み表示は空白になり得るが、保存自体は失敗させない)。
// - twitter: URLベースの単純なiframe埋め込みに対応するプロバイダAPIが無いため
//   正規化の対象外(表示側でリンクにフォールバックする。extensions.ts参照)。
export function normalizeEmbedUrl(url: string, provider: 'youtube' | 'twitter' | 'vimeo'): string {
  if (provider === 'youtube') {
    const id = extractYouTubeId(url);
    return id ? `https://www.youtube.com/embed/${id}` : url;
  }
  if (provider === 'vimeo') {
    const id = extractVimeoId(url);
    return id ? `https://player.vimeo.com/video/${id}` : url;
  }
  return url;
}

export function insertEmbedBlock(
  editor: Editor, url: string,
): { ok: true } | { ok: false; message: string } {
  const provider = detectEmbedProvider(url);
  if (!provider) {
    return { ok: false, message: '許可されていない埋め込み元です(YouTube / X / Vimeo のみ)。' };
  }
  const normalizedUrl = normalizeEmbedUrl(url, provider);
  editor.chain().focus().insertContent({
    type: 'embed',
    attrs: { url: normalizedUrl, provider },
  }).run();
  return { ok: true };
}
