-- 경쟁채널 편성 변화에 "교체 전 평균 vs 교체 후" 비교를 붙인다(2026-09-17 사용자 지시).
--
-- 지금까지 이 참고 정보는 "CNTV 8시대 A(최근 4주 고정) → 오늘 B로 교체"까지만 알려줬다.
-- 사용자 지시: "과거의 평균 시청률과 교체한 후의 시청률을 비교해서 좋은건지 안좋아진건지 같이
-- 볼 수 있도록. 색상과 세모 정도로 보여주면 긴 설명 없이 바로 결과를 알 수 있겠지."
--
-- 그래서 평소 프로그램의 같은 요일·같은 시간대 평균 시청률(usual_avg_rating)과 오늘 대비
-- 증감률(delta_pct)을 함께 돌려준다. 계산은 전부 여기(SQL)에서 한다 — CLAUDE.md 원칙대로
-- 프론트엔드는 받은 수치를 표시만 하고 산술을 하지 않는다.
--
-- 해석 주의: 이 비교는 "4주 평균(여러 회) vs 오늘 하루(1회)"라 표본 크기가 다르다. 그래서
-- 인과를 단정하는 문구가 아니라 방향 표시(▲▼)로만 쓰도록 UI 문구를 맞췄고, 평균을 낸 회차 수
-- (usual_sample_count)도 함께 내려 화면에서 근거를 밝힐 수 있게 했다.
-- Postgres는 기존 함수의 RETURNS TABLE 컬럼 구성을 create or replace로 바꿀 수 없다
-- ("cannot change return type of existing function") — 컬럼을 3개 추가하므로 먼저 지운다.
-- 인자 목록이 같은 함수가 이것 하나뿐이라 시그니처를 명시해 안전하게 지목한다.
drop function if exists get_competitor_schedule_changes(text, date, int);

create function get_competitor_schedule_changes(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_weeks int default 4
)
returns table (
  competitor_name text,
  hour_block int,
  today_program text,
  today_rating numeric,
  usual_program text,
  usual_weeks_seen int,
  usual_avg_rating numeric,
  usual_sample_count int,
  delta_pct numeric
)
language sql
stable
as $$
  with our_channel as (
    select id from channels where code = p_channel_code
  ),
  today_rows as (
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      cp.program_name,
      cp.rating
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id and cp.broadcast_date = p_as_of_date
      and cp.program_name not like '%<재>%'
  ),
  history_rows as (
    select
      cp.competitor_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hour_block,
      cp.program_name,
      cp.broadcast_date,
      cp.rating
    from competitor_program_ratings cp, our_channel
    where cp.our_channel_id = our_channel.id
      and cp.broadcast_date between p_as_of_date - (p_lookback_weeks * 7) and p_as_of_date - 1
      and extract(isodow from cp.broadcast_date) = extract(isodow from p_as_of_date)
      and cp.program_name not like '%<재>%'
  ),
  -- 같은 경쟁채널·시간대에서 가장 자주 나온 프로그램을 "평소 편성"으로 보고, 그 프로그램의
  -- 평균 시청률까지 같은 자리에서 구한다. avg는 NULL(미측정)을 건너뛰므로 측정된 방영분의
  -- 평균이 되고, 그 회차 수를 usual_sample_count로 함께 남긴다.
  usual as (
    select distinct on (h.competitor_name, h.hour_block)
      h.competitor_name,
      h.hour_block,
      h.program_name as usual_program,
      count(distinct h.broadcast_date)::int as usual_weeks_seen,
      round(avg(h.rating)::numeric, 5) as usual_avg_rating,
      count(h.rating)::int as usual_sample_count
    from history_rows h
    group by h.competitor_name, h.hour_block, h.program_name
    order by h.competitor_name, h.hour_block, count(distinct h.broadcast_date) desc
  )
  select
    t.competitor_name,
    t.hour_block,
    t.program_name as today_program,
    round(t.rating::numeric, 5) as today_rating,
    u.usual_program,
    u.usual_weeks_seen,
    u.usual_avg_rating,
    u.usual_sample_count,
    -- 평소 평균이 0이거나 없으면 증감률을 만들지 않는다(0으로 나누거나 값을 지어내지 않음).
    case
      when u.usual_avg_rating is null or u.usual_avg_rating = 0 or t.rating is null then null
      else round((((t.rating::numeric - u.usual_avg_rating) / u.usual_avg_rating) * 100)::numeric, 1)
    end as delta_pct
  from today_rows t
  left join usual u on u.competitor_name = t.competitor_name and u.hour_block = t.hour_block
  where u.usual_program is not null
    and u.usual_weeks_seen >= p_lookback_weeks
    and t.program_name is distinct from u.usual_program
  order by t.competitor_name, t.hour_block;
$$;

comment on function get_competitor_schedule_changes is 'WHY? 편성 변화 참고 정보 — 등록 경쟁채널(competitor_program_ratings) 중 같은 요일·시간대에서 최근 N주 "전부" 동일했던 프로그램(재방송 제외)과 오늘 방영분이 다른 경우만 반환. 2026-09-17 추가: 평소 프로그램의 같은 요일·시간대 평균 시청률(usual_avg_rating), 그 평균을 낸 회차 수(usual_sample_count), 오늘 대비 증감률(delta_pct)을 함께 내려 교체가 득이었는지 실이었는지 화면에서 바로 읽게 한다(인과관계 단정 아님 — 표본 크기가 4주 평균 vs 오늘 1회로 다름).';
