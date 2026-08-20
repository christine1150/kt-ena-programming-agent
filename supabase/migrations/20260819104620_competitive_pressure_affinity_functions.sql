-- 개발 단위 16번: 타깃 분석(Affinity)·경쟁채널 분석(Competitive Pressure).
-- 공식은 CLAUDE.md에 고정된 그대로:
--   Competitive Pressure = 동시간대 상위 3개 경쟁채널 평균 시청률 ÷ 자사 프로그램 시청률 × 100 (100 클램프)
--   Affinity = 특정 Target 구성비 ÷ 비교 기준 채널의 해당 Target 구성비 × 100
--
-- 알려진 한계(정직하게 문서화): "동시간대"는 진짜 시간대별이 아니라 **하루 평균 기준**이다.
-- 원본 Nielsen 파일은 채널당 경쟁채널 1개만 프로그램 단위(시간대별)로 제공하고, Competitor
-- Master 전체 경쟁채널의 시간대별 프로그램 데이터는 없다 — 대신 "유료방송가입가구"/"개인"
-- 랭킹 시트에서 나온 하루 평균 시청률로 근사한다 (PRD.md 5번에 이미 이 한계가 명시되어 있음).

-- 1) Competitive Pressure: 채널의 등록된 경쟁채널 중 상위 3개 평균 시청률 ÷ 자사 시청률 × 100
create or replace function get_competitive_pressure(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  our_avg_rating numeric,
  top3_avg_rating numeric,
  competitive_pressure numeric,
  top3_competitors jsonb
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_our_rating numeric;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  select avg(r.rating) into v_our_rating
  from ratings r
  where r.channel_id = v_channel_id and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to;

  return query
  with competitor_avgs as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name
    where comp.channel_id = v_channel_id
      and cr.target_id = v_target_id
      and cr.broadcast_date between p_date_from and p_date_to
    group by cr.competitor_name
    having avg(cr.rating) is not null
    order by avg_rating desc
    limit 3
  )
  select
    v_our_rating,
    avg(ca.avg_rating),
    least(100, round((avg(ca.avg_rating) / nullif(v_our_rating, 0)) * 100, 1)),
    coalesce(jsonb_agg(jsonb_build_object('name', ca.competitor_name, 'rating', round(ca.avg_rating, 5)) order by ca.avg_rating desc), '[]'::jsonb)
  from competitor_avgs ca;
end;
$$;
comment on function get_competitive_pressure is 'Competitive Pressure(0~100, 100 클램프) — 등록된 경쟁채널 중 상위 3개의 일평균 시청률 ÷ 자사 일평균 시청률. "동시간대"가 아니라 기간 평균 기준(원본 파일 한계, DATA_DICTIONARY.md 참고)';

-- 2) Target Affinity: 채널의 특정 타깃 구성비(그 타깃 시청률 ÷ 채널 기준 시청률) ÷
--    비교 채널의 같은 구성비 × 100. 데이터가 있는 6개 자사 채널 사이의 비교에만 쓸 수 있다
--    (경쟁채널은 연령대별 세부 타깃 데이터가 없어 Affinity 비교 대상이 아님).
create or replace function get_target_affinity(
  p_channel_code text,
  p_channel_baseline_label text,
  p_compare_channel_code text,
  p_compare_baseline_label text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_min_sample_days int default 5
)
returns table (
  channel_target_rating numeric,
  channel_baseline_rating numeric,
  channel_composition numeric,
  compare_target_rating numeric,
  compare_baseline_rating numeric,
  compare_composition numeric,
  affinity_index numeric,
  sample_days_channel bigint,
  sample_days_compare bigint,
  insufficient_sample boolean
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_compare_id uuid;
  v_target_id uuid;
  v_channel_baseline_id uuid;
  v_compare_baseline_id uuid;
  v_channel_target numeric;
  v_channel_baseline numeric;
  v_channel_days bigint;
  v_compare_target numeric;
  v_compare_baseline numeric;
  v_compare_days bigint;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  select id into v_compare_id from channels where code = p_compare_channel_code;
  if v_channel_id is null or v_compare_id is null then
    raise exception '알 수 없는 채널 코드: % 또는 %', p_channel_code, p_compare_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;
  select id into v_channel_baseline_id from targets where label = p_channel_baseline_label;
  select id into v_compare_baseline_id from targets where label = p_compare_baseline_label;

  -- 타깃상세("하루전체" 집계) 행만 쓴다 — rank가 없고 program_id도 없는 행이 그 표시다
  -- (rank 랭킹 시트 유래 행은 rank가 채워져 있어 구분된다).
  select avg(r.rating), count(distinct r.broadcast_date) into v_channel_target, v_channel_days
  from ratings r
  where r.channel_id = v_channel_id and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null and r.rank is null
    and r.broadcast_date between p_date_from and p_date_to;

  select avg(r.rating) into v_channel_baseline
  from ratings r
  where r.channel_id = v_channel_id and r.target_id = v_channel_baseline_id
    and r.source_type = 'nielsen_daily' and r.program_id is null and r.rank is null
    and r.broadcast_date between p_date_from and p_date_to;

  select avg(r.rating), count(distinct r.broadcast_date) into v_compare_target, v_compare_days
  from ratings r
  where r.channel_id = v_compare_id and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null and r.rank is null
    and r.broadcast_date between p_date_from and p_date_to;

  select avg(r.rating) into v_compare_baseline
  from ratings r
  where r.channel_id = v_compare_id and r.target_id = v_compare_baseline_id
    and r.source_type = 'nielsen_daily' and r.program_id is null and r.rank is null
    and r.broadcast_date between p_date_from and p_date_to;

  return query
  select
    v_channel_target, v_channel_baseline,
    round(v_channel_target / nullif(v_channel_baseline, 0) * 100, 1),
    v_compare_target, v_compare_baseline,
    round(v_compare_target / nullif(v_compare_baseline, 0) * 100, 1),
    case
      when v_channel_baseline is null or v_compare_baseline is null
        or v_channel_target is null or v_compare_target is null
        or (v_compare_target / nullif(v_compare_baseline, 0)) = 0
      then null
      else round(
        (v_channel_target / nullif(v_channel_baseline, 0))
        / nullif(v_compare_target / nullif(v_compare_baseline, 0), 0) * 100, 1)
    end,
    coalesce(v_channel_days, 0),
    coalesce(v_compare_days, 0),
    (coalesce(v_channel_days, 0) < p_min_sample_days or coalesce(v_compare_days, 0) < p_min_sample_days);
end;
$$;
comment on function get_target_affinity is 'Target Affinity — 채널의 타깃 구성비(그 타깃÷채널 기준 시청률) ÷ 비교 채널의 같은 구성비 × 100. 자사 6개 채널 사이 비교만 지원(경쟁채널은 세부 타깃 데이터 없음). 표본일수가 p_min_sample_days 미만이면 insufficient_sample=true';
