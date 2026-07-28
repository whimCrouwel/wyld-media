import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'admin' | 'writer' | 'provider';

export interface AdminProfile {
  id: string;
  role: Role;
  slug: string;
  name: string;
  certified: boolean;
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

export interface MyProfile {
  name: string;
  avatarUrl: string | null;
  certified: boolean;
}

// ナビ・見出しのアバター/名前表示用。fetchMyRole と同じ形。
export async function fetchMyProfile(supabase: SupabaseClient): Promise<MyProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles').select('name, avatar_url, certified').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { name: data.name, avatarUrl: data.avatar_url ?? null, certified: data.certified ?? false };
}

export async function fetchAllProfiles(supabase: SupabaseClient): Promise<AdminProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, slug, name, certified')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    role: r.role as Role,
    slug: r.slug,
    name: r.name,
    certified: r.certified,
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

export async function updateProviderCertification(
  supabase: SupabaseClient, id: string, certified: boolean,
): Promise<void> {
  const { data, error } = await supabase
    .from('profiles').update({ certified }).eq('id', id).select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('CERTIFICATION_UPDATE_DENIED');
}

export interface InviteInput {
  email: string;
  name: string;
  slug: string;
  role: 'writer' | 'provider';
  certified?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function validateInviteInput(input: InviteInput): string | null {
  if (!EMAIL_RE.test(input.email)) return 'メールアドレスを正しく入力してください';
  if (!input.name.trim()) return '名前を入力してください';
  if (!SLUG_RE.test(input.slug)) return 'スラッグは小文字英数字とハイフンで入力してください';
  if (input.role !== 'writer' && input.role !== 'provider') return '種別を選択してください';
  if (input.certified && input.role !== 'provider') return '認定はサービスプロバイダーにのみ設定できます';
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

export interface AuditArticle {
  id: string;
  title: string;
  authorName: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  moderationHold: boolean;
  moderationHoldReason: string | null;
}

// admin専用の全記事監査ビュー。writer は自分の記事しか見えない(RLS)ので、
// これは is_admin() バイパスに乗って全著者分を返す。
export async function fetchAllArticlesForAudit(supabase: SupabaseClient): Promise<AuditArticle[]> {
  const { data, error } = await supabase
    .from('articles')
    .select(
      'id, title, status, published_at, moderation_hold, moderation_hold_reason, ' +
      'author:profiles!articles_author_id_fkey(name)',
    )
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    authorName: (row.author as unknown as { name: string } | null)?.name ?? '(不明)',
    status: row.status,
    publishedAt: row.published_at,
    moderationHold: row.moderation_hold,
    moderationHoldReason: row.moderation_hold_reason,
  }));
}

// 審査によるホールドの設置/解除。moderation_hold 系の列以外には触れない
// (admin であっても本文編集はここを通らない)。設置時は理由が必須(DBトリガーでも強制)。
export async function setModerationHold(
  supabase: SupabaseClient, articleId: string, hold: boolean, reason?: string,
): Promise<void> {
  if (hold && !reason?.trim()) throw new Error('MODERATION_HOLD_REASON_REQUIRED');
  const update = hold
    ? { moderation_hold: true, moderation_hold_reason: reason!.trim() }
    : { moderation_hold: false };
  const { data, error } = await supabase
    .from('articles').update(update).eq('id', articleId).select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('MODERATION_HOLD_UPDATE_DENIED');
}

export interface SiteSettings {
  postIntervalDays: number;
  featuredCount: number;
  featuredWindowDays: number;
  pageSize: number;
}

export async function fetchSettings(supabase: SupabaseClient): Promise<SiteSettings> {
  const { data, error } = await supabase
    .from('settings')
    .select('post_interval_days, featured_count, featured_window_days, page_size')
    .eq('id', 1)
    .single();
  if (error) throw error;
  return {
    postIntervalDays: data.post_interval_days,
    featuredCount: data.featured_count,
    featuredWindowDays: data.featured_window_days,
    pageSize: data.page_size,
  };
}

export async function updateSettings(supabase: SupabaseClient, s: SiteSettings): Promise<void> {
  if (!Number.isInteger(s.postIntervalDays) || s.postIntervalDays < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.featuredCount) || s.featuredCount < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.featuredWindowDays) || s.featuredWindowDays < 0) throw new Error('INVALID_SETTINGS');
  if (!Number.isInteger(s.pageSize) || s.pageSize < 1) throw new Error('INVALID_SETTINGS');
  const { data, error } = await supabase
    .from('settings')
    .update({
      post_interval_days: s.postIntervalDays,
      featured_count: s.featuredCount,
      featured_window_days: s.featuredWindowDays,
      page_size: s.pageSize,
    })
    .eq('id', 1)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('SETTINGS_UPDATE_DENIED');
}
