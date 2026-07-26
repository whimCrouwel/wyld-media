begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- 前提: image_base_url を固定
update settings set image_base_url = 'https://img.test' where id = 1;

-- テスト用ライター
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000c1', 'iv-writer@test.local');
insert into profiles (id, role, slug, name)
values ('00000000-0000-0000-0000-0000000000c1', 'writer', 'iv-writer', 'IV Writer');

-- 以降を iv-writer として実行する (08_media_library.test.sql と同じ手当て)。
-- block_media_in_use は auth.uid() が null (=認証コンテキストなしの superuser 実行)
-- だと無条件でチェックをバイパスするため、これがないと末尾の MEDIA_IN_USE 検証が
-- 「削除できてしまう」という誤ったグリーンになる。
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
set local role authenticated;

-- 正常系: 2人インタビュー
-- 話者Aのアバターは、末尾の MEDIA_IN_USE 検証で media テーブルにも同じ URL を
-- 登録するため、enforce_media_url が要求する所有者UUIDプレフィックス付きにする
-- (media テーブルの URL 規約であり、articles.body 側の画像URLには本来不要)。
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ok-2', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"米田","role":"聞き手","avatarUrl":"https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp"},
        {"key":"B","name":"川崎","role":"代表","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
        {"type":"turn","attrs":{"speaker":"B"},"content":[{"type":"text","text":"y"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  '2人インタビューは通る'
);

-- 正常系: 4人座談会
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ok-4', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
        {"type":"turn","attrs":{"speaker":"D"},"content":[{"type":"text","text":"z"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  '4人座談会は通る'
);

-- 異常系: 話者1人
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-1', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_COUNT', '話者1人は拒否'
);

-- 異常系: 話者5人
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-5', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"},
        {"key":"E","name":"E","role":"","avatarUrl":"https://img.test/e.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_COUNT', '話者5人は拒否'
);

-- 異常系: キー飛び番 (A, C)
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-gap', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_KEY_SEQUENCE', 'キー飛び番は拒否'
);

-- 異常系: 名前空
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-name', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_NAME_EMPTY', '名前空は拒否'
);

-- 異常系: 未登録話者を参照
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-ref', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"C"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_TURN_SPEAKER_UNKNOWN', '未登録話者への参照は拒否'
);

-- 異常系: turn 0件
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-empty', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_EMPTY_TURNS', 'turn 0件は拒否'
);

-- 異常系: interview.content に turn 以外が混入
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-child', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]},
        {"type":"paragraph","content":[{"type":"text","text":"stray"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_INVALID_CHILD', 'interview 直下の非 turn ノードは拒否'
);

-- 異常系: アバターURLが image_base_url 外
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-host', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://evil.example/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'IMAGE_HOST_NOT_ALLOWED', 'アバターURLの非許可ホストは拒否'
);

-- 異常系: nested interview (blockquote 内) の構造違反も検出
-- interview は group='block' なので Tiptap 上 blockquote/listItem の子になれる。
-- トップレベルだけを走査する初期実装ではこれを見逃していた (task-2 review 指摘)。
select throws_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ng-nested', $j$[
      {"type":"blockquote","content":[
        {"type":"interview","attrs":{"speakers":[
          {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"}
        ]},"content":[
          {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
        ]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'P0001', 'INTERVIEW_SPEAKER_COUNT', 'blockquote 内にネストされた不正 interview も拒否'
);

-- 異常系: nested interview の合法パターンは通る
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-ok-nested', $j$[
      {"type":"blockquote","content":[
        {"type":"interview","attrs":{"speakers":[
          {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
          {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"}
        ]},"content":[
          {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
        ]}
      ]}
    ]$j$::jsonb, 'draft')$$,
  'blockquote 内にネストされた合法 interview は通る (再帰スキャンの正常系)'
);

-- 検証: body_asset_urls('image') が interview 内のアバターも返す
select set_eq(
  $$select public.body_asset_urls((select body from articles where slug = 'iv-ok-2'), 'image')$$,
  $$values ('https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp'), ('https://img.test/b.webp')$$,
  'body_asset_urls は interview のアバターも列挙する'
);

-- 検証: アバターは image 数上限にはカウントしない (MAX_BODY_IMAGES=5、interview アバターは別枠)
-- 4人インタビュー(=4アバター) + image ノード5件 → 通る
select lives_ok(
  $$insert into articles (author_id, title, slug, body, status)
    values ('00000000-0000-0000-0000-0000000000c1', 't', 'iv-images-ok', $j$[
      {"type":"interview","attrs":{"speakers":[
        {"key":"A","name":"A","role":"","avatarUrl":"https://img.test/a.webp"},
        {"key":"B","name":"B","role":"","avatarUrl":"https://img.test/b.webp"},
        {"key":"C","name":"C","role":"","avatarUrl":"https://img.test/c.webp"},
        {"key":"D","name":"D","role":"","avatarUrl":"https://img.test/d.webp"}
      ]},"content":[
        {"type":"turn","attrs":{"speaker":"A"},"content":[{"type":"text","text":"x"}]}
      ]},
      {"type":"image","attrs":{"url":"https://img.test/1.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/2.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/3.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/4.webp"}},
      {"type":"image","attrs":{"url":"https://img.test/5.webp"}}
    ]$j$::jsonb, 'draft')$$,
  'アバター4枚 + image5枚 は通る (別カウント)'
);

-- 検証: block_media_in_use が interview 内アバターも参照中とみなす
insert into media (owner_id, url, bytes)
values ('00000000-0000-0000-0000-0000000000c1', 'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp', 1000);

select throws_ok(
  $$delete from media where url = 'https://img.test/00000000-0000-0000-0000-0000000000c1/a.webp'$$,
  'P0001', 'MEDIA_IN_USE', 'interview のアバターは media から削除できない'
);

select * from finish();
rollback;
