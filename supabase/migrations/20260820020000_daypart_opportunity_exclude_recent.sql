-- 회고 리뷰(2026-08-20)에서 발견한 개선점: get_channel_daypart_opportunity의 "전체 기간(최대
-- 365일)" 평균이 "최근 1주"를 그대로 포함하고 있어, 최근 데이터가 자기 자신과 비교되며 격차
-- 변화(gap_change)를 옅게 만드는 미세한 편향이 있었다. get_channel_daily_narrative 등 다른
-- baseline 계산이 항상 "오늘/최근 구간을 제외"하는 관행과 다르길래, full_avg 계산에서도 최근
-- 1주를 제외해 "직전 기간 평균 vs 최근 1주 평균"이 되도록 바로잡는다. 반환 컬럼은 그대로라
-- create or replace로 충분하다.
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
      -- "직전 기간" 평균: 최근 p_recent_days는 제외해 최근 구간과 겹치지 않게 한다.
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
comment on function get_channel_daypart_opportunity is 'Page 2 OPPORTUNITY?/WHAT TO SCHEDULE? 보강: daypart별 우리 vs 등록 경쟁채널 격차가 "최근 1주를 제외한" 보유 기간 평균 대비 최근 1주 사이 어떻게 바뀌었는지(gap_change > 0 = 경쟁채널이 상대적으로 약해져 기회). 최근 구간을 전체 평균에 이중 포함하지 않도록 20260820020000에서 수정.';
