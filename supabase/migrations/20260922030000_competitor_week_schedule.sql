-- 사용자 지시(2026-09-22): "왼쪽과 오른쪽을 각각 채널과 기간을 정할 수 있게 해주고, 당사
-- 채널 외에도 우리가 분석 가능한 모든 경쟁채널을 선택할 수 있게 해줘" — /schedule-grid 주간
-- 비교 화면에서 등록 경쟁채널의 편성표도 우리 채널과 같은 방식(요일×시간 그리드)으로 볼 수
-- 있어야 한다. 실측 확인 결과 competitor_program_ratings는 (경쟁채널, 우리 채널) 조합별로
-- 하루 전체를 빈틈없이 이어붙인 방영 구간을 이미 갖고 있어(Nielsen "OOO경쟁채널시청률" 시트
-- 원본 그대로) 우리 채널의 get_channel_week_schedule과 동등한 그리드를 그릴 수 있다.
--
-- 같은 경쟁채널명이 여러 우리 채널의 시트에 동시에 등록돼 있을 수 있어(예: UMAX가 skyUHD
-- 외에 다른 채널의 경쟁채널 목록에도 있는 경우) our_channel_id로 좁히지 않고 경쟁채널명만으로
-- 조회하되, 같은 (날짜, 시작시각) 조합이 여러 소스에 중복 존재하면 시청률이 있는 쪽을
-- 우선한다(distinct on + rating 내림차순 nulls last).
create or replace function get_competitor_week_schedule(
  p_competitor_name text,
  p_week_start date
)
returns table (
  dow int,
  broadcast_date date,
  start_time time,
  end_time time,
  program_name_raw text,
  matched_rating numeric
)
language sql
stable
as $$
  select distinct on (cp.broadcast_date, cp.start_time)
    extract(isodow from cp.broadcast_date)::int as dow,
    cp.broadcast_date,
    cp.start_time,
    cp.end_time,
    cp.program_name as program_name_raw,
    cp.rating as matched_rating
  from competitor_program_ratings cp
  where cp.competitor_name = p_competitor_name
    and cp.broadcast_date between p_week_start and (p_week_start + 6)
  order by cp.broadcast_date, cp.start_time, cp.rating desc nulls last;
$$;
comment on function get_competitor_week_schedule is '/schedule-grid 주간 비교 화면에서 등록 경쟁채널(예: skyUHD의 UMAX/UHD Dream TV)의 한 주 편성표를 우리 채널과 동일한 그리드 형식으로 반환 — competitor_program_ratings(Nielsen 경쟁채널 시트 원본)를 그대로 사용, 매칭 로직 없음. 2026-09-22 추가.';
