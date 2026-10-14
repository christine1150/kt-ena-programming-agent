with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구')
select 'sub_cov' k, json_agg(x) v from (
  select p.canonical_name nm,
         case when r.broadcast_date < date '2026-01-01' then 2025 else 2026 end yr,
         count(*) n,
         count(*) filter (where r.episode_subtitle is not null and r.episode_subtitle <> '') with_sub,
         count(*) filter (where r.episode_number is not null) with_ep
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
  group by 1,2 having count(*) >= 100 order by 3 desc) x
union all
select 'cat', json_agg(x) from (
  select series_name sn, count(*) n, count(distinct country_guess) cty,
         count(*) filter (where themes is not null) with_theme
  from olife_episode_catalog group by 1) x
union all
select 'cat_sample', json_agg(x) from (
  select series_name sn, bis_episode_number ep, subtitle_norm, country_guess, themes
  from olife_episode_catalog limit 8) x
union all
select 'rat_sample', json_agg(x) from (
  select p.canonical_name nm, r.broadcast_date bd, r.start_time st, r.episode_number ep, r.episode_subtitle sub
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
    and r.episode_subtitle is not null and r.broadcast_date >= date '2026-06-01'
  order by r.broadcast_date, r.start_time limit 12) x
union all
select 'join_test', json_agg(x) from (
  select count(*) total,
         count(*) filter (where c.country_guess is not null) matched
  from ratings r
  join programs p on p.id = r.program_id
  left join olife_episode_catalog c
    on regexp_replace(coalesce(c.subtitle_norm,''),'[[:space:]]','','g') = regexp_replace(coalesce(r.episode_subtitle,''),'[[:space:]]','','g')
   and c.subtitle_norm is not null and c.subtitle_norm <> ''
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
    and r.episode_subtitle is not null and r.episode_subtitle <> '') x;
