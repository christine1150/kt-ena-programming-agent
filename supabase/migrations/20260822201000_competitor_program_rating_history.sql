-- 사용자 지시(2026-08-22)의 "SBS Plus" 예시를 위한 보조 함수 — get_program_rating_history는
-- 우리 7개 채널(ratings 테이블)만 다루므로, 등록 경쟁채널(§1.2 competitor_program_ratings)의
-- 같은 프로그램 이력은 별도로 가져와야 한다. CROSS_CHANNEL_COMPETITOR_LOOKUPS(route.ts, 이미
-- ENA↔ENA_DRAMA·SBS Plus 조합으로 존재)가 쓰는 것과 같은 데이터 소스를 재사용한다. <재>(재방)
-- 표기가 붙은 행은 제외해 본방만 남기고, 프로그램명은 <본>/<재> 태그와 공백을 제거한 뒤 정확히
-- 일치하는 것만(epgMatch.ts의 canonicalizeEpgProgramName과 동일 원칙 — 부분일치로 인한 오매칭 방지).
create or replace function get_competitor_program_rating_history(
  p_our_channel_code text,
  p_competitor_name text,
  p_program_name text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  broadcast_date date,
  rating numeric
)
language sql
stable
as $$
  select cpr.broadcast_date, avg(cpr.rating) as rating
  from competitor_program_ratings cpr
  join channels c on c.id = cpr.our_channel_id
  where c.code = p_our_channel_code
    and cpr.competitor_name = p_competitor_name
    and cpr.program_name not like '%<재>%'
    and replace(regexp_replace(cpr.program_name, '<[^>]*>', '', 'g'), ' ', '') = replace(p_program_name, ' ', '')
    and cpr.rating is not null
    and cpr.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
  group by cpr.broadcast_date
  order by cpr.broadcast_date;
$$;
comment on function get_competitor_program_rating_history is '주요 콘텐츠 리뷰 본방송 시청률 추이 그래프에서 CROSS_CHANNEL_COMPETITOR_LOOKUPS(예: ENA↔SBS Plus)로 등록된 경쟁채널의 같은 프로그램 이력을 가져온다(본방만, <재> 제외). competitor_program_ratings.target_label은 §1.2 랭킹 표기(예: 개인2049)로 수도권 2049와 동일 성격.';
