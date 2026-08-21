-- 개선(2026-08-21, 직전 마이그레이션 20260821110000 직후 즉시 발견): 프로그램 전체 평균(rating
-- 단순 평균)을 기준으로 삼았더니, 본방 슬롯 하나(예: 나는SOLO 22시대 본방 rating 1.44)가 나머지
-- 재방 슬롯 전부를 "평균보다 한참 낮음"으로 만들어버려(재방 슬롯 거의 전부가 90% 이상 낮게
-- 나옴) 특정 슬롯을 못 짚어냈다(실측 확인). 두 가지로 고친다:
--  1) rating 대신 share(점유율)를 쓴다 — 시간대마다 TV를 보는 절대 인구(HUT)가 달라 rating은
--     새벽/오전처럼 원래 다들 낮은 시간대와 비교가 안 되지만, share는 "그 시간에 TV를 보던 사람
--     중 이 채널을 고른 비율"이라 시간대 간 비교가 더 공정하다.
--  2) 평균(mean) 대신 중앙값(median)을 기준선으로 쓴다 — median은 본방 같은 단일 극단값에
--     상대적으로 덜 흔들려서, "이 프로그램의 여러 재방 슬롯 중 정말 유독 낮은 곳"을 더 정확히
--     가려낸다. 기본 기간도 4주 → 8주로 늘려 슬롯별 표본을 더 확보한다(재방 슬롯은 매주 정확히
--     같은 시각에 편성되지 않아 4주로는 슬롯당 1회뿐인 경우가 많았다).
drop function if exists get_program_slot_efficiency(text, text, text, date, int);

create or replace function get_program_slot_efficiency(
  p_channel_code text,
  p_canonical_name text,
  p_program_target_label text,
  p_as_of_date date,
  p_weeks int default 8
)
returns table (
  hour_bucket int,
  avg_rating numeric,
  avg_share numeric,
  air_count int,
  share_vs_median_pct numeric
)
language sql
stable
as $$
  with base as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      r.rating, r.share
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code
      and p.canonical_name = p_canonical_name
      and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and r.rating is not null and r.share is not null and r.start_time is not null
      and r.broadcast_date between (p_as_of_date - (p_weeks * 7) + 1) and p_as_of_date
  ),
  per_hour as (
    select hr, avg(rating) as avg_rating, avg(share) as avg_share, count(*) as air_count
    from base
    group by hr
  ),
  med as (
    select percentile_cont(0.5) within group (order by avg_share) as median_share from per_hour
  )
  select
    ph.hr as hour_bucket,
    round(ph.avg_rating::numeric, 5) as avg_rating,
    round(ph.avg_share::numeric, 4) as avg_share,
    ph.air_count::int,
    round((ph.avg_share / nullif(m.median_share, 0) * 100)::numeric, 1) as share_vs_median_pct
  from per_hour ph cross join med m
  order by ph.hr;
$$;
comment on function get_program_slot_efficiency is 'WHAT TO SCHEDULE? MOVE/REPLACE 근거 세분화(2026-08-21) — 한 프로그램이 방영되는 여러 시간(hour) 각각의 최근 N주(기본 8주) 평균 점유율과, 그 프로그램 자신의 시간대별 점유율 중앙값 대비 비율(share_vs_median_pct)을 계산한다. rating이 아닌 share를 쓰고 평균이 아닌 중앙값을 기준선으로 삼아, 본방 같은 단일 극단값에 흔들리지 않고 "여러 재방 슬롯 중 유독 효율이 낮은 시간대"를 가려낸다.';
