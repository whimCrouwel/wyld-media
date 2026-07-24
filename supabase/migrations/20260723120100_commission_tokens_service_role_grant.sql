-- commission_tokens には service_role へのテーブル権限付与が抜けていた(20260706122900と同じ理由:
-- service_role は RLS をバイパスするが、Postgres のテーブル権限自体は別に必要)。
-- シードスクリプトが冪等に再発行するため service role で古いトークンを削除する必要がある。
grant select, insert, update, delete on public.commission_tokens to service_role;
