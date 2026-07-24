import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchPricingItems, createPricingItem, updatePricingItem,
  deletePricingItem, reorderPricingItems, validatePricingItem,
} from '../src/lib/pricing';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const adminClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });
const kentaClient = createClient(url, anon, { auth: { persistSession: false } });

let hanaId = '';
let kentaId = '';

beforeAll(async () => {
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
  const h = await hanaClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (h.error) throw h.error;
  hanaId = h.data.user!.id;
  const k = await kentaClient.auth.signInWithPassword({
    email: 'kenta@seed.local', password: 'seed-pass-1234',
  });
  if (k.error) throw k.error;
  kentaId = k.data.user!.id;
});

// admin は他人の行も消せるので、テスト後の掃除は admin クライアントに任せる。
async function cleanupByLabelPrefix(prefix: string) {
  await adminClient.from('pricing_items').delete().like('label', `${prefix}%`);
}

describe('validatePricingItem', () => {
  it('正しい入力は null', () => {
    expect(validatePricingItem({ label: '基本記事', unit: '1本', amount: 8000 })).toBeNull();
  });
  it('空の項目名を弾く', () => {
    expect(validatePricingItem({ label: '  ', unit: '1本', amount: 8000 })).toContain('項目名');
  });
  it('負の単価を弾く', () => {
    expect(validatePricingItem({ label: '基本', unit: '1本', amount: -1 })).toContain('0以上');
  });
  it('小数の単価を弾く', () => {
    expect(validatePricingItem({ label: '基本', unit: '1本', amount: 1.5 })).toContain('0以上');
  });
});

describe('fetchPricingItems', () => {
  const prefix = '__test_fetch_';
  afterAll(() => cleanupByLabelPrefix(prefix));

  it('自分の writer_id 分だけを sort_order 昇順で返す', async () => {
    await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}B`, unit: '1本', amount: 100, sortOrder: 20,
    });
    await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}A`, unit: '1本', amount: 100, sortOrder: 10,
    });
    const items = await fetchPricingItems(hanaClient, hanaId);
    const testRows = items.filter((i) => i.label.startsWith(prefix));
    expect(testRows.map((i) => i.label)).toEqual([`${prefix}A`, `${prefix}B`]);
  });

  it('他の writer の行は RLS で見えない', async () => {
    // kenta が自分の下書きを作る → hana からは fetch できない
    await createPricingItem(kentaClient, kentaId, {
      label: `${prefix}kenta_own`, unit: '1本', amount: 100,
    });
    const asHana = await fetchPricingItems(hanaClient, kentaId);
    expect(asHana.find((i) => i.label === `${prefix}kenta_own`)).toBeUndefined();
  });
});

describe('createPricingItem', () => {
  const prefix = '__test_create_';
  afterAll(() => cleanupByLabelPrefix(prefix));

  it('自分の writer_id で作成できる', async () => {
    const created = await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}ok`, unit: '1本', amount: 8000,
    });
    expect(created.id).toBeTruthy();
    expect(created.writerId).toBe(hanaId);
    expect(created.amount).toBe(8000);
    expect(created.published).toBe(true);
  });

  it('他人の writer_id は RLS で拒否される', async () => {
    await expect(createPricingItem(hanaClient, kentaId, {
      label: `${prefix}denied`, unit: '1本', amount: 8000,
    })).rejects.toThrow();
  });

  it('admin は他人の writer_id でも作成できる', async () => {
    const created = await createPricingItem(adminClient, hanaId, {
      label: `${prefix}by_admin`, unit: '1本', amount: 500,
    });
    expect(created.writerId).toBe(hanaId);
  });

  it('不正な入力は送信前に弾く', async () => {
    await expect(createPricingItem(hanaClient, hanaId, {
      label: '   ', unit: '1本', amount: 8000,
    })).rejects.toThrow('項目名');
  });
});

describe('updatePricingItem', () => {
  const prefix = '__test_update_';
  let hanaRowId = '';

  beforeAll(async () => {
    const row = await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}row`, unit: '1本', amount: 100,
    });
    hanaRowId = row.id;
  });
  afterAll(() => cleanupByLabelPrefix(prefix));

  it('自分の行は更新できる', async () => {
    await updatePricingItem(hanaClient, hanaRowId, {
      label: `${prefix}row`, unit: '1本', amount: 250,
    });
    const items = await fetchPricingItems(hanaClient, hanaId);
    const updated = items.find((i) => i.id === hanaRowId)!;
    expect(updated.amount).toBe(250);
  });

  it('他人の行は RLS で 0 行 → PRICING_UPDATE_DENIED', async () => {
    await expect(updatePricingItem(kentaClient, hanaRowId, {
      label: `${prefix}row`, unit: '1本', amount: 999,
    })).rejects.toThrow('PRICING_UPDATE_DENIED');
  });
});

describe('deletePricingItem', () => {
  const prefix = '__test_delete_';
  afterAll(() => cleanupByLabelPrefix(prefix));

  it('自分の行は削除できる', async () => {
    const row = await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}row`, unit: '1本', amount: 100,
    });
    await deletePricingItem(hanaClient, row.id);
    const items = await fetchPricingItems(hanaClient, hanaId);
    expect(items.find((i) => i.id === row.id)).toBeUndefined();
  });

  it('他人の行は RLS で 0 行 → PRICING_DELETE_DENIED', async () => {
    const row = await createPricingItem(hanaClient, hanaId, {
      label: `${prefix}denied`, unit: '1本', amount: 100,
    });
    await expect(deletePricingItem(kentaClient, row.id))
      .rejects.toThrow('PRICING_DELETE_DENIED');
  });
});

describe('reorderPricingItems', () => {
  const prefix = '__test_reorder_';
  const ids: string[] = [];

  beforeAll(async () => {
    for (const suffix of ['a', 'b', 'c']) {
      const row = await createPricingItem(hanaClient, hanaId, {
        label: `${prefix}${suffix}`, unit: '1本', amount: 100, sortOrder: 10,
      });
      ids.push(row.id);
    }
  });
  afterAll(() => cleanupByLabelPrefix(prefix));

  it('渡した順に sort_order を10刻みで書き戻す', async () => {
    // 逆順にする
    await reorderPricingItems(hanaClient, [ids[2], ids[1], ids[0]]);
    const items = await fetchPricingItems(hanaClient, hanaId);
    const mine = items.filter((i) => ids.includes(i.id));
    const orderIds = mine.map((i) => i.id);
    expect(orderIds).toEqual([ids[2], ids[1], ids[0]]);
    expect(mine.map((i) => i.sortOrder)).toEqual([10, 20, 30]);
  });
});
