-- announcements の Task 1 マイグレーションで service_role への GRANT が漏れていた
-- (RLS はバイパスするがテーブル権限は別途必要 — pricing_items と同じ理由)。
-- tests/announcements.test.ts の RLS 統合テストが service role クライアントで
-- 直接 insert/delete するために必要。
grant select, insert, update, delete on public.announcements to service_role;
