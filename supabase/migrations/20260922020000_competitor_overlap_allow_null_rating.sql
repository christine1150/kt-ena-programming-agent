-- 사용자 지시(2026-09-22): "UMAX와 UHD Dream의 주간 편성 내역을 skyUHD의 경쟁채널로 인식시켜서
-- 동시간대 편성을 비교해줘. 시청률은 알 수 없더라도 일간 편성에 도움이 되도록 편성표 내역을
-- 앞으로 일일 운행 비교에 넣어줘." — UMAX/UHD Dream TV는 skyUHD처럼 일별 Nielsen 시청률
-- 자체가 없는 채널이라, 이 둘의 "편성표만"(시청률 없이) competitor_program_ratings에
-- rating=null로 적재해도 get_competitor_program_overlap이 `cp.rating is not null` 조건 때문에
-- 항상 걸러내고 있었다. 조건을 완화해 "우리 프로그램(op.rating)은 있어야 하지만, 경쟁
-- 프로그램은 시청률이 없어도(편성만 알아도) 겹침 목록에 포함"하도록 바꾼다 — rating_gap은
-- null 그대로 계산되어(Postgres는 NULL 연산에서 NULL을 반환) 화면에서 자동으로 "—"로 표시된다
-- (ChannelDeepDive.tsx의 fmt()/rating_gap !== null 가드가 이미 null을 안전하게 처리해 새
-- 프론트 변경이 필요 없다). 기존에 시청률이 있던 경쟁채널의 동작은 전혀 바뀌지 않는다
-- (cp.rating이 항상 not null이었으므로 조건 완화가 그 경로엔 영향을 주지 않음).
drop function if exists get_competitor_program_overlap(text, text, date, int);

create or replace function get_competitor_program_overlap(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_limit int default 3
)
returns table (
  our_program_name text,
  our_start_time time,
  our_end_time time,
  our_rating numeric,
  competitor_name text,
  competitor_program_name text,
  competitor_start_time time,
  competitor_end_time time,
  competitor_rating numeric,
  rating_gap numeric
)
language sql
stable
as $$
  with our_programs as (
    select p.canonical_name, r.start_time, r.end_time, r.rating
    from ratings r
    join programs p on p.id = r.program_id
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code
      and t.label = p_target_label
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date = p_as_of_date
      and r.program_id is not null
      and r.start_time is not null
  ),
  matched as (
    select
      op.canonical_name as our_program_name,
      op.start_time as our_start_time,
      op.end_time as our_end_time,
      op.rating as our_rating,
      cp.competitor_name,
      cp.program_name as competitor_program_name,
      cp.start_time as competitor_start_time,
      cp.end_time as competitor_end_time,
      cp.rating as competitor_rating,
      round((cp.rating - op.rating)::numeric, 5) as rating_gap,
      row_number() over (
        partition by op.start_time, op.canonical_name
        -- 시청률이 있는 경쟁 프로그램을 우선 보여주고(nulls last), 편성만 아는 프로그램은
        -- 뒤로 밀린다 — top N(p_limit)이 실측 시청률을 최대한 담도록.
        order by cp.rating desc nulls last
      ) as rn
    from our_programs op
    join channels c on c.code = p_channel_code
    join competitor_program_ratings cp
      on cp.our_channel_id = c.id
      and cp.broadcast_date = p_as_of_date
      and (case when cp.start_time < time '06:00:00' then cp.start_time::interval + interval '24 hours' else cp.start_time::interval end)
          < coalesce(
              (case when op.end_time < time '06:00:00' then op.end_time::interval + interval '24 hours' else op.end_time::interval end),
              (case when op.start_time < time '06:00:00' then op.start_time::interval + interval '24 hours' else op.start_time::interval end) + interval '1 hour'
            )
      and coalesce(
            (case when cp.end_time < time '06:00:00' then cp.end_time::interval + interval '24 hours' else cp.end_time::interval end),
            (case when cp.start_time < time '06:00:00' then cp.start_time::interval + interval '24 hours' else cp.start_time::interval end) + interval '1 hour'
          )
          > (case when op.start_time < time '06:00:00' then op.start_time::interval + interval '24 hours' else op.start_time::interval end)
    -- 변경: cp.rating is not null 조건 삭제 — 시청률 없는(편성만 아는) 경쟁 프로그램도 포함.
    where op.rating is not null
  )
  select
    our_program_name, our_start_time, our_end_time, our_rating,
    competitor_name, competitor_program_name, competitor_start_time, competitor_end_time,
    competitor_rating, rating_gap
  from matched
  where rn <= p_limit
  order by our_start_time, competitor_rating desc nulls last;
$$;
comment on function get_competitor_program_overlap is '동시간대 겹치는 등록 경쟁채널 프로그램 조회. p_limit(기본 3)으로 반환 개수 조절 — Page 2 COMPARED WITH?는 기본값(top3, 노이즈 방지)을 쓰고, Page 1 Original 리포트의 "동시간대 타깃 순위" 계산은 더 큰 값을 넘겨 확보 가능한 모든 경쟁 프로그램을 받는다. 자정을 넘기는 프로그램(예: 23:21~00:38)도 00:00~06:00 시각을 24시간 밀어서 정상적으로 겹침 판정한다. 경쟁 프로그램의 시청률이 없어도(편성만 아는 채널, 예: skyUHD의 UMAX/UHD Dream TV) 목록에는 포함하고 시청률·격차는 null로 둔다(2026-09-22 — 시청률 있는 경쟁 프로그램이 항상 우선 정렬됨).';
