// 업로드 흐름 정책과 오류 형식(단계 05).
// 흐름: 감지 → 열/기간/타깃 미리보기 → 검증 → 기존값 차이/영향 → 반영 → 결과·복구.
// 자료 유형마다 "정상 행만 반영(valid_rows_only)"인지 "전체 원자 적용(all_or_nothing)"인지 정책을 명시한다.
// implemented는 코드에서 확인한 현재 상태이고, target은 다음에 맞출 정책이다 — 구현되지 않은 것을 구현됐다고 쓰지 않는다.
export type Atomicity = "all_or_nothing" | "valid_rows_only" | "replace_all";
export type Recovery = "auto_rollback" | "version_restore" | "reupload_only";

export interface UploadPolicy {
  id: string;
  label: string;
  api: string;
  /** 정책(목표) */
  target: { atomicity: Atomicity; preview: boolean; diff: boolean; recovery: Recovery; respectsLocks: boolean };
  /** 코드에서 확인한 현재 상태 */
  implemented: { preview: boolean; diff: boolean; recovery: Recovery; note: string };
  /** 같은 기간 수정 파일을 다시 올렸을 때의 동작 */
  samePeriodReupload: string;
}

export const UPLOAD_POLICIES: UploadPolicy[] = [
  {
    id: "nielsen",
    label: "Nielsen 시청률(일간·주간·월간)",
    api: "/api/admin/upload/nielsen",
    target: { atomicity: "all_or_nothing", preview: true, diff: true, recovery: "auto_rollback", respectsLocks: false },
    implemented: { preview: false, diff: true, recovery: "auto_rollback", note: "단계 01: 해시·기간 멱등성, 반영 전 일별 백업과 실패 시 복구, 같은 기간 개정(revision)·차이 기록. 미리보기 화면은 없음. 경쟁 시트 실패는 partial." },
    samePeriodReupload: "내용이 같으면 변경 없음, 다르면 개정 번호를 올리고 차이를 기록한 뒤 교체(일간만 ratings 교체).",
  },
  {
    id: "skyuhd",
    label: "skyUHD 수기 누적",
    api: "/api/admin/upload/skyuhd",
    target: { atomicity: "valid_rows_only", preview: true, diff: true, recovery: "reupload_only", respectsLocks: false },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "미래일은 null 유지. 미리보기·차이 표시 없음." },
    samePeriodReupload: "날짜 키 단위로 최신 파일 값으로 갱신.",
  },
  {
    id: "olife_epg",
    label: "EPG(일일운행표)",
    api: "/api/admin/upload/olife-epg",
    target: { atomicity: "valid_rows_only", preview: true, diff: true, recovery: "reupload_only", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "원본은 staging에 저장 후 닐슨과 ±60분 매칭. 매칭 실패·모호 후보는 단계 05의 미매칭 목록으로 노출." },
    samePeriodReupload: "(날짜·채널·시각·프로그램명·출처) 키로 최신값 덮어쓰기.",
  },
  {
    id: "schedule_grid",
    label: "주간 편성표",
    api: "/api/admin/upload/schedule-grid",
    target: { atomicity: "all_or_nothing", preview: true, diff: true, recovery: "version_restore", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "주 단위 교체(scheduleGridSource). 이전 버전 복구 없음." },
    samePeriodReupload: "같은 주는 새 파일로 교체.",
  },
  {
    id: "channel_master",
    label: "Channel Master(채널·경쟁채널·목표)",
    api: "/api/admin/upload/channel-master",
    target: { atomicity: "valid_rows_only", preview: true, diff: true, recovery: "version_restore", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "단계 05: 수동 잠금이 있는 목표는 덮어쓰지 않고 건너뜀(잠금 테이블이 적용된 환경). 경쟁채널은 채널별 삭제 후 재삽입." },
    samePeriodReupload: "채널 단위로 교체하되 수동 잠금 목표는 보존.",
  },
  {
    id: "target_goals",
    label: "목표 시청률(수동 입력)",
    api: "/api/admin/target-goals",
    target: { atomicity: "all_or_nothing", preview: false, diff: true, recovery: "version_restore", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "단계 05: 저장 시 수동 잠금과 변경 이력을 남김(테이블 적용 후)." },
    samePeriodReupload: "수동 입력이 항상 우선하며 Channel Master 재업로드로 덮이지 않음.",
  },
  {
    id: "manual_report",
    label: "PD 수동 회차 리포트",
    api: "/api/admin/upload/manual-drama-report, /api/admin/upload/manual-original-report",
    target: { atomicity: "valid_rows_only", preview: true, diff: true, recovery: "version_restore", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "같은 키로 upsert. PD 메모는 공식 시청률 사실을 덮지 않음(필드 우선순위 표)." },
    samePeriodReupload: "(프로그램·회차) 키로 갱신.",
  },
  {
    id: "monthly_trend",
    label: "월간 채널 추이 참고자료",
    api: "/api/admin/upload/monthly-reference-trend",
    target: { atomicity: "all_or_nothing", preview: true, diff: true, recovery: "version_restore", respectsLocks: false },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "월·채널 키 upsert. 월간 어댑터는 provisional." },
    samePeriodReupload: "월·채널 키로 갱신.",
  },
  {
    id: "market_ytd_rank",
    label: "누적 채널 순위",
    api: "/api/admin/upload/market-ytd-rank",
    target: { atomicity: "all_or_nothing", preview: true, diff: true, recovery: "version_restore", respectsLocks: false },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "upsert/insert." },
    samePeriodReupload: "기준일 키로 갱신.",
  },
  {
    id: "episode_catalog",
    label: "OLIFE 회차 카탈로그(EBS 콘텐츠 리스트)",
    api: "/api/admin/upload/olife-episode-catalog",
    target: { atomicity: "valid_rows_only", preview: true, diff: false, recovery: "reupload_only", respectsLocks: true },
    implemented: { preview: false, diff: false, recovery: "reupload_only", note: "회차 번호 시드와 연동." },
    samePeriodReupload: "회차 키로 갱신.",
  },
  {
    id: "avail",
    label: "Avail(콘텐츠별·채널별 권리)",
    api: "/api/admin/upload/avail",
    target: { atomicity: "valid_rows_only", preview: true, diff: true, recovery: "version_restore", respectsLocks: true },
    implemented: { preview: true, diff: true, recovery: "version_restore", note: "단계 06: 시트별 양식 감지·열 매핑 미리보기, 헤더가 맞지 않으면 거부, 기존 권리와의 차이(신규·개정·철회 후보·수동 충돌) 확인 후 확정 반영. 권리 revision은 쌓기만 하며 실패 시 이번 배치분만 되돌림. 마이그레이션 적용 후 동작." },
    samePeriodReupload: "같은 행(원본 열 해시 동일)은 변화 없음, 내용이 바뀐 행은 새 revision이 이전 revision을 대체(이전 revision은 보존). 증분 파일에서 빠진 행은 철회가 아님, 전체 스냅샷은 대상 범위 확정 후 철회 후보로만 표시.",
  },
  {
    id: "news",
    label: "주요 뉴스(전체 텍스트 교체)",
    api: "/api/admin/news",
    target: { atomicity: "replace_all", preview: true, diff: true, recovery: "version_restore", respectsLocks: false },
    implemented: { preview: true, diff: true, recovery: "version_restore", note: "단계 05: 저장 전 미리보기(추가·삭제·유지 건수), 교체 전 이전 버전 보관·복구(버전 테이블 적용 후), 삽입 실패 시 이전 목록으로 자동 되돌림. 저장은 즉시 게시이며 화면에 표시." },
    samePeriodReupload: "항상 전체 교체.",
  },
];

export interface UploadIssue {
  file: string;
  sheet: string | null;
  /** 1부터 시작하는 행 번호. 행과 무관하면 null */
  row: number | null;
  column?: string | null;
  cause: string;
  /** 어떻게 고치면 되는지 예시 */
  example: string | null;
  severity: "error" | "warning";
}

/** 오류 한 건을 "파일 / 시트 / 행 / 원인 / 수정 예시" 한 줄로 만든다. */
export function formatUploadIssue(i: UploadIssue): string {
  const where = [i.file, i.sheet ? `시트 ${i.sheet}` : null, i.row !== null ? `${i.row}행` : null, i.column ? `${i.column} 열` : null].filter(Boolean).join(" · ");
  return `${i.severity === "error" ? "오류" : "경고"}: ${where} — ${i.cause}${i.example ? ` (예: ${i.example})` : ""}`;
}

export interface RowOutcome {
  row: number;
  ok: boolean;
  issue?: Omit<UploadIssue, "file" | "sheet" | "row">;
}

/**
 * 유형별 정책에 따라 반영할 행을 정한다.
 * all_or_nothing/replace_all: 한 행이라도 오류면 아무것도 반영하지 않는다. valid_rows_only: 정상 행만 반영하고 오류 행은 목록으로 돌려준다.
 */
export function planApplication(atomicity: Atomicity, rows: RowOutcome[], ctx: { file: string; sheet: string | null }): { applyRows: number[]; skipped: UploadIssue[]; blockedAll: boolean } {
  const bad = rows.filter((r) => !r.ok);
  const issues: UploadIssue[] = bad.map((r) => ({
    file: ctx.file,
    sheet: ctx.sheet,
    row: r.row,
    column: r.issue?.column ?? null,
    cause: r.issue?.cause ?? "알 수 없는 오류",
    example: r.issue?.example ?? null,
    severity: r.issue?.severity ?? "error",
  }));
  if (atomicity !== "valid_rows_only" && bad.length > 0) return { applyRows: [], skipped: issues, blockedAll: true };
  return { applyRows: rows.filter((r) => r.ok).map((r) => r.row), skipped: issues, blockedAll: false };
}
