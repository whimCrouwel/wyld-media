import type { SupabaseClient } from '@supabase/supabase-js';

export async function triggerChunking(
  supabase: SupabaseClient, articleId: string,
): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('chunk-article', {
      body: { articleId },
    });
    if (error) console.warn('chunk-article failed:', error);
  } catch (err) {
    console.warn('chunk-article failed:', err);
  }
}
