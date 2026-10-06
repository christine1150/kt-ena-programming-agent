-- 액션 검토 기록(단계 07) — 홈 결정 카드에서 시작한 검토의 상태(검토 중/보류/채택/기각)와 이유를 추가 전용으로 남긴다.
-- 수정·삭제할 수 없다(트리거). "현재 상태"는 같은 action_id의 가장 최근 행이며 이력은 그대로 남는다.
-- 이 마이그레이션이 적용되기 전에도 화면은 동작한다(검토 상태 저장만 '미적용'으로 안내).

create table if not exists action_review_events (
  id uuid primary key default gen_random_uuid(),
  -- 단계 04 ActionCandidate.actionId(프로그램 액션) 또는 data:/anomaly: 합성 ID
  action_id text not null check (char_length(action_id) between 1 and 120),
  action_key text check (action_key is null or char_length(action_key) <= 200),
  channel_code text check (channel_code is null or char_length(channel_code) <= 40),
  title text not null check (char_length(title) between 1 and 300),
  status text not null check (status in ('reviewing','hold','adopted','dismissed')),
  -- 보류·채택·기각은 이유가 필요하다(검토 중은 비어 있어도 됨)
  reason text check (reason is null or char_length(reason) <= 500),
  -- 보류 재검토일 또는 채택 후 성과 평가일
  review_by date,
  -- 이 검토에서 저장한 편성안(ideal_schedule_runs.id). 편성안이 지워져도 기록은 남도록 FK를 걸지 않는다
  linked_run_id uuid,
  -- 판단 당시의 문맥(subject·channel·date·preset·view 등 작은 객체)
  context jsonb not null default '{}'::jsonb,
  snapshot_id text check (snapshot_id is null or char_length(snapshot_id) <= 64),
  -- 기록한 사람은 서버가 세션에서 채운다(클라이언트가 보낸 값은 쓰지 않음)
  actor_role text check (actor_role in ('admin','pd')),
  actor_id text,
  actor_name text,
  created_at timestamptz not null default now(),
  constraint action_review_reason_required check (status = 'reviewing' or (reason is not null and char_length(btrim(reason)) > 0))
);
comment on table action_review_events is '홈 결정 카드 검토 기록(추가 전용). 현재 상태 = action_id별 가장 최근 행.';

create index if not exists action_review_events_action_idx on action_review_events (action_id, created_at desc);
create index if not exists action_review_events_channel_idx on action_review_events (channel_code, created_at desc);

create or replace function action_review_events_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'action_review_events는 추가 전용입니다(수정·삭제·비우기할 수 없습니다).';
end;
$$;

drop trigger if exists action_review_events_no_update on action_review_events;
create trigger action_review_events_no_update before update or delete on action_review_events
  for each row execute function action_review_events_immutable();

-- TRUNCATE는 행 단위 트리거로 막히지 않아 문장 단위 트리거를 따로 둔다.
drop trigger if exists action_review_events_no_truncate on action_review_events;
create trigger action_review_events_no_truncate before truncate on action_review_events
  for each statement execute function action_review_events_immutable();

-- 서비스 롤 외에는 직접 접근하지 않는다(API가 세션을 확인한 뒤 서버에서만 읽고 쓴다).
alter table action_review_events enable row level security;
-- 정책이 없으면 anon·authenticated는 접근할 수 없지만, 과거 RLS 누락 사고가 있어 권한도 명시적으로 회수한다(이중 방어).
revoke all on action_review_events from anon, authenticated;
