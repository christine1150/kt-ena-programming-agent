-- 자체 발견·자체 원인 버그 긴급 수정(2026-09-06).
--
-- 20260905030000에서 "짐쌀라비움" 표시 이름 정리를 위해 실제 데이터가 쌓이는
-- programs 행(ENA eac70ccb, ENA_PLAY de026075)의 canonical_name을 관리자 화면용
-- 짧은 이름("짐쌀라비움")으로 바꿨었다. 그런데 Nielsen 일일 적재 파이프라인은
-- (channel_id, canonical_name) 유니크 제약으로 그날 원본 파일의 프로그램명과
-- 정확히 일치하는 행을 찾아 매칭하므로, canonical_name이 원본 표기
-- "캐리어하나로떠나는주문짐쌀라비움"에서 벗어나자 다음 적재(2026-09-05)부터
-- 매칭이 실패해 매일 새 고아 행을 만들기 시작했다 — 발견 시점 기준 ENA/ENA_PLAY
-- 각각 2026-09-05 하루치(68행/34행)가 고아 행(2120f7e3/e431d6e9)에 분리 적재돼
-- 있었다. 이대로 두면 하루가 지날 때마다 계속 새 고아 행이 생겨 이 작품의
-- 이력이 영구히 조각난다.
--
-- (참고) 같은 원본 이름의 ONCE 행(c5cbd076)은 이번 건과 무관하다 — ONCE는
-- 애초에 이 이름의 행이 하나도 없었고(오늘 처음 방영) canonical_name을 건드린
-- 적도 없어, 실측 결과 정상적인 신규 행이다. ENA_DRAMA 재방 행(316c975e)도
-- 처음부터 canonical_name을 바꾸지 않아 계속 정상 적재되고 있었다.
--
-- 되돌리는 순서: (1) 고아 행의 2026-09-05분 ratings를 원래 안정 행으로 이동
-- (2) 참조가 없어진 고아 행 삭제 (3) 이제서야 유니크 제약이 비어 안전해진
-- 안정 행의 canonical_name을 원본 표기로 되돌림(다음 적재부터 정상 매칭)
-- (4) program_episode_counters도 같은 이름으로 되돌림.
--
-- 관리자 "주요 프로그램" 화면은 이제 짧은 이름 대신 원본 전체 표기가 보인다 —
-- programs 테이블에 canonical_name과 별개인 표시 전용 이름 컬럼이 없어 발생하는
-- 부수 효과다(2026-09-06 사용자 보고 예정, 필요시 별도 컬럼 추가를 논의).

-- (1) 고아 행의 ratings를 안정 행으로 이동
update ratings
set program_id = 'eac70ccb-70ee-4816-856f-9670ca4d177f' -- ENA 안정 행
where program_id = '2120f7e3-13d2-4713-92e9-e84616899e75'; -- ENA 고아 행(2026-09-05분)

update ratings
set program_id = 'de026075-7db6-4d82-b919-b0ea7dc4f1e2' -- ENA_PLAY 안정 행
where program_id = 'e431d6e9-1954-4b4e-be9b-bb38ab10953c'; -- ENA_PLAY 고아 행(2026-09-05분)

-- (2) 참조 없어진 고아 행 삭제(mart_*/featured_content 참조 0건 실측 확인됨)
delete from programs where id = '2120f7e3-13d2-4713-92e9-e84616899e75';
delete from programs where id = 'e431d6e9-1954-4b4e-be9b-bb38ab10953c';

-- (3) 안정 행의 canonical_name을 원본 Nielsen 표기로 복원 — 이제 유니크 제약
-- 슬롯이 비어 있어 충돌 없이 적용된다. 다음 적재부터 정상적으로 이 행에 매칭됨.
update programs set canonical_name = '캐리어하나로떠나는주문짐쌀라비움'
where id = 'eac70ccb-70ee-4816-856f-9670ca4d177f'; -- ENA(본방)
update programs set canonical_name = '캐리어하나로떠나는주문짐쌀라비움'
where id = 'de026075-7db6-4d82-b919-b0ea7dc4f1e2'; -- ENA_PLAY(동시방영)

-- (4) 회차 계산 seed도 같은 원본 이름으로 되돌림(get_episode_number/
-- get_program_rating_history가 featured_content 등록 슬롯 기준으로 매칭하므로
-- 이름 자체는 무엇이든 상관없지만, seed 테이블 키와 programs.canonical_name을
-- 일치시켜 향후 혼동을 막는다).
--
-- (5) 이 김에 seed 기준점 자체도 1회(2026-08-01)로 앞당긴다. get_program_rating_history의
-- episode_number 계산식은 "seed_broadcast_date 이후"만 카운트하므로, 기존처럼 5회
-- (2026-08-29)를 seed로 두면 1~4회는 영원히 episode_number=null로 나온다(실측 확인).
-- 1회를 seed로 두면 1~6회 전부(사용자가 이번에 알려준 "9월5일=6회"까지) 정상 계산된다 —
-- 회차별 추이 그래프(요청 #4)가 1~6회 전 구간을 그리려면 필수.
update program_episode_counters
set canonical_name = '캐리어하나로떠나는주문짐쌀라비움',
    seed_episode_number = 1,
    seed_broadcast_date = '2026-08-01'
where canonical_name in ('짐쌀라비움', '캐리어하나로떠나는주문짐쌀라비움');

-- (6) 20260905020000이 featured_content.broadcast_day_of_week는 토요일로 고쳤지만,
-- 같은 행의 자유 서술 필드 broadcast_schedule_text("매주 일 19:50")는 그대로 남아 있었다 —
-- get_original_content_daily의 note 컬럼이 이 필드를 그대로 반환해 일간 카드에
-- "매주 일 19:50"이 계속 노출되고 있었다(day_of_week_iso=6으로 실제 매칭은 토요일 기준
-- 정상 동작하지만, 화면에 보이는 문구만 틀린 채였음). 관리자 "주요 프로그램" 화면에도
-- 이 필드가 그대로 나타나므로 함께 정정한다.
update featured_content
set broadcast_schedule_text = '매주 토요일 19:50'
where id in (
  select fc.id
  from featured_content fc
  join programs p on p.id = fc.program_id
  where p.canonical_name = '캐리어하나로떠나는주문짐쌀라비움'
);
