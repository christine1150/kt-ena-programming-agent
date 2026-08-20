-- get_competitor_overlap_via_channel도 같은 day-boundary 문제가 있었다 — 22:29 시작 SBS Plus를
-- ENA의 00:14 종료시각과 비교할 때 raw TIME 값(00:14:20)이 자정을 넘겨 작아 보여서
-- "22:29:58 < 00:14:20" 비교가 실패, 겹치는 게 없는 것으로 나왔다(실데이터로 확인). 02시 이전은
-- +24시간 보정한 값으로 겹침을 판정하도록 고친다.
create or replace function get_competitor_overlap_via_channel(
  p_lookup_channel_code text,
  p_competitor_name text,
  p_broadcast_date date,
  p_our_start_time time,
  p_our_end_time time
)
returns table (
  competitor_name text,
  program_name text,
  start_time time,
  end_time time,
  rating numeric
)
language sql
stable
as $$
  with bounds as (
    select
      (extract(epoch from p_our_start_time) + case when extract(hour from p_our_start_time) < 2 then 86400 else 0 end) as our_start_sec,
      (extract(epoch from coalesce(p_our_end_time, p_our_start_time + interval '1 hour')) +
        case when extract(hour from coalesce(p_our_end_time, p_our_start_time + interval '1 hour')) < 2 then 86400 else 0 end) as our_end_sec
  )
  select cp.competitor_name, cp.program_name, cp.start_time, cp.end_time, cp.rating
  from competitor_program_ratings cp
  join channels c on c.id = cp.our_channel_id
  cross join bounds b
  where c.code = p_lookup_channel_code
    and cp.competitor_name = p_competitor_name
    and cp.broadcast_date = p_broadcast_date
    and (extract(epoch from cp.start_time) + case when extract(hour from cp.start_time) < 2 then 86400 else 0 end) < b.our_end_sec
    and (extract(epoch from coalesce(cp.end_time, cp.start_time + interval '1 hour')) +
          case when extract(hour from coalesce(cp.end_time, cp.start_time + interval '1 hour')) < 2 then 86400 else 0 end) > b.our_start_sec
  order by cp.rating desc nulls last;
$$;
comment on function get_competitor_overlap_via_channel is '경쟁채널 데이터가 조회 대상 채널이 아니라 다른 채널의 등록 경쟁채널 시트에만 있는 경우(예: SBS Plus는 ENA가 아니라 ENA Drama의 등록 경쟁채널)를 위한 범용 동시간대 조회. day-boundary-safe(02시 이전은 +24시간 보정) 겹침 판정.';
