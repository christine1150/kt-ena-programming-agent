-- 버그 수정(2026-08-26, 사용자 제보 "왕자와거지 동시간대 경쟁 채널과 시청률은 왜 안나왔지?...
-- 1위일리가 없어"): get_competitor_program_overlap의 겹침 판정(cp.start_time < op.end_time and
-- cp.end_time > op.start_time)이 TIME 타입을 그대로 비교해, 자정을 넘기는 프로그램(예: 왕자와
-- 거지 23:21:04 ~ 00:38:14)에서 end_time(00:38:14)이 TIME 값으로는 start_time(23:21:04)보다
-- "작아"(자정에 리셋) 구간이 뒤집혀 어떤 경쟁 프로그램과도 절대 겹치지 않는 것으로 계산됐다
-- (실측 확인: 자정을 넘기지 않는 신병4사보타주(22:00~23시대)는 정상 매칭, 자정을 넘기는
-- 왕자와거지만 0건). 그 결과 프론트(buildOriginalHeadline)의 순위 계산(rank = 1 + 나보다 높은
-- 경쟁 프로그램 수)이 "비교 대상 0개 = 무조건 1위"로 오판정됐다 — 새 계산 로직을 추가한 게
-- 아니라, 이미 있던 순위 계산이 근거 데이터가 비어 항상 최선의 경우로 떨어진 것.
--
-- 수정: 00:00~06:00 사이 시각은 "전날 밤이 넘어온 것"으로 보고 24시간을 더해(자정 이후를
-- 24:00~30:00으로 펼치는) 비교한다(같은 archi 원칙: get_original_content_daily의 "02시 이전
-- 이면 하루 전 효과 날짜"와 동일한 통상적 방송일 경계 처리, 06:00 컷오프는 그보다 더 이르게
-- 끝나는 프로그램까지 넉넉히 포함하기 위함). 자정을 넘기지 않는 기존 프로그램(op_end≥06:00)은
-- 변환식이 항등이라 기존 매칭 결과에 영향 없음 — 이번처럼 한쪽만 자정을 넘기던 경우만 새로
-- 잡아준다(매칭 범위가 넓어지는 방향, 안전).
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
        order by cp.rating desc
      ) as rn
    from our_programs op
    join channels c on c.code = p_channel_code
    join competitor_program_ratings cp
      on cp.our_channel_id = c.id
      and cp.broadcast_date = p_as_of_date
      -- 자정을 넘기는 구간(예: 23:21~00:38)도 정상적으로 겹침 판정하도록, 00:00~06:00 시각은
      -- 24시간을 더해 "그 전날 밤이 이어지는 것"으로 펼쳐서 비교한다. TIME + INTERVAL은
      -- Postgres에서 24시간 기준으로 다시 wrap되므로(예: 23:00+2시간=01:00, 원하는 25:00이
      -- 아님) 반드시 먼저 ::interval로 캐스팅한 뒤 더해야 24시간을 넘겨 펼쳐진다.
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
    where cp.rating is not null and op.rating is not null
  )
  select
    our_program_name, our_start_time, our_end_time, our_rating,
    competitor_name, competitor_program_name, competitor_start_time, competitor_end_time,
    competitor_rating, rating_gap
  from matched
  where rn <= p_limit
  order by our_start_time, competitor_rating desc;
$$;
comment on function get_competitor_program_overlap is '동시간대 겹치는 등록 경쟁채널 프로그램 조회. p_limit(기본 3)으로 반환 개수 조절 — Page 2 COMPARED WITH?는 기본값(top3, 노이즈 방지)을 쓰고, Page 1 Original 리포트의 "동시간대 타깃 순위" 계산은 더 큰 값을 넘겨 확보 가능한 모든 경쟁 프로그램을 받는다. 자정을 넘기는 프로그램(예: 23:21~00:38)도 00:00~06:00 시각을 24시간 밀어서 정상적으로 겹침 판정한다(2026-08-26 수정 — 그 전엔 TIME 값이 자정에 리셋돼 자정을 넘기는 프로그램만 경쟁 데이터가 0건으로 잡혔다).';
