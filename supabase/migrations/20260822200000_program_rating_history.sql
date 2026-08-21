-- 사용자 지시(2026-08-22): "주요 콘텐츠 리뷰"의 연령대별 미니바 대신, 최근 12주간 본방송
-- 시청률 추이(수도권 2049 진하게 + 전국 유료가구 연하게)를 꺾은선 그래프로, 그리고 "동시간대
-- 같은 컨텐츠를 다른 채널이 방송할 경우(예: SBS Plus, ENA Play) 비교할 수 있게 같이 수도권 2049
-- 시청률만" 표시하라는 요청 — 프로그램명(공백 무시 매칭, 이 앱의 기존 관행)과 "본방 시간
-- ±10분 이내" 기준(CLAUDE.md에 이미 확립된 "본방송 여부" 판정 규칙, originalReviewSchedule.ts와
-- 동일 원칙)으로 채널 구분 없이 전체 ratings에서 시계열을 뽑는다 — 그러면 자연히 같은 콘텐츠를
-- 방송하는 다른 채널의 방영분도 함께 잡힌다(채널별로 그룹핑은 TS에서).
create or replace function get_program_rating_history(
  p_canonical_name text,
  p_expected_start_time time,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  channel_code text,
  broadcast_date date,
  episode_number int,
  target_label text,
  rating numeric
)
language sql
stable
as $$
  select
    c.code,
    r.broadcast_date,
    r.episode_number,
    t.label,
    r.rating
  from ratings r
  join channels c on c.id = r.channel_id
  join programs p on p.id = r.program_id
  join targets t on t.id = r.target_id
  where replace(p.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
    and r.source_type = 'nielsen_daily'
    and r.rating is not null
    and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
    and r.start_time between (p_expected_start_time - interval '10 minutes') and (p_expected_start_time + interval '10 minutes')
    and t.label in ('수도권 2049', '전국 유료가구')
  order by c.code, r.broadcast_date;
$$;
comment on function get_program_rating_history is '주요 콘텐츠 리뷰(Page 1) 본방송 시청률 추이 꺾은선 그래프용 — 프로그램명(공백 무시)+본방 시간(±10분) 기준으로 채널 구분 없이 시계열을 반환, 같은 콘텐츠를 다른 채널이 동시간대 방송한 경우도 자연히 함께 잡힌다. target_label은 수도권 2049/전국 유료가구만.';
