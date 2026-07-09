import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requestUploadUrl, uploadCover } from '../src/lib/images';

const TICKET = {
  uploadUrl: 'https://r2.example/bucket/key?sig=abc',
  publicUrl: 'https://img.example/key',
  headers: { 'Content-Type': 'image/webp' },
};

function stubSupabase(result: { data: unknown; error: unknown }) {
  const calls: unknown[] = [];
  const supabase = {
    functions: {
      invoke: async (name: string, opts: unknown) => {
        calls.push([name, opts]);
        return result;
      },
    },
  } as unknown as SupabaseClient;
  return { supabase, calls };
}

describe('requestUploadUrl', () => {
  it('contentType と contentLength を r2-upload-url に送る', async () => {
    const { supabase, calls } = stubSupabase({ data: TICKET, error: null });
    const blob = new Blob([new Uint8Array(123)], { type: 'image/webp' });
    const ticket = await requestUploadUrl(supabase, blob);
    expect(ticket).toEqual(TICKET);
    expect(calls[0]).toEqual([
      'r2-upload-url',
      { body: { contentType: 'image/webp', contentLength: 123 } },
    ]);
  });

  it('Edge Function がエラーを返したら throw する', async () => {
    const { supabase } = stubSupabase({ data: null, error: new Error('unauthorized') });
    const blob = new Blob([new Uint8Array(1)], { type: 'image/webp' });
    await expect(requestUploadUrl(supabase, blob)).rejects.toThrow('unauthorized');
  });
});

describe('uploadCover', () => {
  const blob = new Blob([new Uint8Array(10)], { type: 'image/webp' });

  it('署名付き URL に PUT して publicUrl を返す', async () => {
    const { supabase } = stubSupabase({ data: TICKET, error: null });
    const puts: unknown[] = [];
    const fetchFn = (async (url: unknown, init: unknown) => {
      puts.push([url, init]);
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    const url = await uploadCover(supabase, blob, fetchFn);

    expect(url).toBe(TICKET.publicUrl);
    const [putUrl, init] = puts[0] as [string, RequestInit];
    expect(putUrl).toBe(TICKET.uploadUrl);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual(TICKET.headers);
    expect(init.body).toBe(blob);
  });

  it('PUT が拒否されたら UPLOAD_FAILED を投げる', async () => {
    const { supabase } = stubSupabase({ data: TICKET, error: null });
    const fetchFn = (async () => ({ ok: false, status: 403 } as Response)) as typeof fetch;
    await expect(uploadCover(supabase, blob, fetchFn)).rejects.toThrow('UPLOAD_FAILED: 403');
  });
});
