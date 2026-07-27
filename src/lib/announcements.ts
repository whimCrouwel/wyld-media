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

const DISMISSED_KEY = 'wm-dismissed-announcement-id';

// 一度 × で閉じたお知らせは、別のお知らせ(別ID)が出るまで再表示しない。
export function shouldShowAnnouncement(id: string, dismissedId: string | null): boolean {
  return id !== dismissedId;
}

export function getDismissedAnnouncementId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function setDismissedAnnouncementId(id: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, id);
  } catch {
    // プライベートモード等でlocalStorageが使えなくても致命的ではないので握りつぶす
  }
}
