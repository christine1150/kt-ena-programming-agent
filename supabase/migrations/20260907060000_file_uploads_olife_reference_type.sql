-- olife_reference_metrics 업로드 이력을 file_uploads에 기록할 수 있도록 file_type 허용값에
-- 'olife_reference' 추가 (20260821121000과 동일한 패턴 — 기존 제약 갱신은 새 마이그레이션으로).
alter table file_uploads drop constraint file_uploads_file_type_check;
alter table file_uploads add constraint file_uploads_file_type_check check (
  file_type in ('nielsen_daily','skyuhd','annual_2025','target_rating','channel_master','competitor_master','market_ytd_rank','olife_reference')
);
