-- 사용자 보고(2026-09-08): "skyUHD 페이지 COMPARED WITH?에서 왜 두개씩 나오는지 확인 후 오류
-- 변경". 실측 확인 결과 market_ytd_rank_snapshot에는 같은 채널·타깃 조합이 스냅샷 기간(date_to)
-- 별로 여러 건 쌓여 있다 — 8/21에 처음 올린 파일(date_to=2026-08-20)과 9/7에 새로 올린
-- "260101-260906 누적.xlsx"(date_to=2026-09-06)가 나란히 존재한다. 유니크 제약이
-- (target_label, channel_name, date_from, date_to)까지 포함해서 기간이 확장된 재업로드는
-- 옛 스냅샷을 덮어쓰지 않고 새 행으로 추가되는 게 설계상 정상 동작(20260821120000 주석 참고,
-- get_market_ytd_rank도 이미 "order by date_to desc limit 1"로 최신 것만 골라 쓰고 있음).
--
-- 그런데 get_channel_market_ytd_competitor_snapshot(skyUHD COMPARED WITH? 전용)은 이 "최신
-- 스냅샷만" 필터가 없어서 채널명+타깃이 일치하는 모든 기간의 행을 그대로 반환하고 있었다 —
-- 그 결과 화면에 각 채널이 옛 스냅샷·새 스냅샷 두 번씩 찍혔다(스크린샷으로 확인: UXN/Asia UHD/
-- UMAX/UHD Dream TV/SkyUHD 전부 2회씩). get_market_ytd_rank와 같은 원칙으로 채널명별 최신
-- 스냅샷 한 건만 남기도록 고친다 — 함수 시그니처·반환 타입은 그대로, 내부 로직만 수정
-- (CLAUDE.md: 기존 마이그레이션 파일 수정 금지, 신규 마이그레이션으로 재정의).
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
  ),
  -- 채널명(대소문자 무시)별로 date_to가 가장 늦은(가장 최신 업로드된) 스냅샷 한 건만 남긴다.
  latest_snapshot as (
    select distinct on (lower(mkt.channel_name))
      mkt.channel_name, mkt.rank, mkt.rating, mkt.date_from, mkt.date_to
    from market_ytd_rank_snapshot mkt
    where mkt.target_label = p_target_label
    order by lower(mkt.channel_name), mkt.date_to desc
  )
  select ls.channel_name, ls.rank, ls.rating, ar.is_self, ls.date_from, ls.date_to
  from all_rows ar
  join latest_snapshot ls
    on lower(ls.channel_name) = lower(ar.competitor_name)
  order by ls.rank asc;
$$;
comment on function get_channel_market_ytd_competitor_snapshot is 'skyUHD처럼 일별 competitor_ratings가 없는 채널을 위한 COMPARED WITH? 대체 데이터 — 관리자가 업로드한 시장 전체 누적 순위 파일(market_ytd_rank_snapshot)에서 그 채널과 등록 경쟁채널 전부의 "가장 최근 업로드된" 순위·시청률을 순위순으로 반환한다(2026-09-08: 채널당 여러 스냅샷 기간이 쌓여도 중복 표시되지 않도록 최신 한 건만 선택). 대소문자 차이는 자동으로 흡수하고, "SBS F!L UHD" 같은 특수문자 표기 차이는 별칭으로 처리한다.';
