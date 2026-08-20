-- skyUHD 버그 수정(사용자 지시, 2026-08-20): skyUHD는 프로그램 단위(26 UHD ALL 시트) 데이터에
-- 타깃 구분이 없어(CLAUDE.md 원칙: "임의로 타깃을 지정하지 않음") `ratings.target_id`가 항상
-- NULL이다(직접 확인: skyUHD 프로그램 단위 행 1,377건 전부 target_id NULL). Page 2의 시간대별
-- 그래프·요일×시간대 히트맵·TOP 콘텐츠·daypart 기회 분석·오늘의 브리핑(피크 시간대/1위 프로그램)이
-- 전부 `join targets t on t.id = r.target_id ... and t.label = p_program_target_label`로
-- INNER JOIN + 라벨 매칭을 걸고 있어서, target_id가 NULL인 skyUHD 행은 조인 자체가 실패해
-- 조용히 전부 빠지고 있었다(데이터가 없는 게 아니라 조인이 실패한 것 — 실제 버그). 아래 모든
-- 함수에서 targets를 LEFT JOIN으로 바꾸고 "라벨이 일치하거나,애초에 타깃 구분이 없는 행
-- (target_id is null)이면 통과"하도록 고쳤다. 다른 6개 채널은 프로그램 단위 행에 target_id가
-- 항상 있으므로(직접 확인) 이 변경으로 동작이 달라지지 않는다.

-- 1) 02~26시 시간대별 그래프
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
    and r.source_type = 'nielsen_daily'
    and r.program_id is not null
    and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour
$$;
comment on function get_hourly_rating_pattern is '방송일 기준 시간대별(02~26시) 평균 지표 — 프로그램 단위 데이터로 계산. skyUHD처럼 target_id가 NULL인 채널(타깃 구분 없는 원본)도 통과하도록 LEFT JOIN.';

-- 2) 02~26시 그래프의 프로그램명
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
    and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour;
$$;
comment on function get_hourly_program_titles is 'Page 2 02~26시 그래프: 선택 기간 동안 각 시간대에 방영된 프로그램명. skyUHD의 NULL target_id도 통과.';

-- 3) 최근 12주 요일×시간대 히트맵
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
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
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
comment on function get_channel_dow_daypart_pattern is 'Page 2 신규 섹션(주간 강세 시간대): 최근 12주 월~일 × daypart 평균 시청률. skyUHD의 NULL target_id도 통과.';

-- 4) 시청률 상위 콘텐츠 TOP N — 사용자 지시(2026-08-20): "시청률은 약하더라도 시간대별 점유율이
--    좋은 프로그램"을 짚어줄 수 있도록 avg_share를 함께 반환(신규 컬럼이라 drop 필요).
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
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
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
comment on function get_channel_top_programs is 'Page 2 신규 섹션(TOP 콘텐츠): 최근 12주 평균 시청률 상위 프로그램(기본 20개) — 시청률·점유율·방영횟수·주 daypart·주 방영시간. skyUHD의 NULL target_id도 통과.';

-- 5) daypart 기회 분석(OPPORTUNITY?)
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
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
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
comment on function get_channel_daypart_opportunity is 'Page 2 OPPORTUNITY?/WHAT TO SCHEDULE?: daypart별 우리 vs 등록 경쟁채널 격차가 보유 기간 전체 대비 최근 구간 사이 어떻게 바뀌었는지(gap_change > 0 = 경쟁채널이 상대적으로 약해져 기회). 최근 구간을 전체 평균에서 제외(이중포함 방지), skyUHD의 NULL target_id도 통과.';

-- 6) 오늘의 브리핑(get_channel_daily_narrative)의 시간대·1위 프로그램 부분
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
    left join targets t on t.id = r.target_id, baseline_range br
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
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
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type = 'nielsen_daily' and r.program_id is not null
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
comment on function get_channel_daily_narrative is 'Page 1/Page 2 오늘의 브리핑 원자료: 오늘 vs baseline 시청률·순위·점유율·피크시간대·1위 프로그램·연령대. skyUHD의 NULL target_id(프로그램 단위)도 시간대/1위 프로그램 부분에서 통과하도록 LEFT JOIN.';
