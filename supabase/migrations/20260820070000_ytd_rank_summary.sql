-- Page 1 ENA 히어로 카드 재구성(사용자 지시, 2026-08-20): 로고·시청률 아래 작은 글씨로
-- "올해 1월 1일~오늘 누적 평균 시청률/등위"와 "목표 등위(6위) 대비 몇 위 차이"를 보여준다.
--
-- 설계 판단: "누적 평균 등위"는 경쟁채널 시청률을 다시 모아 순위를 재계산하지 않는다 — Nielsen
-- 랭킹 시트가 이미 매일 전체 시장 기준 순위를 계산해 `ratings.rank`에 넣어주므로, 이 값의
-- 기간 평균을 내는 것으로 충분하다(경쟁채널 재계산은 오차·완전성 문제만 더할 뿐). 다만
-- Page 1 API(route.ts)가 이미 "오늘 순위" 조회 시 라벨 표기 불일치(수도권 개인2049 vs
-- 개인2049 등, DATA_DICTIONARY.md §1.1)를 candidate 라벨 재시도로 해결해 특정 target_id를
-- 찾아두므로, 이 함수는 그 결과인 channel_id/target_id를 그대로 받아 같은 대상에 대해서만
-- 기간 평균을 낸다(라벨 재해석을 중복하지 않음).
create or replace function get_channel_period_rank_and_rating(
  p_channel_id uuid,
  p_target_id uuid,
  p_date_from date,
  p_date_to date
)
returns table (
  avg_rank numeric,
  avg_rating numeric,
  days_with_data bigint
)
language sql
stable
as $$
  select
    round(avg(rank)::numeric, 1),
    round(avg(rating)::numeric, 5),
    count(distinct broadcast_date)
  from ratings
  where channel_id = p_channel_id
    and target_id = p_target_id
    and source_type = 'nielsen_daily'
    and program_id is null
    and broadcast_date between p_date_from and p_date_to
$$;
comment on function get_channel_period_rank_and_rating is 'Page 1 ENA 히어로 카드: 특정 채널×타깃(route.ts가 이미 찾은 channel_id/target_id)의 기간 평균 순위·시청률. 경쟁채널 재계산 없이 Nielsen이 이미 계산해 저장한 rank 컬럼의 평균만 낸다.';
