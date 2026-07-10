import type { SupabaseClient } from '@supabase/supabase-js';

export interface MediaItem {
  id: string;
  url: string;
  bytes: number;
  createdAt: string;
}

interface MediaRow {
  id: string;
  url: string;
  bytes: number;
  created_at: string;
}

const toItem = (row: MediaRow): MediaItem => ({
  id: row.id,
  url: row.url,
  bytes: row.bytes,
  createdAt: row.created_at,
});

// RLS により自分の画像だけが返る(管理者は全件)。
export async function listMyMedia(supabase: SupabaseClient): Promise<MediaItem[]> {
  const { data, error } = await supabase
    .from('media')
    .select('id, url, bytes, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => toItem(row as MediaRow));
}

export async function recordMedia(
  supabase: SupabaseClient, url: string, bytes: number,
): Promise<MediaItem> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const owner = userData.user;
  if (!owner) throw new Error('NOT_AUTHENTICATED');

  const { data, error } = await supabase
    .from('media')
    .insert({ owner_id: owner.id, url, bytes })
    .select('id, url, bytes, created_at')
    .single();
  if (error) throw error;
  return toItem(data as MediaRow);
}

// 順序が重要: 先に DB 行を消す。使用中なら MEDIA_IN_USE で落ち、R2 の
// オブジェクトは無傷のまま残る。逆順だと、使用中と分かる前に消してしまう。
// オブジェクト削除に失敗しても R2 に孤児が残るだけで見た目に影響はない。
export async function deleteMedia(supabase: SupabaseClient, item: MediaItem): Promise<void> {
  const { error, count } = await supabase
    .from('media')
    .delete({ count: 'exact' })
    .eq('id', item.id);
  if (error) throw error;
  if (count === 0) throw new Error('MEDIA_DELETE_DENIED');

  const { error: fnError } = await supabase.functions.invoke('r2-delete-object', {
    body: { url: item.url },
  });
  if (fnError) throw fnError;
}

export function translateMediaError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (msg.includes('MEDIA_IN_USE')) {
    return 'この画像は記事で使われているため削除できません。先に記事から外してください。';
  }
  if (msg.includes('IMAGE_HOST_NOT_ALLOWED')) {
    return '許可されていない場所の画像です。';
  }
  if (msg.includes('MEDIA_OWNER_MISMATCH') || msg.includes('MEDIA_DELETE_DENIED')) {
    return '自分がアップロードした画像だけを操作できます。';
  }
  return '画像の操作に失敗しました。時間をおいて再度お試しください。';
}
