-- 사용자 지시(2026-09-28): "캐리어하나로떠나는주문짐쌀라비움이 정식 명칭이고, 에이전트
-- 상에서는 '짐쌀라비움'만 보이면 돼. 둘 다 한 프로그램으로 인식해줘."
--
-- programs.canonical_name은 Nielsen 원본 매칭 키라서 바꾸면 안 된다(정규화 기준으로만
-- 비교되므로 "짐쌀라비움"으로 바꾸면 내일부터 올라오는 Nielsen 파일의 실제 문구
-- "캐리어하나로떠나는주문짐쌀라비움"과 더 이상 매칭되지 않아 또 새 programs 행이 생긴다).
-- 즉 "정식 명칭 유지"와 "화면엔 짧게 표시"는 canonical_name 하나로는 동시에 만족할 수
-- 없다 — get_original_content_daily가 Page 1 표시명(featured_display_name)으로 그동안
-- programs.canonical_name을 그대로 돌려주고 있었기 때문이다. 화면 표시 전용 override
-- 컬럼을 featured_content에 따로 둔다.
alter table featured_content add column if not exists display_name text;
comment on column featured_content.display_name is 'Page 1 표시 전용 이름(선택). 비어 있으면 programs.canonical_name을 그대로 쓴다. Nielsen 매칭에는 전혀 쓰이지 않는다 — canonical_name은 절대 이 값으로 바꾸지 않는다.';
