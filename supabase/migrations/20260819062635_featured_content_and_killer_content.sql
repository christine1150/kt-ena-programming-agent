-- 개발 단위 5번: 주요 콘텐츠 관리 기능
-- 1) programs/featured_content 재업로드·재편집 시 중복 생성되지 않도록 유니크 제약 추가
--    (programs: 같은 채널에서 같은 제목은 하나의 "프로그램"으로 취급 — 이후 Nielsen 일별 데이터도
--     이 규칙을 따라 같은 프로그램에 여러 방영일의 ratings 행이 연결된다)
alter table programs
  add constraint programs_channel_canonical_unique unique (channel_id, canonical_name);

alter table featured_content
  add constraint featured_content_program_unique unique (program_id);

-- 2) 킬러 콘텐츠 자동 산출용 뷰. Claude가 암산하지 않고 이 뷰를 SQL로 조회해서 판단하도록 한다
--    (CLAUDE.md 원칙: 계산은 SQL 집계 쿼리를 실제로 실행한 값이어야 함).
--    최근 28일(약 4주) 자사 방영 데이터 중 채널별 평균 시청률 상위 3개를 "킬러 콘텐츠 후보"로 본다.
--    ratings가 비어있으면 결과도 비어있다 (데이터 없음을 0으로 바꾸지 않음).
create view killer_content_v as
with recent as (
  select
    p.channel_id,
    p.id as program_id,
    p.canonical_name,
    avg(r.rating) as avg_rating,
    count(*) as airing_count,
    max(r.broadcast_date) as last_aired_date
  from ratings r
  join programs p on p.id = r.program_id
  where r.source_type = 'nielsen_daily'
    and r.broadcast_date >= (current_date - interval '28 days')
    and r.rating is not null
  group by p.channel_id, p.id, p.canonical_name
)
select
  channel_id,
  program_id,
  canonical_name,
  avg_rating,
  airing_count,
  last_aired_date,
  row_number() over (partition by channel_id order by avg_rating desc) as channel_rank
from recent;

comment on view killer_content_v is '최근 28일 자사 프로그램 평균 시청률 기준 채널별 순위 (킬러 콘텐츠 자동 산출용, ratings 실데이터가 있어야 값이 나온다)';
