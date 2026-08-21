-- 사용자 지시(2026-08-21): "COMPARED WITH?에서 skyUHD는 연간 누적(1/1~오늘) 등위를 참고해
-- 유료가구 기준 UHD 경쟁채널 6개(skyUHD 포함) 사이 위치가 드러나게 보여달라." skyUHD는 §1.1/§1.2
-- 일별 Nielsen 시트가 없는 수기 업로드 채널이라 competitor_ratings(등록 경쟁채널의 일별 시청률)가
-- 원천적으로 비어있다(실측 확인: 0건) — 그래서 기존 COMPARED WITH?(get_competitor_insight_report)는
-- skyUHD에서 "등록 경쟁채널 데이터가 없습니다"로만 나온다. 대신 관리자가 업로드한 "누적 채널
-- 순위" 파일(market_ytd_rank_snapshot, 시장 전체 ~217개 채널 기준 1/1~오늘 누적)에는 skyUHD와
-- 등록 경쟁채널 5개(UXN/ASIA UHD/UMAX/UHD Dream TV/SBS F!L UHD) 전부의 순위·시청률이 실제로
-- 있음을 확인했다(6개 전부 존재).
--
-- competitors.competitor_name(등록 표기)과 market_ytd_rank_snapshot.channel_name(업로드 파일
-- 원본 표기)은 대소문자만 다른 경우(예: "ASIA UHD" vs "Asia UHD")는 대소문자 무시 비교로
-- 해결되지만, "SBS F!L UHD"(Competitor Master 표기, "!"를 "I" 대신 씀) vs "SBS FIL UHD"(업로드
-- 파일 표기)는 특수문자 차이라 별도 별칭 처리가 필요하다(원본 데이터는 그대로 두고 매칭
-- 계층에서만 흡수 — CLAUDE.md 원칙).
create or replace function get_channel_market_ytd_competitor_snapshot(
  p_channel_code text,
  p_target_label text
)
returns table (
  channel_name text,
  rank int,
  rating numeric,
  is_self boolean,
  date_from date,
  date_to date
)
language sql
stable
as $$
  with self_row as (
    select c.name as competitor_name, true as is_self
    from channels c
    where c.code = p_channel_code
  ),
  comp_rows as (
    select
      case when comp.competitor_name = 'SBS F!L UHD' then 'SBS FIL UHD' else comp.competitor_name end as competitor_name,
      false as is_self
    from competitors comp
    join channels c on c.id = comp.channel_id and c.code = p_channel_code
  ),
  all_rows as (
    select * from self_row
    union all
    select * from comp_rows
  )
  select mkt.channel_name, mkt.rank, mkt.rating, ar.is_self, mkt.date_from, mkt.date_to
  from all_rows ar
  join market_ytd_rank_snapshot mkt
    on lower(mkt.channel_name) = lower(ar.competitor_name)
    and mkt.target_label = p_target_label
  order by mkt.rank asc;
$$;
comment on function get_channel_market_ytd_competitor_snapshot is 'skyUHD처럼 일별 competitor_ratings가 없는 채널을 위한 COMPARED WITH? 대체 데이터 — 관리자가 업로드한 시장 전체 누적 순위 파일(market_ytd_rank_snapshot)에서 그 채널과 등록 경쟁채널 전부의 순위·시청률을 순위순으로 반환한다. 대소문자 차이는 자동으로 흡수하고, "SBS F!L UHD" 같은 특수문자 표기 차이는 별칭으로 처리한다.';
