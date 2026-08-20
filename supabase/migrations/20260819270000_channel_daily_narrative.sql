-- Page 1 "채널별 인사이트(줄글)" 섹션용: 오늘 값을 최근 28일 평균(오늘 제외, baseline)과
-- 비교해 "무엇이 평소와 다른가"를 계산해서 돌려준다. 문장은 API/컴포넌트에서 이 값을 가지고
-- 짓는다(SQL은 계산만, CLAUDE.md 원칙). "4주 이상 반복되는 패턴은 가급적 언급 피함"이라는
-- 사용자 지시는 여기서 baseline 대비 변화량(delta)이 큰 것만 추려서 자연스럽게 구현한다 —
-- 변화가 없으면(=매주 반복되는 평소 패턴) delta가 작아 자동으로 걸러진다.
create or replace function get_channel_daily_narrative(
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
  demographics jsonb
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
  today_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.broadcast_date = p_as_of_date
    group by hr
  ),
  baseline_hourly as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      avg(r.rating) as avg_rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
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
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit 1
  ),
  top_program_baseline as (
    select avg(r.rating) as avg_rating, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, baseline_range br, today_top_program ttp
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily'
      and replace(p.canonical_name, ' ', '') = replace(ttp.canonical_name, ' ', '')
      and r.broadcast_date between br.from_date and br.to_date
      and r.rating is not null
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
    ) as demographics
  from channel_rank_today crt
  full outer join channel_rank_baseline crb on true
  left join today_peak tp on true
  left join baseline_peak bp on true
  left join today_top_program ttp on true
  left join top_program_baseline tpb on true;
$$;
comment on function get_channel_daily_narrative is 'Page 1 채널별 인사이트(줄글)용 원시 계산값 — 오늘 vs 최근 28일 평균(baseline) 편차(시청률/등위/점유율/피크시간대/1위 프로그램 자체 이력 대비/연령대별). 문장 조립은 API/화면에서.';

-- 킬러 콘텐츠(최근 4주 채널별 상위)의 강세/약세 시간대(daypart) — 사용자 지시: "강세를 보이는
-- 시간대와 강한 프로그램이지만 약세를 보이는 시간대가 있다면 언급". Fit Score MART와 동일한
-- 4구간 daypart 정의(새벽02-08/오전09-13/오후14-18/저녁심야19-25, DATA_DICTIONARY.md §5)를 그대로 쓴다.
create or replace function get_channel_killer_content_daypart(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 28,
  p_limit int default 3
)
returns table (
  canonical_name text,
  avg_rating numeric,
  airing_count bigint,
  best_daypart text,
  best_daypart_avg numeric,
  worst_daypart text,
  worst_daypart_avg numeric
)
language sql
stable
as $$
  with window_rows as (
    select p.canonical_name, r.rating,
      (case
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 2 and 8 then '새벽'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 9 and 13 then '오전'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 14 and 18 then '오후'
        else '저녁_심야'
      end) as daypart
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
  ),
  top_programs as (
    select canonical_name, avg(rating) as avg_rating, count(*) as airing_count
    from window_rows
    group by canonical_name
    order by avg_rating desc
    limit p_limit
  ),
  daypart_stats as (
    select w.canonical_name, w.daypart, avg(w.rating) as avg_rating, count(*) as n
    from window_rows w
    join top_programs tp on tp.canonical_name = w.canonical_name
    group by w.canonical_name, w.daypart
  )
  select
    tp.canonical_name,
    round(tp.avg_rating::numeric, 5) as avg_rating,
    tp.airing_count,
    best.daypart as best_daypart,
    round(best.avg_rating::numeric, 5) as best_daypart_avg,
    worst.daypart as worst_daypart,
    round(worst.avg_rating::numeric, 5) as worst_daypart_avg
  from top_programs tp
  left join lateral (
    select daypart, avg_rating from daypart_stats ds where ds.canonical_name = tp.canonical_name order by avg_rating desc limit 1
  ) best on true
  left join lateral (
    select daypart, avg_rating from daypart_stats ds
    where ds.canonical_name = tp.canonical_name and ds.n >= 2 and ds.daypart <> best.daypart
    order by avg_rating asc
    limit 1
  ) worst on true
  order by tp.avg_rating desc;
$$;
comment on function get_channel_killer_content_daypart is 'Page 1 채널별 킬러 콘텐츠용: 최근 4주 평균 상위 프로그램의 daypart(새벽/오전/오후/저녁심야)별 강세·약세 — worst는 daypart가 2개 이상 있고 best와 다를 때만 채워진다.';
