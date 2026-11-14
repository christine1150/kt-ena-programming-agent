-- 페이지·API 체감 속도 계측(고도화 계획 E1, 2026-11-14).
-- 브라우저의 Performance API 값(첫 바이트·첫 화면·최대 콘텐츠·완전 로드, 같은 출처 /api/* 호출 소요)을 익명으로 쌓는다.
-- 개인정보 없음: 사용자·IP·쿼리스트링을 저장하지 않고 경로는 [code]·[id] 같은 패턴으로 정규화해서 받는다.
-- 목적은 "2주 뒤 p50/p95로 속도 기준선을 정하고 이후 개선(E2·E3)의 효과를 같은 잣대로 확인"하는 것이다.
create table if not exists page_timing_log (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  -- 정규화된 화면 경로(예: '/', '/channel/[code]', '/ideal-schedule/purchase')
  path text not null,
  -- 'ttfb' 첫 바이트 · 'fcp' 첫 화면 · 'lcp' 최대 콘텐츠 · 'load' 완전 로드 · 'api' 같은 출처 /api/* 호출 1건
  metric text not null check (metric in ('ttfb', 'fcp', 'lcp', 'load', 'api')),
  -- metric='api'일 때 정규화된 API 경로(예: '/api/dashboard/channel'), 그 외 null
  api_path text,
  duration_ms integer not null check (duration_ms >= 0 and duration_ms <= 120000),
  viewport text not null default 'desktop' check (viewport in ('mobile', 'desktop'))
);
comment on table page_timing_log is '화면·API 체감 속도 계측(익명, 고도화 계획 E1). 사용자·IP·쿼리 미저장.';
create index if not exists page_timing_log_recorded_idx on page_timing_log (recorded_at desc);
create index if not exists page_timing_log_path_metric_idx on page_timing_log (path, metric, recorded_at desc);
alter table page_timing_log enable row level security; -- 정책 없음: 서버 service_role만 접근

-- 최근 p_days일의 p50·p95(밀리초) — 화면 경로 × 지표(× API 경로) 단위
create or replace function page_timing_summary(p_days integer default 14)
returns table (path text, metric text, api_path text, n bigint, p50_ms integer, p95_ms integer, max_ms integer)
language sql
stable
as $$
  select
    t.path,
    t.metric,
    t.api_path,
    count(*) as n,
    round(percentile_cont(0.5) within group (order by t.duration_ms))::integer as p50_ms,
    round(percentile_cont(0.95) within group (order by t.duration_ms))::integer as p95_ms,
    max(t.duration_ms) as max_ms
  from page_timing_log t
  where t.recorded_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
  group by t.path, t.metric, t.api_path
  order by t.path, t.metric, t.api_path nulls first;
$$;

-- 오래된 행 정리(90일 초과) — 크론이 아니라 요약 조회 때 호출해도 되는 가벼운 함수
create or replace function page_timing_prune()
returns integer
language plpgsql
as $$
declare n integer;
begin
  delete from page_timing_log where recorded_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
