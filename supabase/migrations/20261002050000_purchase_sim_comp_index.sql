-- 구매 시뮬레이터 입력 RPC 성능: 경쟁 프로그램 3타깃 테이블을 (타깃, 날짜)로 바로 걸러 읽게 한다.
-- 1년 윈도우 조회가 target_label 필터 없이 날짜 인덱스만 타서 30초 걸리던 문제(2026-10-02 실측)를 줄이기 위함.
create index if not exists competitor_program_target_ratings_label_date_idx
  on competitor_program_target_ratings (target_label, broadcast_date);
analyze competitor_program_target_ratings;
