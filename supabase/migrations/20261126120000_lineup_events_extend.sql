-- 라인업 외부 이벤트 확장(2026-11-26 라인업 전면 리디자인, docs/lineup/REDESIGN_2026-11.md §6) — 사용자 승인(2026-11-26) 후 적용.
-- 하위 호환: 기존 열·행은 그대로 두고 열만 더한다(모두 기본값이 있어 기존 행이 그대로 유효). 유형 제약은 기존 값을 모두 포함하는 상위 집합으로 바꾼다.
-- 적용 전에도 화면·API는 동작했다(기본 열만 저장). 적용 뒤에는 repo.eventsSchemaExtended()가 참이 되어 확장 항목도 저장한다.

alter table lineup_events drop constraint if exists lineup_events_event_kind_check;
alter table lineup_events add constraint lineup_events_event_kind_check
  check (event_kind in ('sports', 'awards', 'election', 'anniversary', 'industry', 'other',
                        'movie', 'national', 'performance', 'special', 'internal'));

alter table lineup_events
  add column if not exists subtype text,                                   -- 하위 유형(예: 대선·총선, 올림픽·월드컵)
  add column if not exists all_day boolean not null default true,          -- 종일 여부
  add column if not exists start_time time,                                -- 시작 시각(종일이 아니면)
  add column if not exists end_time time,                                  -- 끝 시각(모르면 비움 — 임의로 채우지 않는다)
  add column if not exists date_precision text not null default 'day'
    check (date_precision in ('day', 'month', 'quarter', 'half', 'year')),  -- 날짜 정밀도(월·분기·반기·연도 발표는 그대로)
  add column if not exists status text not null default 'confirmed'
    check (status in ('confirmed', 'planned', 'tentative')),               -- 확정 상태
  add column if not exists importance smallint not null default 2
    check (importance between 1 and 3),                                    -- 중요도(1 낮음 · 2 보통 · 3 높음) — 띠 노출 순서
  add column if not exists work_ids uuid[],                                -- 관련 작품(lineup_works.id)
  add column if not exists source_url text,                                -- 검증 출처
  add column if not exists verified_at date;                               -- 출처 확인일

comment on column lineup_events.date_precision is '발표된 정밀도 그대로(월·분기·반기·연도). 미정 일정을 정확한 날짜로 바꾸지 않는다.';
