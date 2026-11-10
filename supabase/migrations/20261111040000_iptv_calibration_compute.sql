-- IPTV 활용 계획 2단계 A1(닐슨 잡음 폭) — 보정 계수·잡음 폭을 DB 에서 계산해 iptv_calibration 에 버전별로 저장한다(원칙 1).
-- 기존 테이블·함수는 건드리지 않는다(iptv_calibration 은 20261111010000 에서 만든 표에 열만 더함). 멱등.
--
-- 계산 정의(채널×타깃, slot_band='all'):
--  · n_pairs           닐슨과 짝지어진 방영 건 수(iptv_nielsen_match)
--  · median_ratio      IPTV ÷ 닐슨 중앙값(닐슨 > 0 인 건만) / sum_ratio = 합계 비율(낮은 값의 0 영향을 덜 받음)
--  · corr              방영 건 단위 상관계수
--  · nielsen_step_mad  같은 채널·타깃·프로그램·8대 시간대·본재 표기의 연속 방영(14일 이내) 사이 변화 폭 중앙값.
--                      변화 폭 = |이번 − 직전| ÷ 둘의 평균(0~2, 한쪽이 0이면 2)
--  · iptv_step_mad     같은 쌍에서 IPTV 변화 폭 중앙값
--  · noise_step        IPTV 변화 폭이 0.10 이하(사실상 그대로)인 쌍에서 닐슨 변화 폭의 80% 분위 — "실제로는 그대로인데 닐슨이 이만큼까지는 흔들린다"
--  · nielsen_zero_rate 닐슨 시청률 0 비율
alter table iptv_calibration add column if not exists sum_ratio numeric;
alter table iptv_calibration add column if not exists stable_pairs int;

create or replace function compute_iptv_calibration(p_version text, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  delete from iptv_calibration c where c.version = p_version and c.slot_band = 'all';

  insert into iptv_calibration
    (version, channel_name, target_kind, slot_band, period_from, period_to, n_pairs, median_ratio, sum_ratio, corr,
     nielsen_step_mad, iptv_step_mad, noise_step, stable_pairs, nielsen_zero_rate, note)
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
    where x.broadcast_date between p_from and p_to and x.iptv_rating is not null and x.nielsen_rating is not null
  ), s as (
    select p.*,
      lag(p.ir) over w lir, lag(p.nr) over w lnr, lag(p.broadcast_date) over w ld
    from p
    window w as (partition by p.channel_name, p.target_kind, p.program_key, p.sb, p.is_rerun_tag order by p.broadcast_date, p.start_minute)
  ), st as (
    select s.*,
      case when s.ld >= s.broadcast_date - 14 and (s.nr + s.lnr) > 0 then abs(s.nr - s.lnr) / ((s.nr + s.lnr) / 2) end n_step,
      case when s.ld >= s.broadcast_date - 14 and (s.ir + s.lir) > 0 then abs(s.ir - s.lir) / ((s.ir + s.lir) / 2) end i_step
    from s
  )
  select p_version, st.channel_name, st.target_kind, 'all', p_from, p_to,
    count(*)::int,
    round((percentile_cont(0.5) within group (order by st.ir / st.nr) filter (where st.nr > 0))::numeric, 4),
    round(sum(st.ir) / nullif(sum(st.nr), 0), 4),
    round(corr(st.ir, st.nr)::numeric, 4),
    round((percentile_cont(0.5) within group (order by st.n_step) filter (where st.n_step is not null and st.i_step is not null))::numeric, 4),
    round((percentile_cont(0.5) within group (order by st.i_step) filter (where st.n_step is not null and st.i_step is not null))::numeric, 4),
    round((percentile_cont(0.8) within group (order by st.n_step) filter (where st.i_step <= 0.10 and st.n_step is not null))::numeric, 4),
    (count(*) filter (where st.i_step <= 0.10 and st.n_step is not null))::int,
    round(avg((st.nr = 0)::int)::numeric, 4),
    'A1 잡음 폭: 연속 방영(14일 이내) 변화 폭 = |차| ÷ 평균'
  from st
  group by st.channel_name, st.target_kind;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function compute_iptv_calibration(text, date, date) from public, anon, authenticated;
