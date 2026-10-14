-- EPG 실측 편성표 + 경쟁 채널
with ol as (select id from channels where name ilike 'OLIFE'),
e as (
  select broadcast_date bd, start_time st, program_name_raw nm, episode_number ep, run_type rt,
         case when extract(hour from start_time) < 2 then extract(hour from start_time) + 24
              else extract(hour from start_time) end as hh
  from olife_epg_staging
)
select 'epg_runtype' k, json_agg(x order by x.n desc) v from (
  select coalesce(rt,'미상') rt, count(*) n, round(100.0 * count(*) / sum(count(*)) over (), 1) pct
  from e group by 1) x
union all
select 'epg_pgm', json_agg(x order by x.n desc) from (
  select nm, count(*) n, count(*) filter (where rt like '%재%') rerun, count(distinct ep) eps
  from e group by 1 order by 2 desc limit 15) x
union all
select 'epg_hour', json_agg(x order by x.hh) from (
  select hh::int hh, count(*) n, count(*) filter (where rt like '%본%') bon,
         count(*) filter (where rt like '%재%') jae
  from e group by 1) x
union all
select 'epg_daily', json_agg(x order by x.bd) from (
  select bd, count(*) slots, count(distinct nm) uniq from e group by 1) x
union all
select 'comp_list', json_agg(x order by x.n desc) from (
  select competitor_name cn, target_label tl, count(*) n,
         round(avg(rating),5) rating, round(avg(share),5) share,
         min(broadcast_date) d0, max(broadcast_date) d1
  from competitor_program_ratings where our_channel_id = (select id from ol) group by 1,2) x
union all
select 'comp_top', json_agg(x order by x.rating desc) from (
  select competitor_name cn, program_name pn, count(*) n, round(avg(rating),5) rating
  from competitor_program_ratings where our_channel_id = (select id from ol)
  group by 1,2 having count(*) >= 5 order by 4 desc limit 12) x
union all
select 'comp_ratings_tbl', json_agg(x order by x.n desc) from (
  select competitor_name cn, count(*) n, round(avg(rating),5) rating,
         min(broadcast_date) d0, max(broadcast_date) d1
  from competitor_ratings group by 1 order by 2 desc limit 15) x;
