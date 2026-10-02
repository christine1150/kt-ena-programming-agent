-- 구매 시뮬레이터 백테스트용: 한 달(구간) 동안 자사 채널이 실제 방영한 프로그램×슬롯 실적.
-- 예측 엔진(get_purchase_sim_inputs, as_of=구간 시작 전날)과 짝을 이뤄 "그때 예측 vs 실제"를 비교한다.
--  - 프로그램은 program_identity 별칭 그룹(group_key) 단위로 묶고, 스페셜·특집 계열은 제외한다(본편과 별개 프로그램).
--  - 시청률 NULL 은 제외, 0 은 실측 0 으로 포함(자사 2049 는 0 비중이 큼).
--  - 슬롯 정의는 purchase_slot() 과 같다(예측 입력과 같은 잣대).
create or replace function get_purchase_backtest_cases(
  p_own_channel_code text,
  p_target text,               -- 'A2049' | 'HH'
  p_from date,                 -- 평가 구간 시작(포함)
  p_to date,                   -- 평가 구간 끝(포함)
  p_min_case_n int default 8,  -- 구간 내 프로그램 총 방영 수 하한
  p_min_cell_n int default 4   -- 슬롯 셀 방영 수 하한
)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_label text;
  v_ch uuid;
  v_tid uuid;
  v_out jsonb;
begin
  v_label := case p_target when 'A2049' then '수도권 2049' when 'HH' then '전국 유료가구' end;
  if v_label is null then
    raise exception 'unsupported target %', p_target;
  end if;
  select ch.id into v_ch from channels ch where ch.code = p_own_channel_code;
  select tg.id into v_tid from targets tg where tg.label = v_label;

  with own as (
    select purchase_norm_key(pr.canonical_name) as k,
           purchase_slot(r.broadcast_date, r.start_time) as slot,
           r.rating as r
    from ratings r
    join programs pr on pr.id = r.program_id
    where r.channel_id = v_ch
      and r.target_id = v_tid
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date between p_from and p_to
      and r.rating is not null
  ),
  grp as (
    select coalesce(i.group_key, o.k) as gk, o.slot, o.r, coalesce(i.is_special, false) as sp
    from own o left join program_identity i on i.key = upper(o.k)
  ),
  cells as (
    select g.gk, g.slot, count(*)::int as n, sum(g.r) as s
    from grp g where not g.sp
    group by g.gk, g.slot
  ),
  cases as (
    select c.gk, sum(c.n)::int as total_n
    from cells c group by c.gk having sum(c.n) >= p_min_case_n
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'group_key', cs.gk,
      'display', coalesce((select i2.display_name from program_identity i2 where i2.key = upper(cs.gk)), cs.gk),
      'members', coalesce((select jsonb_agg(m.key) from program_identity m where m.group_key = upper(cs.gk)), jsonb_build_array(upper(cs.gk))),
      'total_n', cs.total_n,
      'cells', (select jsonb_agg(jsonb_build_object('slot', c2.slot, 'n', c2.n, 'sum', c2.s) order by c2.slot) from cells c2 where c2.gk = cs.gk and c2.n >= p_min_cell_n)
    ) order by cs.total_n desc), '[]'::jsonb)
  into v_out
  from cases cs
  where exists (select 1 from cells c3 where c3.gk = cs.gk and c3.n >= p_min_cell_n);
  return v_out;
end;
$$;
