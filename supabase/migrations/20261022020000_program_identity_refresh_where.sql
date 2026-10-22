-- 작품 식별 계층 재생성이 API(rpc)로 호출되지 못하던 문제 수정(2026-10-22, 승인 A3 정기 갱신의 전제).
-- 원인: Supabase API 경로는 WHERE 없는 DELETE·UPDATE를 막는다(safeupdate, "DELETE requires a WHERE clause").
-- refresh_program_identity()의 "delete from program_identity"가 그래서 실패했고, 마이그레이션(직접 연결)에서 한 번 돌린 10/01 이후 갱신이 멈췄다.
-- 계산 내용은 그대로 두고 전체 삭제·전체 갱신 문장에 "where true"만 붙인다(apply_program_aliases도 같은 이유).

create or replace function refresh_program_identity()
returns jsonb
language plpgsql
set statement_timeout = '300s'
as $$
declare
  v_asof date;
  v_rows int;
begin
  select max(r.broadcast_date) into v_asof from ratings r where r.source_type = 'nielsen_daily';

  create temporary table if not exists tmp_identity_stats (k text, disp text, own_chans text[], comp_chans text[], n_total int, n_91 int, d0 date, d1 date) on commit delete rows;
  insert into tmp_identity_stats
  with comp as (
    select upper(c.norm_program_name) as k,
           mode() within group (order by regexp_replace(c.program_name, '<[^>]*>', '', 'g')) as disp,
           array_agg(distinct c.competitor_name) as chans,
           count(*)::int as n_total,
           count(*) filter (where c.broadcast_date > v_asof - 91)::int as n_91,
           min(c.broadcast_date) as d0,
           max(c.broadcast_date) as d1
    from competitor_program_target_ratings c
    where c.target_label = '개인2049'
    group by upper(c.norm_program_name)
  ),
  own as (
    select purchase_norm_key(p.canonical_name) as k,
           (array_agg(p.canonical_name order by length(p.canonical_name) desc))[1] as disp,
           array_agg(distinct ch.code) as chans,
           sum(s.n)::int as n_total,
           sum(s.n91)::int as n_91,
           min(s.d0) as d0,
           max(s.d1) as d1
    from programs p
    join channels ch on ch.id = p.channel_id
    join lateral (
      select count(distinct (r.broadcast_date, r.start_time))::int as n,
             count(distinct (r.broadcast_date, r.start_time)) filter (where r.broadcast_date > v_asof - 91)::int as n91,
             min(r.broadcast_date) as d0,
             max(r.broadcast_date) as d1
      from ratings r
      where r.program_id = p.id and r.source_type = 'nielsen_daily'
    ) s on s.n > 0
    group by purchase_norm_key(p.canonical_name)
  )
  select coalesce(o.k, c.k) as k,
         coalesce(o.disp, c.disp) as disp,
         coalesce(o.chans, '{}'::text[]) as own_chans,
         coalesce(c.chans, '{}'::text[]) as comp_chans,
         coalesce(o.n_total, 0) + coalesce(c.n_total, 0) as n_total,
         coalesce(o.n_91, 0) + coalesce(c.n_91, 0) as n_91,
         least(o.d0, c.d0) as d0,
         greatest(o.d1, c.d1) as d1
  from own o
  full outer join comp c on c.k = o.k
  where coalesce(o.k, c.k) <> '';

  delete from program_identity where true;
  insert into program_identity (key, display_name, jamo_key, group_key, own_channels, comp_channels, airings_total, airings_91d, first_date, last_date, is_special)
  select s.k, s.disp, purchase_hangul_jamo(s.k),
         coalesce((select a.group_key from program_alias a where a.alias_key = s.k and a.status = 'confirmed'), s.k),
         s.own_chans, s.comp_chans, s.n_total, s.n_91, s.d0, s.d1,
         s.k ~ '(스페셜|특집|특별판|몰아보기|하이라이트|베스트|SPECIAL)'
  from tmp_identity_stats s;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('identity_rows', v_rows, 'as_of', v_asof);
end;
$$;

create or replace function apply_program_aliases()
returns int
language plpgsql
as $$
declare
  v_rows int;
begin
  update program_identity i
     set group_key = coalesce((select a.group_key from program_alias a where a.alias_key = i.key and a.status = 'confirmed'), i.key),
         updated_at = now()
   where true;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
