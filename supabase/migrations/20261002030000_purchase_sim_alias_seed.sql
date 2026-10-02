-- 구매 시뮬레이터: 별칭 초기 적재(DB에 실제 존재하는 이름 규칙만, LLM 추론 금지).
--
-- 근거: 백테스트 하네스(2026-10-02)에서 DB 전체 이름을 조사해 "같은 프로그램의 이름 변형"으로 안전하게
-- 볼 수 있는 규칙 3가지를 골랐고(828건 채택, 152건 불채택), 그 규칙을 SQL로 옮겨 적재한다.
--  R1 label_paren : 원문이 "편성라벨(제목)" 꼴(예: 일일드라마(친절한선주씨)) → 제목으로 통합
--  R2 label_prefix: 키가 편성라벨+제목이고 제목 키가 별도로 8회 이상 존재할 때만 통합
--  R3 since       : SINCE####(방송 시작 연도 표기) 토큰만 다른 이름 통합
-- 불채택(후보로도 두지 않음): 숫자·시즌 접미(신병2/신병3은 다른 프로그램), 스페셜·특집·몰아보기·하이라이트·베스트·
-- 프리미어·미리보기·N부, 임의 포함 관계(나는SOLO ↔ 나는SOLO그후사랑은계속된다 등). 체인(전이적) 병합 없음.
-- 이 별칭은 confirmed 로 넣되 source=RULE_DB 라 관리자가 언제든 candidate 로 내리거나 삭제할 수 있다.

-- 편성 라벨 정규식(요일/채널 접두 + 장르 라벨). 키는 대문자 기준.
create or replace function purchase_label_re()
returns text
language sql
immutable
as $$
  select '^(KBS[12]?|MBC|SBS|JTBC|TVN|TV조선|TVCHOSUN|채널A|MBN|ENA|SBS플러스)?(특별기획)?(월화|수목|금토|토일|주말|일일|아침|저녁|평일|주중|월요|화요|수요|목요|금요|토요|일요)?(드라마|미니시리즈|시리즈|시트콤|연속극|스페셜다큐|스페셜|메디컬다큐|휴먼다큐|건강다큐|공간다큐|로망다큐|다큐멘터리|다큐)$'
$$;

-- R1: 경쟁사 원문 "라벨(제목)"
insert into program_alias (alias_key, group_key, rule, status, source, note)
select distinct on (a.alias_key) a.alias_key, a.group_key, 'label_paren', 'confirmed', 'RULE_DB', '편성 라벨(제목) 표기 — ' || a.raw
from (
  select purchase_norm_key(t.stripped) as alias_key,
         purchase_norm_key(substring(t.stripped from '\(([^)]+)\)\s*$')) as group_key,
         t.stripped as raw
  from (
    select distinct regexp_replace(c.program_name, '<[^>]*>', '', 'g') as stripped
    from competitor_program_target_ratings c
    where c.target_label = '개인2049'
      and c.program_name ~ '\([^)]+\)'
  ) t
  where t.stripped ~ '^[^(]+\([^)]+\)\s*$'
    and purchase_norm_key(substring(t.stripped from '^([^(]+)\(')) ~ purchase_label_re()
) a
where a.group_key <> '' and a.alias_key <> a.group_key
  and exists (select 1 from program_identity i where i.key = a.alias_key)
order by a.alias_key
on conflict (alias_key) do nothing;

-- R3: SINCE####
insert into program_alias (alias_key, group_key, rule, status, source, note)
select i.key, regexp_replace(i.key, 'SINCE[0-9]{4}', ''), 'since', 'confirmed', 'RULE_DB', 'SINCE 연도 표기만 다른 이름'
from program_identity i
where i.key ~ 'SINCE[0-9]{4}'
  and regexp_replace(i.key, 'SINCE[0-9]{4}', '') <> ''
  and not i.is_special
on conflict (alias_key) do nothing;

-- R2: 라벨+제목 키(제목 키가 별도로 8회 이상 존재할 때만)
insert into program_alias (alias_key, group_key, rule, status, source, note)
select i.key, m.rest, 'label_prefix', 'confirmed', 'RULE_DB', '편성 라벨 + 제목 키'
from program_identity i
cross join lateral (
  select (regexp_match(i.key, '^((?:KBS[12]?|MBC|SBS|JTBC|TVN|TV조선|TVCHOSUN|채널A|MBN|ENA|SBS플러스)?(?:특별기획)?(?:월화|수목|금토|토일|주말|일일|아침|저녁|평일|주중|월요|화요|수요|목요|금요|토요|일요)?(?:드라마|미니시리즈|시리즈|시트콤|연속극|스페셜다큐|스페셜|메디컬다큐|휴먼다큐|건강다큐|공간다큐|로망다큐|다큐멘터리|다큐))(.+)$'))[2] as rest
) m
where m.rest is not null
  and not i.is_special
  and exists (select 1 from program_identity j where j.key = m.rest and j.airings_total >= 8)
on conflict (alias_key) do nothing;

select apply_program_aliases();
