-- get_original_content_daily 보강: 직후재방 탐지를 화이트리스트의 "직재방 채널" 컬럼이 채워진
-- 경우로만 제한하지 않고, 우리 3개 채널(ENA/ENA Drama/ENA Play) 전체에서 같은 날 더 늦게 방영된
-- 회차를 찾도록 일반화한다 — 사용자 지시: "수요일 나는 SOLO는... 그 이후 ENA Play의 직후 재방
-- 실적도 확인"인데, "나는 SOLO"/"나는 SOLO 그후 사랑은 계속된다"는 화이트리스트 시트에 "직재방
-- 채널"이 비어있어(그대에게드림처럼 고정 채널이 아니라 요일마다 다를 수 있음) 특정 채널로
-- 제한하면 놓친다.
create or replace function get_original_content_daily(p_as_of_date date)
returns table (
  day_of_week_iso int,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  featured_category text,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  retention_pct numeric
)
language sql
stable
as $$
  with whitelist as (
    select w.*, c.code as broadcast_channel_code
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
    where w.day_of_week_iso = extract(isodow from p_as_of_date)::int
  ),
  matched as (
    select
      w.*,
      p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share
      from ratings r
      join programs p on p.id = r.program_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and regexp_replace(p.canonical_name, '[^0-9A-Za-z가-힣]', '', 'g')
            = regexp_replace(w.program_name, '[^0-9A-Za-z가-힣]', '', 'g')
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600
      order by least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  )
  select
    m.day_of_week_iso,
    m.program_name as whitelist_program_name,
    m.broadcast_channel_code,
    m.broadcast_time as expected_time,
    m.note,
    m.matched_program_name,
    m.matched_start_time,
    m.matched_end_time,
    m.matched_rating,
    m.matched_share,
    fc.category as featured_category,
    rr.rerun_channel_code,
    rr.canonical_name as rerun_program_name,
    rr.start_time as rerun_start_time,
    rr.rating as rerun_rating,
    case when m.matched_rating is not null and m.matched_rating > 0 and rr.rating is not null
      then round((rr.rating / m.matched_rating * 100)::numeric, 1) else null end as retention_pct
  from matched m
  left join lateral (
    select fc.category
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and replace(fp.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
    limit 1
  ) fc on true
  -- 직후재방: 우리 3개 채널(ENA/ENA Drama/ENA Play) 중 본방 채널이 아닌 곳에서, 같은
  -- 프로그램이 같은 날 더 늦게 방영된 가장 이른 회차 — 화이트리스트의 "직재방 채널"에
  -- 얽매이지 않는다(비어있는 경우도 실제로 찾아서 보여준다).
  left join lateral (
    select c2.code as rerun_channel_code, p2.canonical_name, r2.start_time, r2.rating
    from ratings r2
    join programs p2 on p2.id = r2.program_id
    join channels c2 on c2.id = r2.channel_id
    where m.matched_program_name is not null
      and c2.code in ('ENA', 'ENA_DRAMA', 'ENA_PLAY')
      and c2.code <> m.broadcast_channel_code
      and r2.source_type = 'nielsen_daily'
      and r2.broadcast_date = m.effective_date
      and replace(p2.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r2.start_time > m.matched_end_time
    order by r2.start_time asc
    limit 1
  ) rr on true
  where m.matched_program_name is not null
  order by m.sort_order;
$$;
