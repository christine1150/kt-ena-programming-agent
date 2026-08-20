-- 로고 이미지마다 투명 여백 비율이 달라, 같은 렌더링 높이로 그려도 실제 "색이 있는 부분"의
-- 높이가 채널마다 다르게 보이는 문제를 고친다. 로고 PNG의 투명 픽셀을 뺀 실제 보이는 부분의
-- 세로 비율(0~1)을 미리 계산해 저장해두고, 화면에서 그 비율로 렌더링 높이를 보정한다
-- (ENA 로고의 "보이는 높이"를 기준으로 다른 채널 로고들의 렌더링 높이를 맞춤).
alter table channels add column if not exists logo_visible_ratio numeric;
alter table channels add column if not exists logo_visible_top_ratio numeric;
comment on column channels.logo_visible_ratio is '로고 PNG에서 투명 픽셀을 제외한 실제 보이는 부분의 세로 비율(0~1). Channel Master 업로드 시 로고 파일과 함께 자동 계산.';
comment on column channels.logo_visible_top_ratio is '로고 PNG에서 보이는 부분이 시작하는 위치의 세로 비율(0~1, 위에서부터). logo_visible_ratio와 함께 화면에서 로고를 확대·잘라내는 데 쓰인다.';
