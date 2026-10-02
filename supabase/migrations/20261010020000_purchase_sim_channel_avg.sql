-- 구매 시뮬레이터: 채널의 최근 1년(365일) 평균 시청률(편성 단위 단순 평균). 예상 시청률이 이보다 낮은지 화면에서 표시하는 기준.
create or replace function get_purchase_channel_avg(p_own_channel_code text, p_target text, p_as_of date, p_days int default 365)
returns jsonb
language plpgsql
stable
set search_path = public
set statement_timeout = '30s'
as $$
declare
  v_ch uuid;
  v_tid uuid;
  v_label text;
  v_avg numeric;
  v_n int;
begin
  v_label := case p_target when 'A2049' then '수도권 2049' when 'HH' then '전국 유료가구' end;
  select ch.id into v_ch from channels ch where ch.code = p_own_channel_code;
  select tg.id into v_tid from targets tg where tg.label = v_label;
  select avg(r.rating), count(*) into v_avg, v_n
  from ratings r
  where r.channel_id = v_ch
    and r.rating is not null
    and r.broadcast_date between p_as_of - p_days + 1 and p_as_of
    and ((p_own_channel_code = 'SKYUHD' and r.target_id is null and r.source_type = 'skyuhd')
      or (p_own_channel_code <> 'SKYUHD' and r.target_id = v_tid and r.source_type = 'nielsen_daily'));
  return jsonb_build_object('avg', v_avg, 'n', v_n);
end;
$$;
