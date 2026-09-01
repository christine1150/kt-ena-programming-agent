-- 사용자 지시(2026-09-02): "3주 이상 같은 요일 또는 같은 시간대에 동일한 패턴이 보인다면
-- 그것도 프로그램명과 함께 분석하여 2페이지 내에서 언급" — 대상은 우리 채널만(사용자 답변).
-- 최근 N주(기본 8주) 동안 같은 요일·같은 시각에 같은 프로그램(본방만, <재> 제외 — 이미 여러
-- 곳에서 쓰는 "이 프로그램의 실제 슬롯" 판별 관례 그대로 재사용)이 연속으로 편성됐는지를
-- gaps-and-islands 패턴으로 계산한다. 각 (요일, 시각) 슬롯에서 가장 최근 스트릭만 보고,
-- 최소 p_min_consecutive_weeks(기본 3주) 이상 연속인 것만 반환한다.
create or replace function get_channel_stable_slot_patterns(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_lookback_weeks int default 8,
  p_min_consecutive_weeks int default 3
)
returns table (
  dow int,
  dow_label text,
  hour_of_day int,
  canonical_name text,
  consecutive_weeks int,
  latest_date date,
  latest_rating numeric
)
language sql
stable
as $$
  with v as (
    select c.id as channel_id, t.id as target_id
    from channels c, targets t
    where c.code = p_channel_code and t.label = p_program_target_label
  ),
  slot_rows as (
    select
      r.broadcast_date as bdate,
      extract(dow from r.broadcast_date)::int as dow_val,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hour_val,
      p.canonical_name as prog_name,
      avg(r.rating) as day_rating
    from ratings r
    join programs p on p.id = r.program_id
    join v on r.channel_id = v.channel_id and r.target_id = v.target_id
    where r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.is_first_run is distinct from false
      and r.broadcast_date between (p_as_of_date - (p_lookback_weeks * 7)) and p_as_of_date
    group by r.broadcast_date, extract(dow from r.broadcast_date),
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end),
      p.canonical_name
  ),
  ranked as (
    select sr.*,
      lag(bdate) over (partition by dow_val, hour_val order by bdate desc) as prev_bdate,
      lag(prog_name) over (partition by dow_val, hour_val order by bdate desc) as prev_prog_name
    from slot_rows sr
  ),
  grp as (
    select rk.*,
      sum(case when prev_bdate is not null and prev_prog_name = prog_name and prev_bdate = bdate + 7 then 0 else 1 end)
        over (partition by dow_val, hour_val order by bdate desc rows unbounded preceding) as grp_id
    from ranked rk
  ),
  streaks as (
    select dow_val, hour_val, prog_name, grp_id,
      count(*)::int as consecutive_weeks,
      max(bdate) as latest_date,
      (array_agg(day_rating order by bdate desc))[1] as latest_rating,
      row_number() over (partition by dow_val, hour_val order by max(bdate) desc) as recency_rank
    from grp
    group by dow_val, hour_val, prog_name, grp_id
  )
  select
    dow_val,
    (array['일','월','화','수','목','금','토'])[dow_val + 1],
    hour_val,
    prog_name,
    consecutive_weeks,
    latest_date,
    latest_rating
  from streaks
  where recency_rank = 1
    and consecutive_weeks >= p_min_consecutive_weeks
  order by consecutive_weeks desc, latest_date desc;
$$;
comment on function get_channel_stable_slot_patterns is '최근 N주(기본 8주) 동안 같은 요일·같은 시각에 같은 프로그램(본방만)이 연속 편성된 패턴을 찾는다(gaps-and-islands, 각 슬롯의 최신 스트릭만). 사용자 지시(2026-09-02) — 편성 안정성/고정 슬롯 패턴을 Page 2에 언급하기 위함, 대상은 자사 채널 한정.';
