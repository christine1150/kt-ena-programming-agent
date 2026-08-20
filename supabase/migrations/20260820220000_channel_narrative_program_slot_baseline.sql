-- 사용자 피드백(2026-08-20): 채널별 인사이트에서 "'나는SOLO'가 오늘 1.589로 최근 평균(0.196)
-- 보다 712% 높은 성적" 같은 문장이 틀린 분석이었다 — top_program_baseline/decline_program이
-- 그 프로그램의 canonical_name과 일치하는 모든 시간대·모든 요일의 방영분(본방+재방 포함, 예:
-- 새벽 재방송 블록)을 그대로 평균 내고 있어서, 주 1회만 본방하는 오리지널 드라마·예능은 낮은
-- 재방송 시청률이 평균을 크게 끌어내려 오늘의 본방 시청률과 비교하면 비정상적으로 큰 격차가
-- 나왔다. 사용자 지시: "오리지널 드라마·예능 등은 해당 채널의 본방송 기준으로 전주 또는 최근
-- 8주 본방 평균과 당일을 비교해야 함".
--
-- Fit Score MART(refresh_fit_score_mart, 20260820210000_ratings_first_run_fit_score.sql)가
-- 이미 쓰고 있는 "슬롯(dow + hour_block)" 정의를 그대로 재사용해, top_program/worst_program의
-- baseline을 "같은 요일 + 같은 시간대(start_time 시(hour) 단위, 02시 이전은 +24시로 보정)"로만
-- 좁힌다 — 매주 반복 편성되는 프로그램의 실제 본방 슬롯만 남고, 다른 요일·다른 시간대의 재방송은
-- 자연히 걸러진다. 채널 단위 평균(rating_delta_pct 등)은 사용자 지시 범위 밖이라 그대로 둔다.
--
-- baseline 기간도 채널 단위 baseline(p_baseline_days, Page1=4주/Page2=12주)과 분리해 프로그램
-- 단위 전용 파라미터 p_program_baseline_weeks(기본 8주)를 새로 받는다 — 주 1회 편성 기준으로
-- "최근 8주 본방"을 그대로 구현.
--
-- 파라미터가 하나 늘어나면 create or replace가 기존 함수를 덮어쓰지 않고 오버로드로 새로
-- 만들어버려("function name is not unique" 오류) 기존 6-parameter 시그니처를 먼저 명시적으로
-- 지운다.
drop function if exists get_channel_daily_narrative(text, text, text, text[], date, int);

create or replace function get_channel_daily_narrative(
  p_channel_code text,
  p_target_label text,
  p_program_target_label text,
  p_demographic_labels text[],
  p_as_of_date date,
  p_baseline_days int default 28,
  p_program_baseline_weeks int default 8
)
returns table (
  today_rating numeric,
  baseline_avg_rating numeric,
  rating_delta_pct numeric,
  today_rank int,
  baseline_avg_rank numeric,
  today_share numeric,
  baseline_avg_share numeric,
  today_peak_hour int,
  today_peak_rating numeric,
  baseline_peak_hour int,
  baseline_peak_rating numeric,
  top_program_name text,
  top_program_rating numeric,
  top_program_start_time time,
  top_program_baseline_avg numeric,
  top_program_baseline_days int,
  decline_program_name text,
  decline_program_rating numeric,
  decline_program_start_time time,
  decline_program_baseline_avg numeric,
  decline_program_baseline_days int,
  decline_program_delta_pct numeric,
  demographics jsonb,
  dow_baseline_avg_rating numeric
)
language sql
stable
as $$
  with baseline_range as (
    select (p_as_of_date - p_baseline_days) as from_date, (p_as_of_date - 1) as to_date
  ),
  -- 프로그램(본방) 단위 비교 전용 기간 — 채널 단위 baseline_range와 분리(사용자 지시: 8주).
  program_baseline_range as (
    select (p_as_of_date - (p_program_baseline_weeks * 7)) as from_date, (p_as_of_date - 1) as to_date
  ),
  channel_rank_today as (
    select r.rating, r.rank, r.share
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date = p_as_of_date
    limit 1
  ),
  channel_rank_baseline as (
    select avg(r.rating) as avg_rating, avg(r.rank) as avg_rank, avg(r.share) as avg_share
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between br.from_date and br.to_date
  ),
  channel_rank_dow_baseline as (
    select avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between br.from_date and br.to_date
      and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
  ),
  today_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.broadcast_date = p_as_of_date
    group by hr
  ),
  baseline_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.broadcast_date between br.from_date and br.to_date
    group by hr
  ),
  today_peak as (
    select hr, avg_rating from today_hourly order by avg_rating desc nulls last limit 1
  ),
  baseline_peak as (
    select hr, avg_rating from baseline_hourly order by avg_rating desc nulls last limit 1
  ),
  today_top_program as (
    select p.canonical_name, r.rating, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit 1
  ),
  -- "같은 요일 + 같은 시간대(본방 슬롯)"만 남긴 최근 N주 본방 평균 — Fit Score MART의
  -- same_slot 정의(day_of_week + hour_block)를 그대로 재사용, 명시적 재방송(is_first_run=false)은
  -- 제외한다.
  top_program_baseline as (
    select avg(r.rating) as avg_rating, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, program_baseline_range pbr, today_top_program ttp
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and replace(p.canonical_name, ' ', '') = replace(ttp.canonical_name, ' ', '')
      and r.broadcast_date between pbr.from_date and pbr.to_date
      and r.rating is not null
      and r.start_time is not null and ttp.start_time is not null
      and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
        = (case when extract(hour from ttp.start_time) < 2 then extract(hour from ttp.start_time)::int + 24 else extract(hour from ttp.start_time)::int end)
      and r.is_first_run is distinct from false
  ),
  today_programs as (
    select p.canonical_name, r.rating, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
  ),
  today_programs_scored as (
    select
      tpr.canonical_name, tpr.rating, tpr.start_time,
      pb.avg_rating as baseline_avg, pb.days as baseline_days,
      case when pb.avg_rating is not null and pb.avg_rating <> 0
        then ((tpr.rating - pb.avg_rating) / pb.avg_rating * 100) else null end as delta_pct
    from today_programs tpr
    left join lateral (
      select avg(r2.rating) as avg_rating, count(*) as days
      from ratings r2
      join channels c2 on c2.id = r2.channel_id
      left join targets t2 on t2.id = r2.target_id
      join programs p2 on p2.id = r2.program_id, program_baseline_range pbr
      where c2.code = p_channel_code and (t2.label = p_program_target_label or r2.target_id is null)
        and r2.source_type in ('nielsen_daily', 'skyuhd')
        and replace(p2.canonical_name, ' ', '') = replace(tpr.canonical_name, ' ', '')
        and r2.broadcast_date between pbr.from_date and pbr.to_date
        and r2.rating is not null
        and r2.start_time is not null and tpr.start_time is not null
        and extract(isodow from r2.broadcast_date) = extract(isodow from p_as_of_date)
        and (case when extract(hour from r2.start_time) < 2 then extract(hour from r2.start_time)::int + 24 else extract(hour from r2.start_time)::int end)
          = (case when extract(hour from tpr.start_time) < 2 then extract(hour from tpr.start_time)::int + 24 else extract(hour from tpr.start_time)::int end)
        and r2.is_first_run is distinct from false
    ) pb on true
  ),
  worst_program as (
    -- baseline_avg >= 0.05: 새벽 필러 프로그램의 0.000 통계 노이즈를 걸러내기 위한 최소 규모 조건.
    select canonical_name, rating, start_time, baseline_avg, baseline_days, delta_pct
    from today_programs_scored
    where delta_pct is not null and baseline_days >= 3 and delta_pct <= -30 and baseline_avg >= 0.05
    order by delta_pct asc
    limit 1
  ),
  demo_today as (
    select t.label, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date = p_as_of_date
  ),
  demo_baseline as (
    select t.label, avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between br.from_date and br.to_date
    group by t.label
  )
  select
    crt.rating as today_rating,
    round(crb.avg_rating::numeric, 5) as baseline_avg_rating,
    case when crb.avg_rating is not null and crb.avg_rating <> 0
      then round(((crt.rating - crb.avg_rating) / crb.avg_rating * 100)::numeric, 1) else null end as rating_delta_pct,
    crt.rank as today_rank,
    round(crb.avg_rank::numeric, 1) as baseline_avg_rank,
    crt.share as today_share,
    round(crb.avg_share::numeric, 4) as baseline_avg_share,
    tp.hr as today_peak_hour,
    round(tp.avg_rating::numeric, 5) as today_peak_rating,
    bp.hr as baseline_peak_hour,
    round(bp.avg_rating::numeric, 5) as baseline_peak_rating,
    ttp.canonical_name as top_program_name,
    round(ttp.rating::numeric, 5) as top_program_rating,
    ttp.start_time as top_program_start_time,
    round(tpb.avg_rating::numeric, 5) as top_program_baseline_avg,
    tpb.days::int as top_program_baseline_days,
    wp.canonical_name as decline_program_name,
    round(wp.rating::numeric, 5) as decline_program_rating,
    wp.start_time as decline_program_start_time,
    round(wp.baseline_avg::numeric, 5) as decline_program_baseline_avg,
    wp.baseline_days::int as decline_program_baseline_days,
    round(wp.delta_pct::numeric, 1) as decline_program_delta_pct,
    (
      select jsonb_agg(jsonb_build_object(
        'label', dt.label,
        'today', dt.rating,
        'baseline_avg', db.avg_rating,
        'delta_pct', case when db.avg_rating is not null and db.avg_rating <> 0
          then round(((dt.rating - db.avg_rating) / db.avg_rating * 100)::numeric, 1) else null end
      ))
      from demo_today dt
      left join demo_baseline db on db.label = dt.label
    ) as demographics,
    round(crd.avg_rating::numeric, 5) as dow_baseline_avg_rating
  from channel_rank_today crt
  full outer join channel_rank_baseline crb on true
  left join channel_rank_dow_baseline crd on true
  left join today_peak tp on true
  left join baseline_peak bp on true
  left join today_top_program ttp on true
  left join top_program_baseline tpb on true
  left join worst_program wp on true;
$$;

comment on function get_channel_daily_narrative is '채널 일일 인사이트(줄글)용 신호 계산. 채널 단위 지표(순위·점유율·시간대)는 p_baseline_days(기본 28일) 평균과 비교하고, 프로그램(top_program/decline_program) 단위 비교는 2026-08-20부터 "같은 요일 + 같은 시간대(본방 슬롯, Fit Score MART의 same_slot 정의 재사용)"로 좁힌 최근 p_program_baseline_weeks(기본 8주) 본방 평균과 비교한다 — 주 1회 편성되는 오리지널 콘텐츠가 매일 방영되는 재방송과 뒤섞여 비교되던 문제 수정.';

-- get_channel_household_top_program도 같은 문제(요일·시간대 구분 없이 같은 canonical_name의
-- 모든 방영분을 평균)를 갖고 있었다 — "ENA Play '나는SOLO'가 오늘 0.140(점유율 1.33%)로 최근
-- 12주 평균(0.065)보다 115% 높은 성과" 문장이 이 함수 결과였다. 위와 동일하게 같은 요일 +
-- 같은 시간대(본방 슬롯) + 최근 8주로 좁힌다.
drop function if exists get_channel_household_top_program(text, date, int);

create or replace function get_channel_household_top_program(
  p_channel_code text,
  p_as_of_date date,
  p_window_days int default 84, -- 하위 호환용(더 이상 baseline 계산에 쓰지 않음, 시그니처만 유지)
  p_program_baseline_weeks int default 8
)
returns table (
  today_top_program text,
  today_top_rating numeric,
  today_top_share numeric,
  today_top_start_time time,
  baseline_avg_rating numeric,
  baseline_avg_share numeric,
  baseline_days int
)
language sql
stable
as $$
  with today_top as (
    select p.canonical_name, r.rating, r.share, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = '전국 유료가구'
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit 1
  ),
  baseline as (
    select avg(r.rating) as avg_rating, avg(r.share) as avg_share, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_top tt
    where c.code = p_channel_code and t.label = '전국 유료가구'
      and r.source_type = 'nielsen_daily'
      and replace(p.canonical_name, ' ', '') = replace(tt.canonical_name, ' ', '')
      and r.broadcast_date between (p_as_of_date - (p_program_baseline_weeks * 7)) and (p_as_of_date - 1)
      and r.rating is not null
      and r.start_time is not null and tt.start_time is not null
      and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
        = (case when extract(hour from tt.start_time) < 2 then extract(hour from tt.start_time)::int + 24 else extract(hour from tt.start_time)::int end)
      and r.is_first_run is distinct from false
  )
  select
    tt.canonical_name as today_top_program,
    round(tt.rating::numeric, 5) as today_top_rating,
    round(tt.share::numeric, 4) as today_top_share,
    tt.start_time as today_top_start_time,
    round(b.avg_rating::numeric, 5) as baseline_avg_rating,
    round(b.avg_share::numeric, 4) as baseline_avg_share,
    b.days::int as baseline_days
  from today_top tt
  left join baseline b on true;
$$;
comment on function get_channel_household_top_program is 'Page 1 채널별 인사이트 보강(ENA/ENA Play/ENA Drama 전용): 오늘 전국 유료가구 타깃 기준 최고 시청률 프로그램과, 그 프로그램의 "같은 요일 + 같은 시간대(본방 슬롯)" 최근 p_program_baseline_weeks(기본 8주) 유료가구 평균 대비 편차(2026-08-20 수정 — 이전엔 요일·시간대 구분 없이 재방송까지 섞여 평균이 비정상적으로 낮게 나왔음). 2049 타깃 기준 1위 프로그램과 다를 수 있어 별도로 확인한다.';
