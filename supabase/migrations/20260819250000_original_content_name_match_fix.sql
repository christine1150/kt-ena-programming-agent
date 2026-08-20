-- 버그 수정: get_original_content_daily/get_original_content_weekly_review이 "±10분 이내
-- 시작"만으로 매칭해서, 그 시간대에 우연히 방영 중이던 **다른** 프로그램을 화이트리스트
-- 프로그램으로 잘못 인식하는 문제가 실데이터로 확인됐다(예: TV로는 방영되지 않는
-- "[웹예능]에나분식"이 그 시간대 방영 중이던 "유부녀킬러"에 매칭, 아직 첫 방송 전인
-- "여자가 여왕이 되는, 위대한 도전"이 엉뚱한 프로그램에 매칭). "±10분"은 "본방송 여부"를
-- 가리는 기준이지 프로그램을 찾는 기준이 아니다 — 반드시 프로그램명이 먼저 일치해야 한다.
-- 공백/쉼표/괄호 등 문장부호 차이는 같은 프로그램으로 본다(CLAUDE.md 원칙과 동일하게
-- 한글·영문·숫자만 남기고 비교).
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
        and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
            = regexp_replace(w.program_name, '[^0-9A-Za-z가-힣]', '', 'g') -- ① 이름 먼저 일치
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600 -- ② 그 중 ±10분 이내 시작한 것 = 본방송
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
  where m.matched_program_name is not null
  order by m.sort_order;
$$;

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
      join programs p on p.id = r.program_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = days.d - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
            = regexp_replace(w.program_name, '[^0-9A-Za-z가-힣]', '', 'g')
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
