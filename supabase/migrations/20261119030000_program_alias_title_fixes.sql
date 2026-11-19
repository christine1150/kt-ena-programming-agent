-- 프로그램 이름 표기 오류로 갈라진 작품 합치기(2026-11-19, 프로그램 성과 점검).
-- 근거: program_identity 전체를 (1) 표기 변형, (2) 한 글자 차이, (3) 번호 없는 제목↔'시즌1', (4) 포함 관계로 훑어, 방영 기간·채널이 겹치는 것만 골랐다.
-- 합치는 것: 오타·글자 누락(같은 날짜·같은 채널), 번호 없는 제목이 '시즌1'과 같은 채널·기간에 있는 경우, 방영일·횟수가 완전히 같은 부제 유무 쌍.
-- 합치지 않는 것: 부제·코너가 붙어 별개 편성물일 수 있는 포함 관계(나는SOLO↔그후사랑은계속된다, 놀라운토요일↔예능신대륙개척 등) — 사람이 확인할 때까지 후보로만 둔다.
-- 모두 manual·confirmed 이고 DB에 두 키가 실제 존재할 때만 들어가며, 관리자가 언제든 지우거나 candidate 로 내릴 수 있다. 체인 병합 없음(대표 키가 다른 별칭의 키면 건너뜀).

insert into program_alias (alias_key, group_key, rule, status, source, note)
select v.alias_key, v.group_key, v.rule, 'confirmed', 'MANUAL', v.note
from (values
  ('냉장고를보탁해', '냉장고를부탁해', 'typo', '오타(보탁해→부탁해) — ENA Story 2026-09-19 3회'),
  ('벨그레이비어넥스트챕터', '벨그레이비어더넥스트챕터', 'typo', '글자 누락(더) — 같은 채널·같은 기간'),
  ('해밍턴가꿈의옷장', '해밍턴가의꿈의옷장', 'typo', '글자 누락(의) — 같은 채널·같은 기간'),
  ('신병시즌2몰아보기', '신병2몰아보기', 'season_label', '시즌 표기 차이(시즌2↔2)'),
  ('청춘노래자랑', '청춘노래자랑시즌1', 'bare_season1', '번호 없는 제목 = 시즌1 — ENA Story 같은 기간'),
  ('로앤오더토론토크리미널인텐트', '로앤오더토론토크리미널인텐트시즌1', 'bare_season1', '번호 없는 제목 = 시즌1 — ONCE 같은 기간'),
  ('스위트피', '스위트피시즌1', 'bare_season1', '번호 없는 제목 = 시즌1(시즌2 없음)'),
  ('밥상학개론', 'WELCOME밥상학개론', 'subtitle', '부제 유무 — 방영일·횟수 동일'),
  ('오페라하우스', '당신이있는그곳오페라하우스', 'subtitle', '부제 유무 — 방영일·횟수 동일'),
  ('아이돌파견근무', '힘든당신을위한아이돌파견근무', 'subtitle', '부제 유무 — 방영일·횟수 동일'),
  ('잘살아보시개', '유기견가족만들기잘살아보시개', 'subtitle', '부제 유무 — 방영일·횟수 동일')
) as v(alias_key, group_key, rule, note)
where exists (select 1 from program_identity i where i.key = v.alias_key)
  and exists (select 1 from program_identity i where i.key = v.group_key)
  and not exists (select 1 from program_alias x where x.alias_key = v.group_key)
on conflict (alias_key) do nothing;

select apply_program_aliases();
