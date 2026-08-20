-- skyUHD 버그의 진짜 근본 원인(2026-08-20, §130000의 target_id 수정만으로는 부족했음을 직접
-- 재현해 확인): skyUHD의 프로그램 단위(26 UHD ALL 시트) 행은 `source_type = 'skyuhd'`로
-- 저장된다(수기 업로드 전용 소스 타입 — 채널 단위 랭킹은 `nielsen_daily`로 정상 저장됨, 이미
-- 해결된 예전 버그와는 다른 부분). 그런데 아래 함수들의 프로그램 단위(program_id is not null)
-- 조회가 전부 `r.source_type = 'nielsen_daily'`로 고정돼 있어서, target_id 조인을 고쳐도
-- source_type 필터에서 전부 걸러지고 있었다(직접 실행해 0건임을 재현·확인). 프로그램 단위
-- 조회만 `source_type in ('nielsen_daily', 'skyuhd')`로 넓히고, 채널 단위(program_id is null)
-- 조회는 그대로 `nielsen_daily`만 쓴다(skyUHD 채널 단위 랭킹은 원래도 nielsen_daily로 정상 저장).
create or replace function get_hourly_rating_pattern(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  broadcast_hour int,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  program_count bigint
)
language sql
stable
as $$
  select
    (case when extract(hour from r.start_time) < 2
          then extract(hour from r.start_time)::int + 24
          else extract(hour from r.start_time)::int
     end) as broadcast_hour,
    avg(r.rating) as avg_rating,
    avg(r.share) as avg_share,
    avg(r.reach) as avg_reach,
    avg(r.time_spent_seconds) as avg_time_spent_seconds,
    count(*) as program_count
  from ratings r
  join channels c on c.id = r.channel_id
  left join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and (t.label = p_target_label or r.target_id is null)
    and r.source_type in ('nielsen_daily', 'skyuhd')
    and r.program_id is not null
    and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour
$$;

drop function if exists get_hourly_program_titles(text, text, date, date);

create function get_hourly_program_titles(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  broadcast_hour int,
  program_names text
)
language sql
stable
as $$
  select
    (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as broadcast_hour,
    string_agg(distinct p.canonical_name, ' / ' order by p.canonical_name) as program_names
  from ratings r
  join channels c on c.id = r.channel_id
  left join targets t on t.id = r.target_id
  join programs p on p.id = r.program_id
  where c.code = p_channel_code and (t.label = p_target_label or r.target_id is null)
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour;
$$;

create or replace function get_channel_dow_daypart_pattern(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  dow int,
  dow_label text,
  daypart text,
  avg_rating numeric,
  sample_count int
)
language sql
stable
as $$
  with base as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      daypart_of(r.start_time) as daypart,
      r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  grid as (
    select dow.d as dow, dp.p as daypart
    from generate_series(1, 7) as dow(d)
    cross join unnest(array['새벽', '오전', '오후', '저녁_심야']) as dp(p)
  )
  select
    g.dow,
    (array['월', '화', '수', '목', '금', '토', '일'])[g.dow] as dow_label,
    g.daypart,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(b.rating)::int as sample_count
  from grid g
  left join base b on b.dow = g.dow and b.daypart = g.daypart
  group by g.dow, g.daypart
  order by g.dow, array_position(array['새벽', '오전', '오후', '저녁_심야'], g.daypart);
$$;

drop function if exists get_channel_top_programs(text, text, date, int, int);

create function get_channel_top_programs(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84,
  p_limit int default 20
)
returns table (
  program_name text,
  avg_rating numeric,
  avg_share numeric,
  air_count int,
  top_daypart text,
  most_common_start_hour int
)
language sql
stable
as $$
  with base as (
    select
      p.canonical_name,
      r.rating,
      r.share,
      daypart_of(r.start_time) as daypart,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  daypart_counts as (
    select canonical_name, daypart, count(*) as cnt
    from base
    group by canonical_name, daypart
  ),
  daypart_mode as (
    select distinct on (canonical_name) canonical_name, daypart
    from daypart_counts
    order by canonical_name, cnt desc, daypart
  ),
  hour_counts as (
    select canonical_name, hr, count(*) as cnt
    from base
    group by canonical_name, hr
  ),
  hour_mode as (
    select distinct on (canonical_name) canonical_name, hr
    from hour_counts
    order by canonical_name, cnt desc, hr
  )
  select
    b.canonical_name as program_name,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    round(avg(b.share)::numeric, 4) as avg_share,
    count(*)::int as air_count,
    dm.daypart as top_daypart,
    hm.hr as most_common_start_hour
  from base b
  left join daypart_mode dm on dm.canonical_name = b.canonical_name
  left join hour_mode hm on hm.canonical_name = b.canonical_name
  group by b.canonical_name, dm.daypart, hm.hr
  order by avg(b.rating) desc
  limit p_limit;
$$;

create or replace function get_channel_daypart_opportunity(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_full_window_days int default 365,
  p_recent_days int default 7
)
returns table (
  daypart text,
  our_full_avg numeric,
  our_recent_avg numeric,
  competitor_full_avg numeric,
  competitor_recent_avg numeric,
  gap_full numeric,
  gap_recent numeric,
  gap_change numeric
)
language sql
stable
as $$
  with dp_expr as (
    select
      r.rating, r.broadcast_date,
      daypart_of(r.start_time) as daypart
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  cp_expr as (
    select
      cp.rating, cp.broadcast_date,
      daypart_of(cp.start_time) as daypart
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    where c.code = p_channel_code and cp.rating is not null
      and cp.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  our_agg as (
    select daypart,
      avg(rating) filter (where broadcast_date <= p_as_of_date - p_recent_days) as full_avg,
      avg(rating) filter (where broadcast_date > p_as_of_date - p_recent_days) as recent_avg
    from dp_expr
    group by daypart
  ),
  comp_agg as (
    select daypart,
      avg(rating) filter (where broadcast_date <= p_as_of_date - p_recent_days) as full_avg,
      avg(rating) filter (where broadcast_date > p_as_of_date - p_recent_days) as recent_avg
    from cp_expr
    group by daypart
  ),
  dayparts as (select unnest(array['새벽', '오전', '오후', '저녁_심야']) as daypart)
  select
    d.daypart,
    round(o.full_avg::numeric, 5) as our_full_avg,
    round(o.recent_avg::numeric, 5) as our_recent_avg,
    round(cm.full_avg::numeric, 5) as competitor_full_avg,
    round(cm.recent_avg::numeric, 5) as competitor_recent_avg,
    round((cm.full_avg - o.full_avg)::numeric, 5) as gap_full,
    round((cm.recent_avg - o.recent_avg)::numeric, 5) as gap_recent,
    round(((cm.full_avg - o.full_avg) - (cm.recent_avg - o.recent_avg))::numeric, 5) as gap_change
  from dayparts d
  left join our_agg o on o.daypart = d.daypart
  left join comp_agg cm on cm.daypart = d.daypart;
$$;

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
    ) as demographics,
    round(crd.avg_rating::numeric, 5) as dow_baseline_avg_rating
  from channel_rank_today crt
  full outer join channel_rank_baseline crb on true
  left join channel_rank_dow_baseline crd on true
  left join today_peak tp on true
  left join baseline_peak bp on true
  left join today_top_program ttp on true
  left join top_program_baseline tpb on true;
$$;
comment on function get_channel_daily_narrative is 'Page 1/Page 2 오늘의 브리핑 원자료. skyUHD의 프로그램 단위 데이터(source_type=skyuhd, target_id NULL)도 시간대/1위 프로그램 부분에서 통과하도록 확장(채널 단위 랭킹은 원래대로 nielsen_daily만).';
