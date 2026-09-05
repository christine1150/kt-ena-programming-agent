-- 사용자 지시(2026-09-05) 이어서 — 배포 전 실측 중 발견한 2건을 함께 고친다.
--
-- (1) "짐쌀라비움" 요일 수정(20260905020000)만으로는 부족했다: featured_content가 가리키는
--     programs 행(canonical_name='짐쌀라비움')은 실제로 한 번도 방영 데이터를 받은 적이 없고,
--     실제 Nielsen 데이터는 정식 풀 타이틀 "캐리어하나로떠나는주문짐쌀라비움"으로 들어오고
--     있었다(1~5회, 2026-08-01~08-29 매주 토요일 19:50 ENA 확인). 이름 매칭 함수들
--     (get_episode_number 등)은 구두점만 무시할 뿐 완전히 다른 문자열은 같은 프로그램으로
--     보지 않으므로, 요일을 고쳐도 "이번 주 실적"은 절대 채워지지 않는 상태였다.
--     → featured_content를 실제 데이터가 쌓이는 programs 행으로 다시 연결하고, 그 행(과
--     동시방영 채널의 대응 행)의 표시 이름을 관리자가 쓰는 짧은 이름 "짐쌀라비움"으로
--     정리한다. 방영 이력이 전혀 없던 옛 programs 행은 featured_content와의 연결을 끊은
--     뒤(참조 0건 실측 확인) 정리한다.
-- (2) 사용자가 관리자 "주요 프로그램" 화면에서 "신병4: 사보타주"(12회, 종영 2026-09-29)로
--     확인 요청. 실측 결과 featured_content에 신병4가 **중복 등록**돼 있었다 — "신병4:
--     사보타주"(종영일 2026-09-29 있음, 그러나 이 이름의 programs 행엔 방영 데이터 0건)와
--     "신병4사보타주"(종영일 없음, 실제 방영 데이터는 전부 이 이름으로 들어옴) 두 행이
--     같은 일정(ENA 월·화 22:00, ENA Drama 재방)으로 동시에 존재했다 — 종영 예정일이
--     실제 데이터가 붙는 행이 아니라 빈 행에 적혀 있었던 것. 실제 데이터 행에 종영일을
--     옮기고 빈 중복 행은 정리한다(관리자 화면에 같은 작품이 두 번 뜨는 것도 함께 해결).
--
-- 두 사례 모두 등록 자체(요일/시각/채널/카테고리)는 정확했고, "표시용 programs 행"과
-- "실제 데이터가 쌓이는 programs 행"이 갈라져 있던 게 근본 원인이었다 — 새 프로그램을
-- 관리자 화면에 최초 등록할 때 실제 첫 방영 데이터가 들어오기 전에 만든 임시 programs 행이
-- 나중에 진짜 데이터 행과 합쳐지지 않고 남아있는 패턴으로 보인다.

-- (1) 짐쌀라비움 — featured_content를 실제 데이터 행으로 재연결
update featured_content
set program_id = 'eac70ccb-70ee-4816-856f-9670ca4d177f' -- 캐리어하나로떠나는주문짐쌀라비움(ENA, 실제 방영 데이터 보유)
where program_id = '2fef9458-a46e-4961-97f9-ef4ac2fd3cc7'; -- 짐쌀라비움(ENA, 방영 데이터 0건이던 옛 행)

-- 이제 참조가 없어진 옛 표시용 행 정리(위 UPDATE로 featured_content 참조 0건 확인된 뒤 실행).
delete from programs where id = '2fef9458-a46e-4961-97f9-ef4ac2fd3cc7';

-- 실제 데이터가 쌓이는 행의 표시 이름을 관리자가 쓰는 짧은 이름으로 정리(공백만 지우는
-- get_episode_number 매칭 규칙과 이미 일치하는 이름이라 회차 계산에 영향 없음).
update programs set canonical_name = '짐쌀라비움'
where id = 'eac70ccb-70ee-4816-856f-9670ca4d177f'; -- ENA(본방)
update programs set canonical_name = '짐쌀라비움'
where id = 'de026075-7db6-4d82-b919-b0ea7dc4f1e2'; -- ENA_PLAY(짐쌀라비움 동시방영 채널) 대응 행

-- (2) 신병4 — 실제 데이터가 쌓이는 행("신병4사보타주")에 종영 예정일을 옮기고, 빈 중복
-- 등록("신병4: 사보타주")은 정리한다.
update featured_content
set broadcast_end_date = '2026-09-29'
where program_id = '770ec65f-a294-47a4-a24b-11921463aa0d'; -- 신병4사보타주(ENA, 실제 방영 데이터 보유)

delete from featured_content
where program_id = '6d53a214-fead-40db-93f5-4a94c192dc3a'; -- 신병4: 사보타주(방영 데이터 0건이던 중복 행)
delete from programs where id = '6d53a214-fead-40db-93f5-4a94c192dc3a';
