begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000010', 'tok-writer@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'tok-provider@test.local'),
  ('00000000-0000-0000-0000-000000000012', 'tok-other-writer@test.local'),
  ('00000000-0000-0000-0000-000000000013', 'tok-other-provider@test.local');

insert into profiles (id, role, slug, name) values
  ('00000000-0000-0000-0000-000000000010', 'writer', 'tok-writer', 'Writer'),
  ('00000000-0000-0000-0000-000000000011', 'provider', 'tok-provider', 'Provider'),
  ('00000000-0000-0000-0000-000000000012', 'writer', 'tok-other-writer', 'Other Writer'),
  ('00000000-0000-0000-0000-000000000013', 'provider', 'tok-other-provider', 'Other Provider');

-- act as provider
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into commission_tokens (id, writer_id)
    values ('50000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000010')$$,
  'provider issues a token to a writer');

select matches(
  (select token from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '^WM-[0-9A-F]{8}$',
  'issued token has the expected format');

select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'provider_id is forced to the caller');

select lives_ok(
  $$insert into commission_tokens (id, writer_id, provider_id)
    values ('50000000-0000-0000-0000-000000000002',
            '00000000-0000-0000-0000-000000000010',
            '00000000-0000-0000-0000-000000000013')$$,
  'a spoofed provider_id does not error (silently overwritten)');
select is(
  (select provider_id from commission_tokens
    where id = '50000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'the spoofed provider_id is forced back to the actual caller');

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000013')$$,
  '%INVALID_WRITER%',
  'the target must have role=writer (a provider id is rejected)');

-- act as a writer (not a provider)
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into commission_tokens (writer_id)
    values ('00000000-0000-0000-0000-000000000012')$$,
  '%NOT_A_PROVIDER%',
  'a writer cannot issue commission tokens');

select ok(
  exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'the target writer can see a token issued to them');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
set local role authenticated;
select ok(
  not exists(select 1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
  'an unrelated provider cannot see another provider''s token');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;
select ok(
  exists(select 1 from commission_tokens where writer_id = '00000000-0000-0000-0000-000000000010'),
  'the issuing provider can see their own issued tokens');

select ok(
  exists(select 1 from profiles where id = '00000000-0000-0000-0000-000000000010'),
  'an authenticated provider can read a writer profile (needed for the "pick a writer" UI)');

-- resolve: articles への解決
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

-- stash the raw token value while it's still visible under the writer's own
-- RLS view (commission_tokens select policy only allows the issuing provider
-- or the recipient writer to see a row); a later test needs this literal
-- value from a session that cannot see the row at all.
select token as tok1 from commission_tokens where id = '50000000-0000-0000-0000-000000000001' \gset

select lives_ok(
  $$insert into articles (id, author_id, title, commission_token_input)
    values ('60000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000010',
            'commissioned draft',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'))$$,
  'writer publishes using a token issued to them');

select is(
  (select commissioned_by from articles where id = '60000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000011'::uuid,
  'commissioned_by resolved from the token''s provider');

select is(
  (select commission_token_id from articles where id = '60000000-0000-0000-0000-000000000001'),
  '50000000-0000-0000-0000-000000000001'::uuid,
  'commission_token_id resolved to the matching token');

select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'),
    '60000000-0000-0000-0000-000000000001'),
  'Provider',
  'RPC still returns the provider name when article_id excludes the article that legitimately holds the token');

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'bad token', 'WM-NOPE0000')$$,
  '%INVALID_COMMISSION_TOKEN%',
  'an unknown token is rejected');

-- act as a different writer the token was not issued to
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
set local role authenticated;

-- built dynamically (rather than the usual $$...$$ literal) because this
-- writer's own RLS view of commission_tokens cannot see a row issued to
-- someone else, so a same-session subquery would silently resolve to NULL
-- instead of exercising the WRONG_WRITER branch; tok1 was captured above
-- while still visible to its rightful recipient.
select throws_like(
  'insert into articles (author_id, title, commission_token_input) values (' ||
    quote_literal('00000000-0000-0000-0000-000000000012') || ', ' ||
    quote_literal('wrong writer') || ', ' ||
    quote_literal(:'tok1') || ')',
  '%COMMISSION_TOKEN_WRONG_WRITER%',
  'a token issued to a different writer is rejected');

-- back to the token's actual writer: reusing an already-linked token is rejected
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

select throws_like(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'second use',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000001'))$$,
  '%COMMISSION_TOKEN_ALREADY_USED%',
  'a token already linked to another article cannot be reused');

select lives_ok(
  $$update articles set commission_token_input = null
    where id = '60000000-0000-0000-0000-000000000001'$$,
  'the commission link can be cleared');
select is(
  (select commissioned_by from articles where id = '60000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the token input clears commissioned_by');
select is(
  (select commission_token_id from articles where id = '60000000-0000-0000-0000-000000000001'),
  null::uuid,
  'clearing the token input clears commission_token_id');

-- validate_commission_token RPC (used by the editor's blur-time preview)
select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002')),
  'Provider',
  'RPC returns the provider name for a valid, unused token belonging to the caller');
select is(
  public.validate_commission_token('WM-NOPE0000'),
  null::text,
  'RPC returns null for an unknown token');

select lives_ok(
  $$insert into articles (author_id, title, commission_token_input)
    values ('00000000-0000-0000-0000-000000000010', 'second commissioned',
            (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002'))$$,
  'writer publishes a second commissioned article using token #2');
select is(
  public.validate_commission_token(
    (select token from commission_tokens where id = '50000000-0000-0000-0000-000000000002')),
  null::text,
  'RPC returns null once the token has been used by an article');

select * from finish();
rollback;
