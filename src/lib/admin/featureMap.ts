// 관리자 화면 기능 위치표(단계 05) — 기존 관리자 화면의 모든 기능이 어디로 가는지(유지/이동/통합) 한 표로 고정한다.
// 소스: src/app/admin/page.tsx와 컴포넌트, src/app/api/admin/**. 화면 스크린샷이 아니라 실제 코드 기준이다.
import type { AdminAction } from "./permissions";

export type Disposition = "유지" | "이동" | "통합";
export type FeatureGroup = "수신·반영 현황" | "매일 올리는 자료" | "1페이지 반영 내용" | "편성표 검토" | "기준 정보" | "점검·이력";

export interface AdminFeature {
  id: string;
  name: string;
  component: string | null;
  page: string | null;
  apis: string[];
  group: FeatureGroup;
  minRole: AdminAction;
  disposition: Disposition;
  /** 새 위치·변경 내용 */
  destination: string;
  /** 즉시 게시처럼 사용자가 알아야 하는 동작 */
  note?: string;
}

export const ADMIN_FEATURES: AdminFeature[] = [
  { id: "nielsen", name: "Nielsen 시청률 업로드", component: "NielsenUploader", page: null, apis: ["/api/admin/upload/nielsen"], group: "매일 올리는 자료", minRole: "upload", disposition: "유지", destination: "수신 현황 표 바로 아래. 일간·주간·월간 자동 분류, 변경 없음·개정·부분 반영 결과 표시(단계 01)." },
  { id: "skyuhd", name: "skyUHD 시청률 업로드", component: "SkyUhdUploader", page: null, apis: ["/api/admin/upload/skyuhd"], group: "매일 올리는 자료", minRole: "upload", disposition: "유지", destination: "수신 현황의 skyUHD 행과 연결." },
  { id: "olife_epg", name: "OLIFE EPG 업로드", component: "OlifeEpgUploader", page: null, apis: ["/api/admin/upload/olife-epg"], group: "매일 올리는 자료", minRole: "upload", disposition: "유지", destination: "업로드 결과에 미매칭·모호 후보 목록(미매칭 큐) 추가." },
  { id: "news", name: "주요 뉴스 관리(베타)", component: "DailyNewsManager", page: null, apis: ["/api/admin/news"], group: "1페이지 반영 내용", minRole: "approve", disposition: "유지", destination: "저장 전 미리보기, 이전 버전 복구 추가.", note: "저장하면 즉시 게시됩니다(검토·게시 상태 분리는 후속)." },
  { id: "featured", name: "주요 콘텐츠 관리", component: "FeaturedContentManager", page: null, apis: ["/api/admin/featured-content", "/api/admin/featured-content/[id]"], group: "1페이지 반영 내용", minRole: "approve", disposition: "유지", destination: "위치 유지. 저장은 즉시 반영." },
  { id: "manual_report", name: "PD 수동 회차 리포트 업로드", component: "ManualReportUploader", page: null, apis: ["/api/admin/upload/manual-drama-report", "/api/admin/upload/manual-original-report"], group: "1페이지 반영 내용", minRole: "upload", disposition: "유지", destination: "드라마·예능 양식 통합 카드 유지. PD 메모는 공식 시청률을 덮지 않는 필드로 분리." },
  { id: "monthly_trend", name: "월간 채널 추이 자료 업로드", component: "MonthlyReferenceTrendUploader", page: null, apis: ["/api/admin/upload/monthly-reference-trend"], group: "1페이지 반영 내용", minRole: "upload", disposition: "유지", destination: "위치 유지(월간 어댑터 provisional 표시)." },
  { id: "schedule_grid", name: "주간 편성표 업로드", component: "ScheduleGridUploader", page: "/admin/schedule-grid", apis: ["/api/admin/upload/schedule-grid", "/api/admin/schedule-grid/data", "/api/admin/schedule-grid/export", "/api/admin/schedule-grid/weeks"], group: "편성표 검토", minRole: "upload", disposition: "유지", destination: "위치 유지. 내보내기는 편성자 이상(export)." },
  { id: "channel_master", name: "Channel Master 업로드", component: "ChannelMasterUploader", page: null, apis: ["/api/admin/upload/channel-master", "/api/admin/channels"], group: "기준 정보", minRole: "master_edit", disposition: "유지", destination: "수동 잠금 목표를 덮어쓰지 않음(단계 05)." },
  { id: "target_goals", name: "목표 시청률 관리", component: "TargetGoalsManager", page: null, apis: ["/api/admin/target-goals"], group: "기준 정보", minRole: "master_edit", disposition: "유지", destination: "저장 시 수동 잠금·변경 이력 기록(단계 05)." },
  { id: "market_ytd_rank", name: "누적 채널 순위 업로드", component: "MarketYtdRankUploader", page: null, apis: ["/api/admin/upload/market-ytd-rank"], group: "기준 정보", minRole: "upload", disposition: "유지", destination: "위치 유지." },
  { id: "episode_catalog", name: "OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 업로드", component: "OlifeEpisodeCatalogUploader", page: null, apis: ["/api/admin/upload/olife-episode-catalog"], group: "기준 정보", minRole: "upload", disposition: "유지", destination: "위치 유지." },
  { id: "avail", name: "Avail(콘텐츠·채널 권리) 관리", component: "AvailManager", page: null, apis: ["/api/admin/upload/avail", "/api/admin/avail", "/api/admin/avail/template", "/api/admin/avail/ledger"], group: "기준 정보", minRole: "rights_edit", disposition: "통합", destination: "기준 정보에 신설(단계 06). 표준 양식·열 매핑 미리보기·권리 반영·확인 대기(해석·메모·승인·중복)·보충 속성(1st window)을 한 카드에서 처리.", note: "Avail 업로드는 미리보기를 거친 뒤 확정해야 반영됩니다. 마이그레이션 적용 전에는 반영할 수 없습니다." },
  { id: "genre_map", name: "장르 분류 보완", component: "GenreMapManager", page: null, apis: ["/api/admin/program-genre"], group: "기준 정보", minRole: "approve", disposition: "유지", destination: "분류율 표시를 내림·미분류 건수 병기로 수정(단계 05)." },
  { id: "mail_ingestion", name: "Nielsen 메일 자동 수집", component: "MailIngestionManager", page: null, apis: ["/api/admin/mail-ingestion/run", "/api/admin/mail-ingestion/status"], group: "점검·이력", minRole: "upload", disposition: "유지", destination: "연결 상태·마지막 성공·오류만 표시, 설정 절차는 기술 문서로 이동(단계 05)." },
  { id: "login_history", name: "로그인 이력", component: null, page: "/admin/login-history", apis: [], group: "점검·이력", minRole: "view", disposition: "유지", destination: "상단 링크 유지." },
  { id: "ask_gaps", name: "질문하기 사각지대", component: null, page: "/admin/ask-gaps", apis: [], group: "점검·이력", minRole: "view", disposition: "유지", destination: "상단 링크 유지." },
  { id: "data_status", name: "자료 수신·반영 현황", component: "DataStatusPanel", page: null, apis: ["/api/admin/data-status"], group: "수신·반영 현황", minRole: "view", disposition: "통합", destination: "관리자 첫 화면 최상단 신설(단계 05). 업로드 카드의 결과를 채널×자료종류로 모아 보여 줌." },
];

/** 위치표에 없는 관리자 컴포넌트·API를 찾는 데 쓴다(테스트). */
export function featureApis(): string[] {
  return ADMIN_FEATURES.flatMap((f) => f.apis);
}
export function featureComponents(): string[] {
  return ADMIN_FEATURES.flatMap((f) => (f.component ? [f.component] : []));
}
