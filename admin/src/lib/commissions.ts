import type { SupabaseClient } from '@supabase/supabase-js';

export interface WriterOption {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  bio: string;
}

export async function fetchWriters(supabase: SupabaseClient): Promise<WriterOption[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, slug, name, region, bio')
    .eq('role', 'writer')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, region: r.region, bio: r.bio,
  }));
}

export async function issueCommissionToken(
  supabase: SupabaseClient, writerId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('commission_tokens')
    .insert({ writer_id: writerId })
    .select('token')
    .single();
  if (error) throw error;
  return data.token as string;
}

export type TokenStatus = 'pending' | 'used' | 'revoked';

export interface CommissionToken {
  id: string;
  token: string;
  providerName: string;
  writerName: string;
  createdAt: string;
  status: TokenStatus;
  articleId: string | null;
  articleTitle: string | null;
}

interface TokenRow {
  id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
  provider: { name: string } | { name: string }[] | null;
  writer: { name: string } | { name: string }[] | null;
  articles: { id: string; title: string } | { id: string; title: string }[] | null;
}

// PostgREST の to-one 埋め込みは環境により object / array 両方があり得るので吸収する
// (src/lib/content.ts の one() と同じ理由)
function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toTokenStatus(revokedAt: string | null, article: { id: string } | null): TokenStatus {
  if (article) return 'used';
  if (revokedAt) return 'revoked';
  return 'pending';
}

function mapTokenRow(r: TokenRow): CommissionToken {
  const provider = one<{ name: string }>(r.provider);
  const writer = one<{ name: string }>(r.writer);
  const article = one<{ id: string; title: string }>(r.articles);
  return {
    id: r.id,
    token: r.token,
    providerName: provider?.name ?? '',
    writerName: writer?.name ?? '',
    createdAt: r.created_at,
    status: toTokenStatus(r.revoked_at, article),
    articleId: article?.id ?? null,
    articleTitle: article?.title ?? null,
  };
}

const TOKEN_SELECT =
  'id, token, created_at, revoked_at, ' +
  'provider:profiles!commission_tokens_provider_id_fkey(name), ' +
  'writer:profiles!commission_tokens_writer_id_fkey(name), ' +
  'articles(id, title)';

// provider: 自分が発行したトークンの履歴
export async function fetchMyIssuedTokens(supabase: SupabaseClient): Promise<CommissionToken[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const { data, error } = await supabase
    .from('commission_tokens')
    .select(TOKEN_SELECT)
    .eq('provider_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as TokenRow[]).map(mapTokenRow);
}

// admin: 全プロバイダー分のトークン一覧
export async function fetchAllTokens(supabase: SupabaseClient): Promise<CommissionToken[]> {
  const { data, error } = await supabase
    .from('commission_tokens')
    .select(TOKEN_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as TokenRow[]).map(mapTokenRow);
}

export async function revokeCommissionToken(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase
    .from('commission_tokens')
    // revoked_at の実値は DB トリガーが now() で上書きする(サーバー権威)。
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('REVOKE_DENIED');
}

export function translateCommissionError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (msg.includes('NOT_A_PROVIDER')) return 'プロバイダーのみ依頼を作成できます。';
  if (msg.includes('INVALID_WRITER')) return '依頼先がライターではありません。';
  if (msg.includes('TOKEN_IN_USE_CANNOT_REVOKE')) return '使用済みのトークンは取り消せません。';
  if (msg.includes('COMMISSION_TOKEN_ALREADY_REVOKED')) return 'このトークンは既に取り消されています。';
  if (msg.includes('COMMISSION_INTERVAL_NOT_ELAPSED')) {
    return '同じライターへの依頼は一定の間隔を空ける必要があります。しばらくしてから再度お試しください。';
  }
  return '操作に失敗しました。時間をおいて再度お試しください。';
}
