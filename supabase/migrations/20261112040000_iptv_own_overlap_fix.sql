-- P6 보정: same_slot 을 "A 채널 방영 중 B 채널이 같은 작품을 같은 요일·시간대에 방영한 건수"(A 방영 기준 고유 건수)로 바꾼다(앞 판은 쌍 곱을 세어 과대). 신규 파일로 대체(멱등).
-- 같은 요일·시간대(8대)에 나간 건수. 채널 쌍은 이름 순으로 한 번만 센다.
create or replace function iptv_own_overlap(p_target text, p_from date, p_to date, p_min_airings int default 5)
returns table (
  program_key text, program_name text, channel_a text, channel_b text,
  airings_a int, airings_b int, rating_a numeric, rating_b numeric,
  simultaneous int, same_slot int
)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.channel_name cn, m.program_key pk, m.program_name pn, m.broadcast_date d, m.start_minute s, m.end_minute e,
      m.dow, m.slot_band sb, m.duration_min dm, m.rating
    from iptv_airing_metrics m
    where m.channel_group = 'own' and m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0
  ), agg as (
    select cn, pk, min(pn) pn, count(*)::int n,
      round(sum(rating * dm) / nullif(sum(dm) filter (where rating is not null), 0), 5) r
    from b group by cn, pk
  ), pairs as (
    select a.pk, a.pn, a.cn ca, c.cn cb, a.n na, c.n nb, a.r ra, c.r rb
    from agg a join agg c on c.pk = a.pk and c.cn > a.cn
    where a.n >= p_min_airings and c.n >= p_min_airings
  ), simul as (
    select x.pk, x.cn ca, y.cn cb, count(*)::int n
    from b x join b y on y.pk = x.pk and y.cn > x.cn and y.d = x.d
      and least(x.e, y.e) - greatest(x.s, y.s) >= 30
    group by x.pk, x.cn, y.cn
  ), slotc as (
    select x.pk, x.cn ca, y.cn cb, count(distinct (x.d, x.s))::int n
    from b x join b y on y.pk = x.pk and y.cn > x.cn and y.dow = x.dow and y.sb = x.sb
    group by x.pk, x.cn, y.cn
  )
  select p.pk, p.pn, p.ca, p.cb, p.na, p.nb, p.ra, p.rb, coalesce(s.n, 0), coalesce(sl.n, 0)
  from pairs p
  left join simul s on s.pk = p.pk and s.ca = p.ca and s.cb = p.cb
  left join slotc sl on sl.pk = p.pk and sl.ca = p.ca and sl.cb = p.cb
  order by p.na + p.nb desc;
$$;
revoke all on function iptv_own_overlap(text, date, date, int) from public, anon, authenticated;
