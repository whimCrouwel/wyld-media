import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'admin' | 'writer' | 'provider';

export interface AdminProfile {
  id: string;
  role: Role;
  slug: string;
  name: string;
  commissionCode: string | null;
}

// ページのロール出し分けに使う。本物の防壁は RLS/トリガー(これは UX)。
export async function fetchMyRole(supabase: SupabaseClient): Promise<Role | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return (data?.role as Role) ?? null;
}

export async function fetchAllProfiles(supabase: SupabaseClient): Promise<AdminProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, slug, name, commission_code')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as Role,
    slug: r.slug,
    name: r.name,
    commissionCode: r.commission_code ?? null,
  }));
}

export async function updateUserRole(
  supabase: SupabaseClient, id: string, role: 'writer' | 'provider',
): Promise<void> {
  if (role !== 'writer' && role !== 'provider') throw new Error('INVALID_ROLE');
  const { data, error } = await supabase
    .from('profiles').update({ role }).eq('id', id).select('id');
  if (error) throw error;
  // RLS で行にマッチしなかった場合は静かに 0 行になる — 明示的にエラー化する
  if ((data ?? []).length === 0) throw new Error('ROLE_UPDATE_DENIED');
}

export interface InviteInput {
  email: string;
  name: string;
  slug: string;
  role: 'writer' | 'provider';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateInviteInput(input: InviteInput): string | null {
  if (!EMAIL_RE.test(input.email)) return 'メールアドレスを正しく入力してください';
  if (!input.name.trim()) return '名前を入力してください';
  if (!SLUG_RE.test(input.slug)) return 'スラッグは小文字英数字とハイフンで入力してください';
  if (input.role !== 'writer' && input.role !== 'provider') return '種別を選択してください';
  return null;
}

export async function inviteUser(supabase: SupabaseClient, input: InviteInput): Promise<void> {
  const { error } = await supabase.functions.invoke('invite-user', { body: input });
  if (!error) return;
  // FunctionsHttpError の .message は汎用文言。EF の { error: "..." } は context(Response)にある。
  const ctx = (error as { context?: Response }).context;
  const body = ctx && typeof ctx.json === 'function'
    ? await ctx.json().catch(() => null)
    : null;
  const msg = body && typeof body === 'object' && 'error' in body ? String(body.error) : null;
  throw new Error(msg ?? (error instanceof Error ? error.message : String(error)));
}

export function translateInviteError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('already been registered')) return 'このメールアドレスは既に登録されています。';
  if (msg.includes('profiles_slug_key')) return 'このスラッグは既に使われています。';
  if (msg.includes('forbidden')) return '管理者のみ実行できます。';
  if (msg.includes('required')) return '入力内容を確認してください。';
  return '招待に失敗しました。時間をおいて再度お試しください。';
}

export interface SiteSettings {
  postIntervalDays: number;
  featuredCount: number;
  pageSize: number;
}

export async function fetchSettings(supabase: SupabaseClient): Promise<SiteSettings> {
  const { data, error } = await supabase
    .from('settings').select('post_interval_days, featured_count, page_size').eq('id', 1).single();
  if (error) throw error;
  return {
    postIntervalDays: data.post_interval_days,
    featuredCount: data.featured_count,
    pageSize: data.page_size,
  };
}

export async function updateSettings(supabase: SupabaseClient, s: SiteSettings): Promise<void> {
  if (!Number.isInteger(s.postIntervalDays) || s.postIntervalDays < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.featuredCount) || s.featuredCount < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.pageSize) || s.pageSize < 1) throw new Error('INVALID_SETTINGS');
  const { data, error } = await supabase
    .from('settings')
    .update({
      post_interval_days: s.postIntervalDays,
      featured_count: s.featuredCount,
      page_size: s.pageSize,
    })
    .eq('id', 1)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('SETTINGS_UPDATE_DENIED');
}
