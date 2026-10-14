-- 월간/주간 순위 추이 (nielsen_period_rank)
with ol as (select id from channels where name ilike 'OLIFE'),
r as (
  select p.period_type pt, p.date_from df, p.date_to dt, t.label tl,
         p.rank, p.rating, p.share, p.reach, p.time_spent_seconds ats
  from nielsen_period_rank p join targets t on t.id = p.target_id
  where p.channel_id = (select id from ol)
)
select 'targets' k, json_agg(x order by x.pt, x.tl) v from (
  select pt, tl, count(*) n, min(df) d0, max(dt) d1 from r group by 1,2) x
union all
select 'monthly', json_agg(x order by x.tl, x.df) from (
  select tl, df, dt, rank, round(rating,5) rating, round(share,5) share,
         round(reach,5) reach, round(ats,0) ats
  from r where pt = 'monthly') x
union all
select 'weekly', json_agg(x order by x.tl, x.df) from (
  select tl, df, dt, rank, round(rating,5) rating, round(ats,0) ats
  from r where pt = 'weekly') x;
