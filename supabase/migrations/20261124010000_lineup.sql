-- 라인업 화면(2026-11-24, docs/lineup/LINEUP_DESIGN.md §8).
-- 자사 오리지널·사업형 라인업과 타사(지상파·종편·tvN 등) 드라마 라인업을 한 틀(방송사 > 자리 > 편성 구간)로 저장한다.
-- 라인업은 대외비다: 모든 표는 RLS를 켜고 정책을 두지 않아 서버(service_role)만 읽고 쓴다.
-- 작품 제목 등 실제 라인업 내용은 이 파일에 넣지 않는다(시드는 방송사 기준표만). 내용은 /lineup/manage 업로드로 들어온다.

-- 1) 방송사·채널. 자사는 channels와 연결한다.
create table lineup_outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- 자사: channels.code와 같게('ENA') / 타사: 'TVN','JTBC','MBC','SBS','KBS2'…
  display_name text not null,                      -- 화면 표기('tvN')
  side text not null check (side in ('own', 'rival')),
  channel_id uuid references channels(id) on delete restrict,
  outlet_kind text check (outlet_kind in ('own', 'terrestrial', 'general', 'cable', 'ott')),
  aliases text[] not null default '{}',            -- 원자료 표기 변형('TVN','tvn') — 비교는 공백 제거·대문자로
  sort_order int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check (side <> 'own' or channel_id is not null)
);

-- 2) 자리(요일 묶음 + 시각). 시각은 방송일 기준 분(00:30 = 1470, competitor_airings와 같은 규칙).
create table lineup_slots (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references lineup_outlets(id) on delete restrict,
  name text not null,                              -- '월화 22:00', '토일 21:20'
  days smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[1,2,3,4,5,6,7]::smallint[]),
  start_minute int check (start_minute between 0 and 1799),
  time_note text,                                  -- '1일 2회', '금토 23시' 같은 원문
  compare_block text not null check (compare_block in ('mon_tue', 'wed_thu', 'weekend', 'other')),
  default_genre text not null check (default_genre in ('drama', 'variety', 'business', 'other')),
  sort_order int not null default 100,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (outlet_id, name)
);

-- 3) 작품. 한 작품이 여러 편성 구간(파트1·2, 자리 이동)을 가질 수 있다.
create table lineup_works (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references lineup_outlets(id) on delete restrict,
  title text not null,                             -- 풀네임
  title_key text not null,                         -- 정규화 키(공백·문장부호 제거, 소문자)
  aliases text[] not null default '{}',            -- 다른 표기의 정규화 키(가제 → 확정 제목, 띄어쓰기 차이)
  short_title text,                                -- 넘칠 때만 쓰는 줄임말(사람이 정함, 코드에 두지 않음)
  title_tentative boolean not null default false,  -- 가제
  genre text not null check (genre in ('drama', 'variety', 'business', 'other')),
  total_episodes int check (total_episodes > 0),
  cast_main text[] not null default '{}',
  directors text[] not null default '{}',
  writers text[] not null default '{}',
  producers text[] not null default '{}',          -- 제작사
  logline text,
  ott_note text,                                   -- '티빙 오리지널' 등 원문
  program_id uuid references programs(id) on delete set null,  -- 자사 방영 후 시청률 연결(2단계)
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
create unique index lineup_works_outlet_title_uq on lineup_works (outlet_id, title_key) where archived_at is null;
create index lineup_works_aliases_idx on lineup_works using gin (aliases);

-- 4) 자료 출처(업로드·입력 한 번 = 한 건). 원본 파일은 저장하지 않는다.
create table lineup_sources (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('own_xlsx', 'industry_xlsx', 'outlet_xlsx', 'standard_xlsx', 'paste', 'manual')),
  title text not null,
  as_of date not null,                             -- 자료 기준일
  file_name text,
  file_hash text,
  change_note text,                                -- '추후 변경 가능성 있음' 같은 원문 주석
  summary jsonb not null default '{}'::jsonb,      -- 반영 결과 건수 등
  status text not null default 'applied' check (status in ('applied', 'rolled_back')),
  applied_by text not null,
  applied_at timestamptz not null default now()
);

-- 5) 행사(공휴일이 아닌 것: 대형 중계·시상식·선거·기념일). 공휴일은 public_holidays를 읽는다.
create table lineup_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_kind text not null check (event_kind in ('sports', 'awards', 'election', 'anniversary', 'industry', 'other')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  outlet_ids uuid[],                               -- 특정 방송사만 영향(중계 결방). 비면 전체
  note text,
  source_id uuid references lineup_sources(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 6) 편성 구간 = 화면의 막대·점·마름모·칸 하나.
create table lineup_runs (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references lineup_slots(id) on delete restrict,
  work_id uuid references lineup_works(id) on delete restrict,
  run_kind text not null check (run_kind in ('series', 'monthly', 'single', 'multi_day', 'tbd', 'hiatus', 'filler')),
    -- series 연속 편성 / monthly 월 1회 / single 단발 / multi_day 이틀 이상 행사 / tbd 미정 자리 / hiatus 결방·휴방 / filler 수급물
  status text not null default 'planned' check (status in ('confirmed', 'planned', 'tentative')),
  start_date date,
  start_precision text not null check (start_precision in ('day', 'week', 'month', 'unknown')),
  end_date date,                                   -- 없으면 끝 모름(추정은 저장하지 않고 서버 함수가 계산)
  end_precision text not null check (end_precision in ('day', 'week', 'month', 'open', 'unknown')),
  start_text text,                                 -- 원문('3~4월', '27.02.05')
  end_text text,
  episodes int check (episodes > 0),               -- 이 구간 회차 수
  episode_from int,                                -- 누적 회차 표기(장수 예능)
  episode_to int,
  recurrence text,                                 -- 월 1회 규칙 원문('월1회·마지막주')
  air_dates date[],                                -- 단발·이틀 행사·월 1회의 명시 날짜
  label text,                                      -- 작품 없는 칸의 글자('미정', 'OTT 수급', '휴방')
  reason text,                                     -- 결방·휴방 사유
  event_id uuid references lineup_events(id) on delete set null,
  source_id uuid references lineup_sources(id) on delete set null,
  source_cell text,                                -- 원자료 위치('2027드라마!G37:M37')
  source_text text,                                -- 셀 원문
  needs_review boolean not null default false,
  note text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  check ((run_kind in ('tbd', 'hiatus', 'filler')) = (work_id is null)),
  check (start_date is null or end_date is null or end_date >= start_date),
  check (start_precision = 'unknown' or start_date is not null),
  check (end_precision in ('unknown', 'open') or end_date is not null),
  check (run_kind not in ('single', 'multi_day') or start_date is not null)
);
create index lineup_runs_slot_idx on lineup_runs (slot_id, start_date);
create index lineup_runs_work_idx on lineup_runs (work_id);
create index lineup_runs_range_idx on lineup_runs (start_date, end_date) where archived_at is null;
create index lineup_runs_source_idx on lineup_runs (source_id);

-- 7) 변경 이력(트리거가 씀, 바꾼 사람 = NEW.updated_by).
create table lineup_changes (
  id bigserial primary key,
  entity text not null check (entity in ('outlet', 'slot', 'work', 'run', 'event')),
  entity_id uuid not null,
  action text not null check (action in ('create', 'update', 'archive', 'restore', 'delete')),
  diff jsonb not null,                             -- {"start_date":{"before":"…","after":"…"}}
  source_id uuid,
  actor text not null,
  at timestamptz not null default now()
);
create index lineup_changes_entity_idx on lineup_changes (entity, entity_id, at desc);
create index lineup_changes_recent_idx on lineup_changes (at desc);

-- 변경 이력 트리거 — 바뀐 열만 before/after로 남긴다. updated_at·created_at은 비교에서 뺀다.
create or replace function lineup_log_change() returns trigger
language plpgsql as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
  v_action text;
begin
  for v_key in select jsonb_object_keys(v_old || v_new) loop
    if v_key in ('updated_at', 'created_at') then continue; end if;
    if (v_old -> v_key) is distinct from (v_new -> v_key) then
      v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('before', v_old -> v_key, 'after', v_new -> v_key));
    end if;
  end loop;
  if tg_op = 'UPDATE' and v_diff = '{}'::jsonb then return new; end if;
  v_action := case
    when tg_op = 'INSERT' then 'create'
    when tg_op = 'DELETE' then 'delete'
    when (v_old ->> 'archived_at') is null and (v_new ->> 'archived_at') is not null then 'archive'
    when (v_old ->> 'archived_at') is not null and (v_new ->> 'archived_at') is null then 'restore'
    else 'update' end;
  insert into lineup_changes (entity, entity_id, action, diff, source_id, actor)
  values (
    v_entity,
    ((case when tg_op = 'DELETE' then v_old else v_new end) ->> 'id')::uuid,
    v_action,
    v_diff,
    nullif(coalesce(v_new ->> 'source_id', v_old ->> 'source_id'), '')::uuid,
    coalesce(v_new ->> 'updated_by', v_old ->> 'updated_by', 'system')
  );
  return coalesce(new, old);
end $$;

create or replace function lineup_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger lineup_outlets_touch before update on lineup_outlets for each row execute function lineup_touch_updated_at();
create trigger lineup_slots_touch before update on lineup_slots for each row execute function lineup_touch_updated_at();
create trigger lineup_works_touch before update on lineup_works for each row execute function lineup_touch_updated_at();
create trigger lineup_runs_touch before update on lineup_runs for each row execute function lineup_touch_updated_at();
create trigger lineup_events_touch before update on lineup_events for each row execute function lineup_touch_updated_at();

create trigger lineup_outlets_log after insert or update or delete on lineup_outlets for each row execute function lineup_log_change('outlet');
create trigger lineup_slots_log after insert or update or delete on lineup_slots for each row execute function lineup_log_change('slot');
create trigger lineup_works_log after insert or update or delete on lineup_works for each row execute function lineup_log_change('work');
create trigger lineup_runs_log after insert or update or delete on lineup_runs for each row execute function lineup_log_change('run');
create trigger lineup_events_log after insert or update or delete on lineup_events for each row execute function lineup_log_change('event');

alter table lineup_outlets enable row level security;
alter table lineup_slots enable row level security;
alter table lineup_works enable row level security;
alter table lineup_sources enable row level security;
alter table lineup_events enable row level security;
alter table lineup_runs enable row level security;
alter table lineup_changes enable row level security;

comment on table lineup_runs is '라인업 편성 구간(화면 막대 하나). 대외비 — 서버 전용(RLS 정책 없음). docs/lineup/LINEUP_DESIGN.md';

-- 방송사 기준표 시드(작품 내용 없음). 자사 7채널은 channels에서, 타사는 고정 목록.
insert into lineup_outlets (code, display_name, side, channel_id, outlet_kind, aliases, sort_order)
select c.code, c.name, 'own', c.id, 'own', array[upper(replace(c.name, ' ', ''))],
  case c.code when 'ENA' then 1 when 'ENA_DRAMA' then 2 when 'ENA_PLAY' then 3 when 'OLIFE' then 4
    when 'ONCE' then 5 when 'ENA_STORY' then 6 when 'SKYUHD' then 7 else 9 end
from channels c
where c.code in ('ENA', 'ENA_DRAMA', 'ENA_PLAY', 'ENA_STORY', 'OLIFE', 'ONCE', 'SKYUHD')
on conflict (code) do nothing;

insert into lineup_outlets (code, display_name, side, outlet_kind, aliases, sort_order) values
  ('KBS2', 'KBS2', 'rival', 'terrestrial', array['KBS2', 'KBS'], 20),
  ('MBC', 'MBC', 'rival', 'terrestrial', array['MBC'], 21),
  ('SBS', 'SBS', 'rival', 'terrestrial', array['SBS'], 22),
  ('TVN', 'tvN', 'rival', 'cable', array['TVN'], 30),
  ('JTBC', 'JTBC', 'rival', 'general', array['JTBC'], 31),
  ('CHANNEL_A', '채널A', 'rival', 'general', array['채널A', 'CHANNELA'], 32),
  ('MBN', 'MBN', 'rival', 'general', array['MBN'], 33),
  ('TV_CHOSUN', 'TV조선', 'rival', 'general', array['TV조선', 'TVCHOSUN'], 34)
on conflict (code) do nothing;
