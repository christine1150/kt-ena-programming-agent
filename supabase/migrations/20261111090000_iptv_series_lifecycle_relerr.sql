-- 20261111080000 의 수명 곡선 분포에 '1~2회 평균으로 3~10회 각 회를 맞혔을 때의 상대 오차'(rel_err_hold = Σ|이번−1~2회 평균| ÷ Σ이번, scope='episode' 행만)를 더한다(2026-11-11).
-- 예측 화면의 '방영 한 편은 실적과 평균 X% 차이'와 같은 잣대로, 작품 자체의 회차 흐름만으로 생기는 차이를 보여 주기 위함. 신규 추가(멱등).
alter table iptv_series_lifecycle add column if not exists rel_err_hold numeric;

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
  insert into iptv_series_lifecycle (version, channel_group, target_kind, scope, start_from, start_to, n_series, n_values, p10, p25, p50, p75, p90, rel_err_hold)
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
    select s.channel_group, s.target_kind, s.channel_name, s.program_key, fr.r / s.base v, abs(fr.r - s.base) ad, fr.r rr
    from s join fr using (channel_name, target_kind, program_key)
    where fr.k between 3 and 10 and s.base > 0
  ), sa as (
    select ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key, avg(ep.v) v from ep
    group by ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key
  ), vals as (
    select 'series_avg'::text scope, sa.channel_group, sa.target_kind, sa.channel_name, sa.program_key, sa.v, null::numeric ad, null::numeric rr from sa
    union all
    select 'episode', ep.channel_group, ep.target_kind, ep.channel_name, ep.program_key, ep.v, ep.ad, ep.rr from ep
  )
  select p_version, vals.channel_group, vals.target_kind, vals.scope, p_start_from, p_start_to,
    count(distinct (vals.channel_name, vals.program_key))::int, count(*)::int,
    round(percentile_cont(0.1) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.25) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.5) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.75) within group (order by vals.v)::numeric, 3),
    round(percentile_cont(0.9) within group (order by vals.v)::numeric, 3),
    round((sum(vals.ad) / nullif(sum(vals.rr), 0))::numeric, 3)
  from vals
  group by vals.channel_group, vals.target_kind, vals.scope
  having count(distinct (vals.channel_name, vals.program_key)) >= 30;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function compute_iptv_series_lifecycle(text, date, date) from public, anon, authenticated;
