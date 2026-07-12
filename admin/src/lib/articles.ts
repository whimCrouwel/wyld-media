import type { SupabaseClient } from '@supabase/supabase-js';
import type { JSONContent } from '@tiptap/core';
import { safeUrl } from './url';

export interface ArticleInput {
  title: string;
  slug: string;
  body: JSONContent[];
  coverUrl: string;
  commissionCode: string;
}

export interface ArticlePayload {
  title: string;
  slug: string | null;
  body: JSONContent[];
  cover_image_url: string | null;
  commission_code_input: string | null;
}

export interface EditableArticle {
  id: string;
  title: string;
  slug: string | null;
  body: JSONContent[];
  coverImageUrl: string | null;
  commissionCodeInput: string | null;
  status: 'draft' | 'published';
  updatedAt: string;
}

export interface SaveResult {
  updatedAt: string;
}

function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

export function buildArticlePayload(input: ArticleInput): ArticlePayload {
  return {
    title: input.title.trim(),
    slug: emptyToNull(input.slug),
    body: input.body,
    cover_image_url: safeUrl(input.coverUrl),
    commission_code_input: emptyToNull(input.commissionCode),
  };
}

export async function createDraft(supabase: SupabaseClient, input: ArticleInput): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authenticated');
  const payload = buildArticlePayload(input);
  const { data, error } = await supabase
    .from('articles')
    .insert({ ...payload, author_id: user.id, status: 'draft' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function fetchArticleForEdit(
  supabase: SupabaseClient, id: string,
): Promise<EditableArticle | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, slug, body, cover_image_url, commission_code_input, status, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    body: (data.body ?? []) as JSONContent[],
    coverImageUrl: data.cover_image_url,
    commissionCodeInput: data.commission_code_input,
    status: data.status,
    updatedAt: data.updated_at,
  };
}

export async function saveArticle(
  supabase: SupabaseClient, id: string, input: ArticleInput, publish: boolean,
  expectedUpdatedAt?: string,
): Promise<SaveResult> {
  const payload = buildArticlePayload(input);
  // publish=true のときだけ status を published に上げる。false なら status を触らない
  // (未指定にすると現状維持)。published_at は送らない(トリガーが権威)。
  const update: Record<string, unknown> = { ...payload };
  if (publish) update.status = 'published';

  let query = supabase.from('articles').update(update).eq('id', id);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

  const { data, error } = await query.select('updated_at').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(expectedUpdatedAt ? 'CONFLICT' : 'NOT_FOUND');
  return { updatedAt: data.updated_at as string };
}

export async function deleteArticle(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('articles').delete().eq('id', id);
  if (error) throw error;
}

export async function checkSlugAvailable(
  supabase: SupabaseClient, slug: string, excludeId?: string,
): Promise<boolean> {
  let query = supabase.from('articles').select('id').eq('slug', slug);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).length === 0;
}

export async function validateCommissionCode(
  supabase: SupabaseClient, code: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('validate_commission_code', { code });
  if (error) throw error;
  return (data as string | null) ?? null;
}
