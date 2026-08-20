-- 개발 단위 11번: 시청률 핵심 지표 계산 (Rating/Share/Reach/Time Spent/Time Spent Share,
-- DoD/WoW/MoM/QoQ/YoY/YTD 비교). PRD.md 5번 "10. 개발 단위" 11번 그대로.
--
-- CLAUDE.md 원칙: "계산은 암산이 아니라 SQL 집계 쿼리를 실제로 실행해서 나온 값이어야 한다."
-- 그래서 계산 로직을 전부 여기(Postgres 함수)에 두고, Next.js API Route는 이 함수를
-- supabase.rpc()로 호출만 한다 — 값 비교(등락률 계산)까지 SQL이 하고, Claude는 결과를
-- 문장으로 설명하는 역할만 한다.

-- 두 값의 증감률(%)을 계산하는 작은 도우미. 기준값이 없거나 0이면 계산할 수 없으므로 NULL.
create or replace function pct_change(p_new numeric, p_old numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_new is null or p_old is null or p_old = 0 then null
    else round((p_new - p_old) / p_old * 100, 1)
  end
$$;
comment on function pct_change is '두 값의 증감률(%) 계산. 기준값이 NULL이거나 0이면 NULL (억지로 0으로 나누지 않음)';

-- 1) 기간 평균 지표: 채널×타깃×기간 기준 Rating/Share/Reach/평균 시청시간/시청시간비율
--    (channels/targets는 program_id가 NULL인 "채널 단위 집계" 행만 대상 — 프로그램별 값은 이 함수의 대상이 아니다)
create or replace function get_rating_summary(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_source_type text default 'nielsen_daily'
)
returns table (
  days_with_data bigint,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric
)
language sql
stable
as $$
  select
    count(distinct r.broadcast_date) as days_with_data,
    avg(r.rating) as avg_rating,
    avg(r.share) as avg_share,
    avg(r.reach) as avg_reach,
    avg(r.time_spent_seconds) as avg_time_spent_seconds,
    avg(r.time_spent_share) as avg_time_spent_share
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and t.label = p_target_label
    and r.source_type = p_source_type
    and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to
$$;
comment on function get_rating_summary is '채널×타깃×기간 평균 지표 (채널 단위 집계 행 기준)';

-- 2) 시간대별(방송일 기준 02~26시) 패턴: 프로그램 단위 데이터를 시간대로 묶어 평균 지표를 낸다.
--    DESIGN.md Page 2의 "02시~26시 시간대별 그래프" 자리에 쓰인다.
--    새벽 0~1시대는 "방송일이 끝나기 전 시간대"로 보고 24~25시로 옮겨 표시한다
--    (Nielsen 분석 관행: 하루를 02:00부터 다음날 01:59까지로 봄).
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
  join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and t.label = p_target_label
    and r.source_type = 'nielsen_daily'
    and r.program_id is not null
    and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour
$$;
comment on function get_hourly_rating_pattern is '방송일 기준 시간대별(02~26시) 평균 지표 — 프로그램 단위 데이터로 계산';

-- 3) DoD/WoW/MoM/QoQ/YoY/YTD 비교표: 기준일 하나를 주면 6개 비교 기간의 값과 등락률을 한 번에 낸다.
--    YoY는 작년 같은 날짜의 일별 데이터가 없으면(가장 흔한 경우) 2025년 연간 평균값으로 대체한다
--    (개발 단위 9번에서 만든 YoY 기준값 — DATA_DICTIONARY.md §3에 명시된 한계 그대로 반영).
create or replace function get_rating_trend_summary(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date
)
returns table (
  period text,
  compare_date date,
  value_source text,
  rating numeric,
  share numeric,
  reach numeric,
  time_spent_seconds numeric,
  time_spent_share numeric,
  rating_change_pct numeric,
  share_change_pct numeric,
  reach_change_pct numeric,
  time_spent_change_pct numeric,
  time_spent_share_change_pct numeric
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_cur_rating numeric;
  v_cur_share numeric;
  v_cur_reach numeric;
  v_cur_time_spent numeric;
  v_cur_time_spent_share numeric;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  select r.rating, r.share, r.reach, r.time_spent_seconds, r.time_spent_share
    into v_cur_rating, v_cur_share, v_cur_reach, v_cur_time_spent, v_cur_time_spent_share
  from ratings r
  where r.channel_id = v_channel_id and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null
    and r.broadcast_date = p_as_of_date
  limit 1;

  return query
  with cmp(period, cmp_date) as (
    values
      ('current', p_as_of_date),
      ('DoD', p_as_of_date - 1),
      ('WoW', p_as_of_date - 7),
      ('MoM', (p_as_of_date - interval '1 month')::date),
      ('QoQ', (p_as_of_date - interval '3 months')::date),
      ('YoY', (p_as_of_date - interval '1 year')::date)
  ),
  daily as (
    select
      cmp.period, cmp.cmp_date,
      r.rating, r.share, r.reach, r.time_spent_seconds, r.time_spent_share
    from cmp
    left join ratings r
      on r.channel_id = v_channel_id and r.target_id = v_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date = cmp.cmp_date
  ),
  yoy_fallback as (
    select r.rating, r.share, r.reach, r.time_spent_seconds, r.time_spent_share
    from ratings r
    where r.channel_id = v_channel_id and r.target_id = v_target_id
      and r.source_type = 'annual_2025' and r.program_id is null
    limit 1
  ),
  resolved as (
    select
      d.period,
      d.cmp_date,
      case
        when d.period != 'YoY' then 'nielsen_daily'
        when d.rating is not null then 'nielsen_daily'
        when yf.rating is not null then 'annual_2025_fallback'
        else null
      end as value_source,
      coalesce(d.rating, case when d.period = 'YoY' then yf.rating end) as rating,
      coalesce(d.share, case when d.period = 'YoY' then yf.share end) as share,
      coalesce(d.reach, case when d.period = 'YoY' then yf.reach end) as reach,
      coalesce(d.time_spent_seconds, case when d.period = 'YoY' then yf.time_spent_seconds end) as time_spent_seconds,
      coalesce(d.time_spent_share, case when d.period = 'YoY' then yf.time_spent_share end) as time_spent_share
    from daily d
    left join yoy_fallback yf on d.period = 'YoY'
  ),
  ytd as (
    select
      'YTD'::text as period,
      null::date as cmp_date,
      'nielsen_daily'::text as value_source,
      avg(r.rating) as rating,
      avg(r.share) as share,
      avg(r.reach) as reach,
      avg(r.time_spent_seconds) as time_spent_seconds,
      avg(r.time_spent_share) as time_spent_share
    from ratings r
    where r.channel_id = v_channel_id and r.target_id = v_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between date_trunc('year', p_as_of_date)::date and p_as_of_date
  )
  select
    x.period, x.cmp_date, x.value_source,
    x.rating, x.share, x.reach, x.time_spent_seconds, x.time_spent_share,
    case when x.period = 'current' then null else pct_change(v_cur_rating, x.rating) end,
    case when x.period = 'current' then null else pct_change(v_cur_share, x.share) end,
    case when x.period = 'current' then null else pct_change(v_cur_reach, x.reach) end,
    case when x.period = 'current' then null else pct_change(v_cur_time_spent, x.time_spent_seconds) end,
    case when x.period = 'current' then null else pct_change(v_cur_time_spent_share, x.time_spent_share) end
  from (
    select * from resolved
    union all
    select * from ytd
  ) x
  order by array_position(array['current','DoD','WoW','MoM','QoQ','YoY','YTD'], x.period);
end;
$$;
comment on function get_rating_trend_summary is '기준일 하나로 DoD/WoW/MoM/QoQ/YoY/YTD 비교값·등락률을 한 번에 계산. YoY는 일별 데이터 없으면 2025년 연간 평균으로 대체';
