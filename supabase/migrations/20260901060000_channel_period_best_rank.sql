-- 사용자 지시(2026-09-01): "경쟁채널과 비교할 때 기준 채널 등위가 빠진 버그 오류 수정".
--
-- 원인(코드 실측 확인): ChannelDeepDive.tsx의 COMPARED WITH? 표는 등록 경쟁채널 목록
-- (get_competitor_insight_report)에 우리 채널 자신을 한 행 끼워 넣어(merged.push) 같이 순위
-- 매겨 보여준다. 경쟁채널의 today_rank는 이 함수가 이미 `min(cr.rank)`(선택 기간 중 최고
-- 순위)로 계산해 돌려주는데, 기간 모드(dateFrom≠dateTo)일 때 우리 채널 행만
-- `today_rank: isRangeMode ? null : ...`로 항상 비워두고 있었다 — "기간 평균이라 단일 순위
-- 개념이 없다"는 2026-08-21 당시 판단이었으나, 실제로는 경쟁채널도 기간 중 최고 순위(집계값)를
-- 쓰고 있어 우리 채널만 그 집계를 안 해준 비대칭이었다.
--
-- 경쟁채널과 정확히 같은 계산(선택 기간 중 최고 순위 = min(rank))을 우리 채널 자신의
-- ratings(채널 단위 행, program_id is null)에 대해서도 하는 함수 하나만 추가한다 — 경쟁채널
-- 쪽처럼 타깃 동의어 재시도 로직은 필요 없다(우리 채널은 이미 route.ts가 확정한
-- matchedTargetLabel을 그대로 쓰면 되고, 그 라벨로 이미 narrativeSignal.today_rank 등이 정상
-- 조회되고 있다는 게 실측으로 검증돼 있다).
create or replace function get_channel_period_best_rank(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (best_rank int)
language sql
stable
as $$
  select min(r.rank)
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code
    and t.label = p_target_label
    and r.source_type = 'nielsen_daily'
    and r.program_id is null
    and r.rank is not null
    and r.broadcast_date between p_date_from and p_date_to
$$;
comment on function get_channel_period_best_rank is 'Page 2 COMPARED WITH? — 기간 모드에서 우리 채널 자신의 순위를 경쟁채널과 같은 방식(선택 기간 중 최고 순위, get_competitor_insight_report의 min(rank)와 동일 개념)으로 계산. 2026-09-01: 기간 모드에서 우리 채널 행만 순위가 항상 비어 있던 비대칭 버그 수정.';
