import { describe, it, expect, vi } from 'vitest';
import { requestUploadUrl, uploadToR2 } from '../src/lib/r2-upload';

function fakeSupabase(ticket: { uploadUrl: string; publicUrl: string; headers: Record<string, string> }) {
  return {
    functions: {
      invoke: vi.fn(async (name: string, _opts: { body: unknown }) => {
        expect(name).toBe('r2-upload-url');
        return { data: ticket, error: null };
      }),
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('requestUploadUrl', () => {
  it('invokes r2-upload-url with contentType/contentLength/kind', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: {} };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const result = await requestUploadUrl(supabase, file, 'image');
    expect(result).toEqual(ticket);
    expect(supabase.functions.invoke).toHaveBeenCalledWith('r2-upload-url', {
      body: { contentType: 'image/webp', contentLength: 1, kind: 'image' },
    });
  });
});

describe('uploadToR2', () => {
  it('uploads the file via PUT and returns the public url', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: { 'Content-Type': 'image/webp' } };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(ticket.uploadUrl);
      expect(init.method).toBe('PUT');
      return new Response(null, { status: 200 });
    });
    const result = await uploadToR2(supabase, file, 'image', fetchFn as unknown as typeof fetch);
    expect(result).toEqual({ url: ticket.publicUrl });
  });

  it('throws UPLOAD_FAILED when the PUT is not ok', async () => {
    const ticket = { uploadUrl: 'https://r2.test/put', publicUrl: 'https://img.test/x.webp', headers: {} };
    const supabase = fakeSupabase(ticket);
    const file = new File(['x'], 'x.webp', { type: 'image/webp' });
    const fetchFn = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(
      uploadToR2(supabase, file, 'image', fetchFn as unknown as typeof fetch),
    ).rejects.toThrow('UPLOAD_FAILED: 500');
  });
});
