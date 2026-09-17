-- skyUHD 수기 시청률의 "빈 시청률 칸"을 결측(NULL)이 아니라 실측 0으로 정정한다.
--
-- 배경(사용자 지시 2026-09-17): "시청률이 비어있는 것은 0으로 인식하면 되고."
-- skyUHD 월별 세부 엑셀은 측정값이 0인 회차의 시청률 칸을 그냥 비워두는 관행이다. 그런데
-- 적재 파서가 이 빈 칸을 NULL로 저장해 왔고, 하류 집계 함수들은 예외 없이
--   ... where r.rating is not null ... avg(r.rating), count(*) as air_count ...
-- 형태(예: get_skyuhd_program_scorecard, get_dow_hourblock_heatmap)라서, NULL로 들어간 행이
-- **분모에서 통째로 빠졌다**. 그 결과 "편성은 됐지만 시청률 0이었던 회차"가 없는 셈이 되어
-- skyUHD의 시간대별 그래프·TOP20·프로그램 스코어카드 평균이 실제보다 높게 나온다.
--
-- 근본 해결은 적재 시점에 0으로 저장하는 것이고(src/lib/skyUhd.ts의 parseSkyUhdRating,
-- 2026-09-17 수정 완료), 이 마이그레이션은 그 이전에 NULL로 들어간 과거 행만 소급 보정한다.
-- 집계 함수(SQL)는 한 줄도 건드리지 않는다 — 데이터가 규칙에 맞게 바뀌면 기존 함수가 그대로
-- 올바른 값을 낸다(CLAUDE.md: DB가 KPI의 유일한 진실 원천, Delta-Only).
--
-- 안전장치:
--  * source_type = 'skyuhd'(수기 업로드 경로)로만 한정한다. 같은 채널이라도 닐슨 랭킹 시트에서
--    온 채널 단위 행(source_type = 'nielsen_daily')은 건드리지 않는다.
--  * channels.code = 'SKYUHD' 조건을 한 번 더 걸어 다른 채널 데이터는 어떤 경우에도 바뀌지 않게 한다.
--  * "행 자체가 없는 시간"은 원래 행이 없으므로 이 UPDATE의 대상이 아니다 — 없던 편성을
--    0으로 만들어내지 않는다(CLAUDE.md: 존재하지 않는 값을 지어내지 않음).
--  * rating is null 인 행만 바꾸므로 몇 번 실행해도 결과가 같다(idempotent).
--
-- 주의: 적용하면 skyUHD의 프로그램 평균·시간대 평균이 (0 회차가 분모에 포함되면서) 내려간다.
--       수치가 "떨어진" 게 아니라 그동안 빠져 있던 0 회차가 제자리를 찾은 것이다.

update ratings r
set rating = 0
from channels c
where c.id = r.channel_id
  and c.code = 'SKYUHD'
  and r.source_type = 'skyuhd'
  and r.rating is null;
