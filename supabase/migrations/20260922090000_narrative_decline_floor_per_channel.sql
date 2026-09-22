-- 사용자 지시(2026-09-22): "'특정 프로그램 원인 없이 채널 전반 순위 하락'은 말이 안돼. 원인을
-- 찾아서 ***이유로 순위 하락. 이라고 표현해줘." (skyUHD 카드에서 발생)
--
-- 원인을 실측으로 확인했다: get_channel_daily_narrative의 worst_program(순위 하락의 원인이 될
-- 프로그램) CTE는 "baseline_avg >= 0.05"라는 고정 노이즈 필터를 쓴다(20260820170000, 새벽
-- 필러 프로그램의 0.000 급락을 노이즈로 걸러내려는 의도, "웬만한 낮 시간대 프로그램 수준"을
-- 0.05로 잡음). 그런데 이 0.05는 일반 채널(수도권 2049 등, 시청률 대역 0.01~1대)을 기준으로
-- 잡은 절대값이라, skyUHD(유료방송가구, 시청률 대역이 그보다 50~100배 작은 0.0001~0.02대)에서는
-- 어떤 프로그램도 0.05를 넘을 수 없어 decline_program이 사실상 영구적으로 null이 된다 — 그래서
-- 항상 "특정 프로그램 원인 없이"로 빠졌다. 실제로 2026-09-21 skyUHD를 직접 조회하니 '쯔양몇끼'가
-- 그 슬롯 평균(0.00103) 대비 오늘 0(-100%)을 기록한, 노이즈가 아닌 명백한 하락 원인이 있었는데도
-- 0.05 필터에 걸려 숨겨졌다.
--
-- 조치: 노이즈 필터를 파라미터화(p_decline_noise_floor, 기본값 0.05로 기존 6개 채널은 100%
-- 동일하게 동작)하고, skyUHD 호출에만 그 채널 규모에 맞는 낮은 값을 넘긴다(route.ts에서 처리).
drop function if exists get_channel_daily_narrative(text, text, text, text[], date, int, int, int);

create or replace function get_channel_daily_narrative(
  p_channel_code text,
  p_target_label text,
  p_program_target_label text,
  p_demographic_labels text[],
  p_as_of_date date,
  p_baseline_days int default 28,
  p_program_baseline_weeks int default 8,
  p_target_dow int default null,
  p_decline_noise_floor numeric default 0.05
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
  today_peak_program_name text,
  today_peak_program_rating numeric,
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
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
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
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
    group by hr
  ),
  today_peak as (
    select hr, avg_rating from today_hourly order by avg_rating desc nulls last limit 1
  ),
  baseline_peak as (
    select hr, avg_rating from baseline_hourly order by avg_rating desc nulls last limit 1
  ),
  today_peak_top_program as (
    select p.canonical_name, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_peak tpk
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) = tpk.hr
    order by r.rating desc
    limit 1
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
  top_program_baseline as (
    select avg(r.rating) as avg_rating, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_top_program ttp
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and replace(p.canonical_name, ' ', '') = replace(ttp.canonical_name, ' ', '')
      and r.rating is not null
      and r.start_time is not null and ttp.start_time is not null
      and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
        = (case when extract(hour from ttp.start_time) < 2 then extract(hour from ttp.start_time)::int + 24 else extract(hour from ttp.start_time)::int end)
      and r.is_first_run is distinct from false
      and (
        p_target_dow is null
          and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
          and r.broadcast_date between (select from_date from program_baseline_range) and (select to_date from program_baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
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
      join programs p2 on p2.id = r2.program_id
      where c2.code = p_channel_code and (t2.label = p_program_target_label or r2.target_id is null)
        and r2.source_type in ('nielsen_daily', 'skyuhd')
        and replace(p2.canonical_name, ' ', '') = replace(tpr.canonical_name, ' ', '')
        and r2.rating is not null
        and r2.start_time is not null and tpr.start_time is not null
        and (case when extract(hour from r2.start_time) < 2 then extract(hour from r2.start_time)::int + 24 else extract(hour from r2.start_time)::int end)
          = (case when extract(hour from tpr.start_time) < 2 then extract(hour from tpr.start_time)::int + 24 else extract(hour from tpr.start_time)::int end)
        and r2.is_first_run is distinct from false
        and (
          p_target_dow is null
            and extract(isodow from r2.broadcast_date) = extract(isodow from p_as_of_date)
            and r2.broadcast_date between (select from_date from program_baseline_range) and (select to_date from program_baseline_range)
          or
          p_target_dow is not null
            and r2.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
        )
    ) pb on true
  ),
  worst_program as (
    select canonical_name, rating, start_time, baseline_avg, baseline_days, delta_pct
    from today_programs_scored
    -- 변경: 고정 0.05 대신 p_decline_noise_floor(채널별로 다르게 넘길 수 있음, 기본 0.05로
    -- 기존 6개 채널은 완전히 동일하게 동작).
    where delta_pct is not null and baseline_days >= 3 and delta_pct <= -30 and baseline_avg >= p_decline_noise_floor
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
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = any(p_demographic_labels)
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and (
        p_target_dow is null
          and r.broadcast_date between (select from_date from baseline_range) and (select to_date from baseline_range)
        or
        p_target_dow is not null
          and r.broadcast_date in (select d from same_dow_dates(p_as_of_date, p_target_dow, p_program_baseline_weeks))
      )
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
    tpt.canonical_name as today_peak_program_name,
    round(tpt.rating::numeric, 5) as today_peak_program_rating,
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
  left join today_peak_top_program tpt on true
  left join baseline_peak bp on true
  left join today_top_program ttp on true
  left join top_program_baseline tpb on true
  left join worst_program wp on true;
$$;
comment on function get_channel_daily_narrative is '채널 일일 인사이트(줄글)용 신호 계산. 채널 단위 지표는 p_baseline_days(기본 28일) 평균과, 프로그램(top_program/decline_program) 단위는 "같은 요일+같은 시간대(본방 슬롯)"로 좁힌 최근 p_program_baseline_weeks(기본 8주) 평균과 비교. p_target_dow(2026-09-02, SDoW)가 있으면 채널 단위 baseline도 "그 요일의 최근 p_program_baseline_weeks주"로 통일. p_decline_noise_floor(2026-09-22, 기본 0.05)는 decline_program 후보의 최소 baseline 시청률 — skyUHD처럼 시청률 대역 자체가 훨씬 작은 채널은 route.ts에서 더 낮은 값을 넘겨 "노이즈 필터가 모든 프로그램을 걸러내 원인 불명으로만 나오는" 문제를 피한다. 넘기지 않으면(기존 호출부 전부) 기존 0.05 그대로 동작.';
