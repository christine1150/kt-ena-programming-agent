-- 전 채널 분석 1단계 — IPTV 작품(program_key)별 장르 표(2026-11-10 사용자 승인 "추정까지 확장").
-- program_genre_map(관리자·검색 분류)을 정규화 이름으로 맞춘 값(source=MAP)을 우선하고, 없는 작품은 제목 키워드(GUESS_RULE) →
-- 방영 채널의 장르 분포(GUESS_CHANNEL, 신뢰도 낮음) 순으로 추정한다. 추정은 반드시 source 로 구분하며 확인 전에는 판정 근거로 쓰지 않는다.
-- 분석 보조용 신규 테이블(기존 테이블·함수는 건드리지 않음). 서버(service_role)만 접근.
create table if not exists iptv_program_genre (
  program_key text primary key,
  genre text not null,
  source text not null check (source in ('MAP', 'GUESS_RULE', 'GUESS_CHANNEL', 'NONE')),
  confidence numeric,
  note text,
  updated_at timestamptz not null default now()
);
comment on table iptv_program_genre is 'IPTV program_key 별 장르. MAP=program_genre_map 일치, GUESS_RULE=제목 키워드 추정, GUESS_CHANNEL=방영 채널 장르 분포 추정(낮은 신뢰). 추정은 확인 후 MAP 으로 승격.';
alter table iptv_program_genre enable row level security;

-- 군 분석 결과에 장르를 붙이는 보조 뷰: 작품 단위 방영 분 기준 장르 구성(채널 × 장르)
create or replace function iptv_group_genre_mix(p_group text, p_target text, p_from date, p_to date)
returns table (channel_name text, genre text, airing_minutes bigint, share numeric, guess_share numeric)
language sql stable security definer set search_path = public
as $$
  with b as (
    select m.channel_name cn, coalesce(g.genre, '미분류') gn, m.duration_min dm, coalesce(g.source, 'NONE') src
    from iptv_airing_metrics m
    join iptv_peer_groups p on p.group_key = p_group and p.iptv_channel_name = m.channel_name
    left join iptv_program_genre g on g.program_key = m.program_key
    where m.target_kind = p_target and m.broadcast_date between p_from and p_to and m.duration_min > 0
  )
  select cn, gn, sum(dm)::bigint,
    round(sum(dm)::numeric / sum(sum(dm)) over (partition by cn), 4),
    round((sum(dm) filter (where src like 'GUESS%'))::numeric / nullif(sum(dm), 0), 4)
  from b group by cn, gn;
$$;
revoke all on function iptv_group_genre_mix(text, text, date, date) from public, anon, authenticated;
