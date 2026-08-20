-- 개발 단위 12번: 목표 대비 달성률·Gap 계산.
-- 공식은 PRD.md/CLAUDE.md에 고정된 그대로: 달성률 = 실제 평균 시청률 ÷ 목표 시청률 × 100, Gap = 실제 − 목표.
--
-- channels.primary_target(Channel Master 표기, 예: "수도권 개인2049")과
-- targets.label(Nielsen 파일 표기, 예: "수도권 2049")이 문구가 정확히 같지 않은 채널이 있어
-- (사용자 확인: "수도권 개인2049" = "수도권 2049", 같은 타깃) 1차로 정확히 일치하는 타깃을 찾고,
-- 없으면 "개인" 표기를 뺀 이름으로 다시 찾는다. 그래도 못 찾으면 값 없이(NULL) 반환한다
-- (임의로 다른 타깃을 갖다 붙이지 않는다 — CLAUDE.md 원칙).
create or replace function get_target_achievement(
  p_channel_code text,
  p_date_from date,
  p_date_to date,
  p_year int
)
returns table (
  channel_code text,
  primary_target text,
  matched_target_label text,
  target_rank text,
  target_rating numeric,
  actual_avg_rating numeric,
  days_with_data bigint,
  achievement_pct numeric,
  gap numeric
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_primary_target text;
  v_target_id uuid;
  v_matched_label text;
  v_target_rating numeric;
  v_target_rank text;
begin
  select c.id, c.primary_target into v_channel_id, v_primary_target
  from channels c where c.code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select tg.target_rating, tg.target_rank into v_target_rating, v_target_rank
  from target_goals tg
  where tg.channel_id = v_channel_id and tg.year = p_year;

  -- 1차: Channel Master KPI 문구와 정확히 같은 타깃
  select t.id, t.label into v_target_id, v_matched_label
  from targets t where t.label = v_primary_target;

  -- 2차: 못 찾으면 "개인" 표기를 뺀 이름으로 재시도 (사용자 확인된 동의어 처리)
  if v_target_id is null then
    select t.id, t.label into v_target_id, v_matched_label
    from targets t where t.label = replace(v_primary_target, '개인', '');
  end if;

  return query
  select
    p_channel_code,
    v_primary_target,
    v_matched_label,
    v_target_rank,
    v_target_rating,
    avg(r.rating),
    count(distinct r.broadcast_date),
    round((avg(r.rating) / nullif(v_target_rating, 0)) * 100, 1),
    round(avg(r.rating) - v_target_rating, 5)
  from ratings r
  where r.channel_id = v_channel_id
    and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily'
    and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to;
end;
$$;
comment on function get_target_achievement is '채널×기간 목표 대비 달성률(%)·Gap. target_goals에 그 해 목표가 없거나 타깃 이름을 못 찾으면 값 없이 NULL 반환 (임의 추정 금지)';
