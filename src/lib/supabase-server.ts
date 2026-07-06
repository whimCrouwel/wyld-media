import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    'PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env に設定してください',
  );
}

// ビルド時専用クライアント。ブラウザに渡るコードから import しないこと。
export const supabaseServer = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
