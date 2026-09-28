-- 실측 버그 수정(2026-09-28): get_program_slot_recent_avg(20260928130000)가 "같은 시(hour)"
-- 단위로만 매칭해, <니돈내산>(일요일 20:30 신설)의 baseline이 0건으로 나왔다 — 직전까지 그
-- 저녁 자리를 지키던 <엑스 더 리그>는 19:50 방영이라 hour 19, 니돈내산은 hour 20이라 서로 다른
-- 시간 버킷으로 갈라졌기 때문(사용자가 앞서 추석 보고서 작업에서도 지적한 것과 동일한 함정 —
-- "시간대가 다르므로 그 전의 4주 같은 시간대 평균과 비교"). 시(hour) 단위 일치 대신, 같은
-- 요일에서 목표 시각과의 차이가 90분 이내인 방영분을 "같은 저녁 슬롯"으로 본다 — 정시 경계에서
-- 갈라지던 문제를 없앤다. 파라미터 시그니처는 그대로라 create or replace로 덮어쓴다.
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
    and abs(
      (case when extract(hour from r.start_time) < 2 then extract(epoch from r.start_time) + 24 * 3600 else extract(epoch from r.start_time) end)
      -
      (case when extract(hour from p_start_time) < 2 then extract(epoch from p_start_time) + 24 * 3600 else extract(epoch from p_start_time) end)
    ) <= 5400 -- 90분 이내를 "같은 저녁 슬롯"으로 본다
$$;
comment on function get_program_slot_recent_avg is '프로그램 자체의 방영 이력이 없거나 부족할 때(예: 1회차 신규 편성) "최근 성적 대비"의 baseline으로 쓴다 — 같은 채널·같은 타깃·같은 요일에서 목표 시각과 90분 이내로 방영된(정시 경계로 가르지 않음) 최근 p_weeks주간의 평균 시청률(프로그램명 무관).';
