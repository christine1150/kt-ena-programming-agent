-- 사용자 지시(2026-09-28): "<니돈내산>처럼 1회인 타이틀은 '최근 성적 대비'에서 최근 동시간
-- 지난 4주 평균 성적과 비교하여 분석" — 1회차(또는 과거 방영 이력이 아예 없는) 신규 프로그램은
-- computeRecentComparison(직전 회차 평균)이 비교 대상을 못 찾아 "비교할 이전 회차 없음"만
-- 나왔다. 그 자리의 baseline으로 "같은 요일 + 같은 시간대(본방 슬롯)에 최근 N주간 방영된
-- 모든 프로그램의 평균"을 쓴다 — 20260820220000_channel_narrative_program_slot_baseline.sql이
-- 이미 쓰는 "요일+시간대(hour_block, 02시 이전은 +24시 보정)" 정의를 그대로 재사용하되, 거기서는
-- canonical_name까지 일치해야 했던 것과 달리 여기서는 프로그램명을 따지지 않는다(그 자리에
-- "무엇이" 있었든 그 자리 자체의 최근 실적을 본다 — new-pilot-baseline-is-prior-slot-occupant
-- 원칙과 동일).
create or replace function get_program_slot_recent_avg(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_start_time time,
  p_weeks int default 4
)
returns table (
  avg_rating numeric,
  sample_count int
)
language sql
stable
as $$
  select
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(*)::int as sample_count
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
    and r.broadcast_date between (p_as_of_date - (p_weeks * 7)) and (p_as_of_date - 1)
    and r.rating is not null
    and r.start_time is not null
    and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
    and (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
      = (case when extract(hour from p_start_time) < 2 then extract(hour from p_start_time)::int + 24 else extract(hour from p_start_time)::int end)
$$;
comment on function get_program_slot_recent_avg is '프로그램 자체의 방영 이력이 없거나 부족할 때(예: 1회차 신규 편성) "최근 성적 대비"의 baseline으로 쓴다 — 같은 채널·같은 타깃·같은 요일+시간대(본방 슬롯)에서 최근 p_weeks주간 실제로 방영된 모든 프로그램(프로그램명 무관)의 평균 시청률.';
