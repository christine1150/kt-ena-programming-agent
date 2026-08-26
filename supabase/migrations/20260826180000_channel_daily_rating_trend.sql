-- Tier 2 확장(2026-08-26, 사용자 지시: "티어 2 진행" — 원 제안 8번 "시각화 타입 확장, 지금
-- bar/table뿐" 나머지) — 자연어 질의 엔진(CHANNEL_PERFORMANCE intent)이 "최근 7일 추이는?"
-- 같은 기간 질문에 일별 라인 차트를 보여주려면 채널×타깃의 "일자별 채널 단위" 시청률이
-- 필요하다. get_rating_period_report 등 기존 함수는 기간 전체를 하나의 평균으로만 압축해
-- 돌려줘 일별 값이 없다 — 계산(평균)은 여전히 SQL이 전담하고, TypeScript는 그 결과를 그대로
-- line 차트 포인트로 옮기기만 한다(CLAUDE.md "LLM/프론트가 계산하지 않는다" 원칙 유지).
-- get_rating_period_report와 동일하게 "채널 단위 일자 행"(program_id is null)만 집계한다.
create or replace function get_channel_daily_rating_trend(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  broadcast_date date,
  avg_rating numeric
)
language sql
stable
as $$
  select
    r.broadcast_date,
    round(avg(r.rating)::numeric, 5) as avg_rating
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to
    and r.rating is not null
  group by r.broadcast_date
  order by r.broadcast_date;
$$;
comment on function get_channel_daily_rating_trend is '자연어 질의 엔진(CHANNEL_PERFORMANCE, 기간 모드) line 차트 전용 — 채널×타깃의 일자별 채널 단위(program_id is null) 평균 시청률. 표본 없는 날은 행 자체가 없음(호출부가 결측으로 처리).';
