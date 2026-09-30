-- 사용자 지시(2026-09-30): "OLIFE는 부제가 나오니까 걸어서세계속으로와 세계테마기행은 에피소드 부제명도 포함해서
-- 짜보자 … 부제 반영 미반영 옵션을 만들어주면 되겠어" — 이상적 1주일 편성에 에피소드(부제) 단위 편성 옵션 추가.
--
-- 1) 방영 입력 RPC에 회차·부제(ratings.episode_number/episode_subtitle — OLIFE EPG로 채워진 값) 추가.
--    기존 함수를 같은 시그니처로 재정의(반환 jsonb에 'ep','sub'만 추가, 나머지 동작·as_of 강제 동일).
-- 2) 설정: 에피소드 단위로 편성할 시리즈 목록(채널별)과 에피소드 반복·휴지 규칙. 코드 하드코딩 없이 이 설정에서만.
-- 3) 실행·블록에 부제 반영 여부와 배정된 에피소드 저장.

create or replace function get_ideal_schedule_own_airings(
  p_channel_code text,
  p_as_of_date date,
  p_lookback_days int default 84,
  p_target_labels text[] default null
)
returns jsonb
language sql
stable
as $$
  with ch as (
    select c.id, c.code, c.primary_target,
      case when c.code = 'SKYUHD' then null else resolve_program_target_label(c.primary_target) end as kpi_label
    from channels c
    where c.code = p_channel_code
  ),
  win as (
    select (p_as_of_date - (p_lookback_days - 1)) as d_from, p_as_of_date as d_to
  ),
  base as (
    select
      r.broadcast_date,
      r.start_time,
      r.end_time,
      r.program_id,
      r.is_first_run,
      r.episode_number,
      r.episode_subtitle,
      r.rating,
      r.share,
      r.reach,
      r.time_spent_seconds,
      case when ch.code = 'SKYUHD' then '__SKYUHD__' else t.label end as target_label
    from ratings r
    join ch on ch.id = r.channel_id
    cross join win
    left join targets t on t.id = r.target_id
    where r.broadcast_date between win.d_from and win.d_to
      and r.program_id is not null
      and r.start_time is not null
      and (
        (ch.code = 'SKYUHD' and r.source_type = 'skyuhd' and r.target_id is null)
        or (
          ch.code <> 'SKYUHD'
          and r.source_type = 'nielsen_daily'
          and t.label = any(coalesce(p_target_labels, array[ch.kpi_label]))
        )
      )
  ),
  airing as (
    select
      b.broadcast_date,
      b.start_time,
      max(b.end_time) as end_time,
      b.program_id,
      bool_or(b.is_first_run) filter (where b.is_first_run is not null) as is_first_run,
      max(b.episode_number) as episode_number,
      max(b.episode_subtitle) as episode_subtitle,
      jsonb_object_agg(
        b.target_label,
        jsonb_build_object('r', b.rating, 's', b.share, 'reach', b.reach, 'ts', b.time_spent_seconds)
      ) as metrics
    from base b
    group by b.broadcast_date, b.start_time, b.program_id
  )
  select jsonb_build_object(
    'channel_code', (select code from ch),
    'kpi_label', (select coalesce(kpi_label, '__SKYUHD__') from ch),
    'date_from', (select d_from from win),
    'date_to', (select d_to from win),
    'holidays', coalesce((
      select jsonb_agg(h.holiday_date order by h.holiday_date)
      from public_holidays h, win
      where h.holiday_date between win.d_from and win.d_to
    ), '[]'::jsonb),
    'dates_with_data', coalesce((
      select jsonb_agg(distinct a.broadcast_date) from airing a
    ), '[]'::jsonb),
    'airings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', a.broadcast_date,
          'start', to_char(a.start_time, 'HH24:MI:SS'),
          'end', to_char(a.end_time, 'HH24:MI:SS'),
          'program_id', a.program_id,
          'program_name', p.canonical_name,
          'first_run', a.is_first_run,
          'ep', a.episode_number,
          'sub', a.episode_subtitle,
          'm', a.metrics
        )
        order by a.broadcast_date, a.start_time, a.program_id
      )
      from airing a
      join programs p on p.id = a.program_id
    ), '[]'::jsonb)
  );
$$;
comment on function get_ideal_schedule_own_airings is '이상적 1주일 편성 Feature 입력(2026-09-30): 자사 채널의 as_of 이전 N일 방영 1건=1원소 jsonb(타깃별 rating/share/reach/시청시간 + 회차·부제). broadcast_date<=as_of를 SQL에서 강제(백테스트 미래 데이터 차단). skyUHD는 source_type=skyuhd·타깃 없음으로 분기.';

-- 설정: 에피소드 단위 편성 시리즈(채널 코드 → 프로그램명 정규화 목록)와 규칙
--  episode_weekly_cap: 같은 에피소드 주간 최대 편성 수 / episode_rest_days: 마지막 방영 후 다시 편성하기까지 최소 일수
--  (초기값 1회·7일 — 운영 중 조정 대상)
update ideal_schedule_config
set structure = structure || '{"episodic_programs":{"OLIFE":["걸어서세계속으로","세계테마기행"]},"episode_weekly_cap":1,"episode_rest_days":7}'::jsonb,
    updated_by = 'migration',
    updated_at = now()
where channel_id is null;

alter table ideal_schedule_runs add column if not exists episode_mode text not null default 'PROGRAM'
  check (episode_mode in ('PROGRAM','EPISODE'));
comment on column ideal_schedule_runs.episode_mode is 'PROGRAM=부제 미반영(프로그램 단위), EPISODE=부제 반영(설정의 에피소드 시리즈는 에피소드 단위 배정)';

alter table ideal_schedule_blocks
  add column if not exists episode_number int,
  add column if not exists episode_subtitle text,
  add column if not exists episode_info jsonb;
