-- A1-3: rating = f(reach, ATS) 항등식 검증 + 성장 기여도 로그분해
-- 원천: olife_reference_metrics (daily + household)
with d as (
  select period_date,
         extract(year from period_date)::int as yr,
         rating, share, reach,
         avg_time_spent_seconds::numeric as ats
  from olife_reference_metrics
  where granularity = 'daily'
    and dimension   = 'household'
    and rating is not null and reach is not null and avg_time_spent_seconds is not null
),
idcheck as (
  select yr,
         count(*)::int as n_days,
         round(avg(rating)::numeric, 5)                          as avg_rating,
         round(avg(reach * ats * 100.0 / 86400)::numeric, 5)      as avg_implied,
         round(corr(rating, reach * ats)::numeric, 4)             as corr_rating_vs_reach_x_ats,
         round(avg(abs(rating - reach * ats * 100.0 / 86400))::numeric, 5) as mean_abs_gap
  from d group by yr
),
base_full as (
  select 'full'::text as basis, yr,
         avg(rating)::numeric as r, avg(reach)::numeric as rc,
         avg(ats)::numeric as a,   avg(share)::numeric as sh
  from d group by yr
),
base_ytd as (
  select 'ytd_0101_0906'::text as basis, yr,
         avg(rating)::numeric as r, avg(reach)::numeric as rc,
         avg(ats)::numeric as a,   avg(share)::numeric as sh
  from d where to_char(period_date, 'MMDD') <= '0906'
  group by yr
),
base as (
  select * from base_full union all select * from base_ytd
),
pairs as (
  select * from (values (2024, 2025), (2025, 2026), (2024, 2026)) as p(y0, y1)
),
dcp as (
  select b0.basis, p.y0, p.y1,
         round(b0.r, 5)  as rating_from,  round(b1.r, 5)  as rating_to,
         round(b0.rc, 5) as reach_from,   round(b1.rc, 5) as reach_to,
         round(b0.a, 1)  as ats_from,     round(b1.a, 1)  as ats_to,
         round(b0.sh, 5) as share_from,   round(b1.sh, 5) as share_to,
         round((b1.r / b0.r  - 1) * 100, 1) as rating_chg_pct,
         round((b1.rc / b0.rc - 1) * 100, 1) as reach_chg_pct,
         round((b1.a / b0.a  - 1) * 100, 1) as ats_chg_pct,
         round((b1.sh / b0.sh - 1) * 100, 1) as share_chg_pct,
         round(ln(b1.r / b0.r), 5)   as ln_rating,
         round(ln(b1.rc / b0.rc), 5) as ln_reach,
         round(ln(b1.a / b0.a), 5)   as ln_ats,
         round(ln(b1.r / b0.r) - ln(b1.rc / b0.rc) - ln(b1.a / b0.a), 5) as ln_residual,
         round(ln(b1.rc / b0.rc) / ln(b1.r / b0.r) * 100, 1) as reach_contrib_pct,
         round(ln(b1.a / b0.a)  / ln(b1.r / b0.r) * 100, 1) as ats_contrib_pct,
         round((ln(b1.r / b0.r) - ln(b1.rc / b0.rc) - ln(b1.a / b0.a)) / ln(b1.r / b0.r) * 100, 1) as residual_contrib_pct
  from pairs p
  join base b0 on b0.yr = p.y0
  join base b1 on b1.yr = p.y1 and b1.basis = b0.basis
)
select 'identity' as k, json_agg(i order by i.yr)                       as v from idcheck i
union all
select 'decomp',        json_agg(x order by x.basis, x.y0, x.y1)              from dcp x;
