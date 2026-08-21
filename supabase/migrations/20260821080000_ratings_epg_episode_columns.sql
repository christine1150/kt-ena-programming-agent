-- 사용자 지시(2026-08-21): OLIFE(세계테마기행/극한직업/걸어서세계속으로/한국기행 등)는 같은
-- 프로그램이라도 회차·부제(국가/도시/주제)에 따라 시청률 편차가 커서, "회차/부제 단위" 분석이
-- 필요하다. 관리자가 제공한 EPG(일일운행표) 엑셀에 회차·부제가 직접 있어(별도 파싱/추측 불필요),
-- 이를 Nielsen ratings 행에 매칭해 채워 넣는다(program_id/canonical_name은 기존 로직 그대로,
-- 이 두 컬럼만 추가로 채운다 — is_first_run 컬럼을 추가했던 방식과 동일한 패턴).
alter table ratings add column if not exists episode_number int;
alter table ratings add column if not exists episode_subtitle text;
comment on column ratings.episode_number is 'EPG(일일운행표) 매칭으로 채워지는 회차 번호(BIS등록회차 등 방송사 고유 번호, 프로그램마다 채번 체계가 다를 수 있음) — 매칭 안 된 행은 NULL(2026-08-21, OLIFE부터 시작).';
comment on column ratings.episode_subtitle is 'EPG(일일운행표) 매칭으로 채워지는 부제(원문 그대로, 국가/도시/주제가 자유 텍스트로 섞여 있어 별도 구조화 필드로 분리하지 않음 — 검색은 이 텍스트 자체로) — 매칭 안 된 행은 NULL(2026-08-21).';
