-- 비교군 우수 사례(고도화 B2): 자사 채널별 "격차 자리"(비교군보다 자리 지수가 낮은 자리와 비교군이 그 자리에서 트는 작품) 적재.
-- 주 1회 크론(/api/cron/benchmark-gaps)이 채널당 한 행을 덮어쓴다. 보고서는 이 표만 읽는다(스냅샷 시점에 비교군 방영을 다시 읽지 않기 위함).
-- 기존 표·함수는 건드리지 않는 신규 표 하나이며 RLS를 켠다(서버 service role만 접근, 정책 없음 — 다른 적재표와 같은 방식).
create table if not exists benchmark_slot_gaps (
  own_channel_code text primary key,
  as_of date not null,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);
alter table benchmark_slot_gaps enable row level security;
comment on table benchmark_slot_gaps is '고도화 B2: 자사 채널별 격차 자리(BenchmarkGapsSummary). 주 1회 덮어쓰기.';
