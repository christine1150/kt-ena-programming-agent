-- IPTV 활용 3단계 — 주간·월간 보고서의 "IPTV 셋톱 요약" 한 단락 계산(2026-11-11 사용자 승인 "네", 보고서 단락 진행).
-- 원칙 1: 지표는 DB 에서 계산하고 보고서·LLM은 읽기만 한다. IPTV 는 보조 자료(청약·공식 KPI 기준은 닐슨).
-- 한 자사 채널(IPTV 채널명) × 타깃(household/p2049)의 분석 기간과 직전 비교 기간을 요약한다.
--  · 시청률·도달률은 방영 길이 가중 평균, 1인당 시청 분 = 1분 시청자 × 방영 분 ÷ 도달자의 중앙값.
--  · 순위는 그 기간 방영 10회 이상인 경쟁·UHD 채널과 이 채널 안에서 시청률로 매긴다(다른 자사 채널은 뺌).
--  · 프로그램 TOP 3 은 기간 안 본방(재방 태그 제외) 방영 3회 이상 프로그램을 평균 시청률 순으로 뽑는다.
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 실행.

create or replace function iptv_report_summary(p_channel text, p_target text, p_from date, p_to date, p_prev_from date, p_prev_to date)
returns table (
  last_date date,
  airings int,
  avg_rating numeric,
  avg_reach_rate numeric,
  minutes_per_reacher numeric,
  prev_airings int,
  prev_avg_rating numeric,
  observed_channels int,
  rating_rank int,
  top_programs jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with cur as (
    select m.* from iptv_airing_metrics m
    where m.channel_name = p_channel and m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0
  ), prev as (
    select m.* from iptv_airing_metrics m
    where m.channel_name = p_channel and m.target_kind = p_target and m.broadcast_date between p_prev_from and p_prev_to and m.duration_min > 0
  ), chan as (
    select m.channel_name,
      count(*)::int n,
      sum(m.rating * m.duration_min) / nullif(sum(m.duration_min) filter (where m.rating is not null), 0) r
    from iptv_airing_metrics m
    where m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0
      and (m.channel_name = p_channel or m.channel_group in ('comp', 'uhd'))
    group by m.channel_name
    having count(*) >= 10
  ), mine as (
    select c.r from chan c where c.channel_name = p_channel
  ), progs as (
    select c.program_key, min(c.program_name) pname, count(*)::int n,
      sum(c.rating * c.duration_min) / nullif(sum(c.duration_min) filter (where c.rating is not null), 0) r,
      (percentile_cont(0.5) within group (order by (c.avg_minute_viewers::numeric * c.duration_min / nullif(c.reach_viewers, 0))) filter (where c.reach_viewers > 0))::numeric mpr
    from cur c
    where not c.is_rerun_tag
    group by c.program_key
    having count(*) >= 3 and sum(c.rating * c.duration_min) is not null
  ), top3 as (
    select coalesce(jsonb_agg(jsonb_build_object('name', t.pname, 'airings', t.n, 'rating', round(t.r, 5), 'minutes_per_reacher', round(t.mpr, 1)) order by t.r desc), '[]'::jsonb) j
    from (select * from progs order by r desc limit 3) t
  )
  select
    (select max(a.broadcast_date) from iptv_tvindex_airings a where a.channel_name = p_channel and a.target_kind = p_target),
    (select count(*)::int from cur),
    (select round(sum(c.rating * c.duration_min) / nullif(sum(c.duration_min) filter (where c.rating is not null), 0), 5) from cur c),
    (select round(sum(c.reach_rate * c.duration_min) / nullif(sum(c.duration_min) filter (where c.reach_rate is not null), 0), 4) from cur c),
    (select round((percentile_cont(0.5) within group (order by (c.avg_minute_viewers::numeric * c.duration_min / nullif(c.reach_viewers, 0))) filter (where c.reach_viewers > 0))::numeric, 1) from cur c),
    (select count(*)::int from prev),
    (select round(sum(c.rating * c.duration_min) / nullif(sum(c.duration_min) filter (where c.rating is not null), 0), 5) from prev c),
    (select count(*)::int from chan),
    (select (1 + count(*) filter (where c.r > (select r from mine)))::int from chan c where exists (select 1 from mine)),
    (select j from top3);
$$;

revoke all on function iptv_report_summary(text, text, date, date, date, date) from public, anon, authenticated;
