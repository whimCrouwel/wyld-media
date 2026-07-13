import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { triggerChunking } from '../src/lib/search-index';

function fakeClient(invoke: ReturnType<typeof vi.fn>): SupabaseClient {
  return { functions: { invoke } } as unknown as SupabaseClient;
}

describe('triggerChunking', () => {
  it('invokes chunk-article with the articleId', async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true, chunkCount: 3 }, error: null }));
    await triggerChunking(fakeClient(invoke), 'article-1');
    expect(invoke).toHaveBeenCalledWith('chunk-article', { body: { articleId: 'article-1' } });
  });

  it('does not throw when the function returns an error', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error('boom') }));
    await expect(triggerChunking(fakeClient(invoke), 'article-1')).resolves.toBeUndefined();
  });

  it('does not throw when invoke itself rejects', async () => {
    const invoke = vi.fn(async () => { throw new Error('network down'); });
    await expect(triggerChunking(fakeClient(invoke), 'article-1')).resolves.toBeUndefined();
  });
});
