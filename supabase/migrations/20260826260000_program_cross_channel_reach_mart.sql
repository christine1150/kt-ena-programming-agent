-- 사용자 지시(2026-08-26): "빠르게 할 수 있는 Fit Score처럼 사전 계산해두는 마트 테이블
-- 방식으로 바꿔서 속도를 크게 줄여줘" — get_program_cross_channel_reach는 채널당 약 10초가
-- 걸려(41만+행 competitor_program_ratings 매칭) /api/ask 응답 시간으로는 여전히 느리다.
-- Fit Score(mart_scheduling_fit_score + refresh_fit_score_mart)와 완전히 같은 전략을 쓴다:
-- 계산 로직(get_program_cross_channel_reach)은 그대로 두고, "언제 계산하느냐"만 요청 시점
-- (매번)에서 "이 기준일에 아직 없으면 한 번만" 시점으로 바꾼다.
--
-- 기준일(as_of_date) 개념이 필요한 이유: 이 마트를 키(channel, lookback_days)만으로 캐시하면
-- 최초 1회 계산 후 다시는 새로고침될 계기가 없어 Nielsen 데이터가 갱신돼도 계속 옛날 결과만
-- 보여주게 된다. Fit Score처럼 as_of_date를 키에 포함해, 최신 데이터 날짜가 바뀔 때마다
-- 자연스럽게 캐시 미스가 나서 다시 계산되게 한다(과거 as_of_date 행은 정리하지 않고 그대로
-- 남겨둠 — Fit Score도 동일. 이 기능은 "지금 기준"만 의미 있어 과거 스냅샷을 다시 조회하는
-- 화면은 없지만, 굳이 지우는 로직을 추가하지 않는다 — YAGNI, 필요해지면 그때 추가).
--
-- lookback_days: 지금은 365(기본)와 30("지금 ~하고 있는" 현재진행형 질문) 두 종류뿐이다
-- (src/lib/intent/executors.ts CROSS_CHANNEL_REACH_DEFAULT_LOOKBACK_DAYS /
-- CROSS_CHANNEL_REACH_CURRENTLY_AIRING_LOOKBACK_DAYS 참고). 사용자가 명시적으로 기간을
-- 지정한 질문("최근 31일" 등)은 이 마트를 쓰지 않고 지금처럼 그때그때 직접 계산한다(임의
-- 기간까지 전부 사전 계산해두는 건 조합이 무한해 마트로 감당이 안 됨 — 자주 나오는 기본
-- 두 종류만 캐시).
create table mart_program_cross_channel_reach (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  lookback_days int not null,
  canonical_title text not null,
  found_channel_label text not null,
  is_own_channel boolean not null,
  target_label text not null,
  broadcast_count bigint not null,
  first_broadcast_date date not null,
  last_broadcast_date date not null,
  typical_hours text not null,
  avg_rating numeric,
  created_at timestamptz not null default now()
);
comment on table mart_program_cross_channel_reach is 'get_program_cross_channel_reach 사전 계산 캐시(2026-08-26). (channel_id, lookback_days, as_of_date) 조합이 아직 없으면 refresh_program_cross_channel_reach_mart()로 그때 한 번만 계산 — Fit Score와 동일한 지연 캐싱 패턴.';

create index mart_program_cross_channel_reach_lookup_idx
  on mart_program_cross_channel_reach (channel_id, lookback_days, as_of_date);

-- 기존 마트 테이블들과 동일한 보안 모델: RLS 켜고 anon/authenticated 정책은 두지 않음.
alter table mart_program_cross_channel_reach enable row level security;

create or replace function refresh_program_cross_channel_reach_mart(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_days int
)
returns void
language plpgsql
as $$
declare
  v_channel_id uuid;
  v_date_from date := p_as_of_date - p_lookback_days;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    return;
  end if;

  -- 이 (채널, lookback, 기준일) 조합만 지우고 다시 채운다 — 다른 채널/조합의 기존 계산은
  -- 그대로 둔다(refresh_fit_score_mart의 p_channel_code 좁히기와 동일한 이유: 여러 채널을
  -- 한 번에 재계산하면 20초 role statement_timeout을 넘길 수 있다).
  delete from mart_program_cross_channel_reach
    where channel_id = v_channel_id and lookback_days = p_lookback_days and as_of_date = p_as_of_date;

  insert into mart_program_cross_channel_reach (
    as_of_date, channel_id, lookback_days, canonical_title, found_channel_label,
    is_own_channel, target_label, broadcast_count, first_broadcast_date, last_broadcast_date,
    typical_hours, avg_rating
  )
  select p_as_of_date, v_channel_id, p_lookback_days, g.*
  from get_program_cross_channel_reach(p_channel_code, v_date_from, p_as_of_date) g;
end;
$$;
comment on function refresh_program_cross_channel_reach_mart is 'mart_program_cross_channel_reach의 (channel_id, lookback_days, as_of_date) 한 조합만 재계산. 콜드 계산은 채널당 약 10초 걸리므로(20260826242000에서 service_role statement_timeout을 20초로 올려둔 것에 의존 — 함수 내부 set_config는 20260820040000에서 이미 확인했듯 최상위 문 타임아웃에는 효과가 없어 시도하지 않음), 매 요청마다가 아니라 캐시 미스일 때만 호출한다.';
