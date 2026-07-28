import type { SupabaseClient } from '@supabase/supabase-js';

export interface EndUserAnnouncement {
  id: string;
  title: string;
  body: string;
}

// end_user向けに公開中の最新1件だけを取得する。anon key + RLS
// (published=true and 'end_user' = ANY(audiences) の行のみ anon から見える)。
export async function fetchLatestEndUserAnnouncement(
  supabase: SupabaseClient,
): Promise<EndUserAnnouncement | null> {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
