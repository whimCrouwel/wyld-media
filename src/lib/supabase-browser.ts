import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を .env に設定してください',
  );
}

// ブラウザ専用クライアント(検索モーダル用)。anon keyのみ。
// service role keyはここに絶対に入れないこと(それは supabase-server.ts の役目)。
export const supabaseBrowser = createClient(url, anonKey, {
  auth: { persistSession: false },
});
