-- 사용자 지시(2026-09-01): "WHO IS WATCHING?의 경우 기간대별 분석이면 WoW DoD MoM YoY 등이면
-- 분석 기간 동안 연령대가 어떻게 이동했는지를 보여주세요. 특히 그 기간 어떤 요일 어떤 시간대,
-- 어떤 컨텐츠 때문에 그런 이동이 생겼는지까지 분석하여 작성을 해주세요."
--
-- 배경: Page 2 WHO IS WATCHING?은 이미 기간 비교 모드(hasPriorRange/isRangeMode)에서
-- periodDemographics(연령대별 이번 기간 vs 전 기간 평균)로 "어느 연령대가 가장 크게 움직였는지"
-- 까지는 답하고 있었다(buildInternalDemographicNarrative의 ④번 문장). 하지만 "왜"(어떤 요일·
-- 시간대·콘텐츠 때문에)는 답하지 못했다 — 채널 전체를 요일×시간대로 쪼갠 히트맵(기존
-- get_channel_dow_hourblock_pattern)과 프로그램×타깃 교차(기존, 2026-08-28
-- get_channel_period_demographic_program_highlights)는 있었지만, "이 연령대가 어느 요일·
-- 시간대에서 움직였는지"를 직접 답하는 함수가 없었다.
--
-- 이 함수는 그 빈 자리만 채운다 — get_channel_dow_hourblock_pattern과 정확히 같은 8구간
-- (02~04, 05~07, ..., 23~25) 정의를 그대로 재사용하되, 채널 전체가 아니라 지정한 연령대별로
-- 쪼개고, get_channel_monthly_program_drivers·get_channel_period_demographic_program_highlights와
-- 같은 "이번 기간 vs 직전 기간 두 세그먼트를 한 쿼리에서 피벗" 패턴을 그대로 따른다. "어떤
-- 컨텐츠" 답은 새로 만들지 않는다 — 이미 있는 get_channel_period_demographic_program_highlights
-- (프로그램×타깃, 기간 vs 전기간)를 그대로 재조회해서 같은 연령대로 필터링하면 된다.
--
-- language sql(plpgsql 아님) + 모든 CTE 컬럼에 RETURNS TABLE 컬럼명과 다른 별칭을 둬서 이
-- 프로젝트에서 반복된 "column reference is ambiguous" 오류를 원천 차단한다.
create or replace function get_channel_demographic_dow_hourblock_shift(
  p_channel_code text,
  p_demographic_labels text[],
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date
)
returns table (
  demographic_label text,
  dow int,
  dow_label text,
  hour_block int,
  period_avg_rating numeric,
  prior_avg_rating numeric,
  period_sample_count int,
  delta numeric
)
language sql
stable
as $$
  with base as (
    select
      t.label as tl,
      extract(isodow from r.broadcast_date)::int as dw,
      (2 + 3 * floor((
        (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) - 2
      ) / 3.0))::int as hb,
      r.rating as rt,
      (case when r.broadcast_date between p_date_from and p_date_to then 1 else 0 end) as cur
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and r.program_id is not null and r.start_time is not null and r.rating is not null
      and (r.broadcast_date between p_date_from and p_date_to
        or r.broadcast_date between p_prior_date_from and p_prior_date_to)
  ),
  agg as (
    select b.tl as gtl, b.dw as gdw, b.hb as ghb, b.cur as gcur,
      avg(b.rt) as avg_rt, count(*) as cnt
    from base b
    group by b.tl, b.dw, b.hb, b.cur
  ),
  piv as (
    select
      a.gtl as ptl, a.gdw as pdw, a.ghb as phb,
      max(a.avg_rt) filter (where a.gcur = 1) as cur_avg,
      max(a.avg_rt) filter (where a.gcur = 0) as prior_avg,
      max(a.cnt) filter (where a.gcur = 1) as cur_cnt
    from agg a
    group by a.gtl, a.gdw, a.ghb
  )
  select
    p.ptl,
    p.pdw,
    (array['월', '화', '수', '목', '금', '토', '일'])[p.pdw],
    p.phb,
    round(p.cur_avg::numeric, 5),
    round(p.prior_avg::numeric, 5),
    coalesce(p.cur_cnt, 0)::int,
    round((coalesce(p.cur_avg, 0) - coalesce(p.prior_avg, 0))::numeric, 5)
  from piv p
  order by p.ptl, p.pdw, p.phb;
$$;
comment on function get_channel_demographic_dow_hourblock_shift is 'Page 2 WHO IS WATCHING? — 지정 연령대별 요일×시간대(8구간, get_channel_dow_hourblock_pattern과 동일 정의) 이번 기간 vs 직전 기간 평균 시청률·델타. "어느 연령대가 어느 요일·시간대에서 이동했는지" 답하기 위한 함수. 2026-09-01 신설.';
