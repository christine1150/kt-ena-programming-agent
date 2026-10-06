-- Avail(권리) 표준 모델 단계 06(2026-10-06): 권리 revision·보충 속성·콘텐츠 연결·확인 기록·사용 원장·편성안 권리 스냅샷.
-- 코드가 best-effort로 읽고 쓴다 — 이 마이그레이션이 적용되기 전에도 기존 성과 분석·편성표 뽑기는 그대로 동작하고,
-- 적용 전에는 Avail 업로드·권리 판정·원장이 작동하지 않는다(관리자 화면에 '미적용' 표시, 실행 가능 판정은 보류).
-- 실제 계약 조건·가격은 이 파일에 넣지 않는다. 가격은 선택 입력이며 비어 있으면 '미확인'이다(0원 아님).

-- 1) 반영 배치(파일 1건 = 1배치). 원본 파일 해시와 시트별 감지 결과를 남긴다.
create table if not exists avail_batches (
  id uuid primary key default gen_random_uuid(),
  batch_kind text not null check (batch_kind in ('incremental', 'full_snapshot')),
  snapshot_scope jsonb,                  -- 전체 스냅샷일 때 교체 대상 범위(채널·자료 종류·기간)
  file_name text not null,
  file_hash text,
  sheet_summary jsonb not null default '[]'::jsonb,
  plan_summary jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'applied', 'failed')),
  applied_by text not null,
  applied_at timestamptz not null default now(),
  note text
);

-- 2) 권리 revision. 행을 고치지 않고 새 revision을 쌓는다(과거 평가·예측을 현재 권리표로 덮지 않기 위해).
--    effective_*는 권리의 유효기간(data.window), entered_at은 시스템이 이 revision을 알게 된 시각이다. 둘은 별개다.
create table if not exists avail_grants (
  revision_id text primary key,          -- grant_id#원본 행 해시
  grant_id text not null,
  row_hash text not null,
  supersedes_revision_id text,
  status text not null check (status in ('active', 'revoked', 'expired', 'proposed_revoke')),
  source_kind text not null check (source_kind in ('content_avail', 'channel_avail', 'manual')),
  batch_id uuid references avail_batches (id),
  entered_at timestamptz not null default now(),
  data jsonb not null,                   -- Grant 전체(원본열·파일·시트·행 포함)
  created_at timestamptz not null default now()
);
create index if not exists idx_avail_grants_grant on avail_grants (grant_id, entered_at desc);
create index if not exists idx_avail_grants_batch on avail_grants (batch_id);

-- 3) 보충 속성(1st window 순서·제작년도·영문 제품명·오리지널 표시). 파일을 다시 올려도 지워지지 않고 원본을 덮지 않는다.
create table if not exists avail_addenda (
  addendum_id text primary key,
  data jsonb not null,
  provenance text not null,
  saved_by text not null,
  saved_at timestamptz not null default now()
);

-- 4) 콘텐츠 연결: 운영자가 확인한 (프로그램 ↔ Avail 제목) 연결만 저장한다. 자동 병합은 하지 않는다.
create table if not exists avail_content_links (
  program_id text not null,
  canonical_key text not null,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now(),
  primary key (program_id, canonical_key)
);

-- 5) 확인 기록(메모·홀드백·승인·기소진·중복). row_hash가 현재 revision과 같을 때만 유효하다.
create table if not exists avail_confirmations (
  id bigserial primary key,
  grant_id text not null,
  row_hash text not null,
  topic text not null,
  value text,
  evidence text,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now()
);
create index if not exists idx_avail_confirmations_grant on avail_confirmations (grant_id, topic);

-- 6) 계약 해석 확인(종료일 포함 여부·기간 기준·걸친 방송·방수 단위·1st window 단위).
create table if not exists avail_interpretation (
  key text primary key,
  value jsonb not null,
  confirmed_by text not null,
  confirmed_at timestamptz not null default now()
);

-- 7) 사용 원장 — 삭제·수정하지 않는 이벤트 로그. 취소·복원도 반대 이벤트로 쌓는다.
create table if not exists avail_usage_ledger (
  seq bigserial primary key,
  usage_id text not null,
  event text not null check (event in ('reserve', 'consume', 'release', 'cancel')),
  pool_id text not null,
  grant_revision_id text not null,
  channel_id text not null,
  episode int,
  scheduled_at timestamptz,
  actual_at timestamptz,
  units int not null check (units > 0),
  schedule_revision_id text,
  idempotency_key text not null unique,
  source_event_id text,
  evidence text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_avail_usage_source_event on avail_usage_ledger (source_event_id) where source_event_id is not null;
create index if not exists idx_avail_usage_pool on avail_usage_ledger (pool_id, episode, seq);
create index if not exists idx_avail_usage_usage on avail_usage_ledger (usage_id, seq);

create or replace function avail_immutable_guard() returns trigger language plpgsql as $$
begin
  raise exception '% 테이블은 수정·삭제할 수 없습니다(반대 이벤트를 새로 쌓으세요)', tg_table_name;
end $$;
drop trigger if exists trg_avail_usage_immutable on avail_usage_ledger;
create trigger trg_avail_usage_immutable before update or delete on avail_usage_ledger for each row execute function avail_immutable_guard();

-- 8) 편성안 권리 스냅샷 — 저장 당시의 판정과 권리 목록 버전을 한 번 쓰고 바꾸지 않는다.
create table if not exists avail_plan_snapshots (
  id bigserial primary key,
  plan_id text not null,
  schedule_revision_id text not null,
  inventory_version text not null,
  captured_at timestamptz not null default now(),
  data jsonb not null,
  unique (plan_id, schedule_revision_id)
);
drop trigger if exists trg_avail_snapshot_immutable on avail_plan_snapshots;
create trigger trg_avail_snapshot_immutable before update or delete on avail_plan_snapshots for each row execute function avail_immutable_guard();

alter table avail_batches enable row level security;
alter table avail_grants enable row level security;
alter table avail_addenda enable row level security;
alter table avail_content_links enable row level security;
alter table avail_confirmations enable row level security;
alter table avail_interpretation enable row level security;
alter table avail_usage_ledger enable row level security;
alter table avail_plan_snapshots enable row level security;

-- 9) 원자적 예약·소진·해제. "풀 잠금 → 잔여 계산 → 기록"을 한 트랜잭션에서 한다(두 편성자가 마지막 1회를 동시에 잡아도 한 건만 성공).
--    규칙은 src/lib/avail/ledger.ts(테스트된 기준 구현)와 같다. 반환은 jsonb로 해 RETURNS TABLE 열 이름 충돌을 피한다.
--    사용 상태 = 사용(usage_id)별 마지막 이벤트. reserve·consume이 횟수에 잡히고 release·cancel은 잡히지 않는다.
create or replace function avail_reserve_usage(
  p_pool_id text, p_episode int, p_units int, p_limit int, p_per_channel boolean, p_channel_id text,
  p_grant_revision_id text, p_scheduled_at timestamptz, p_schedule_revision_id text,
  p_idempotency_key text, p_evidence text default null, p_usage_id text default null
) returns jsonb language plpgsql as $$
declare
  v_dup avail_usage_ledger%rowtype;
  v_used int;
  v_row avail_usage_ledger%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id || '|' || coalesce(p_episode::text, '*'), 0));
  select * into v_dup from avail_usage_ledger where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'seq', v_dup.seq, 'usage_id', v_dup.usage_id);
  end if;
  select coalesce(sum(t.units), 0) into v_used from (
    select distinct on (l.usage_id) l.usage_id, l.event, l.units, l.channel_id
      from avail_usage_ledger l
     where l.pool_id = p_pool_id and l.episode is not distinct from p_episode
     order by l.usage_id, l.seq desc
  ) t
  where t.event in ('reserve', 'consume') and (not p_per_channel or t.channel_id = p_channel_id);
  if p_limit is not null and v_used + p_units > p_limit then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'remaining', greatest(0, p_limit - v_used));
  end if;
  insert into avail_usage_ledger (usage_id, event, pool_id, grant_revision_id, channel_id, episode, scheduled_at, units, schedule_revision_id, idempotency_key, evidence)
  values (coalesce(p_usage_id, 'u:' || p_idempotency_key), 'reserve', p_pool_id, p_grant_revision_id, p_channel_id, p_episode, p_scheduled_at, p_units, p_schedule_revision_id, p_idempotency_key, p_evidence)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'replay', false, 'seq', v_row.seq, 'usage_id', v_row.usage_id);
end $$;

create or replace function avail_consume_usage(
  p_source_event_id text, p_pool_id text, p_episode int, p_grant_revision_id text, p_channel_id text, p_units int,
  p_actual_at timestamptz, p_scheduled_at timestamptz, p_usage_id text, p_limit int, p_evidence text default null
) returns jsonb language plpgsql as $$
declare
  v_dup avail_usage_ledger%rowtype;
  v_cur avail_usage_ledger%rowtype;
  v_usage text := p_usage_id;
  v_used int;
  v_reserved int := 0;
  v_over boolean;
  v_row avail_usage_ledger%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id || '|' || coalesce(p_episode::text, '*'), 0));
  select * into v_dup from avail_usage_ledger where source_event_id = p_source_event_id;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'seq', v_dup.seq, 'usage_id', v_dup.usage_id);
  end if;
  if v_usage is null and p_scheduled_at is not null then
    select t.usage_id into v_usage from (
      select distinct on (l.usage_id) l.usage_id, l.event, l.channel_id, l.scheduled_at
        from avail_usage_ledger l
       where l.pool_id = p_pool_id and l.episode is not distinct from p_episode
       order by l.usage_id, l.seq desc
    ) t where t.event = 'reserve' and t.channel_id = p_channel_id and t.scheduled_at = p_scheduled_at limit 1;
  end if;
  if v_usage is not null then
    select * into v_cur from avail_usage_ledger where usage_id = v_usage order by seq desc limit 1;
    if found and v_cur.event = 'consume' then
      return jsonb_build_object('ok', true, 'replay', true, 'seq', v_cur.seq, 'usage_id', v_cur.usage_id);
    end if;
    if found and v_cur.event = 'reserve' then v_reserved := v_cur.units; end if;
  end if;
  select coalesce(sum(t.units), 0) into v_used from (
    select distinct on (l.usage_id) l.usage_id, l.event, l.units
      from avail_usage_ledger l
     where l.pool_id = p_pool_id and l.episode is not distinct from p_episode
     order by l.usage_id, l.seq desc
  ) t where t.event in ('reserve', 'consume');
  v_over := p_limit is not null and (v_used - v_reserved + p_units) > p_limit;
  insert into avail_usage_ledger (usage_id, event, pool_id, grant_revision_id, channel_id, episode, scheduled_at, actual_at, units, schedule_revision_id, idempotency_key, source_event_id, evidence)
  values (coalesce(v_usage, 'u:' || p_source_event_id), 'consume', p_pool_id, p_grant_revision_id, p_channel_id, p_episode, p_scheduled_at, p_actual_at, p_units,
          case when v_cur.event = 'reserve' then v_cur.schedule_revision_id else null end,
          'consume:' || p_source_event_id, p_source_event_id,
          coalesce(p_evidence, case when v_over then '한도 초과 실적(실제 방송 사실 기록)' else null end))
  returning * into v_row;
  return jsonb_build_object('ok', true, 'replay', false, 'seq', v_row.seq, 'usage_id', v_row.usage_id, 'over_limit', v_over);
end $$;

create or replace function avail_release_usage(
  p_usage_id text, p_kind text, p_idempotency_key text, p_evidence text default null
) returns jsonb language plpgsql as $$
declare
  v_first avail_usage_ledger%rowtype;
  v_cur avail_usage_ledger%rowtype;
  v_dup avail_usage_ledger%rowtype;
  v_row avail_usage_ledger%rowtype;
begin
  if p_kind not in ('release', 'cancel') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;
  select * into v_first from avail_usage_ledger where usage_id = p_usage_id order by seq asc limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_first.pool_id || '|' || coalesce(v_first.episode::text, '*'), 0));
  select * into v_dup from avail_usage_ledger where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'seq', v_dup.seq, 'usage_id', v_dup.usage_id);
  end if;
  select * into v_cur from avail_usage_ledger where usage_id = p_usage_id order by seq desc limit 1;
  if v_cur.event not in ('reserve', 'consume') or (p_kind = 'release' and v_cur.event = 'consume') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;
  insert into avail_usage_ledger (usage_id, event, pool_id, grant_revision_id, channel_id, episode, scheduled_at, actual_at, units, schedule_revision_id, idempotency_key, evidence)
  values (p_usage_id, p_kind, v_cur.pool_id, v_cur.grant_revision_id, v_cur.channel_id, v_cur.episode, v_cur.scheduled_at, v_cur.actual_at, v_cur.units, v_cur.schedule_revision_id, p_idempotency_key, p_evidence)
  returning * into v_row;
  return jsonb_build_object('ok', true, 'replay', false, 'seq', v_row.seq, 'usage_id', v_row.usage_id);
end $$;
