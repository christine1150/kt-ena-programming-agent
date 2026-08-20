-- Page 2 재설계(사용자 지시, 2026-08-20)를 위한 SQL 함수 모음.
-- 1) get_channel_daily_narrative에 "요일별 12주 평균"(dow_baseline_avg_rating)을 추가한다
--    (Page 1은 이미 이 함수를 4주 baseline으로 쓰고, Page 2 오늘의 브리핑은 12주 baseline으로
--    같은 함수를 재사용한다 — p_baseline_days 파라미터만 다르게 호출).
-- 출력 컬럼(OUT 파라미터)이 바뀌면 create or replace로 안 되고 함수를 먼저 지워야 한다(Postgres 제약).
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
    -- 오늘과 같은 요일만 골라 최근 baseline 기간 평균 — "이 요일엔 평소 어느 정도인가"
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

-- 2) COMPARED WITH? 재설계: Competitive Pressure 숫자 대신, 등록 경쟁채널을 오늘 순위 높은
-- 순으로 나열하고 각 채널의 최근 12주 평균 대비 오늘 등락 + 오늘 가장 잘 된 프로그램(시간대)을
-- 함께 준다 — "경쟁채널이 왜 오늘 좋아졌는지/나빠졌는지, 무엇으로 그랬는지" 보고서용 원자료.
create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84
)
returns table (
  competitor_name text,
  today_rank int,
  today_rating numeric,
  baseline_avg_rating numeric,
  delta_pct numeric,
  top_program_name text,
  top_program_start_time time,
  top_program_rating numeric
)
language sql
stable
as $$
  with today_rows as (
    select cr.competitor_name, cr.rank, cr.rating
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    join channels c on c.code = p_channel_code
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = c.id
    where t.label = p_target_label
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date = p_as_of_date
  ),
  baseline as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    join channels c on c.code = p_channel_code
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = c.id
    where t.label = p_target_label
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between (p_as_of_date - p_baseline_days) and (p_as_of_date - 1)
    group by cr.competitor_name
  ),
  top_program as (
    select distinct on (cp.competitor_name) cp.competitor_name, cp.program_name, cp.start_time, cp.rating
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    where c.code = p_channel_code
      and cp.broadcast_date = p_as_of_date
      and cp.rating is not null
    order by cp.competitor_name, cp.rating desc
  )
  select
    tr.competitor_name,
    tr.rank as today_rank,
    round(tr.rating::numeric, 5) as today_rating,
    round(b.avg_rating::numeric, 5) as baseline_avg_rating,
    case when b.avg_rating is not null and b.avg_rating <> 0
      then round(((tr.rating - b.avg_rating) / b.avg_rating * 100)::numeric, 1) else null end as delta_pct,
    tp.program_name as top_program_name,
    tp.start_time as top_program_start_time,
    round(tp.rating::numeric, 5) as top_program_rating
  from today_rows tr
  left join baseline b on b.competitor_name = tr.competitor_name
  left join top_program tp on tp.competitor_name = tr.competitor_name
  order by tr.rank asc nulls last;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 오늘 순위 순으로, 최근 12주 평균 대비 오늘 등락과 오늘 최고 성적 프로그램(시간대)까지 함께 제공.';

-- 3) OPPORTUNITY?/WHAT TO SCHEDULE? 재설계: daypart별로 "우리 vs 등록 경쟁채널"의 경쟁 격차가
-- (가능한 전체 보유 기간, 기본 365일) 대비 최근 1주 사이 어떻게 바뀌었는지 계산 — 격차가 좁혀진
-- (경쟁채널이 상대적으로 약해진) daypart가 편성 기회다.
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
      (case
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 2 and 8 then '새벽'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 9 and 13 then '오전'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 14 and 18 then '오후'
        else '저녁_심야'
      end) as daypart
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  cp_expr as (
    select
      cp.rating, cp.broadcast_date,
      (case
        when (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) between 2 and 8 then '새벽'
        when (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) between 9 and 13 then '오전'
        when (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) between 14 and 18 then '오후'
        else '저녁_심야'
      end) as daypart
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    where c.code = p_channel_code and cp.rating is not null
      and cp.broadcast_date between (p_as_of_date - p_full_window_days) and p_as_of_date
  ),
  our_agg as (
    select daypart,
      avg(rating) as full_avg,
      avg(rating) filter (where broadcast_date > p_as_of_date - p_recent_days) as recent_avg
    from dp_expr
    group by daypart
  ),
  comp_agg as (
    select daypart,
      avg(rating) as full_avg,
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
comment on function get_channel_daypart_opportunity is 'Page 2 OPPORTUNITY?/WHAT TO SCHEDULE? 보강: daypart별 우리 vs 등록 경쟁채널 격차가 보유 기간 전체 대비 최근 1주 사이 어떻게 바뀌었는지(gap_change > 0 = 경쟁채널이 상대적으로 약해져 기회).';

-- 4) 02~26시 그래프에 프로그램명을 표시하기 위한 시간대별 프로그램명 조회.
create or replace function get_hourly_program_titles(
  p_channel_code text,
  p_target_label text,
  p_date date
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
  join targets t on t.id = r.target_id
  join programs p on p.id = r.program_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
    and r.broadcast_date = p_date
  group by broadcast_hour
  order by broadcast_hour;
$$;
comment on function get_hourly_program_titles is 'Page 2 02~26시 그래프: 각 시간대에 실제로 방영된 프로그램명(같은 시간대에 여러 개면 " / "로 이어붙임).';
