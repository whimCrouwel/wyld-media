-- Featured帯は「commissioned_by が入っていて公開から featured_window_days 日以内」を
-- 最新順に featured_count 件まで表示する形に変える(picks the latest N within a rolling
-- window, instead of always the latest N regardless of age)。列の追加だけで、
-- フィルタ本体は src/lib/content.ts 側(アプリ層)で行う。
alter table public.settings
  add column featured_window_days int not null default 14 check (featured_window_days >= 0);
