-- 사용자 지시(2026-08-21): WHAT TO SCHEDULE?에서 "재방이 많은 컨텐츠(예: 나는SOLO)"를 통째로
-- "이동 검토"하라고 제안하는 것은 부적절하다 — 하루에도 여러 시간대에 걸쳐 방영되는 프로그램은
-- 그중 일부 시간대만 효율이 낮을 수 있는데, 프로그램 전체를 옮기라는 식으로 뭉뚱그리면 실제로
-- 잘 되고 있는 시간대까지 건드리게 된다. 그래서 "이 프로그램이 여러 시간대에 방영되는지"부터
-- 확인하고, 여러 시간대라면 그중 "최근 N주 동안 유독 효율이 낮은 특정 시간대"만 짚어서 그
-- 시간대에 대해서만 이동/교체 의견을 내도록 한다. get_channel_top_programs 등과 같은 필터로
-- 프로그램×시(hour) 단위 최근 N주 평균 시청률을 구하고, "이 프로그램 자신의 전체 평균" 대비
-- 그 시간대가 얼마나 낮은지(share_of_program_avg)로 판단한다.
create or replace function get_program_slot_efficiency(
  p_channel_code text,
  p_canonical_name text,
  p_program_target_label text,
  p_as_of_date date,
  p_weeks int default 4
)
returns table (
  hour_bucket int,
  avg_rating numeric,
  air_count int,
  share_of_program_avg numeric
)
language sql
stable
as $$
  with base as (
    select
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr,
      r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code
      and p.canonical_name = p_canonical_name
      and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd')
      and r.rating is not null and r.start_time is not null
      and r.broadcast_date between (p_as_of_date - (p_weeks * 7) + 1) and p_as_of_date
  ),
  overall as (
    select avg(rating) as overall_avg from base
  )
  select
    b.hr as hour_bucket,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(*)::int as air_count,
    round((avg(b.rating) / nullif(o.overall_avg, 0) * 100)::numeric, 1) as share_of_program_avg
  from base b cross join overall o
  group by b.hr, o.overall_avg
  order by b.hr;
$$;
comment on function get_program_slot_efficiency is 'WHAT TO SCHEDULE? MOVE/REPLACE 근거 세분화(2026-08-21) — 한 프로그램이 방영되는 여러 시간(hour) 각각의 최근 N주(기본 4주) 평균 시청률과, 그 프로그램 자신의 전체 평균 대비 비율(share_of_program_avg)을 계산한다. 재방이 많아 여러 시간대에 걸쳐 방영되는 프로그램에서 "어느 시간대만 유독 효율이 낮은지"를 짚기 위한 용도 — 프로그램 전체가 아니라 특정 시간대만 이동/교체를 권장할 근거로 쓴다.';
