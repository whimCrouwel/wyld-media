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
