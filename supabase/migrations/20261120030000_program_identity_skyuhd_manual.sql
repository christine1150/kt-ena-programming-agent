-- 프로그램 성과: skyUHD 수기 파일(ratings.source_type='skyuhd')에만 있는 작품도 작품 식별 표(program_identity)에 넣는다(2026-11-20 사용자 승인).
-- 문제: 식별 갱신이 닐슨(nielsen_daily)·IPTV 셋톱만 읽어서 skyUHD 수기 프로그램 266개 중 42개(강철부대 시즌2 335회, 로앤오더 토론토 시즌1~3,
--       레지던트 에이리언 시즌3 등)가 검색·프로그램 성과에 나오지 않았다.
-- 바꾼 것(20261119020000 의 refresh_program_identity 그대로 + 아래 두 가지):
--   ① skyUHD 수기 방영을 IPTV 와 같은 '보조 자료'로 합친다 — 닐슨 자료가 없는 키는 skyUHD·IPTV 방영 수·기간으로 행을 만들고,
--      닐슨 자료가 있는 키에도 자사 채널 목록에 SKYUHD 를 더한다(skyUHD 는 닐슨 프로그램 단위 자료가 없어 겹쳐 세지 않는다).
--   ② 별칭 체인 정리 — 시즌 표기 별칭이 새로 생겨 대표 키가 다른 별칭의 별칭이 되면(레지던트에어리언3 → 레지던트에이리언3 → …시즌3)
--      마지막 대표 키로 옮긴다(최대 3단계).

create or replace function refresh_program_identity()
returns jsonb
language plpgsql
set statement_timeout = '300s'
as $$
declare
  v_asof date;
  v_rows int;
  v_i int;
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
  -- skyUHD 수기 파일 방영(source_type='skyuhd') — 2026-11-20 추가
  sky as (
    select purchase_norm_key(p.canonical_name) as k,
           (array_agg(p.canonical_name order by length(p.canonical_name) desc))[1] as disp,
           array['SKYUHD']::text[] as chans,
           count(distinct (r.broadcast_date, r.start_time))::int as n_total,
           count(distinct (r.broadcast_date, r.start_time)) filter (where r.broadcast_date > v_asof - 91)::int as n_91,
           min(r.broadcast_date) as d0,
           max(r.broadcast_date) as d1
    from programs p
    join ratings r on r.program_id = p.id and r.source_type = 'skyuhd'
    group by purchase_norm_key(p.canonical_name)
  ),
  -- 보조 자료(IPTV + skyUHD 수기) 키별 합계 — 닐슨 자료가 없는 키의 방영 수·기간으로 쓴다
  sec as (
    select coalesce(i.k, s.k) as k,
           coalesce(i.disp, s.disp) as disp,
           array(select distinct x from unnest(coalesce(i.chans, '{}'::text[]) || coalesce(s.chans, '{}'::text[])) as x) as chans,
           coalesce(i.n_total, 0) + coalesce(s.n_total, 0) as n_total,
           coalesce(i.n_91, 0) + coalesce(s.n_91, 0) as n_91,
           least(i.d0, s.d0) as d0,
           greatest(i.d1, s.d1) as d1,
           s.k is not null as has_sky
    from iptv i
    full outer join sky s on s.k = i.k
  ),
  own_all as (
    select coalesce(o.k, i.k) as k,
           coalesce(o.disp, i.disp) as disp,
           case when o.k is not null
                then case when i.has_sky and not ('SKYUHD' = any (o.chans)) then o.chans || 'SKYUHD'::text else o.chans end
                else i.chans end as chans,
           o.n_total, o.n_91, o.d0, o.d1,
           (o.k is null) as iptv_only,
           i.n_total as i_total, i.n_91 as i_91, i.d0 as i_d0, i.d1 as i_d1
    from own o
    full outer join sec i on i.k = o.k
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

  -- 시즌 표기 별칭: "…시즌N" 키와 "…N" 키가 둘 다 있을 때 후자를 전자로 합친다(2026-11-19)
  insert into program_alias (alias_key, group_key, rule, status, source, note)
  select b.k, a.k, 'season_label', 'confirmed', 'RULE_DB', '시즌 표기 차이(시즌N ↔ N) — 같은 숫자만 합침'
  from tmp_identity_stats a
  join tmp_identity_stats b on b.k = regexp_replace(a.k, '시즌(\d+)$', '\1')
  where a.k ~ '.\D시즌\d+$'
    and b.k <> a.k
    and not exists (select 1 from program_alias x where x.alias_key = a.k)
  on conflict (alias_key) do nothing;

  -- 별칭 체인 정리(2026-11-20): 대표 키가 다른 확정 별칭의 별칭이면 그 대표로 옮긴다
  for v_i in 1..3 loop
    update program_alias a
       set group_key = b.group_key
      from program_alias b
     where a.group_key = b.alias_key
       and b.status = 'confirmed'
       and b.group_key <> a.alias_key;
    exit when not found;
  end loop;

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
