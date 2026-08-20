-- Page 1 우측 "Original" 리포트: ENA/ENA Drama/ENA Play를 중심으로 오늘 실제 방영된 프로그램과
-- (있다면) 같은 날 다른 채널에서의 재방영 관계, 관리자가 지정한 주요 콘텐츠 태그(오리지널/독점 등)를
-- 한 번에 조회한다.
--
-- 프로그램명을 하드코딩하지 않는다: PD 참고 예시 레이아웃에 "수요일은 <나는 솔로>가 중요" 같은
-- 특정 제목이 있었지만, 그 프로그램은 featured_content(주요 콘텐츠)에 편성 정보가 등록돼 있지
-- 않아(실데이터로 확인) 고정 문구로 박아두면 프로그램이 바뀌어도 안 바뀌는 낡은 정보가 된다.
-- 대신 그날 실제로 방영된 프로그램을 시청률 데이터에서 그대로 가져와, featured_content에
-- 태그가 있으면 그 태그(오리지널드라마/독점예능 등)를 함께 보여준다.
create or replace function get_original_content_report(p_as_of_date date)
returns table (
  channel_code text,
  canonical_name text,
  start_time time,
  end_time time,
  rating numeric,
  share numeric,
  featured_category text,
  rerun_of_channel_code text,
  rerun_of_rating numeric
)
language sql
stable
as $$
  with today_programs as (
    select c.code as channel_code, p.canonical_name, r.start_time, r.end_time, r.rating, r.share,
      p.id as program_id
    from ratings r
    join programs p on p.id = r.program_id
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code in ('ENA', 'ENA_DRAMA', 'ENA_PLAY')
      and t.label = '수도권 2049'
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date = p_as_of_date
      and r.program_id is not null
      and r.rating is not null
  ),
  tagged as (
    select tp.*, fc.category as featured_category
    from today_programs tp
    -- featured_content(관리자가 KT ENA 오리지널 시트에서 직접 입력한 제목)와 Nielsen 파일의
    -- 프로그램명이 띄어쓰기만 다른 경우가 실제로 있었다(예: "그대에게 드림" vs "그대에게드림"
    -- — 서로 다른 원본 파일에 사람이 입력/발주처가 제공한 제목이라 표기가 다를 수 있음).
    -- program_id로 정확히 매칭하면 이런 경우를 놓치므로, 공백을 뺀 이름으로 매칭한다
    -- (CLAUDE.md: "프로그램명은 띄어쓰기·회차/부제 차이 정도는 동일 프로그램으로 인식").
    left join lateral (
      select fc.category
      from featured_content fc
      join programs fp on fp.id = fc.program_id
      where replace(fp.canonical_name, ' ', '') = replace(tp.canonical_name, ' ', '')
      limit 1
    ) fc on true
  )
  select
    t1.channel_code, t1.canonical_name, t1.start_time, t1.end_time, t1.rating, t1.share, t1.featured_category,
    t2.channel_code as rerun_of_channel_code, t2.rating as rerun_of_rating
  from tagged t1
  -- 같은 프로그램명이 같은 날 "더 이른 시각"에 "다른 채널"에서 먼저 방영됐으면 그게 본방,
  -- 지금 이 행은 그 직후재방으로 본다 (여러 개면 가장 늦게 끝난 본방 하나만 매칭).
  left join lateral (
    select t2.channel_code, t2.rating
    from tagged t2
    where t2.canonical_name = t1.canonical_name
      and t2.channel_code <> t1.channel_code
      and t2.start_time < t1.start_time
    order by t2.start_time desc
    limit 1
  ) t2 on true
  order by t1.channel_code, t1.start_time;
$$;
comment on function get_original_content_report is 'Page 1 Original 리포트용: ENA/ENA Drama/ENA Play가 오늘 방영한 프로그램(수도권 2049 기준)과 featured_content 태그, 같은 날 다른 채널에서의 직후재방 관계(프로그램명·시각 매칭)를 함께 반환. 프로그램명을 하드코딩하지 않고 그날 실제 데이터만 사용.';
