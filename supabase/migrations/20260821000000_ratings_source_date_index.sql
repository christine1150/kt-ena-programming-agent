-- 긴급 수정(2026-08-21): Nielsen 히스토리 백필(2023-07~2025-12, 약 140만 행 추가)로 ratings
-- 테이블이 크게 늘어난 뒤 Page 1의 "가장 최근 반영된 날짜" 조회
-- (select broadcast_date from ratings where source_type='nielsen_daily' order by broadcast_date
-- desc limit 1)가 statement timeout(57014)으로 실패해 "아직 반영된 Nielsen 데이터가 없습니다"
-- 오류를 냈다 — idx_ratings_source_type(source_type 단독)과 idx_ratings_channel_date
-- (channel_id, broadcast_date)만 있고 source_type+broadcast_date 조합 정렬을 지원하는 인덱스가
-- 없어, source_type으로 걸러진 뒤에도 broadcast_date 정렬을 위해 대량 행을 훑어야 했던 것.
create index if not exists idx_ratings_source_type_broadcast_date
  on ratings (source_type, broadcast_date desc);
comment on index idx_ratings_source_type_broadcast_date is '2026-08-21 긴급 추가: source_type 필터 + broadcast_date 정렬(Page1 최신 날짜 조회 등)을 인덱스만으로 처리하기 위함. 백필로 테이블이 급증하며 이 조합이 없어 통계적 timeout이 발생했다.';
