import type { SupabaseClient } from '@supabase/supabase-js';

export type AnnouncementAudience = 'writer' | 'provider' | 'end_user';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
}

const VALID_AUDIENCES: AnnouncementAudience[] = ['writer', 'provider', 'end_user'];

export function validateAnnouncementInput(input: AnnouncementInput): string | null {
  if (!input.title.trim()) return 'タイトルを入力してください';
  if (!input.body.trim()) return '本文を入力してください';
  if (input.audiences.length === 0) return '対象を1つ以上選択してください';
  if (input.audiences.some((a) => !VALID_AUDIENCES.includes(a))) return '対象の指定が不正です';
  return null;
}

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  audiences: AnnouncementAudience[];
  published: boolean;
  created_at: string;
  updated_at: string;
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audiences: row.audiences,
    published: row.published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// admin: 下書き含む全件。writer/provider: 自分向け公開済みのみ(RLSが出し分ける)。
export async function fetchAnnouncements(
  supabase: SupabaseClient, opts?: { limit?: number },
): Promise<Announcement[]> {
  let query = supabase
    .from('announcements')
    .select('id, title, body, audiences, published, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (opts?.limit) query = query.limit(opts.limit);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toAnnouncement);
}

export async function createAnnouncement(
  supabase: SupabaseClient, input: AnnouncementInput,
): Promise<void> {
  const validationError = validateAnnouncementInput(input);
  if (validationError) throw new Error(validationError);
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('announcements').insert({
    title: input.title.trim(),
    body: input.body.trim(),
    audiences: input.audiences,
    published: input.published,
    created_by: user?.id ?? null,
  });
  if (error) throw error;
}

export async function updateAnnouncement(
  supabase: SupabaseClient, id: string, input: AnnouncementInput,
): Promise<void> {
  const validationError = validateAnnouncementInput(input);
  if (validationError) throw new Error(validationError);
  const { data, error } = await supabase
    .from('announcements')
    .update({
      title: input.title.trim(),
      body: input.body.trim(),
      audiences: input.audiences,
      published: input.published,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('ANNOUNCEMENT_UPDATE_DENIED');
}

export async function deleteAnnouncement(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.from('announcements').delete().eq('id', id).select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('ANNOUNCEMENT_DELETE_DENIED');
}
