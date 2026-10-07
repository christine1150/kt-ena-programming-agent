// 단계 16 — 운영 시나리오 × daily/weekly/monthly 검증표(작업 2)와 출시 보류 후보. 연결 규칙은 traceability.ts와 같다.
// 월간은 실제 월간 파일 샘플이 없어 합성 검증만 있고 **실제 양식은 미검증**이다(어댑터 상태 '잠정'). 그 사실을 칸마다 구분해 적는다.
import type { TraceRef, TraceStatus } from "./traceability";

const T = (file: string, find: string): TraceRef => ({ file: `scripts/${file}`, find });
const ING = "test-nielsen-ingest.ts";
const MET = "test-metrics.ts";
const INS = "test-insight.ts";
const WRK = "test-workspace.ts";
const ADM = "test-admin-ops.ts";
const AVL = "test-avail.ts";
const O06 = "test-opt06.ts";
const RPT = "test-report-snapshot.ts";

export interface ScenarioCell {
  status: TraceStatus;
  refs: TraceRef[];
  note?: string;
}
export interface ScenarioRow {
  id: string;
  title: string;
  daily: ScenarioCell;
  weekly: ScenarioCell;
  monthly: ScenarioCell;
}

const MONTHLY_REAL = "실제 월간 파일 샘플 없음 — 합성 검증만, 실제 양식 미검증(어댑터 상태 '잠정')";
const monthlySynthetic = (refs: TraceRef[]): ScenarioCell => ({ status: "needs_real_data", refs, note: MONTHLY_REAL });

export const SCENARIOS: ScenarioRow[] = [
  {
    id: "S01", title: "정상 수신",
    daily: { status: "verified_original", refs: [T(ING, "실제 일간 파일 적재(대역 DB) 성공"), T(ING, "1차 적재 성공 + 개정 1")], note: "실제 파일 검사는 로컬 원본이 있을 때만 실행" },
    weekly: { status: "verified_original", refs: [T(ING, "주간 2시트 적재 성공(어댑터 검증됨)"), T(ING, "실제 주간 파일 적재")] },
    monthly: monthlySynthetic([T(ING, "월간 파일은 잠정 어댑터 상태로 표시")]),
  },
  {
    id: "S02", title: "누락일",
    daily: { status: "verified", refs: [T(MET, "부분 수신: 7일 중 6일 수신, 누락일 표시, complete=false"), T(ADM, "미수신 날짜(어제까지 기준 빠진 날)를 찾는다")] },
    weekly: { status: "verified", refs: [T(ADM, "주간 자료가 10일을 넘기면 지연"), T(MET, "누락일(10/2)을 0으로 채우지 않고 평균(0.2), 수신 2/3일·불완전 표시")] },
    monthly: { status: "partial", refs: [T(MET, "완결월 MoM: 진행 중인 10월을 빼고 9월 vs 8월(한 달 전체)"), T(WRK, "보기별 확정 상태: 주간은 공식 주간 리뷰가 있어야 확정")], note: "월 공식 파일이 없을 때 '확정이 아님'으로 표시하는 규칙은 확인했고, 실제 월간 파일 지연은 측정하지 못했다" },
  },
  {
    id: "S03", title: "수정본(같은 기간 재수신, 값 변경)",
    daily: { status: "verified", refs: [T(ING, "같은 날짜 수정본 → 개정 2 + 차이 1건 이상"), T(ING, "원장: 개정 2가 개정 1을 supersede")] },
    weekly: { status: "verified", refs: [T(ING, "주간 수정본 → 개정 2 + 차이 보고")] },
    monthly: monthlySynthetic([T(ING, "월간·주간 모두 프로그램 상세 불변")]),
  },
  {
    id: "S04", title: "잘못된 양식",
    daily: { status: "verified", refs: [T(ING, "필수 시트 없음 → 시트 이름이 담긴 오류"), T(ING, "날짜: 파일명과 시트가 다르면 적재 거부(다른 날 덮어쓰기 방지)"), T(ING, "엑셀이 아닌 파일은 오류로 거부(적재 없음)")] },
    weekly: { status: "verified", refs: [T(ING, "월~일이 아닌 7일 주간은 경고"), T(ING, "주간 형태: 월~일 7일이면 경고 없음, 아니면 경고")] },
    monthly: monthlySynthetic([T(ING, "어댑터 상태: 주간 검증됨 / 월간 잠정")]),
  },
  {
    id: "S05", title: "부분 반영(일부 테이블 실패)",
    daily: { status: "verified", refs: [T(ING, "경쟁채널 테이블 실패는 부분 성공(핵심 ratings는 반영)으로 표시"), T(ING, "ratings 삽입 실패 → 실패 보고 + '되돌렸습니다'")] },
    weekly: { status: "partial", refs: [T(ING, "주간 행은 nielsen_period_rank에만 저장")], note: "주간은 한 테이블에만 쓰므로 부분 반영 경로가 없고, 그 테이블 쓰기 실패 롤백은 일간 경로 테스트에 의존한다" },
    monthly: monthlySynthetic([T(ING, "월간 파일은 잠정 어댑터 상태로 표시")]),
  },
  {
    id: "S06", title: "이전 버전 복원",
    daily: { status: "partial", refs: [T(ING, "A→B→A 되돌리기 재업로드는 변경으로 처리(최신본이 B이므로 duplicate 아님)")], note: "이전 파일을 다시 올리면 새 개정으로 반영되는 방식 — 개정 번호를 되돌리는 화면 기능은 없다" },
    weekly: { status: "partial", refs: [T(ING, "주간 동일 파일 재수신 → duplicate, 행 수 불변")], note: "되돌리기 재업로드를 주간 경로에서 따로 시험하지는 않았다(같은 개정 로직 공유)" },
    monthly: monthlySynthetic([T(ING, "월간 파일은 잠정 어댑터 상태로 표시")]),
  },
  {
    id: "S07", title: "메일 중복 수신",
    daily: { status: "verified", refs: [T(ING, "동일 파일 재업로드 → 변경 없음(duplicate)"), T(ING, "메일 재시도: processed는 완료"), T(ING, "메일 재시도: 상한(3회) 도달은 dead-letter")] },
    weekly: { status: "verified", refs: [T(ING, "주간 동일 파일 재수신 → duplicate, 행 수 불변")] },
    monthly: monthlySynthetic([T(ING, "메일 재시도: processed는 완료")]),
  },
  {
    id: "S08", title: "목표 개정",
    daily: { status: "verified", refs: [T(ADM, "수동 목표 보호: 잠긴 목표를 Channel Master 파일이 덮지 못한다"), T(ADM, "잠금 해제 후에는 파일이 다시 반영되고 해제 이력이 남는다")], note: "목표는 일·주·월 공통(기준 정보) — 세 칸 모두 같은 근거" },
    weekly: { status: "verified", refs: [T(ADM, "수동 입력이 잠금과 변경 이력(변경자·근거·적용일)을 남긴다")] },
    monthly: { status: "verified", refs: [T(ADM, "새 수동 입력은 이전 잠금을 해제하고 유효 잠금은 하나만 남긴다")] },
  },
  {
    id: "S09", title: "Avail 개정",
    daily: { status: "needs_real_data", refs: [T(AVL, "A12 개정 후 기존 초안은 재검증 필요로 바뀐다")], note: "합성 자료로 통과, 실제 Avail 양식은 미검증" },
    weekly: { status: "needs_real_data", refs: [T(AVL, "A12 영향받는 슬롯(12월 슬롯)을 찾아 주고 상태가 나빠졌음을 표시")], note: "합성 자료로 통과, 실제 Avail 양식은 미검증" },
    monthly: { status: "needs_real_data", refs: [T(AVL, "A12 과거 snapshot은 얼려져 바뀌지 않는다")], note: "합성 자료로 통과, 실제 Avail 양식은 미검증(월간 보고의 권리 요약은 읽기 전용)" },
  },
  {
    id: "S10", title: "동시 예약",
    daily: { status: "partial", refs: [T(AVL, "A08 두 편성자가 동시에 마지막 1회를 잡으면 한 건만 성공")], note: "메모리 원장(합성)에서 확인. SQL 함수의 advisory lock은 코드 확인만이고 DB 동시 실행은 시험하지 못했다(H5)" },
    weekly: { status: "partial", refs: [T(O06, "화면이 본 버전과 다르면(다른 곳에서 수정) 확정 불가")], note: "확정 준비 검사의 버전 불일치 차단은 확인했다. DB 수준 동시 예약 보호는 승인 대기" },
    monthly: { status: "partial", refs: [T(AVL, "A08 원장에는 예약이 한 건만 남는다")], note: "월간 보고는 권리를 읽기만 하고 예약하지 않는다" },
  },
  {
    id: "S11", title: "모델·AI 실패",
    daily: { status: "verified", refs: [T(INS, "OpenAI 실패·타임아웃이면 null(호출부가 규칙 기반 문구 사용)"), T(INS, "API 키가 없으면 호출 없이 null")] },
    weekly: { status: "verified", refs: [T(RPT, "본문에 데이터 없는 항목은 그리지 않고 사유를 '전제·한계'에 남긴다")] },
    monthly: { status: "verified", refs: [T(RPT, "추천 결과가 없으면 비어 있다고 밝히고 오래됨으로 오인하지 않는다")], note: "AI 요약이 없어도 보고서는 생성되고 전제·한계에 사유가 남는다" },
  },
  {
    id: "S12", title: "빠른 필터 전환",
    daily: { status: "verified", refs: [T(WRK, "A→B→C로 빠르게 전환해도 응답이 어떤 순서로 와도 마지막 선택(C)의 값만"), T(WRK, "날짜가 바뀌면 홈 데이터 키가 바뀐다")] },
    weekly: { status: "verified", refs: [T(WRK, "홈은 일간·주간·월간 보기만 바꿔서는 데이터 키가 바뀌지 않는다")] },
    monthly: { status: "verified", refs: [T(WRK, "채널 데이터 키는 채널·기간·프리셋이 다르면 달라진다")] },
  },
];

/** 출시 보류 후보(RELEASE_READINESS.md와 같은 목록) */
export interface HoldItem {
  id: string;
  title: string;
  kind: "원본대조 불일치" | "기간 혼용" | "권리 위반" | "저장 유실" | "지역·타깃 혼용" | "승인 대기";
  detail: string;
  /** 해소 조건 */
  clearedBy: string;
}

export const HOLD_ITEMS: HoldItem[] = [
  { id: "H1", title: "경쟁 채널 가구 값의 지역 예외(KBS1·MBC·SBS=수도권) 미보존", kind: "지역·타깃 혼용", detail: "원본 'ENA경쟁채널시청률' A3에 가구 지표의 채널별 지역 예외가 적혀 있으나 파서는 이를 읽어 보존하지 않는다. 경쟁 채널 가구 값을 National 값과 같은 열에서 비교하면 지역이 섞인다.", clearedBy: "A3 문구를 읽어 채널별 지역을 보존하거나, 경쟁 채널 가구 비교 화면에 지역 주의 문구를 고정 표시 + 테스트" },
  { id: "H2", title: "실제 Avail 파일 양식 어댑터 미검증", kind: "권리 위반", detail: "A01~A19는 합성 자료로 통과했지만 실제 Avail 양식에서 열 매핑·해석이 맞는지는 실제 샘플이 있어야 확인된다. 그 전에는 모든 후보가 '권리 미확인'으로 표시된다(권리 위반을 막는 쪽으로 보수적).", clearedBy: "실제 Avail 샘플 1건 이상으로 어댑터 점검 + 결과표 갱신" },
  { id: "H3", title: "실제 월간 파일 양식 어댑터 미검증", kind: "원본대조 불일치", detail: "월간 어댑터는 '잠정'이며 월간 값을 공식으로 쓰는 화면은 표시로 구분한다. 실제 월간 파일로 대조하기 전에는 월간 공식 순위를 확정으로 단정하지 않는다.", clearedBy: "실제 월간 파일로 골든 대조 추가" },
  { id: "H4", title: "채택·검토·수집 원장 저장소 미적용", kind: "저장 유실", detail: "수집 원장(20261011)·관리자 운영 잠금·이력(20261012)·검토 기록(20261014)은 마이그레이션이 승인 대기라 지금은 저장되지 않는다(화면은 '미적용'으로 알리고 기존 동작은 유지). 채택 기록(OPT05) 저장소는 마이그레이션 파일도 아직 없다. 그래서 채택 이력·검토 이력·수동 목표 잠금이 쌓이지 않는다.", clearedBy: "마이그레이션 승인·적용 후 저장·복원 확인(적용 전 영향·rollback은 RELEASE_READINESS.md)" },
  { id: "H5", title: "편성안 동시 편집의 DB 보호 없음, 권리 예약 동시성은 DB에서 시험하지 못함", kind: "저장 유실", detail: "① 편성안 수정은 화면이 본 버전(baseSeq)을 보내 다른 곳의 수정을 감지하고 확정 준비 검사가 막지만, DB 버전 열은 승인 대기다. ② 권리 예약 원장의 SQL 함수(20261013, 적용됨)는 풀 단위 advisory lock으로 원자 처리하도록 작성돼 있으나 동시 실행은 메모리 원장(A08)으로만 시험했고 운영 DB에 시험 행을 쓰지는 않았다. 현재 화면에는 예약을 만드는 버튼이 없어(편성안이 '확정 대기'로 저장되는 흐름 없음) 실제 영향은 작다. 확정은 방송사 시스템에 반영되지 않는다.", clearedBy: "편성안 DB 버전 열 마이그레이션 승인 + 격리된 DB에서 권리 예약 동시성 시험" },
  { id: "H6", title: "구매 추천 갱신 멈춤", kind: "기간 혼용", detail: "주간 추천 갱신이 멈춰 추천 기준일이 분석 종료일보다 오래됐다(단계 13에서 화면에 '오래된 추천' 표시). 표시는 하지만 최신 추천이 아니다.", clearedBy: "GitHub secrets 확인(사용자) 후 갱신 재개" },
  { id: "H7", title: "예측 합격선 미승인", kind: "승인 대기", detail: "OPT05의 승격 합격선은 제안 상태다. 합격선 승인 전에는 모델 승격 판정(PASS)을 내리지 않는다.", clearedBy: "합격선 승인 후 실제 자료로 측정" },
  { id: "H8", title: "program_schedule_grid RLS 꺼짐(보안 수정 20261015 미적용)", kind: "승인 대기", detail: "주간 편성표 테이블에 RLS가 꺼져 있어 공개 anon 키로 읽기·쓰기·삭제가 가능했다는 Supabase 보안 경고에 대한 수정(멱등, 서버 service_role 접근은 영향 없음)이 승인 대기다. 가장 먼저 판단할 항목이다.", clearedBy: "20261015 승인·적용 후 anon 접근이 막히고 편성표 업로드·조회가 그대로 동작하는지 확인" },
];
