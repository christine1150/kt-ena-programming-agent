-- 사용자 지시(2026-09-20): "주요 컨텐츠 리뷰"의 주간 대체 뷰(카드형)에서 "금주 시청률
-- (M.D 요일)"만으로는 정확히 몇 시에 방영했는지 알 수 없다 — "몇월 몇일 몇시"까지 보여달라는
-- 요청에 따라, this_week 매칭 시 이미 골라낸 ratings 행의 start_time을 함께 반환하도록
-- get_original_content_weekly_review를 확장한다. 매칭 로직(요일·시간 근접도 600초 이내 최소
-- 오차 1건) 자체는 20260905040000과 완전히 동일 — scalar subquery 2개(rating/start_time)를
-- 중복 계산하지 않도록 LATERAL JOIN 하나로 합쳐 그 결과에서 두 컬럼을 함께 뽑는다.
drop function if exists get_original_content_weekly_review(date, date, int);

create function get_original_content_weekly_review(
  p_date_from date,
  p_date_to date,
  p_baseline_weeks int default 4
)
returns table (
  program_name text,
  broadcast_channel_code text,
  category text,
  day_of_week_iso int,
  this_week_date date,
  this_week_start_time time,
  this_week_rating numeric,
  baseline_avg_rating numeric,
  baseline_instances int
)
language sql
stable
as $$
  with dow_map(kr, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  featured_slots as (
    select
      regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g') as sl_key,
      p.canonical_name as sl_program_name,
      c.id as sl_channel_id,
      c.code as sl_channel_code,
      fc.category as sl_category,
      fc.broadcast_time as sl_time,
      dm.iso as sl_dow,
      row_number() over (
        partition by regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g'), c.code, dm.iso
        order by length(p.canonical_name) desc, fc.broadcast_start_date desc
      ) as rn
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels c on c.id = p.channel_id
    cross join lateral unnest(fc.broadcast_day_of_week) as day_kr
    join dow_map dm on dm.kr = day_kr
    where fc.broadcast_start_date <= p_date_to
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_date_from)
  ),
  legacy_slots as (
    select
      regexp_replace(w.program_name, '[^0-9A-Za-z가-힣]', '', 'g') as sl_key,
      w.program_name as sl_program_name,
      w.broadcast_channel_id as sl_channel_id,
      c.code as sl_channel_code,
      null::text as sl_category,
      w.broadcast_time as sl_time,
      w.day_of_week_iso as sl_dow
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
  ),
  slots as (
    select sl_key, sl_program_name, sl_channel_id, sl_channel_code, sl_category, sl_time, sl_dow
    from featured_slots
    where rn = 1
    union
    select l.sl_key, l.sl_program_name, l.sl_channel_id, l.sl_channel_code, l.sl_category, l.sl_time, l.sl_dow
    from legacy_slots l
    where not exists (select 1 from featured_slots f where f.sl_key = l.sl_key)
  ),
  window_days as (
    select gs::date as target_date from generate_series(p_date_from, p_date_to, interval '1 day') gs
  ),
  this_week as (
    select
      s.sl_program_name as wp_program_name,
      s.sl_channel_code as wp_channel_code,
      s.sl_category as wp_category,
      s.sl_dow as wp_dow,
      wd.target_date as wp_date,
      m.rating as wp_rating,
      m.start_time as wp_start_time
    from window_days wd
    join slots s on s.sl_dow = extract(isodow from wd.target_date)::int
    left join lateral (
      select r.rating, r.start_time
      from ratings r
      join programs p on p.id = r.program_id
      where r.channel_id = s.sl_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = wd.target_date - (case when s.sl_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and s.sl_time is not null
        and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
            = regexp_replace(s.sl_program_name, '[^0-9A-Za-z가-힣]', '', 'g')
        and least(
              abs(extract(epoch from (r.start_time - s.sl_time))),
              86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
            ) <= 600
      order by least(
              abs(extract(epoch from (r.start_time - s.sl_time))),
              86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
            ) asc
      limit 1
    ) m on true
  ),
  baseline_days as (
    select gs::date as target_date
    from generate_series(p_date_from - (p_baseline_weeks * 7), p_date_from - 1, interval '1 day') gs
  ),
  baseline as (
    select
      s.sl_program_name as bp_program_name,
      s.sl_channel_code as bp_channel_code,
      (
        select r.rating
        from ratings r
        join programs p on p.id = r.program_id
        where r.channel_id = s.sl_channel_id
          and r.source_type = 'nielsen_daily'
          and r.broadcast_date = bd.target_date - (case when s.sl_time < time '02:00:00' then 1 else 0 end)
          and r.program_id is not null
          and s.sl_time is not null
          and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
              = regexp_replace(s.sl_program_name, '[^0-9A-Za-z가-힣]', '', 'g')
          and least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) <= 600
        order by least(
                abs(extract(epoch from (r.start_time - s.sl_time))),
                86400 - abs(extract(epoch from (r.start_time - s.sl_time)))
              ) asc
        limit 1
      ) as bp_rating
    from baseline_days bd
    join slots s on s.sl_dow = extract(isodow from bd.target_date)::int
  ),
  baseline_agg as (
    select bp_program_name, bp_channel_code,
      round(avg(bp_rating)::numeric, 5) as baseline_avg_rating,
      count(bp_rating)::int as baseline_instances
    from baseline
    group by bp_program_name, bp_channel_code
  )
  select
    tw.wp_program_name as program_name,
    tw.wp_channel_code as broadcast_channel_code,
    tw.wp_category as category,
    tw.wp_dow as day_of_week_iso,
    tw.wp_date as this_week_date,
    tw.wp_start_time as this_week_start_time,
    tw.wp_rating as this_week_rating,
    ba.baseline_avg_rating,
    coalesce(ba.baseline_instances, 0) as baseline_instances
  from this_week tw
  left join baseline_agg ba
    on ba.bp_program_name = tw.wp_program_name
   and ba.bp_channel_code = tw.wp_channel_code
  where tw.wp_rating is not null
  order by tw.wp_date asc;
$$;
