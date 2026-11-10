-- 20261111010000 의 refresh_iptv_nielsen_match 가 programs.name(없는 열)을 읽어 실패 — programs.raw_name 으로 고친 같은 함수로 바꾼다(2026-11-11).

create or replace function refresh_iptv_nielsen_match(p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_m int;
begin
  delete from iptv_nielsen_match m where m.broadcast_date between p_from and p_to;

  -- 자사(닐슨 일일 파일 ratings, 프로그램 행만). 채널·타깃·방송일 동등 조인 뒤 시작 ±3분으로 거른다.
  insert into iptv_nielsen_match
    (channel_name, target_kind, broadcast_date, start_minute, program_key, nielsen_source,
     nielsen_start_minute, nielsen_end_minute, nielsen_program_name, nielsen_rating, nielsen_share, nielsen_reach, start_gap)
  with n as (
    select c.code, case t.label when '전국 유료가구' then 'household' else 'p2049' end tk, r.broadcast_date d,
      (extract(hour from r.start_time) * 60 + extract(minute from r.start_time)
        + case when extract(hour from r.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from r.end_time) * 60 + extract(minute from r.end_time)
        + case when extract(hour from r.end_time) < 2 or r.end_time < r.start_time then 1440 else 0 end)::int em,
      p.raw_name pname, r.rating, r.share, r.reach
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id and t.label in ('전국 유료가구', '수도권 2049')
    left join programs p on p.id = r.program_id
    where r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.broadcast_date between p_from and p_to
  )
  select distinct on (a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key)
    a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, 'own',
    n.sm, n.em, n.pname, n.rating, n.share, n.reach, abs(n.sm - a.start_minute)
  from iptv_tvindex_airings a
  join iptv_channel_map cm on cm.iptv_channel_name = a.channel_name and cm.channel_group = 'own' and cm.nielsen_channel_code is not null
  join n on n.code = cm.nielsen_channel_code and n.tk = a.target_kind and n.d = a.broadcast_date
    and abs(n.sm - a.start_minute) <= 3
  where a.broadcast_date between p_from and p_to
    and (n.em is null or (n.em - n.sm) between 0.5 * (a.end_minute - a.start_minute) and 2 * (a.end_minute - a.start_minute))
  order by a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, abs(n.sm - a.start_minute);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  -- 경쟁(닐슨 경쟁채널 시트). 우리 채널 시트마다 같은 행이 반복되므로 distinct on 으로 가장 가까운 한 건만 남긴다.
  insert into iptv_nielsen_match
    (channel_name, target_kind, broadcast_date, start_minute, program_key, nielsen_source,
     nielsen_start_minute, nielsen_end_minute, nielsen_program_name, nielsen_rating, nielsen_share, nielsen_reach, start_gap)
  with n as (
    select x.competitor_name cn, case x.target_label when '유료방송가구' then 'household' else 'p2049' end tk, x.broadcast_date d,
      (extract(hour from x.start_time) * 60 + extract(minute from x.start_time)
        + case when extract(hour from x.start_time) < 2 then 1440 else 0 end)::int sm,
      (extract(hour from x.end_time) * 60 + extract(minute from x.end_time)
        + case when extract(hour from x.end_time) < 2 or x.end_time < x.start_time then 1440 else 0 end)::int em,
      x.program_name pname, x.rating, x.share
    from competitor_program_ratings x
    where x.target_label in ('유료방송가구', '개인2049') and x.start_time is not null
      and x.broadcast_date between p_from and p_to
  )
  select distinct on (a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key)
    a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, 'comp',
    n.sm, n.em, n.pname, n.rating, n.share, null, abs(n.sm - a.start_minute)
  from iptv_tvindex_airings a
  join iptv_channel_map cm on cm.iptv_channel_name = a.channel_name and cm.nielsen_competitor_name is not null
  join n on n.cn = cm.nielsen_competitor_name and n.tk = a.target_kind and n.d = a.broadcast_date
    and abs(n.sm - a.start_minute) <= 3
  where a.broadcast_date between p_from and p_to
    and (n.em is null or (n.em - n.sm) between 0.5 * (a.end_minute - a.start_minute) and 2 * (a.end_minute - a.start_minute))
  order by a.channel_name, a.target_kind, a.broadcast_date, a.start_minute, a.program_key, abs(n.sm - a.start_minute);
  get diagnostics v_m = row_count;
  v_n := v_n + v_m;

  return v_n;
end;
$$;

revoke all on function refresh_iptv_nielsen_match(date, date) from public, anon, authenticated;
