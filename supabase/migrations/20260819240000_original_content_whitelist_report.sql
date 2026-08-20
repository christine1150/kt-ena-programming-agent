-- Page 1 Original 리포트를 화이트리스트(original_review_programs) 기반으로 다시 만든다.
-- 사용자 지시: "Original 분석은 그 프로그램들만 하면 돼" — 그날 방영된 프로그램을 무작위로
-- 잡지 않고, 관리자가 지정한 요일별 프로그램만 시청률 데이터와 매칭한다. "본방 시간의 ±10분
-- 이내로 시작하는 것이 본방송"이라는 사용자 기준을 그대로 구현한다.
--
-- 자정을 넘기는 프로그램(예: 수요일 "아이돌 파견근무"가 화요일 밤~수요일 새벽 00:40에 방영)은
-- Nielsen 파일이 02:00~다음날 25:59를 "하루"로 보므로, 그 프로그램은 실제로는 하루 전 날짜의
-- 파일에 들어있다 — broadcast_time이 02:00 이전이면 effective_date를 하루 앞당겨 찾는다.
create or replace function get_original_content_daily(p_as_of_date date)
returns table (
  day_of_week_iso int,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  featured_category text,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  retention_pct numeric
)
language sql
stable
as $$
  with whitelist as (
    select w.*, c.code as broadcast_channel_code, rc.code as rerun_channel_code_val
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
    left join channels rc on rc.id = w.rerun_channel_id
    where w.day_of_week_iso = extract(isodow from p_as_of_date)::int
  ),
  matched as (
    select
      w.*,
      p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share
      from ratings r
      join programs p on p.id = r.program_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600 -- ±10분
      order by least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  )
  select
    m.day_of_week_iso,
    m.program_name as whitelist_program_name,
    m.broadcast_channel_code,
    m.broadcast_time as expected_time,
    m.note,
    m.matched_program_name,
    m.matched_start_time,
    m.matched_end_time,
    m.matched_rating,
    m.matched_share,
    fc.category as featured_category,
    m.rerun_channel_code_val as rerun_channel_code,
    rr.canonical_name as rerun_program_name,
    rr.start_time as rerun_start_time,
    rr.rating as rerun_rating,
    case when m.matched_rating is not null and m.matched_rating > 0 and rr.rating is not null
      then round((rr.rating / m.matched_rating * 100)::numeric, 1) else null end as retention_pct
  from matched m
  left join lateral (
    select fc.category
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and replace(fp.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
    limit 1
  ) fc on true
  left join lateral (
    select p2.canonical_name, r2.start_time, r2.rating
    from ratings r2
    join programs p2 on p2.id = r2.program_id
    where m.rerun_channel_id is not null
      and m.matched_program_name is not null
      and r2.channel_id = m.rerun_channel_id
      and r2.source_type = 'nielsen_daily'
      and r2.broadcast_date = m.effective_date
      and replace(p2.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r2.start_time > m.matched_end_time
    order by r2.start_time asc
    limit 1
  ) rr on true
  where m.matched_program_name is not null -- 화이트리스트에는 있지만 실제로 방영된 게 없으면(조건부 편성 등) 조용히 제외
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): original_review_programs 화이트리스트를 그날 실제 방영 데이터(±10분 매칭)와 연결, 직후재방·SBS Plus 등 동시방송 비교는 API 레이어에서 get_competitor_program_overlap을 재사용해 보강한다.';

-- 화이트리스트가 없는 요일(예: 금요일)에 쓰는 주간 리뷰 — 최근 7일간 화이트리스트 프로그램들의
-- 실적을 종합한다(사용자 지시: "분석할 오리지널이 없는 날은 한 주의 실적을 종합 리뷰").
create or replace function get_original_content_weekly_review(p_as_of_date date, p_days int default 7)
returns table (
  program_name text,
  broadcast_channel_code text,
  instances_count int,
  avg_rating numeric,
  best_date date,
  best_rating numeric,
  latest_date date,
  latest_rating numeric
)
language sql
stable
as $$
  with days as (
    select d::date as d from generate_series(p_as_of_date - (p_days - 1), p_as_of_date, interval '1 day') d
  ),
  whitelist as (
    select w.*, c.code as broadcast_channel_code
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
  ),
  matched as (
    select
      w.program_name, w.broadcast_channel_code, w.sort_order,
      days.d as target_date,
      m.rating
    from days
    join whitelist w on w.day_of_week_iso = extract(isodow from days.d)::int
    left join lateral (
      select r.rating
      from ratings r
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = days.d - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600
      order by least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  )
  select
    program_name,
    broadcast_channel_code,
    count(rating)::int as instances_count,
    round(avg(rating)::numeric, 5) as avg_rating,
    (array_agg(target_date order by rating desc nulls last))[1] as best_date,
    max(rating) as best_rating,
    max(target_date) as latest_date,
    (array_agg(rating order by target_date desc))[1] as latest_rating
  from matched
  group by program_name, broadcast_channel_code, sort_order
  having count(rating) > 0
  order by avg(rating) desc nulls last;
$$;
comment on function get_original_content_weekly_review is 'Page 1 Original 리포트: 화이트리스트가 없는 요일(예: 금요일)에 최근 7일간 화이트리스트 프로그램들의 실적을 종합 리뷰용으로 집계.';
