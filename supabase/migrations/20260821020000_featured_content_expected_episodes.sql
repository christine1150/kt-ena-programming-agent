-- 사용자 지시(2026-08-21): "주요 콘텐츠 관리에 첫 방송일자와 예상 회차를 넣으면 끝 방송일자를
-- 자동으로 인식해 정리되도록" — featured_content에 예상 총 회차 컬럼을 추가한다. 실제 종영일
-- 계산(첫 방송일자 + 매주 반복 요일 개수 기준 주수)은 저장 시점에 API 라우트(TypeScript)에서
-- 계산해 넣는다(CLAUDE.md 원칙: 계산 로직은 SQL 또는 애플리케이션 코드에서, 이 경우 단순 날짜
-- 산술이라 별도 SQL 함수 없이 upsert 전에 계산).
alter table featured_content add column if not exists expected_episode_count int;
comment on column featured_content.expected_episode_count is '예상 총 회차 수(관리자 입력) — broadcast_start_date + broadcast_day_of_week 요일 수를 기준으로 broadcast_end_date를 자동 계산하는 데 쓰인다(2026-08-21 추가).';
