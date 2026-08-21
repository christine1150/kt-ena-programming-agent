-- 성능 긴급 수정(2026-08-21, 사용자 지시 — "1페이지 접속·채널 이동 로딩 속도가 느림"):
-- EXPLAIN ANALYZE로 직접 확인한 원인 — get_channel_daily_narrative의 decline_program(자기
-- 평균 대비 급락 프로그램 탐지) 서브쿼리가 "프로그램 X의 최근 8주 본방 슬롯 평균"을 구할 때
-- idx_ratings_program(program_id 단독 인덱스)만 있어서, 그 program_id의 **전체 기간(2023~2026,
-- 히스토리 백필로 최대 3년치)** ratings 행을 전부 읽어온 뒤에야 broadcast_date 범위로 걸러내고
-- 있었다(실측: 한 프로그램 조회에 ratings 90,898버퍼 히트, 실행 6.4초). 히스토리 백필 전에는
-- 프로그램당 데이터가 최대 230일뿐이라 문제가 안 됐지만, 이제 오래 방영된(재방송 포함) 프로그램은
-- 수천~수만 행이 쌓여 이 패턴이 매우 느려졌다.
-- ratings(program_id, broadcast_date) 복합 인덱스를 추가해 "이 프로그램의 이 날짜 범위"를
-- 인덱스만으로 바로 좁히도록 한다 — get_channel_daily_narrative/get_original_content_daily/
-- get_channel_demographic_program_highlights 등 canonical_name 매칭 후 날짜 범위로 좁히는
-- 모든 "본방 슬롯" 비교 쿼리가 공통으로 이 패턴을 쓰므로 전부 함께 개선된다.
create index if not exists idx_ratings_program_broadcast_date on ratings (program_id, broadcast_date);
comment on index idx_ratings_program_broadcast_date is '2026-08-21 긴급 추가: program_id로 좁힌 뒤 broadcast_date 범위로 다시 좁히는 "본방 슬롯" 비교 쿼리들(get_channel_daily_narrative 등)이 프로그램 단위 전체 히스토리를 다 읽지 않고 인덱스만으로 날짜 범위를 좁히게 하기 위함. 히스토리 백필(2023~2025) 이후 프로그램당 행 수가 크게 늘며 병목이 됨.';
