-- インタビューブロックの構造整合を強制する。
-- body 内の各 interview ノードについて:
--  * speakers 長さ 2〜4
--  * speakers[i].key が A から始まる連番 (A, AB, ABC, ABCD のいずれか)
--  * speakers[i].name が空でない
--  * content が最低 1 件の turn
--  * 各 turn.attrs.speaker が speakers[*].key に存在
--
-- 参照: docs/superpowers/specs/2026-07-26-interview-block-design.md
--       Global Constraints (docs/superpowers/plans/2026-07-26-interview-block.md)

create or replace function public.enforce_interview_structure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  interview_node jsonb;
  speakers jsonb;
  turn_node jsonb;
  speaker_key text;
  expected_key text;
  speaker_keys text[];
  i int;
begin
  -- body 未変更 UPDATE はスキップ (enforce_body_image_rules と同じ救済経路)
  if tg_op = 'UPDATE' and new.body is not distinct from old.body then
    return new;
  end if;

  if jsonb_typeof(new.body) <> 'array' then
    return new;  -- body が配列でない場合はここでは何もしない (別のガードに任せる)
  end if;

  -- トップレベルの interview ノードを走査 (現状 interview はトップレベルのみを想定)
  for interview_node in
    select value
    from jsonb_array_elements(new.body) as value
    where value->>'type' = 'interview'
  loop
    speakers := interview_node -> 'attrs' -> 'speakers';

    -- 話者数チェック (2〜4)
    if speakers is null
       or jsonb_typeof(speakers) <> 'array'
       or jsonb_array_length(speakers) < 2
       or jsonb_array_length(speakers) > 4 then
      raise exception 'INTERVIEW_SPEAKER_COUNT';
    end if;

    -- キー連番チェック (A から始まる連番)
    speaker_keys := array[]::text[];
    for i in 0 .. jsonb_array_length(speakers) - 1 loop
      expected_key := chr(65 + i);  -- 'A', 'B', 'C', 'D'
      speaker_key := speakers -> i ->> 'key';
      if speaker_key is null or speaker_key <> expected_key then
        raise exception 'INTERVIEW_KEY_SEQUENCE';
      end if;
      -- 名前空チェック
      if coalesce(nullif(speakers -> i ->> 'name', ''), '') = '' then
        raise exception 'INTERVIEW_SPEAKER_NAME_EMPTY';
      end if;
      speaker_keys := speaker_keys || speaker_key;
    end loop;

    -- turn が最低 1 件
    if jsonb_typeof(interview_node -> 'content') <> 'array'
       or jsonb_array_length(interview_node -> 'content') < 1 then
      raise exception 'INTERVIEW_EMPTY_TURNS';
    end if;

    -- 各 turn.speaker が speakers に存在
    for turn_node in
      select value from jsonb_array_elements(interview_node -> 'content') as value
    loop
      if turn_node ->> 'type' <> 'turn' then
        continue;
      end if;
      speaker_key := turn_node -> 'attrs' ->> 'speaker';
      if speaker_key is null or not (speaker_key = any(speaker_keys)) then
        raise exception 'INTERVIEW_TURN_SPEAKER_UNKNOWN';
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

comment on function public.enforce_interview_structure() is
  'interview ノードの話者数(2-4)・キー連番・turn.speaker 参照整合を検証する。';

-- トリガーバインド (既存 enforce_body_image_rules と同じく BEFORE INSERT OR UPDATE)。
-- 名前は 'b_' プレフィックスで実行順を後ろに (先に image URL 検証、次に interview 構造)。
create trigger b_enforce_interview_structure
  before insert or update on public.articles
  for each row execute function public.enforce_interview_structure();
