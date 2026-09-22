-- 사용자 지시(2026-09-22): "내가 이렇게 UHD Dream 등의 skyUHD 경쟁 채널 편성 정보를 제공하면,
-- 네가 알고 있는 부분을 '오늘 시간대별 경쟁 프로그램'에 반영해서 같이 보여줘." — 직전 마이그레이션
-- (20260922020000)에서 "경쟁 프로그램 쪽 시청률이 없어도 포함"하도록 완화했지만, 실제로 skyUHD
-- 채널로 이 함수를 호출하면 여전히 0건이었다. 원인은 두 가지 더 있었다(직접 RPC 호출로 확인):
--   1) our_programs CTE가 `r.source_type = 'nielsen_daily'`만 허용 — skyUHD 자체 프로그램은
--      수기 업로드 채널이라 항상 source_type='skyuhd'로 저장된다(CLAUDE.md에 문서화된 skyUHD
--      전용 처리, route.ts의 다른 조회들도 이미 in('nielsen_daily','skyuhd')로 이 둘을 함께 본다).
--   2) our_programs CTE가 `join targets t on t.id = r.target_id`로 타깃 라벨이 반드시 있어야
--      매칭되는데, skyUHD는 target_id를 항상 비워 저장한다("skyuhd-blank-rating-means-zero"
--      메모리 및 CLAUDE.md §3에 문서화) — 이 join 자체가 skyUHD 행에서는 절대 성립하지 않았다.
--   3) `where op.rating is not null`(우리 쪽 시청률 필수) — skyUHD는 매달 한 번 수기 파일로
--      시청률이 뒤늦게 채워지는 채널이라, "오늘" 시점엔 프로그램 편성만 있고 시청률은 아직 null인
--      게 정상이다. 이 섹션의 목적 자체가 "오늘 시간대별 경쟁 프로그램"(편성 비교)이지 시청률
--      비교가 아니므로, 우리 쪽 시청률이 아직 없어도 편성만으로 보여줘야 한다.
-- 세 가지를 모두 완화한다. 기존 6개 채널(nielsen_daily·target_id 항상 있음·당일 시청률 항상
-- 있음)의 동작에는 실질적 영향이 없다 — 조건이 넓어진 것이지 좁아진 게 아니기 때문이다.
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
    -- 변경: skyUHD는 target_id가 항상 비어 있으므로 left join으로 바꾸고, 아래 where에서
    -- "타깃 라벨이 맞거나, 애초에 타깃 구분이 없는 행(target_id is null)이면" 통과시킨다.
    left join targets t on t.id = r.target_id
    where c.code = p_channel_code
      and (t.label = p_target_label or r.target_id is null)
      -- 변경: skyUHD 자체 프로그램 데이터는 source_type='skyuhd'로 저장된다.
      and r.source_type in ('nielsen_daily', 'skyuhd')
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
    -- 변경: 우리 쪽 시청률(op.rating) 필수 조건 삭제 — skyUHD처럼 시청률이 뒤늦게(월 단위로)
    -- 채워지는 채널도 "오늘"의 편성 정보만으로 경쟁 프로그램을 비교해 볼 수 있어야 한다.
  )
  select
    our_program_name, our_start_time, our_end_time, our_rating,
    competitor_name, competitor_program_name, competitor_start_time, competitor_end_time,
    competitor_rating, rating_gap
  from matched
  where rn <= p_limit
  order by our_start_time, competitor_rating desc nulls last;
$$;
comment on function get_competitor_program_overlap is '동시간대 겹치는 등록 경쟁채널 프로그램 조회. p_limit(기본 3)으로 반환 개수 조절 — Page 2 COMPARED WITH?는 기본값(top3, 노이즈 방지)을 쓰고, Page 1 Original 리포트의 "동시간대 타깃 순위" 계산은 더 큰 값을 넘겨 확보 가능한 모든 경쟁 프로그램을 받는다. 자정을 넘기는 프로그램(예: 23:21~00:38)도 00:00~06:00 시각을 24시간 밀어서 정상적으로 겹침 판정한다. 경쟁 프로그램의 시청률이 없어도(편성만 아는 채널, 예: skyUHD의 UMAX/UHD Dream TV) 목록에는 포함하고 시청률·격차는 null로 둔다. 우리 쪽(skyUHD)도 target_id가 비어 있거나(수기 업로드 채널) 당일 시청률이 아직 없어도(월 단위 후행 반영) 편성 시간만으로 매칭한다(2026-09-22).';
