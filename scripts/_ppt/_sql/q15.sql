-- 여행 큐레이션 검증용: 2026년 자막이 있는 편성 전체
with ol as (select id from channels where name ilike 'OLIFE'),
tg as (select id from targets where label = '전국 유료가구')
select 'rows' k, json_agg(x order by x.bd, x.hh, x.st) v from (
  select p.canonical_name nm, r.broadcast_date bd, r.start_time st,
         case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time) + 24
              else extract(hour from r.start_time) end hh,
         r.episode_number ep, r.episode_subtitle sub, round(r.rating,5) rating
  from ratings r join programs p on p.id = r.program_id
  where r.channel_id = (select id from ol) and r.target_id = (select id from tg)
    and r.episode_subtitle is not null and r.episode_subtitle <> ''
) x;
