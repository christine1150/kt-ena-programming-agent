-- 시청률 자판기 "제외 편성" — 종영·방영권 만료·사용 비권장·임시 중단으로 편성표에 넣지 않을 프로그램 제목 목록(사용자 지시 2026-10-06/07).
-- channel_id가 null이면 모든 채널에 적용한다. 기간(active_from~active_to)이 비어 있으면 상시 제외.
-- RLS는 켜 두고 정책은 두지 않는다(서버 service_role만 접근 — 다른 테이블과 같은 방식).
create table if not exists ideal_schedule_exclusions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  program_name text not null,
  reason text,
  active_from date,
  active_to date,
  created_by text,
  created_at timestamptz not null default now()
);

create unique index if not exists ideal_schedule_exclusions_uniq
  on ideal_schedule_exclusions (coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid), program_name, coalesce(active_from, date '1900-01-01'));

alter table ideal_schedule_exclusions enable row level security;
