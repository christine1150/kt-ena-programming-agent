-- 채널별 기간 심층 리포트용 신규 조회 2종(2026-09-09, 사용자 지시)
--
-- 사용자 요구: "일자별, 시간대별, 프로그램별, 타깃별 시청률을 모두 분석", "각 채널별 고효율
-- 프로그램을 찾아, 각 프로그램별로 시청 시간대별(특히 주요시간)·타깃별 특징을 정리", "도달율,
-- 시청시간, 시청시간 비율에서 눈에 띄는 인사이트", "요일별·시간대별 강세 구간과 보완 필요 구간".
--
-- 조사 결과 원자료(ratings)는 이미 충분했다 — 프로그램 단위 행이 타깃별로 완전히 분해돼 있고
-- reach/time_spent_seconds/time_spent_share/share가 전부 채워져 있다(skyUHD만 예외).
-- 그런데 기존 RPC로는 임의 기간에 대해 다음을 뽑을 방법이 아예 없었다:
--   · 프로그램 × 요일 × 시간대 × 5지표  (get_hourly_program_titles는 프로그램명만 주고 지표 0개,
--     get_program_slot_efficiency는 프로그램 1개 + as_of 트레일링 전용)
--   · 프로그램 단위 share/reach/time_spent  (movers·drivers는 전부 rating only)
--   · time_spent_share  (시간대/요일/프로그램 어느 함수에도 없음)
--   · 요일 × 시간대를 from/to로  (get_channel_dow_hourblock_pattern은 as_of + window_days뿐)
-- 이 두 함수가 그 빈자리를 메운다.
--
-- 설계 원칙(기존 관례 그대로 복사, 새로 발명하지 않음):
--   · language sql — plpgsql이 아니라 RETURNS TABLE 컬럼 충돌("ambiguous") 위험 자체를 피한다.
--   · 방영시간 = end_time - start_time, 자정 넘김이면 epoch 추출 후 숫자 +1440.
--     time에 interval '24 hour'를 더하면 Postgres가 24시간으로 wrap해 음수가 된다
--     (20260826030000에 문서화된 함정, 8월 한 달 프로그램 행의 4.6%가 자정 넘김).
--   · 시간대 정규화 = 2시 미만은 +24(방송일 기준 2~25시), get_hourly_rating_pattern과 동일.
--   · 요일 = extract(isodow) 1=월…7=일 + (array['월'…'일'])[dow], 다수 관례.
--   · 평균은 전부 방영시간 가중 — get_channel_monthly_program_drivers와 같은 방식이라
--     두 함수의 값이 서로 어긋나지 않는다.
--   · 프라임은 public_holidays를 참조한 요일 구분형(평일 19~23시 / 토·일·공휴일 18~23시).
--   · 결과 행 수에 명시적 limit을 둔다 — PostgREST 기본 1000행 캡에 조용히 잘리는 사고를
--     Phase 12에서 겪었으므로, 잘릴 거면 SQL이 명시적으로 자르고 호출부가 알 수 있게 한다.

-- 축 분리에 대한 실측 근거(2026-09-09, 배포 전 측정):
--   ENA 6개월 구간의 서로 다른 조합 수 — 프로그램×요일×시간대 1,578 / 프로그램×시간대 597 /
--   요일×시간대 164 / 프로그램 58.
-- 3원 교차(프로그램×요일×시간대)는 PostgREST 1000행 캡을 넘겨 조용히 잘린다. 그런데 요구사항을
-- 다시 보면 3원 교차가 필요한 곳이 없다 — 프로그램에 대해서는 "시간대별·타깃별 특징"을,
-- 채널에 대해서는 "요일별·시간대별 강세/보완"을 요구한다. 프로그램의 주력 요일은 이미
-- get_channel_monthly_program_drivers가 main_slot_dow/main_prime_dow로 준다.
-- 따라서 2원 교차 두 개로 나눠 두 함수 모두 캡 아래에 안전하게 둔다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 프로그램 × 시간대 프로파일 — "고효율 프로그램"과 그 프로그램의 시간대 특성용
drop function if exists get_channel_program_slot_profile(text, text, date, date, int, int, int, int, int);
create or replace function get_channel_program_slot_profile(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_weekday_prime_from int default 19,
  p_weekday_prime_to int default 23,
  p_weekend_prime_from int default 18,
  p_weekend_prime_to int default 23,
  p_limit int default 900
)
returns table (
  canonical_name text,
  broadcast_hour int,
  is_prime boolean,
  airings int,
  airtime_min numeric,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric
)
language sql
stable
as $$
  with raw as (
    select
      p.canonical_name as cn,
      (case when extract(hour from r.start_time) < 2
            then extract(hour from r.start_time)::int + 24
            else extract(hour from r.start_time)::int end) as bh,
      (extract(isodow from r.broadcast_date) >= 6 or h.holiday_date is not null) as wkend,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      r.rating as rt,
      r.share as sh,
      r.reach as rc,
      r.time_spent_seconds as tsec,
      r.time_spent_share as tshr
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    left join public_holidays h on h.holiday_date = r.broadcast_date
    where c.code = p_channel_code
      and t.label = p_target_label
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and r.broadcast_date between p_date_from and p_date_to
  ),
  flagged as (
    select
      w.cn, w.bh, w.wkend, w.dur, w.rt, w.sh, w.rc, w.tsec, w.tshr,
      (case when w.wkend
            then w.bh >= p_weekend_prime_from and w.bh < p_weekend_prime_to
            else w.bh >= p_weekday_prime_from and w.bh < p_weekday_prime_to end) as pr
    from raw w
  )
  select
    f.cn,
    f.bh,
    f.pr,
    count(*)::int,
    round(sum(f.dur)::numeric, 1),
    round((sum(f.rt * f.dur) / nullif(sum(f.dur) filter (where f.rt is not null), 0))::numeric, 5),
    round((sum(f.sh * f.dur) / nullif(sum(f.dur) filter (where f.sh is not null), 0))::numeric, 4),
    round((sum(f.rc * f.dur) / nullif(sum(f.dur) filter (where f.rc is not null), 0))::numeric, 5),
    round((sum(f.tsec * f.dur) / nullif(sum(f.dur) filter (where f.tsec is not null), 0))::numeric, 1),
    round((sum(f.tshr * f.dur) / nullif(sum(f.dur) filter (where f.tshr is not null), 0))::numeric, 3)
  from flagged f
  group by f.cn, f.bh, f.pr
  order by sum(f.dur) desc
  limit p_limit;
$$;
comment on function get_channel_program_slot_profile is
  '채널별 기간 심층 리포트(2026-09-09) — 프로그램 × 방송시간대 × 주요시간여부로 편성 횟수·방영시간과 5개 지표(시청률/점유율/도달율/시청시간/시청시간 비율)의 방영시간 가중 평균을 낸다. is_prime은 요일 구분 주요시간(평일 19~23시 / 토·일·공휴일 18~23시, public_holidays 참조)이라 같은 시각이라도 평일/주말이 갈린다. 프로그램·시간대·프라임 어느 축으로 롤업해도 값이 일관된다. 방영시간이 긴 순으로 최대 p_limit행.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b) 요일 × 시간대 프로파일(채널 단위) — "요일별·시간대별 강세 구간과 보완 필요 구간"용.
-- 기존 get_channel_dow_hourblock_pattern은 as_of + window_days 전용이라 임의 기간을 못 받고
-- 3시간 구간·시청률만 준다. 이쪽은 from/to를 받고 raw 시간대에 5지표를 전부 낸다.
create or replace function get_channel_dow_hour_profile(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_weekday_prime_from int default 19,
  p_weekday_prime_to int default 23,
  p_weekend_prime_from int default 18,
  p_weekend_prime_to int default 23
)
returns table (
  dow int,
  dow_label text,
  broadcast_hour int,
  day_type text,
  is_prime boolean,
  airings int,
  airtime_min numeric,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric
)
language sql
stable
as $$
  with raw as (
    select
      extract(isodow from r.broadcast_date)::int as dw,
      (case when extract(hour from r.start_time) < 2
            then extract(hour from r.start_time)::int + 24
            else extract(hour from r.start_time)::int end) as bh,
      (extract(isodow from r.broadcast_date) >= 6 or h.holiday_date is not null) as wkend,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      r.rating as rt,
      r.share as sh,
      r.reach as rc,
      r.time_spent_seconds as tsec,
      r.time_spent_share as tshr
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    left join public_holidays h on h.holiday_date = r.broadcast_date
    where c.code = p_channel_code
      and t.label = p_target_label
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and r.broadcast_date between p_date_from and p_date_to
  ),
  flagged as (
    select
      w.dw, w.bh, w.wkend, w.dur, w.rt, w.sh, w.rc, w.tsec, w.tshr,
      (case when w.wkend
            then w.bh >= p_weekend_prime_from and w.bh < p_weekend_prime_to
            else w.bh >= p_weekday_prime_from and w.bh < p_weekday_prime_to end) as pr
    from raw w
  )
  select
    f.dw,
    (array['월', '화', '수', '목', '금', '토', '일'])[f.dw],
    f.bh,
    (case when f.wkend then '주말·공휴일' else '평일' end),
    f.pr,
    count(*)::int,
    round(sum(f.dur)::numeric, 1),
    round((sum(f.rt * f.dur) / nullif(sum(f.dur) filter (where f.rt is not null), 0))::numeric, 5),
    round((sum(f.sh * f.dur) / nullif(sum(f.dur) filter (where f.sh is not null), 0))::numeric, 4),
    round((sum(f.rc * f.dur) / nullif(sum(f.dur) filter (where f.rc is not null), 0))::numeric, 5),
    round((sum(f.tsec * f.dur) / nullif(sum(f.dur) filter (where f.tsec is not null), 0))::numeric, 1),
    round((sum(f.tshr * f.dur) / nullif(sum(f.dur) filter (where f.tshr is not null), 0))::numeric, 3)
  from flagged f
  group by f.dw, f.bh, f.wkend, f.pr
  order by f.dw, f.bh;
$$;
comment on function get_channel_dow_hour_profile is
  '채널별 기간 심층 리포트(2026-09-09) — 요일 × 방송시간대별 5지표의 방영시간 가중 평균(채널 단위). 기존 get_channel_dow_hourblock_pattern이 as_of+window_days·3시간구간·시청률만 주는 것과 달리, 임의 기간(from/to)과 raw 시간대, 5지표 전부를 낸다. 조합 수가 최대 7×24×2라 결과 행이 항상 캡 아래에 있다.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 프로그램 × 타깃(연령대) × 주요시간 프로파일
--
-- "각 프로그램별로 타깃별 특징을 찾아 정리" + "일부 타깃에서 특별히 눈에 띄는 특징" 요구를 위한
-- 원자료. 채널 기준선(타깃별 평균)은 이 결과 집합을 호출부에서 롤업해 구하므로 별도 조회가 없다.
--
-- 기존 get_channel_period_demographic_program_highlights와의 차이:
--   · 그쪽은 지표를 unpivot해 metric 컬럼으로 내고 노이즈 바닥·±300% 컷을 적용한 "하이라이트"다.
--   · 이쪽은 컷 없이 원값을 그대로 내고 주요시간/비주요시간으로 갈라, 호출부가 지수를 직접
--     계산하고 강세·미진 구간을 판정할 수 있게 한다. 두 함수는 용도가 다르므로 공존한다.
--
-- 대상 프로그램은 방영시간 가중 기여도(sum(rating × 방영시간)) 상위 N개로 좁힌다 —
-- 전 프로그램 × 전 타깃 × 2로 펼치면 1000행 캡에 걸리고, 애초에 "고효율 프로그램"을 찾는 것이
-- 목적이라 편성이 미미한 프로그램까지 타깃 분해할 이유가 없다.
-- p_min_airings(기본 3)로 1~2회 편성분을 아예 후보에서 뺀다 — 실측 근거: ENA 2026-08의
-- "내아이의사생활추사랑스페셜"은 1회 편성으로 시청률 0.323·도달율 0.780이 나와 어떤 순위든
-- 1위를 차지해 버린다(같은 함정을 R절에서 이미 확인).
create or replace function get_channel_program_target_profile(
  p_channel_code text,
  p_kpi_target_label text,
  p_demographic_labels text[],
  p_date_from date,
  p_date_to date,
  p_prior_date_from date,
  p_prior_date_to date,
  p_top_n_programs int default 12,
  p_min_airings int default 3,
  p_weekday_prime_from int default 19,
  p_weekday_prime_to int default 23,
  p_weekend_prime_from int default 18,
  p_weekend_prime_to int default 23
)
returns table (
  canonical_name text,
  demographic_label text,
  is_prime boolean,
  airings int,
  airtime_min numeric,
  avg_rating numeric,
  avg_reach numeric,
  avg_time_spent_share numeric,
  prior_avg_rating numeric
)
language sql
stable
as $$
  with raw as (
    select
      p.canonical_name as cn,
      t.label as lb,
      (extract(isodow from r.broadcast_date) >= 6 or h.holiday_date is not null) as wkend,
      (case when extract(hour from r.start_time) < 2
            then extract(hour from r.start_time)::int + 24
            else extract(hour from r.start_time)::int end) as bh,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      r.rating as rt,
      r.reach as rc,
      r.time_spent_share as tshr,
      (case when r.broadcast_date between p_date_from and p_date_to then 1 else 0 end) as is_cur
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    left join public_holidays h on h.holiday_date = r.broadcast_date
    where c.code = p_channel_code
      and t.label = any(p_demographic_labels || array[p_kpi_target_label])
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and (r.broadcast_date between p_date_from and p_date_to
        or r.broadcast_date between p_prior_date_from and p_prior_date_to)
  ),
  flagged as (
    select
      w.cn, w.lb, w.dur, w.rt, w.rc, w.tshr, w.is_cur,
      (case when w.wkend
            then w.bh >= p_weekend_prime_from and w.bh < p_weekend_prime_to
            else w.bh >= p_weekday_prime_from and w.bh < p_weekday_prime_to end) as pr
    from raw w
  ),
  -- 대상 프로그램 선정: 이번 기간·KPI 타깃 기준 방영시간 가중 기여도 상위 N개, 최소 편성 횟수 충족.
  picked as (
    select f.cn as cn
    from flagged f
    where f.is_cur = 1 and f.lb = p_kpi_target_label
    group by f.cn
    having count(*) >= p_min_airings
    order by sum(f.rt * f.dur) desc
    limit p_top_n_programs
  ),
  cur as (
    select
      f.cn as cn, f.lb as lb, f.pr as pr,
      count(*)::int as ac,
      sum(f.dur) as dur_sum,
      sum(f.rt * f.dur) / nullif(sum(f.dur) filter (where f.rt is not null), 0) as ar,
      sum(f.rc * f.dur) / nullif(sum(f.dur) filter (where f.rc is not null), 0) as arc,
      sum(f.tshr * f.dur) / nullif(sum(f.dur) filter (where f.tshr is not null), 0) as atsr
    from flagged f
    join picked k on k.cn = f.cn
    where f.is_cur = 1
    group by f.cn, f.lb, f.pr
  ),
  pri as (
    select
      f.cn as cn, f.lb as lb, f.pr as pr,
      sum(f.rt * f.dur) / nullif(sum(f.dur) filter (where f.rt is not null), 0) as ar
    from flagged f
    join picked k on k.cn = f.cn
    where f.is_cur = 0
    group by f.cn, f.lb, f.pr
  )
  select
    c.cn,
    c.lb,
    c.pr,
    c.ac,
    round(c.dur_sum::numeric, 1),
    round(c.ar::numeric, 5),
    round(c.arc::numeric, 5),
    round(c.atsr::numeric, 3),
    round(pv.ar::numeric, 5)
  from cur c
  left join pri pv on pv.cn = c.cn and pv.lb = c.lb and pv.pr = c.pr
  order by c.cn, c.lb, c.pr;
$$;
comment on function get_channel_program_target_profile is
  '채널별 기간 심층 리포트(2026-09-09) — 기여도 상위 N개 프로그램에 대해 타깃(연령대) × 주요시간 여부별로 시청률·도달율·시청시간 비율의 방영시간 가중 평균과 직전 기간 시청률을 낸다. 채널 타깃 기준선은 이 결과를 호출부에서 롤업해 구하므로 추가 조회가 없다. p_min_airings(기본 3)로 1~2회 편성분을 후보에서 제외해 극단값이 순위를 지배하지 않게 한다.';
