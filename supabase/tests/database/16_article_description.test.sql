begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

-- Column exists
select has_column('articles', 'description', 'articles.description exists');

-- Column is nullable (so existing rows do not break the migration)
select col_is_null('articles', 'description', 'articles.description is nullable');

-- Column type is text
select col_type_is('articles', 'description', 'text', 'articles.description is text');

select * from finish();
rollback;
