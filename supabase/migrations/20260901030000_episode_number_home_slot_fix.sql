-- 사용자 지시(2026-09-01): "왕자와거지도 7월 27일 첫 방송... 8월 31일이 6회인데 자동 계산이
-- 잘못되어 26회로 나와있음". 실측 확인 결과 get_episode_number/get_program_rating_history의
-- 회차 계산 서브쿼리가 "seed 이후 이 프로그램명이 등장한 모든 날짜"를 채널·시각 구분 없이
-- distinct count하고 있었다 — 왕자와거지는 ENA 본방(월 23:15) 외에도 ENA_PLAY(동시방송)·
-- ENA_DRAMA·ENA_STORY에서 하루 여러 번 재방영되는데, 그 재방 날짜까지 전부 "새 회차"로 세어
-- 7주(6회) 분량이 26일로 부풀려졌다. 신병4:사보타주(3회인데 8회로 표시된 것)도 같은 원인.
--
-- 수정: featured_content(주요 콘텐츠 관리)에 이미 등록된 "본방 슬롯"(채널·요일·시각)이 있으면
-- 그 슬롯(같은 채널 + 등록된 요일 + 등록 시각 ±10분)에서 실제로 방영된 날짜만 센다. 등록이
-- 없는 프로그램(과거 동작)은 지금처럼 이름만으로 넓게 센다 — 회귀 없음. 드라마처럼 주 2회
-- (월,화) 편성인 프로그램도 broadcast_day_of_week 배열을 그대로 쓰므로 정상 처리된다.
create or replace function get_episode_number(p_canonical_name text, p_broadcast_date date)
returns int
language sql
stable
as $$
  with day_map(label, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  home as (
    select distinct p2.channel_id, fc.broadcast_time, dm.iso as dow_iso
    from featured_content fc
    join programs p2 on p2.id = fc.program_id
    join lateral unnest(fc.broadcast_day_of_week) as wd(label) on true
    join day_map dm on dm.label = wd.label
    where replace(p2.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
      and fc.broadcast_time is not null
  )
  select pec.seed_episode_number + count(distinct r.broadcast_date)
  from program_episode_counters pec
  left join ratings r
    on r.source_type = 'nielsen_daily' and r.program_id is not null
    and r.broadcast_date > pec.seed_broadcast_date
    and r.broadcast_date <= p_broadcast_date
    and exists (
      select 1 from programs p3 where p3.id = r.program_id
        and replace(p3.canonical_name, ' ', '') = replace(pec.canonical_name, ' ', '')
    )
    and (
      not exists (select 1 from home)
      or exists (
        select 1 from home h
        where h.channel_id = r.channel_id
          and h.dow_iso = extract(isodow from r.broadcast_date)::int
          and least(
                abs(extract(epoch from (r.start_time - h.broadcast_time))),
                86400 - abs(extract(epoch from (r.start_time - h.broadcast_time)))
              ) <= 600
      )
    )
  where pec.canonical_name = p_canonical_name
    and p_broadcast_date >= pec.seed_broadcast_date
  group by pec.seed_episode_number
$$;
comment on function get_episode_number is '회차 번호 = seed 회차 + (seed 날짜 이후 ~ 대상 날짜까지 그 프로그램이 실제로 방영된 날짜 수). featured_content에 본방 슬롯(채널·요일·시각)이 등록돼 있으면 그 슬롯에서 방영된 날짜만 세어 재방송을 별개 회차로 잘못 세지 않는다(2026-09-01) — 등록이 없으면 기존처럼 이름만으로 넓게 센다. seed 이전 날짜나 seed가 없는 프로그램은 NULL(추정하지 않음).';

-- get_program_rating_history(주요 컨텐츠 리뷰 꺾은선 그래프)도 자체적으로 같은 계산을 복제해
-- 갖고 있었다(episode_number 컬럼) — 위와 동일한 원칙으로 함께 수정한다.
create or replace function get_program_rating_history(
  p_canonical_name text,
  p_expected_start_time time,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  channel_code text,
  broadcast_date date,
  episode_number int,
  target_label text,
  rating numeric
)
language sql
stable
as $$
  with day_map(label, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  home as (
    select distinct p2.channel_id, fc.broadcast_time, dm.iso as dow_iso
    from featured_content fc
    join programs p2 on p2.id = fc.program_id
    join lateral unnest(fc.broadcast_day_of_week) as wd(label) on true
    join day_map dm on dm.label = wd.label
    where replace(p2.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
      and fc.broadcast_time is not null
  )
  select
    c.code,
    r.broadcast_date,
    coalesce(
      r.episode_number,
      case
        when pec.seed_episode_number is not null and r.broadcast_date >= pec.seed_broadcast_date then
          pec.seed_episode_number + (
            select count(distinct r2.broadcast_date)
            from ratings r2
            join programs p2 on p2.id = r2.program_id
            where r2.source_type = 'nielsen_daily' and r2.program_id is not null
              and r2.broadcast_date > pec.seed_broadcast_date and r2.broadcast_date <= r.broadcast_date
              and replace(p2.canonical_name, ' ', '') = replace(pec.canonical_name, ' ', '')
              and (
                not exists (select 1 from home)
                or exists (
                  select 1 from home h
                  where h.channel_id = r2.channel_id
                    and h.dow_iso = extract(isodow from r2.broadcast_date)::int
                    and least(
                          abs(extract(epoch from (r2.start_time - h.broadcast_time))),
                          86400 - abs(extract(epoch from (r2.start_time - h.broadcast_time)))
                        ) <= 600
                )
              )
          )::int
        else null
      end
    ) as episode_number,
    t.label,
    r.rating
  from ratings r
  join channels c on c.id = r.channel_id
  join programs p on p.id = r.program_id
  join targets t on t.id = r.target_id
  left join program_episode_counters pec on replace(pec.canonical_name, ' ', '') = replace(p.canonical_name, ' ', '')
  where replace(p.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
    and r.source_type = 'nielsen_daily'
    and r.rating is not null
    and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
    and r.start_time between (p_expected_start_time - interval '10 minutes') and (p_expected_start_time + interval '10 minutes')
    and t.label in ('수도권 2049', '전국 유료가구')
  order by c.code, r.broadcast_date;
$$;
comment on function get_program_rating_history is '주요 콘텐츠 리뷰(Page 1) 본방송 시청률 추이 꺾은선 그래프용 — 프로그램명(공백 무시)+본방 시간(±10분) 기준으로 채널 구분 없이 시계열을 반환. episode_number는 ratings.episode_number(OLIFE EPG 매칭)를 우선하고 없으면 program_episode_counters seed 기반으로 계산하되, featured_content 본방 슬롯(채널·요일·시각)이 등록돼 있으면 그 슬롯의 방영일만 세어 재방송을 별개 회차로 잘못 세지 않는다(2026-09-01).';
