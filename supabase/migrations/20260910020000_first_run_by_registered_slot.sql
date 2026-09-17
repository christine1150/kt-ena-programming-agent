-- 본방 인식에 "등록 슬롯"을 추가(2026-09-10, 사용자 지시)
--
-- 사용자 지시: "`<본>` 태그가 없어도 오리지널 등록이 되어 있는 시간대는 본방 요일과 시간으로
-- 인식해줘."
--
-- 배경: 직전 버전의 get_channel_first_run_efficiency는 ratings.is_first_run(=`<본>` 태그)만
-- 봤다. 그런데 실측상 이 태그는 ENA 채널에만 있어(2026-06~09 기준 ENA 1,853건, 나머지 6채널
-- 0건) 다른 채널은 본방/재방 구분이 통째로 비었다. 반면 featured_content(주요 콘텐츠 관리)에는
-- 작품마다 본방 요일 배열과 시각이 등록돼 있고, 이 프로젝트는 이미 그 슬롯 ±10분 매칭으로
-- 본방을 찾는 방식을 쓰고 있다(get_original_content_daily, get_channel_original_rerun_profile).
-- 그 방식을 이 함수에도 적용해 태그가 없는 채널도 본방을 가릴 수 있게 한다.
--
-- 본방 판정 = (`<본>` 태그가 붙었거나) OR (등록된 요일·시각 ±10분 슬롯에서 방영됐거나).
-- 두 경로 중 하나만 맞아도 본방으로 본다 — 태그가 있는 ENA는 기존 결과가 그대로 유지되고,
-- 태그가 없는 채널은 등록 슬롯으로 새로 잡힌다(기존 동작 회귀 없음).
--
-- 동시방영(simulcast) 채널도 본방으로 센다: 같은 시각에 함께 나가는 방영분은 재방이 아니라
-- 같은 본방이다. 재방(rerun) 채널은 당연히 제외한다.
--
-- 어떤 경로로 본방을 찾았는지 first_run_source로 함께 반환한다 — 화면·문서가 "무엇을 근거로
-- 본방이라고 했는지"를 밝힐 수 있어야 하기 때문이다(추정으로 오해받지 않게).
-- 반환 컬럼이 늘어 create or replace가 불가하므로 drop 후 재생성한다.

drop function if exists get_channel_first_run_efficiency(text, text, date, date, int);
create function get_channel_first_run_efficiency(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_limit int default 40
)
returns table (
  canonical_name text,
  first_run_airings int,
  first_run_avg_rating numeric,
  first_run_avg_reach numeric,
  first_run_avg_time_spent_share numeric,
  other_airings int,
  other_avg_rating numeric,
  other_avg_reach numeric,
  other_avg_time_spent_share numeric,
  rerun_retention_pct numeric,
  total_airtime_min numeric,
  first_run_source text
)
language sql
stable
as $$
  -- 이 채널에 본방 또는 동시방영으로 등록된 작품의 슬롯(요일 배열 + 시각).
  with reg as (
    select distinct
      regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') as rnorm,
      fc.broadcast_day_of_week as rdows,
      fc.broadcast_time as rtime
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels hc on hc.id = p.channel_id
    left join channels sc on sc.id = fc.simulcast_channel_id
    where fc.broadcast_time is not null
      and fc.broadcast_day_of_week is not null
      and (hc.code = p_channel_code or sc.code = p_channel_code)
      and fc.broadcast_start_date <= p_date_to
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_date_from)
  ),
  base as (
    select
      p.canonical_name as cn,
      (r.is_first_run is true) as tagged_fr,
      exists (
        select 1
        from reg g
        where g.rnorm = regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g')
          and (array['월', '화', '수', '목', '금', '토', '일'])[extract(isodow from r.broadcast_date)::int] = any(g.rdows)
          and abs(extract(epoch from (r.start_time - g.rtime))) <= 600
      ) as slot_fr,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      r.rating as rt,
      r.reach as rc,
      r.time_spent_share as tshr
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code
      and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and r.broadcast_date between p_date_from and p_date_to
  ),
  flagged as (
    select b.*, (b.tagged_fr or b.slot_fr) as is_fr
    from base b
  ),
  agg as (
    select
      f.cn as cn,
      count(*) filter (where f.is_fr)::int as fr_air,
      sum(f.rt * f.dur) filter (where f.is_fr) / nullif(sum(f.dur) filter (where f.is_fr and f.rt is not null), 0) as fr_rt,
      sum(f.rc * f.dur) filter (where f.is_fr) / nullif(sum(f.dur) filter (where f.is_fr and f.rc is not null), 0) as fr_rc,
      sum(f.tshr * f.dur) filter (where f.is_fr) / nullif(sum(f.dur) filter (where f.is_fr and f.tshr is not null), 0) as fr_tshr,
      count(*) filter (where not f.is_fr)::int as ot_air,
      sum(f.rt * f.dur) filter (where not f.is_fr) / nullif(sum(f.dur) filter (where not f.is_fr and f.rt is not null), 0) as ot_rt,
      sum(f.rc * f.dur) filter (where not f.is_fr) / nullif(sum(f.dur) filter (where not f.is_fr and f.rc is not null), 0) as ot_rc,
      sum(f.tshr * f.dur) filter (where not f.is_fr) / nullif(sum(f.dur) filter (where not f.is_fr and f.tshr is not null), 0) as ot_tshr,
      sum(f.dur) as tot_dur,
      bool_or(f.tagged_fr) as any_tagged,
      bool_or(f.slot_fr) as any_slot
    from flagged f
    group by f.cn
  )
  select
    a.cn,
    a.fr_air,
    round(a.fr_rt::numeric, 5),
    round(a.fr_rc::numeric, 5),
    round(a.fr_tshr::numeric, 3),
    a.ot_air,
    round(a.ot_rt::numeric, 5),
    round(a.ot_rc::numeric, 5),
    round(a.ot_tshr::numeric, 3),
    round((100.0 * a.ot_rt / nullif(a.fr_rt, 0))::numeric, 1),
    round(a.tot_dur::numeric, 1),
    (case
       when a.any_tagged and a.any_slot then '태그+등록 슬롯'
       when a.any_tagged then '<본> 태그'
       else '등록 슬롯'
     end)
  from agg a
  where a.fr_air > 0
  order by a.fr_rt desc nulls last
  limit p_limit;
$$;
comment on function get_channel_first_run_efficiency is
  '본방 vs 본방 외 효율(2026-09-10 개정) — 본방 판정을 `<본>` 태그(ratings.is_first_run)와 주요 콘텐츠 등록 슬롯(featured_content의 요일 배열 + 시각 ±10분, 동시방영 채널 포함) 두 경로의 합집합으로 한다. `<본>` 태그가 ENA 채널에만 있어 다른 채널은 본방 구분이 통째로 비던 문제를 해결한다. first_run_source로 어느 경로에서 본방을 찾았는지 밝힌다. 재방 채널은 본방으로 세지 않는다.';
