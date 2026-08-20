-- 사용자 지시(2026-08-20): "1페이지 채널별 인사이트에는 시청률, 점유율 또는 시청시간 부분에서
-- 가장 두각을 나타낸 프로그램 한 두개도 채널별로 짚어주고 어떤 역할을 하였는지도 함께 정리.
-- 혹시 평균 대비 엄청난 하락을 이끌었을 경우 그 부분도 코멘트." — 기존 top_program_*(오늘 최고
-- 시청률 프로그램)에 더해, "오늘 방영된 프로그램 중 자기 자신의 최근 12주 평균 대비 가장 큰 폭으로
-- 하락한 프로그램"을 decline_program_*으로 추가한다. top_program과 같은 방식(프로그램 자기 자신의
-- 과거 평균과 비교, 채널 전체 평균과 비교하지 않음)으로 계산해 "이 프로그램이 평소보다 얼마나
-- 부진했는지"를 짚는다. baseline_days(표본)가 3일 미만이면 우연에 가까워 제외한다.
drop function if exists get_channel_daily_narrative(text, text, text, text[], date, int);

create function get_channel_daily_narrative(
  p_channel_code text,
  p_target_label text,
  p_program_target_label text,
  p_demographic_labels text[],
  p_as_of_date date,
  p_baseline_days int default 28
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
  top_program_baseline as (
    select avg(r.rating) as avg_rating, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, baseline_range br, today_top_program ttp
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and replace(p.canonical_name, ' ', '') = replace(ttp.canonical_name, ' ', '')
      and r.broadcast_date between br.from_date and br.to_date
      and r.rating is not null
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
      join programs p2 on p2.id = r2.program_id, baseline_range br
      where c2.code = p_channel_code and (t2.label = p_program_target_label or r2.target_id is null)
        and r2.source_type in ('nielsen_daily', 'skyuhd')
        and replace(p2.canonical_name, ' ', '') = replace(tpr.canonical_name, ' ', '')
        and r2.broadcast_date between br.from_date and br.to_date
        and r2.rating is not null
    ) pb on true
  ),
  worst_program as (
    select canonical_name, rating, start_time, baseline_avg, baseline_days, delta_pct
    from today_programs_scored
    where delta_pct is not null and baseline_days >= 3 and delta_pct <= -30
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
comment on function get_channel_daily_narrative is 'Page 1/Page 2 오늘의 브리핑용: 오늘 vs 최근 N일 평균의 시청률·순위·점유율·피크시간대, 오늘 최고 시청률 프로그램(top_program_*, 자기 자신의 과거 평균 대비)과 자기 평균 대비 30% 이상 급락한 프로그램(decline_program_*, 표본 3일 미만은 제외), 연령대별 편차.';
