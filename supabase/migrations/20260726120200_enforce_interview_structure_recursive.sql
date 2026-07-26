-- Fix (task-2 review): 20260726120100_enforce_interview_structure.sql の
-- enforce_interview_structure はトップレベル (jsonb_array_elements(new.body)) だけを
-- 走査していたため、interview を許可する親コンテナ (blockquote: content='block+',
-- listItem: content='paragraph block*') 内にネストされた interview は5チェック全てを
-- 素通りしていた。一方で body_asset_urls は再帰CTEなので、同じネスト位置にある
-- アバターURLは列挙・ホスト検証されており、両者が食い違って穴になっていた。
-- 加えて interview.content 内の非 turn ノードは continue で黙ってスキップしていたため、
-- {"type":"paragraph"} が混入しても "≥1件" 判定と turn ループを両方通り抜けてしまう。
--
-- 修正:
--   1. body 全体を再帰的に走査し、任意の深さの interview ノードを収集して検証する
--      (body_asset_urls と同じ recursive-CTE パターン)。
--   2. interview.content 内に type != 'turn' の子ノードがあれば
--      INTERVIEW_INVALID_CHILD で拒否する (これまで silent-skip)。

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

  -- 再帰的にすべての interview ノードを収集する。Tiptap のノードグループ設計上、
  -- interview は group='block' なので blockquote / listItem など block を受け入れる
  -- コンテナの中にも入り得る。それらを見逃すと DB 側の構造検証が抜ける。
  for interview_node in
    with recursive nodes as (
      select jsonb_array_elements(new.body) as n
      union all
      select jsonb_array_elements(n->'content')
      from nodes
      where jsonb_typeof(n->'content') = 'array'
    )
    select n from nodes where n->>'type' = 'interview'
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

    -- interview 直下は turn のみ許可し、speaker が speakers に存在すること。
    -- ここは以前 "continue" で非 turn を素通しさせていたため、
    -- {"type":"paragraph"} などが混入しても検出できない穴になっていた。
    for turn_node in
      select value from jsonb_array_elements(interview_node -> 'content') as value
    loop
      if turn_node ->> 'type' <> 'turn' then
        raise exception 'INTERVIEW_INVALID_CHILD';
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
  'interview ノードの話者数(2-4)・キー連番・turn.speaker 参照整合を検証する (body 全体を再帰走査)。';
