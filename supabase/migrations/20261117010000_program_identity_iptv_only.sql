-- 프로그램 성과 검색 목록에 "IPTV 셋톱 자료만 있는 자사 작품"도 넣는다(2026-11-17, 예: skyUHD 더 캡처 — 닐슨 프로그램 자료 없음).
-- 20261102010000 의 refresh_program_identity 그대로 + iptv_tvindex_airings(자사) 작품을 own 쪽에 합친다(닐슨 자료가 있는 작품은 기존 값 유지).

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
      and not (c.start_time = time '02:00:00' and exists (
        select 1 from competitor_program_target_ratings t
        where t.broadcast_date = c.broadcast_date - 1
          and t.competitor_name = c.competitor_name
          and t.target_label = c.target_label
          and t.end_time between time '01:59:00' and time '02:00:00'
          and regexp_replace(t.program_name, '<[^>]*>', '', 'g') = regexp_replace(c.program_name, '<[^>]*>', '', 'g')))
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
        and not (r.start_time = time '02:00:00' and exists (
          select 1 from ratings t
          where t.program_id = r.program_id
            and t.source_type = 'nielsen_daily'
            and t.broadcast_date = r.broadcast_date - 1
            and t.end_time between time '01:59:00' and time '02:00:00'))
    ) s on s.n > 0
    group by purchase_norm_key(p.canonical_name)
  ),
  -- IPTV 셋톱 자료만 있는 자사 작품(닐슨 프로그램 자료 없음) — 2026-11-17 추가
  iptv as (
    select purchase_norm_key(a.program_name) as k,
           (array_agg(a.program_name order by length(a.program_name) desc))[1] as disp,
           array_agg(distinct ch.code) as chans,
           count(distinct (a.broadcast_date, a.start_minute))::int as n_total,
           count(distinct (a.broadcast_date, a.start_minute)) filter (where a.broadcast_date > v_asof - 91)::int as n_91,
           min(a.broadcast_date) as d0,
           max(a.broadcast_date) as d1
    from iptv_tvindex_airings a
    join channels ch on ch.name = a.channel_name
    where a.channel_group = 'own'
    group by purchase_norm_key(a.program_name)
  ),
  own_all as (
    select coalesce(o.k, i.k) as k,
           coalesce(o.disp, i.disp) as disp,
           case when o.k is not null then o.chans else i.chans end as chans,
           o.n_total, o.n_91, o.d0, o.d1,
           (o.k is null) as iptv_only,
           i.n_total as i_total, i.n_91 as i_91, i.d0 as i_d0, i.d1 as i_d1
    from own o
    full outer join iptv i on i.k = o.k
  )
  select coalesce(o.k, c.k) as k,
         coalesce(o.disp, c.disp) as disp,
         coalesce(o.chans, '{}'::text[]) as own_chans,
         coalesce(c.chans, '{}'::text[]) as comp_chans,
         coalesce(case when o.iptv_only then o.i_total else o.n_total end, 0) + coalesce(c.n_total, 0) as n_total,
         coalesce(case when o.iptv_only then o.i_91 else o.n_91 end, 0) + coalesce(c.n_91, 0) as n_91,
         least(case when o.iptv_only then o.i_d0 else o.d0 end, c.d0) as d0,
         greatest(case when o.iptv_only then o.i_d1 else o.d1 end, c.d1) as d1
  from own_all o
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
