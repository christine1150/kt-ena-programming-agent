-- 사용자 제보(2026-08-26): "1페이지 주요 컨텐츠 리뷰에서 신병4사보타주가 1~2회 방송 중인데
-- 직전 라인업(그대에게 드림) 평균 비교 문구가 안 나온다" — 조사 결과 두 가지 독립된 버그.
--
-- 버그 1) 주요 콘텐츠 관리 화면(featured-content 등록 API)이 programs 테이블을
-- (channel_id, canonical_name) 정확 문자열로 upsert했는데, 관리자가 입력한 표기
-- ("그대에게 드림", "신병4: 사보타주" — 공백·콜론 포함)가 실제 Nielsen 데이터가 붙는
-- canonical_name("그대에게드림", "신병4사보타주" — 공백·문장부호 없음, CLAUDE.md 프로그램명
-- 매칭 원칙)과 문자열이 달라 매칭에 실패, ratings가 0건인 새 programs 행이 별도로 생겼다
-- (실측: "그대에게 드림" 행 ratings 0건 vs "그대에게드림" 행 2,057건). get_previous_drama_
-- baseline은 featured_content.program_id로 ratings를 찾으므로 평균이 항상 NULL이었다.
-- → featured_content.program_id를 실제 Nielsen 데이터가 붙은 programs.id로 재지정
-- (TypeScript 등록 로직 자체의 재발 방지는 별도 커밋의 정규화 매칭으로 처리).
update featured_content
set program_id = '57cffd46-4ff6-4264-ad0a-946bbf32634c' -- 그대에게드림(ENA, Nielsen 원본, ratings 2057건)
where id = '672ad60a-70b7-40e2-ac35-c744f5f71ca1';

update featured_content
set program_id = '770ec65f-a294-47a4-a24b-11921463aa0d' -- 신병4사보타주(ENA, Nielsen 원본)
where id = '795cd97a-c7c4-4f33-ae54-69e9e671576a';

-- 버그 2) "아너: 그녀들의 법정"(ENA 월·화 22시, 그대에게 드림 이전 작품) 항목이
-- broadcast_end_date가 비어있어(NULL="아직도 방영 중") 이후 슬롯을 차지한 모든 작품
-- (클라이맥스→허수아비→닥터 섬보이→그대에게 드림→신병4:사보타주)과 함께 매일 중복 카드로
-- 노출되는 부작용이 있었다. 정확한 종영일 기록이 없어 다음 작품(클라이맥스, 2026-03-16
-- 시작) 시작 하루 전으로 상한만 잡는다(정확한 날짜를 알면 관리자 화면에서 직접 수정 가능 —
-- 추정치이지 확정값이 아님을 명시).
update featured_content
set broadcast_end_date = '2026-03-15'
where id = '7767adb3-13fc-43de-84d7-7bbabd871db6'; -- 아너: 그녀들의 법정

-- 참고(수정하지 않음): "크래시2 : 분노의 도로"(id ecbe19ab-7e1c-4142-ac07-7dc2575546bc)도
-- 같은 슬롯에 있으나 broadcast_start_date/end_date가 둘 다 비어 있어 상한을 추정할 근거조차
-- 없다 — 임의 날짜를 넣지 않고 그대로 두었다(관리자 화면에서 실제 방영 여부·기간 확인 후
-- 직접 정리 필요).
