import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  fetchWriters, issueCommissionToken, fetchMyIssuedTokens,
  fetchAllTokens, revokeCommissionToken, translateCommissionError,
} from '../src/lib/commissions';

const url = process.env.PUBLIC_SUPABASE_URL!;
const anon = process.env.PUBLIC_SUPABASE_ANON_KEY!;

const forestClient = createClient(url, anon, { auth: { persistSession: false } });
const hanaClient = createClient(url, anon, { auth: { persistSession: false } });
const adminClient = createClient(url, anon, { auth: { persistSession: false } });

let hanaId: string;

beforeAll(async () => {
  const f = await forestClient.auth.signInWithPassword({
    email: 'forest@seed.local', password: 'seed-pass-1234',
  });
  if (f.error) throw f.error;
  const h = await hanaClient.auth.signInWithPassword({
    email: 'hana@seed.local', password: 'seed-pass-1234',
  });
  if (h.error) throw h.error;
  hanaId = h.data.user!.id;
  const a = await adminClient.auth.signInWithPassword({
    email: 'admin@seed.local', password: 'seed-pass-1234',
  });
  if (a.error) throw a.error;
});

describe('fetchWriters', () => {
  it('lists writer profiles (visible to any authenticated user)', async () => {
    const writers = await fetchWriters(hanaClient);
    const slugs = writers.map((w) => w.slug);
    expect(slugs).toContain('tanaka-hana');
    expect(slugs).toContain('sato-kenta');
  });
});

describe('issueCommissionToken / fetchMyIssuedTokens / fetchAllTokens / revokeCommissionToken', () => {
  it('provider issues a token, sees it pending, admin sees it too, then revokes it', async () => {
    const token = await issueCommissionToken(forestClient, hanaId);
    expect(token).toMatch(/^WM-[0-9A-F]{8}$/);

    const mine = await fetchMyIssuedTokens(forestClient);
    const issued = mine.find((t) => t.token === token);
    expect(issued).toBeDefined();
    expect(issued!.status).toBe('pending');
    expect(issued!.writerName).toBe('田中 花');

    const all = await fetchAllTokens(adminClient);
    expect(all.some((t) => t.token === token)).toBe(true);

    await revokeCommissionToken(forestClient, issued!.id);
    const mineAfter = await fetchMyIssuedTokens(forestClient);
    expect(mineAfter.find((t) => t.token === token)!.status).toBe('revoked');
  });

  it('a writer cannot issue a token (NOT_A_PROVIDER)', async () => {
    await expect(issueCommissionToken(hanaClient, hanaId)).rejects.toThrow(/NOT_A_PROVIDER/);
  });

  it('revoking a used token fails', async () => {
    const token = await issueCommissionToken(forestClient, hanaId);
    const mine = await fetchMyIssuedTokens(forestClient);
    const issued = mine.find((t) => t.token === token)!;

    const { error } = await hanaClient.from('articles').insert({
      author_id: hanaId, title: 'commissions.test 用', body: [], commission_token_input: token,
    });
    expect(error).toBeNull();

    await expect(revokeCommissionToken(forestClient, issued.id)).rejects.toThrow();

    await hanaClient.from('articles').delete().eq('commission_token_input', token);
  });
});

describe('translateCommissionError', () => {
  it('known codes map to Japanese messages', () => {
    expect(translateCommissionError(new Error('NOT_A_PROVIDER: x'))).toContain('プロバイダー');
    expect(translateCommissionError(new Error('boom'))).toContain('失敗');
  });
});
