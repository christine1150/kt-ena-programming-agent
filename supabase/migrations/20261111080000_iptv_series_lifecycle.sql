-- IPTV 활용 3단계 4순위 — 예측 화면 오차 범위 설명의 근거(B2 수명 곡선, 2026-11-11 사용자 승인 "4순위 진행").
-- 표본이 큰 IPTV 셋톱으로 "1~2회를 본 뒤 남은 회차가 1~2회 평균 대비 얼마나 움직이는가"를 버전별로 저장한다.
--  · scope='series_avg' : 3~10회 평균 ÷ 1~2회 평균 의 분포(시리즈 하나 = 값 하나)
--  · scope='episode'    : 3~10회 각 회 ÷ 1~2회 평균 의 분포(방영 한 편 = 값 하나) — 한 편 예측이 작품 흐름만으로 빗나갈 수 있는 폭
-- 대상: 프라임(19시 이후 시작) 본방(<재> 표기 없음), 50분 이상, 시리즈 10~24회, 첫 방영 p_start_from~p_start_to.
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 접근. IPTV 는 보조 자료(닐슨 값과 섞지 않음).

create table if not exists iptv_series_lifecycle (
  version text not null,
  channel_group text not null check (channel_group in ('own', 'comp', 'uhd')),
  target_kind text not null check (target_kind in ('household', 'p2049')),
  scope text not null check (scope in ('series_avg', 'episode')),
  start_from date not null,
  start_to date not null,
  n_series int not null,
  n_values int not null,
  p10 numeric, p25 numeric, p50 numeric, p75 numeric, p90 numeric,
  created_at timestamptz not null default now(),
  primary key (version, channel_group, target_kind, scope)
);
comment on table iptv_series_lifecycle is 'IPTV 셋톱 시리즈 회차 흐름 분포(1~2회 평균 대비 3~10회) — 예측 오차 범위 설명의 보조 근거.';
alter table iptv_series_lifecycle enable row level security;

create or replace function compute_iptv_series_lifecycle(p_version text, p_start_from date, p_start_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from iptv_series_lifecycle t where t.version = p_version;
  insert into iptv_series_lifecycle (version, channel_group, target_kind, scope, start_from, start_to, n_series, n_values, p10, p25, p50, p75, p90)
  with fr as (
    select a.channel_name, a.channel_group, a.target_kind, a.program_key, a.rating r,
      row_number() over (partition by a.channel_name, a.target_kind, a.program_key order by a.broadcast_date, a.start_minute) k,
      count(*) over (partition by a.channel_name, a.target_kind, a.program_key) n,
      min(a.broadcast_date) over (partition by a.channel_name, a.target_kind, a.program_key) d0
    from iptv_tvindex_airings a
    where not a.is_rerun_tag and a.start_minute >= 1140 and a.end_minute - a.start_minute >= 50 and a.rating > 0
  ), s as (
    select fr.channel_name, fr.channel_group, fr.target_kind, fr.program_key, avg(fr.r) filter (where fr.k <= 2) base
    from fr
    where fr.d0 between p_start_from and p_start_to and fr.n between 10 and 24
    group by fr.channel_name, fr.channel_group, fr.target_kind, fr.program_key
  ), ep as (
    select s.channel_group, s.target_kind, s.channel_name, s.program_key, fr.r / s.base v
    from s join fr using (channel_name, target_kind, program_key)
    where fr.k between 3 and 10 and s.base > 0
  ), sa as (
    select ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key, avg(ep.v) v from ep
    group by ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key
  ), vals as (
    select 'series_avg'::text scope, sa.channel_group, sa.target_kind, sa.channel_name, sa.program_key, sa.v from sa
    union all
    select 'episode', ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key, ep.v from ep
  )
  select p_version, vals.channel_group, vals.target_kind, vals.scope, p_start_from, p_start_to,
    count(distinct (vals.channel_name, vals.program_key))::int, count(*)::int,
    round(percentile_cont(0.1) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.25) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.5) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.75) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.9) within group (order by vals.v)::numeric, 3)
  from vals
  group by vals.channel_group, vals.target_kind, vals.scope
  having count(distinct (vals.channel_name, vals.program_key)) >= 30;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function compute_iptv_series_lifecycle(text, date, date) from public, anon, authenticated;
