-- market_ytd_rank_snapshot 업로드 이력을 file_uploads에 기록할 수 있도록 file_type 허용값에
-- 'market_ytd_rank' 추가.
alter table file_uploads drop constraint file_uploads_file_type_check;
alter table file_uploads add constraint file_uploads_file_type_check check (
  file_type in ('nielsen_daily','skyuhd','annual_2025','target_rating','channel_master','competitor_master','market_ytd_rank')
);
