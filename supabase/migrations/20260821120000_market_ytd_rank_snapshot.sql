-- 사용자 지시(2026-08-21): "26년 채널 누적 시청률.xlsx"(2026-01-01~08-20 누적, 유료방송가구·
-- 수도권 2049 타깃, 시장 전체 ~217개 채널 순위) 업로드 — 모든 자료에 반영.
--
-- 검증 결과(실측): 이 파일의 시청률(rating) 값은 우리 시스템이 daily 데이터로 직접 계산한 기간
-- 평균과 거의 완전히 일치했다(예: ENA 수도권2049 파일 0.12025 vs 우리 계산 0.12027) — 우리
-- 파이프라인이 정확하다는 교차 검증이 됐다. 다만 "순위(rank)"는 다르다: 우리 Page 1 히어로
-- 카드의 "누적 평균 순위"는 `ratings.rank`(Nielsen이 매일 계산해 저장한 그날의 순위)의 "일별
-- 평균"인데, 이 파일의 순위는 "누적 평균 시청률 자체의 순위"(다른 통계량)라서 값이 다르다
-- (ENA 예시: 우리 avg_rank=9.3 vs 파일 rank=7). 게다가 우리는 등록된 경쟁채널(최대 40개)
-- 데이터만 갖고 있어 시장 전체(~217개 채널) 기준 순위를 아예 계산할 수 없다 — 이 파일이야말로
-- "시장 전체 기준 누적 순위"의 유일한 근거라서, 새로 계산하지 않고 원본 그대로 저장해 참고한다
-- (CLAUDE.md 원칙: 계산은 SQL이 하되, 우리에게 없는 원본 데이터를 만들어내지 않는다).
create table market_ytd_rank_snapshot (
  id uuid primary key default gen_random_uuid(),
  target_label text not null, -- 파일 원문 그대로(예: "유료방송가구", "수도권2049") — 우리 targets 표기와 별개
  channel_name text not null, -- 파일 원문 채널명 그대로(예: "ENA", "MBC") — channels 테이블과 느슨하게 매칭
  rank int not null,
  rating numeric not null,
  date_from date not null,
  date_to date not null,
  uploaded_at timestamptz not null default now(),
  unique (target_label, channel_name, date_from, date_to)
);
comment on table market_ytd_rank_snapshot is '관리자가 업로드하는 "누적 채널 순위" 파일(예: 26년 채널 누적 시청률.xlsx) 원본 스냅샷 — 시장 전체(경쟁채널 미등록 채널 포함) 기준 순위라 우리 데이터로는 재현 불가. 같은 (타깃, 채널, 기간)으로 재업로드하면 덮어씀.';
create index idx_market_ytd_rank_snapshot_channel on market_ytd_rank_snapshot (channel_name, target_label, date_to desc);

create or replace function get_market_ytd_rank(
  p_channel_name text,
  p_target_label text
)
returns table (
  rank int,
  rating numeric,
  date_from date,
  date_to date
)
language sql
stable
as $$
  select rank, rating, date_from, date_to
  from market_ytd_rank_snapshot
  where channel_name = p_channel_name and target_label = p_target_label
  order by date_to desc
  limit 1;
$$;
comment on function get_market_ytd_rank is 'Page 1 히어로 카드용 — 업로드된 "누적 채널 순위" 파일 중 그 채널·타깃의 가장 최근 스냅샷 하나. 없으면 빈 결과(호출부가 기존 avg_rank 방식으로 대체).';
