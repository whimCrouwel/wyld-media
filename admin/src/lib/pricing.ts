import type { SupabaseClient } from '@supabase/supabase-js';

export interface PricingItem {
  id: string;
  writerId: string;
  label: string;
  unit: string;
  amount: number;
  published: boolean;
  sortOrder: number;
}

export interface PricingItemInput {
  label: string;
  unit: string;
  amount: number;
  published?: boolean;
  sortOrder?: number;
}

// Returned by validatePricingItem when the input is unusable; UI shows the string as-is.
export function validatePricingItem(input: PricingItemInput): string | null {
  if (!input.label.trim()) return '項目名を入力してください';
  if (!Number.isInteger(input.amount) || input.amount < 0) return '単価は0以上の整数で入力してください';
  return null;
}

const SELECT_COLS = 'id, writer_id, label, unit, amount, published, sort_order';

function toItem(r: {
  id: string; writer_id: string; label: string; unit: string;
  amount: number; published: boolean; sort_order: number;
}): PricingItem {
  return {
    id: r.id,
    writerId: r.writer_id,
    label: r.label,
    unit: r.unit,
    amount: r.amount,
    published: r.published,
    sortOrder: r.sort_order,
  };
}

// writer_id を絞り込まなくても RLS 側で「自分の行」だけに絞られるが、admin から他人の
// 料金を編集するケースに備えて明示的に writerId を要求する。
export async function fetchPricingItems(
  supabase: SupabaseClient, writerId: string,
): Promise<PricingItem[]> {
  const { data, error } = await supabase
    .from('pricing_items')
    .select(SELECT_COLS)
    .eq('writer_id', writerId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(toItem);
}

export async function createPricingItem(
  supabase: SupabaseClient, writerId: string, input: PricingItemInput,
): Promise<PricingItem> {
  const err = validatePricingItem(input);
  if (err) throw new Error(err);
  const { data, error } = await supabase
    .from('pricing_items')
    .insert({
      writer_id: writerId,
      label: input.label.trim(),
      unit: input.unit.trim(),
      amount: input.amount,
      published: input.published ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return toItem(data);
}

export async function updatePricingItem(
  supabase: SupabaseClient, id: string, input: PricingItemInput,
): Promise<void> {
  const err = validatePricingItem(input);
  if (err) throw new Error(err);
  const { data, error } = await supabase
    .from('pricing_items')
    .update({
      label: input.label.trim(),
      unit: input.unit.trim(),
      amount: input.amount,
      published: input.published ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  // RLS で行にマッチしなかった場合は静かに 0 行になる — 明示的にエラー化する。
  if ((data ?? []).length === 0) throw new Error('PRICING_UPDATE_DENIED');
}

export async function deletePricingItem(
  supabase: SupabaseClient, id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('pricing_items')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('PRICING_DELETE_DENIED');
}

// 並び替えは行ごとに sort_order を書き戻す。件数は10〜20想定なので個別UPDATEで十分。
export async function reorderPricingItems(
  supabase: SupabaseClient, orderedIds: string[],
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    const { data, error } = await supabase
      .from('pricing_items')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', orderedIds[i])
      .select('id');
    if (error) throw error;
    if ((data ?? []).length === 0) throw new Error('PRICING_REORDER_DENIED');
  }
}
