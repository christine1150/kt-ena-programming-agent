-- 임시 진단용 — Supabase Security Advisor 경고(RLS 비활성 테이블) 대응을 위해 public 스키마
-- 전체 테이블의 RLS 활성 여부·기존 정책 개수를 한 번에 조회한다. 실제 RLS 활성화 마이그레이션
-- 작성 후 이 함수는 삭제한다.
create or replace function tmp_list_table_rls_status()
returns table (table_name text, rls_enabled boolean, policy_count bigint, row_estimate bigint)
language sql
security definer
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
    c.reltuples::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname;
$$;
