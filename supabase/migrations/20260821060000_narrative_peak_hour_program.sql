-- 사용자 지시(2026-08-21): 채널별 인사이트에서 "17시대에 가장 높은 시청률"처럼 시간대만 말하지
-- 말고 "17시대에 가장 높은 시청률(세계테마기행 13회 멕시코 0.150)"처럼 그 시간대 실제 최고
-- 시청률 프로그램명(회차/부제 포함, canonical_name 그대로)과 시청률을 함께 보여준다. 기존
-- today_peak_hour/today_peak_rating은 "그 시간대의 평균 시청률"이라 특정 프로그램과 다를 수
-- 있어, 그 시간대 안에서 실제로 가장 높았던 "프로그램 단위" 값을 별도 컬럼으로 추가한다.
drop function if exists get_channel_daily_narrative(text, text, text, text[], date, int, int);

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
  -- 사용자 지시(2026-08-21): 오늘 강세 시간대 안에서 실제로 가장 높았던 "프로그램 단위" 값
  -- (평균이 아니라 개별 방영분의 최고 시청률) — 문장에 프로그램명·회차/부제·시청률을 함께 표시.
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

comment on function get_channel_daily_narrative is '채널 일일 인사이트(줄글)용 신호 계산. 채널 단위 지표(순위·점유율·시간대)는 p_baseline_days(기본 28일) 평균과 비교하고, 프로그램(top_program/decline_program) 단위 비교는 "같은 요일 + 같은 시간대(본방 슬롯)"로 좁힌 최근 p_program_baseline_weeks(기본 8주) 본방 평균과 비교한다. today_peak_program_name/rating은 오늘 강세 시간대 안에서 실제로 가장 높았던 프로그램명(회차/부제 포함)·시청률(2026-08-21 추가, 인사이트 문장에 시간대뿐 아니라 프로그램명을 함께 표기하기 위함).';
