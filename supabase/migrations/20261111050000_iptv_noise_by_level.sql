-- IPTV 활용 3단계 2순위 — 닐슨 회차 간 잡음 폭을 "타깃 × 시청률 구간"별로 계산(2026-11-11).
-- 채널 평균 잡음 폭(iptv_calibration.noise_step)은 낮은 시청률 방영이 섞여 프라임 본방(높은 시청률)의 잡음을 크게 과장했다
-- (예: ENA 2049 채널 평균 1.63 vs 1% 이상 구간 0.38). 같은 구간이면 자사 채널끼리 값이 비슷해(가구 0.15~0.4% 구간 0.50~0.62)
-- 자사 채널을 합쳐 타깃 × 구간으로 낸다. 정의는 compute_iptv_calibration 과 같다:
--   변화 폭 = |이번 − 직전| ÷ 둘의 평균(0~2), 같은 채널·타깃·프로그램·8대 시간대·본재 표기의 14일 이내 연속 방영,
--   잡음 폭 = IPTV 변화 폭 ≤ 0.10(실제로는 거의 그대로) 인 쌍에서 닐슨 변화 폭의 80% 분위. 구간 = 두 회 닐슨 평균 시청률(%).
-- 기존 테이블·함수는 건드리지 않는 신규 추가(멱등). service_role 만 접근.

create table if not exists iptv_noise_by_level (
  version text not null,
  target_kind text not null check (target_kind in ('household', 'p2049')),
  -- 두 회 닐슨 평균 시청률(%) 구간 [level_lo, level_hi). 마지막 구간 level_hi 는 null(상한 없음)
  level_lo numeric not null,
  level_hi numeric,
  period_from date not null,
  period_to date not null,
  n_pairs int not null,
  noise_step numeric not null,
  created_at timestamptz not null default now(),
  primary key (version, target_kind, level_lo)
);
comment on table iptv_noise_by_level is '닐슨 회차 간 잡음 폭(자사 채널 합산, 타깃 × 두 회 평균 시청률 구간). IPTV 셋톱 대조로 계산 — 보조 근거.';
alter table iptv_noise_by_level enable row level security;

create or replace function compute_iptv_noise_by_level(p_version text, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from iptv_noise_by_level t where t.version = p_version;
  insert into iptv_noise_by_level (version, target_kind, level_lo, level_hi, period_from, period_to, n_pairs, noise_step)
  with p as (
    select x.channel_name, x.target_kind, x.program_key, x.is_rerun_tag, x.broadcast_date, x.start_minute,
      x.iptv_rating ir, x.nielsen_rating nr,
      case
        when x.start_minute >= 1380 or x.start_minute < 120 then '23-02'
        when x.start_minute < 300 then '02-05'
        when x.start_minute < 480 then '05-08'
        when x.start_minute < 660 then '08-11'
        when x.start_minute < 840 then '11-14'
        when x.start_minute < 1020 then '14-17'
        when x.start_minute < 1200 then '17-20'
        else '20-23'
      end sb
    from iptv_nielsen_pairs x
    where x.nielsen_source = 'own' and x.broadcast_date between p_from and p_to
      and x.iptv_rating is not null and x.nielsen_rating is not null
  ), s as (
    select p.*, lag(p.ir) over w lir, lag(p.nr) over w lnr, lag(p.broadcast_date) over w ld
    from p
    window w as (partition by p.channel_name, p.target_kind, p.program_key, p.sb, p.is_rerun_tag order by p.broadcast_date, p.start_minute)
  ), st as (
    select s.target_kind,
      (s.nr + s.lnr) / 2 lvl,
      abs(s.nr - s.lnr) / nullif((s.nr + s.lnr) / 2, 0) n_step,
      abs(s.ir - s.lir) / nullif((s.ir + s.lir) / 2, 0) i_step
    from s
    where s.ld >= s.broadcast_date - 14
  ), b as (
    select st.target_kind, st.n_step,
      case when st.lvl < 0.05 then 0 when st.lvl < 0.15 then 0.05 when st.lvl < 0.4 then 0.15 when st.lvl < 1 then 0.4 else 1 end lo
    from st
    where st.i_step <= 0.10 and st.n_step is not null
  )
  select p_version, b.target_kind, b.lo,
    case b.lo when 0 then 0.05 when 0.05 then 0.15 when 0.15 then 0.4 when 0.4 then 1 else null end,
    p_from, p_to, count(*)::int,
    round((percentile_cont(0.8) within group (order by b.n_step))::numeric, 4)
  from b
  group by b.target_kind, b.lo
  having count(*) >= 30;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function compute_iptv_noise_by_level(text, date, date) from public, anon, authenticated;
