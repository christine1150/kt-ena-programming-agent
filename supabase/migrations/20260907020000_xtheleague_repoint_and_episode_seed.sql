-- 사용자 지시(2026-09-07): "엑스 더 리그는 8월 2일 첫 방송으로 8/2 1회, 8/9 2회, 8/16 3회,
-- 8/23 4회 방송됨. DB에 반영."
--
-- 실측 확인 결과 이 프로그램도 짐쌀라비움(2026-09-05~06 처리)과 정확히 같은 패턴이었다 —
-- featured_content가 가리키는 programs 행("엑스 더 리그", 관리자 화면 등록용 표시 이름)은
-- 방영 데이터가 0건이고, 실제 Nielsen 데이터는 전부 원본 표기 "XTHELEAGUE"(공백 없음)로
-- 들어오고 있다(493건, 2026-08-02~09-06). 짐쌀라비움 사고에서 배운 그대로 — canonical_name을
-- "보기 좋은 이름"으로 바꾸면 다음 날 적재부터 새 고아 행이 생긴다 — 이번엔 이름을 바꾸지
-- 않고 featured_content만 실제 데이터 행으로 재연결한다(관리자 화면에는 이제 "XTHELEAGUE"로
-- 보인다 — programs에 canonical_name과 별개인 표시 전용 이름 컬럼이 없어 생기는 부수 효과,
-- 짐쌀라비움 때와 동일하게 정직히 밝혀둔다).
update featured_content
set program_id = '242ec843-e59b-47cf-abb7-86a20bef1963' -- XTHELEAGUE(ENA, 실제 방영 데이터 보유)
where program_id = '1608ea11-285c-4294-a41e-21b225536b7b'; -- 엑스 더 리그(ENA, 방영 데이터 0건)

delete from programs where id = '1608ea11-285c-4294-a41e-21b225536b7b';

-- 회차 seed는 1회(가장 이른 날짜)를 기준으로 둔다 — get_episode_number/get_program_rating_history의
-- 계산식이 "seed_broadcast_date 이후"만 정방향으로 세므로, 5회(8/23)를 seed로 두면 1~3회는
-- 영원히 episode_number=null이 되어(회차별 추이 그래프에서 앞 회차가 빠짐) 회귀할 수 있다.
insert into program_episode_counters (canonical_name, seed_episode_number, seed_broadcast_date)
values ('XTHELEAGUE', 1, '2026-08-02')
on conflict (canonical_name) do update set
  seed_episode_number = excluded.seed_episode_number,
  seed_broadcast_date = excluded.seed_broadcast_date;
