-- 사용자 지시(2026-10-01): "'송영주의 재즈 포레스트'는 Jazz로 검색해보면 비슷한 이름의 방영 내역이 있을거야. 그걸로 반영해. 같은 프로그램임"
-- 주요 콘텐츠 관리가 가리키던 programs 행("송영주의 재즈 포레스트", ENA PLAY)은 방영 데이터가 0건이고, 실제 닐슨 데이터는
-- 원본 표기 "LIVEJAZZSESSIONJAZZFOREST"(ENA PLAY, 34건)로 들어온다. 엑스 더 리그(20260907020000)와 같은 방식으로
-- featured_content만 실제 데이터 행으로 재연결하고, 화면 이름은 display_name으로 유지한다(canonical_name을 바꾸면
-- 다음 적재부터 새 고아 행이 생김).
update featured_content
set program_id = '0f3fc186-e406-4d52-a1c2-87d705267242', -- LIVEJAZZSESSIONJAZZFOREST(ENA PLAY, 방영 데이터 보유)
    display_name = coalesce(display_name, '송영주의 재즈 포레스트')
where program_id = '4914443f-2591-49e0-b0f1-8c3aee664f1b'; -- 송영주의 재즈 포레스트(ENA PLAY, 방영 데이터 0건)

delete from programs where id = '4914443f-2591-49e0-b0f1-8c3aee664f1b';
