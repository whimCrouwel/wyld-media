import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と PUBLIC_SUPABASE_ANON_KEY を admin/.env に設定してください',
  );
}

// ブラウザ専用クライアント。anon キー + ユーザーセッション(localStorage)。
// service role キーはここに絶対に入れないこと。
export const supabaseBrowser = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
