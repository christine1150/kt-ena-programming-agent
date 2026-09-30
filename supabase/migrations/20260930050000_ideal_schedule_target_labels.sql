-- 사용자 지시(2026-09-30): "ENA 플레이는 2039, 2039 여성. ONCE는 가구, 5064, 50대 남자 이런 식으로 자사 채널은
-- 골라서 원하는 타깃의 시청률 최적화 편성표를 뽑을 수 있게 해줘. 가능한 범위 안에서" — 화면의 타깃 선택 목록은
-- 추측하지 않고 "그 채널에 실제로 프로그램 단위 데이터가 있는 타깃"만 보여줘야 한다. 기준일 이전 N일 동안 해당
-- 채널에 방영 단위 시청률이 존재하는 타깃 라벨과 표본 수를 돌려준다(as_of 강제 — 백테스트 누수 없음).
-- 여러 연령대를 합친 타깃(예: 여성 2039 = 여20대+여30대)은 연령대별 모집단 크기 없이 정확히 합산할 수 없어
-- 만들지 않는다 — 원본에 있는 라벨만 선택 가능.
create or replace function get_ideal_schedule_target_labels(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_days int default 84
)
returns table (target_label text, airing_count bigint)
language sql
stable
as $$
  select t.label as target_label, count(*) as airing_count
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and r.source_type = 'nielsen_daily'
    and r.program_id is not null
    and r.broadcast_date between p_as_of_date - (p_lookback_days - 1) and p_as_of_date
  group by t.label
  order by t.label;
$$;
comment on function get_ideal_schedule_target_labels is '이상적 1주일 편성 최적화 타깃 선택 목록(2026-09-30): 채널에 실제 프로그램 단위 데이터가 있는 타깃 라벨과 방영 수. skyUHD는 타깃 없음(가구 단일 값)이라 빈 결과.';
