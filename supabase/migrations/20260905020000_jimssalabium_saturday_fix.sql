-- 사용자 지시(2026-09-05): "짐쌀라비움"은 등록만 일요일로 잘못돼 있었고, 실제로는 매주
-- 토요일 저녁 7시 50분 ENA 방영이었다(1회 8/1, 2회 8/8, 3회 8/15, 4회 8/22, 5회 8/29 —
-- 전부 토요일). featured_content(주요 콘텐츠 관리 화면이 직접 참조하는 표)의 요일만 고쳐
-- 반영한다 — 채널(ENA)·시각(19:50)은 이미 맞았다.
update featured_content
set broadcast_day_of_week = array['토']
where id in (
  select fc.id
  from featured_content fc
  join programs p on p.id = fc.program_id
  where p.canonical_name = '짐쌀라비움'
);

-- program_episode_counters(회차 자동 계산 기준점)도 사용자가 알려준 실제 회차로 갱신 —
-- episode-number-seeding 메모리(대화 중 알려주는 회차 번호는 upsert로 반영) 그대로.
-- 이전 seed(1회=2026-08-01)를 5회=2026-08-29로 교체 — 이후 회차는 get_episode_number가
-- 위에서 고친 토요일 슬롯 기준으로 자동 계산한다.
insert into program_episode_counters (canonical_name, seed_episode_number, seed_broadcast_date)
values ('짐쌀라비움', 5, '2026-08-29')
on conflict (canonical_name) do update set
  seed_episode_number = excluded.seed_episode_number,
  seed_broadcast_date = excluded.seed_broadcast_date;
