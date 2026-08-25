-- 사용자 제보(2026-08-26): "주요 컨텐츠 리뷰에서 여전히 꺾은선 그래프 하단에 회차 정보도
-- 안나온다" — 신병4:사보타주는 program_episode_counters에 seed가 전혀 없어서 get_episode_number/
-- get_program_rating_history가 계산할 회차 정보가 아예 없었다(원래는 관리자가 채널기본정보.xlsx
-- "요일 별 리뷰 프로그램" 시트를 재업로드하면 자동 seed되지만, 아직 재업로드되지 않았다).
-- 사용자가 이전에 대화로 전달한 시트 값("신병4 : 사보타주 ... 첫방송일자 2026-08-24") 기준으로
-- 수동 seed — 1회 = 2026-08-24. canonical_name은 Nielsen 실제 ingest 값과 정확히 일치해야
-- 하므로 문장부호를 뺀 "신병4사보타주"로 넣는다(programs 테이블 실측 확인: 두 채널(ENA/ENA
-- Drama) 모두 canonical_name="신병4사보타주"). 이후 정식 엑셀 재업로드 시에도 ON CONFLICT DO
-- NOTHING 정책이라 이 값이 덮어써지지 않는다(같은 값이라 문제 없음).
insert into program_episode_counters (canonical_name, seed_episode_number, seed_broadcast_date)
values ('신병4사보타주', 1, '2026-08-24')
on conflict (canonical_name) do update set
  seed_episode_number = excluded.seed_episode_number,
  seed_broadcast_date = excluded.seed_broadcast_date;
