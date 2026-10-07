// 단계 16 — 통합 수용 체크리스트(04) · 원본 대조 14건과 파서 예외(03) · 검수 발견사항 F01~F19 · Avail A01~A19 추적표.
// 각 항목을 실제 테스트의 검사 이름(문자열 일부)에 연결한다. scripts/test-traceability.ts가 연결한 검사가 파일에 실제로 있는지,
// 통과로 표시한 항목이 근거 없이 비어 있지 않은지, 미검증 항목에 사유가 있는지 확인하고 docs/agent-improvement/TRACEABILITY.md가 이 표와 같은지 본다.
//
// 상태(status) 뜻:
//  verified            자동 테스트가 합성·코드 수준에서 확인(실행하면 통과)
//  verified_original   로컬 원본 파일(저장소 밖 `Nielsen Data/…`)이 있을 때만 실행되는 검사로 확인(파일이 없으면 SKIP이므로 통과가 아님)
//  partial             일부 측면만 검증(note에 어디까지인지)
//  needs_real_data     실제 자료(월간 파일·Avail 실제 양식 등)가 없어 합성으로만 확인, 실제 양식은 미검증
//  not_done            구현하지 않았거나 검증하지 못함(note에 이유·다음 단계)
export type TraceStatus = "verified" | "verified_original" | "partial" | "needs_real_data" | "not_done";
export interface TraceRef {
  file: string;
  /** 그 파일 안에 있어야 하는 검사 이름의 일부 */
  find: string;
}
export interface TraceItem {
  id: string;
  group: string;
  title: string;
  status: TraceStatus;
  refs: TraceRef[];
  note?: string;
}

const T = (file: string, find: string): TraceRef => ({ file: `scripts/${file}`, find });
const ING = "test-nielsen-ingest.ts";
const MET = "test-metrics.ts";
const BRD = "test-broadcast-time.ts";
const INS = "test-insight.ts";
const WRK = "test-workspace.ts";
const ADM = "test-admin-ops.ts";
const AVL = "test-avail.ts";
const O02 = "test-opt02.ts";
const O03 = "test-opt03.ts";
const O04 = "test-opt04.ts";
const O05 = "test-opt05.ts";
const O06 = "test-opt06.ts";
const IDL = "test-ideal-schedule.ts";
const RPT = "test-report-snapshot.ts";
const PRT = "test-portfolio.ts";
const PUR = "test-purchase-review.ts";
const UIP = "test-ui-polish.ts";

export const CHECKLIST: TraceItem[] = [
  // ── 데이터 ──
  { id: "D01", group: "데이터", title: "일간 10시트·주간 2시트 분류, 주간 상세 없음 표시", status: "verified_original",
    refs: [T(ING, "주간 2시트 적재 성공(어댑터 검증됨)"), T(ING, "주간 입력은 programs·ratings를 만들지도 지우지도 않음"), T(ING, "실제 일간 파일 파싱(10/4"), T(ING, "실제 주간 파일 파싱(2시트")],
    note: "실제 파일 두 개는 저장소에 없고 로컬 폴더가 있을 때만 실행된다. 합성 파일 검사는 항상 실행된다." },
  { id: "D02", group: "데이터", title: "원본 대조 14건의 타깃·기간·시청률·공식 순위·출처 일치", status: "verified_original",
    refs: [T(ING, "원본 14개 채널·기간 골든"), T(MET, "원본 ENA 주간: 수도권2049 0.11358%·7위"), T(MET, "공식 주간 값이 있으면 순위는 공식 7위")],
    note: "일간 8건은 파서 출력, 주간 6건은 화면용 주간 보기까지 대조한다. 로컬 원본 파일 필요(없으면 SKIP)." },
  { id: "D03", group: "데이터", title: "ENA Play 2039/2049 열 역전·다중 채널 블록·총계행·지역 예외·0/빈칸·문자/Excel 시간", status: "partial",
    refs: [T(ING, "ENA PLAY 헤더 순서가 바뀌어도(D=2049/I=2039)"), T(ING, "다중 채널 시트: 블록 헤더로 채널을 구분"), T(ING, "하루전체 행은 프로그램이 아니라 채널 집계"), T(ING, "빈 셀=결측(null), 숫자 0=관측값 0 구분"), T(ING, "엑셀 일수 실수 시간·24시 이상 시간이 시계 시각으로 정규화"), T(ING, "문자열 '25:30:00'도 같은 결과")],
    note: "지역 예외(ENA경쟁채널시청률 A3의 'KBS1·MBC·SBS는 수도권 기준')를 source override로 보존하는 코드와 테스트는 없다 — 출시 보류 후보 H1(RELEASE_READINESS.md)." },
  { id: "D04", group: "데이터", title: "동일 파일·메일 재수신 중복 없음, 수정본 버전 관리, 부분 실패 원자성, 복구", status: "verified",
    refs: [T(ING, "동일 파일 재업로드 → 변경 없음(duplicate)"), T(ING, "같은 날짜 수정본 → 개정 2"), T(ING, "ratings 삽입 실패 → 실패 보고"), T(ING, "롤백: 실패 후 ratings가 실패 전과 동일"), T(ING, "A→B→A 되돌리기 재업로드는 변경으로 처리"), T(ING, "메일 재시도: processed는 완료"), T(ING, "경쟁채널 테이블 실패는 부분 성공")],
    note: "이전 버전 복원은 '이전 파일을 다시 올리면 새 개정으로 반영'(되돌리기 재업로드)이다 — 개정 번호를 되돌리는 화면 기능은 없다." },
  { id: "D05", group: "데이터", title: "공식 기간값·일간 파생 잠정·회차 평균·시간 가중값·일별 순위 평균 구분", status: "verified",
    refs: [T(MET, "공식 기간 순위 표기: 7위"), T(MET, "순위는 항상 정수: 일별 순위 평균 41.1"), T(MET, "같은 타깃·기간이라도 공식과 잠정은 결합 불가"), T(BRD, "시간가중: 20시에 A 900초(0.2)+B 2700초(0.1) → 0.125")] },
  { id: "D06", group: "데이터", title: "Reach·점유율·시청시간 비율을 단순 합산·잘못 평균하지 않음, metric별 단위·계산 가능 조건", status: "verified",
    refs: [T(MET, "Reach를 일간 값으로 합산·평균하지 않음(null)"), T(MET, "정책: 점유율·Reach·시청시간은 여러 날 값으로 파생 불가"), T(UIP, "지표 이름·단위 사전은 표준 용어")] },
  // ── 분석 ──
  { id: "M01", group: "분석", title: "ENA 2026-09-28~10-04 수도권 2049 0.11358%·공식 7위, 가구 12위 혼합 금지", status: "verified_original",
    refs: [T(MET, "F01: ENA 주간 수도권2049 0.11358/7위, 전국가구 0.31771/12위는 서로 다른 문맥"), T(MET, "원본 ENA 주간: 수도권2049 0.11358%·7위")] },
  { id: "M02", group: "분석", title: "시작 시간 8시 방송 0건 ≠ 8시 실제 시청률 0, 추정·원자료 해상도 표시", status: "verified_original",
    refs: [T(BRD, "07:54:58~09:01:07 방송은 8시 구간에 겹쳐"), T(BRD, "시작 시각별 평균은 별도 metric: 8시에 시작한 방송이 없으므로 null"), T(BRD, "방법·한계가 메타데이터에 명시"), T(BRD, "원본 ENA PLAY 2049: 07:54:58~09:01:07(0.07742) 방송이 8시 추정에 반영")] },
  { id: "M03", group: "분석", title: "38초 겹침이 대표 경쟁 관계로 과장되지 않음", status: "verified_original",
    refs: [T(BRD, "38초 겹침은 대표 경쟁작이 아님"), T(BRD, "원본 값으로 계산해도 교집합 38초·대표 경쟁작 아님")] },
  { id: "M04", group: "분석", title: "전주/12주, 값/증감, %/%p/지수, 연령별 rating/구성비 검증", status: "verified",
    refs: [T(MET, "값 차이(%p)와 상대 변화(%)를 분리"), T(INS, "전주 vs 12주: 12주 기준 값을 '전주 대비'로 쓰면 차단"), T(INS, "153.8 지수는 기준 대비 53.8% 높은 수준"), T(INS, "% 값을 %p로 쓰면 차단"), T(INS, "구성비 근거 없이 핵심 시청층을 단정하면 차단")] },
  { id: "M05", group: "분석", title: "홈·상세·그룹·보고서 같은 context에서 Action 일관성", status: "verified",
    refs: [T(INS, "홈과 상세가 같은 입력이면 같은 action_id·snapshot"), T(WRK, "같은 입력이면 같은 action_id(홈·상세·보고서가 같은 판단 공유)"), T(RPT, "종합 판단 ID는 임원 결정과 TOP ACTIONS가 같은 신호에 같은 ID"), T(INS, "같은 대상·기간·목적에 다른 판단이면 충돌로 드러난다")],
    note: "그룹(포트폴리오)은 같은 신호에 같은 ID를 쓰는지까지 확인한다. 화면 세 곳의 문구가 입력까지 완전히 같다는 증명은 아니고, 달라지면 충돌로 드러나게 했다." },
  { id: "M06", group: "분석", title: "프로그램 기여 분해의 합계 분모·잔차, 가짜 원인·유지율·자기 잠식 단정 금지", status: "verified",
    refs: [T(INS, "단위 기여 변화의 합 = 모델 평균의 변화(분해에 잔차 없음)"), T(INS, "공식 채널 평균과 재구성값의 차이를 공개한다(잔차)"), T(INS, "인과 주장은 항상 불가"), T(INS, "인과 단정(때문에)은 차단")] },
  { id: "M07", group: "분석", title: "월누계 동일 일수, 완결월, 부분 주, 윤년, 연말·월말, 방송일 경계", status: "verified",
    refs: [T(MET, "월누계 동일일수 비교: 10/1~10/4 vs 9/1~9/4"), T(MET, "윤년: 2028-03-31 MTD 전월 2/29 포함 29일"), T(MET, "완결월: 연초(1/15)는 전년 12월"), T(MET, "부분 수신: 7일 중 6일 수신"), T(MET, "방송일 경계: 달력 01:30은 전날 방송일"), T(BRD, "날짜 경계: 12/31 25:30 → 다음 해 1/1 01:30")] },
  // ── UX ──
  { id: "U01", group: "UX", title: "기간·타깃 빠른 전환과 응답 역전 시 숫자·제목·링크 혼재 없음", status: "verified",
    refs: [T(WRK, "A→B→C로 빠르게 전환해도 응답이 어떤 순서로 와도 마지막 선택(C)의 값만"), T(WRK, "더 새 요청이 시작된 뒤 도착한 이전 응답은 화면에 쓰지 않는다"), T(WRK, "이전 요청의 늦은 실패는 새 요청의 상태를 오염시키지 않는다"), T(UIP, "요청 훅: 이전 요청 취소 + 시간 초과 중단")],
    note: "상태 규칙은 순수 함수 테스트이고 늦은 응답을 브라우저에서 실제로 재현하지는 않았다(단계 07·14 기록)." },
  { id: "U02", group: "UX", title: "데이터 없음·미제공·로딩·실패·잠정·낡은 결과·권리 미확인 구분", status: "verified",
    refs: [T(WRK, "새 기간을 요청한 뒤 응답 전에는 stale이며 값은 이전 문맥(A)의 것임을 알린다"), T(WRK, "공식 주간 값은 '확정', 일간 수신값은 '잠정'으로 표시"), T(WRK, "미수신 채널이 있으면 경고하고 빈 값이 0이 아님을 밝힌다"), T(O06, "Avail 자료 없음은 '확인 못함'이지 '가능'이 아니다"), T(UIP, "불러오는 중 안내는 낭독기에 알려진다")] },
  { id: "U03", group: "UX", title: "고정 컨텍스트와 첫 화면 우선 판단 3건, 근거·대안으로 이동", status: "verified",
    refs: [T(WRK, "결정 카드는 최대 3건"), T(WRK, "카드마다 근거 2개·대안·확인 조건·검토일이 있다"), T(WRK, "링크가 액션·채널·기준일·데이터 시점을 이어 준다")] },
  { id: "U04", group: "UX", title: "색 척도·단위·축·대체표·키보드·확대·좁은 창", status: "partial",
    refs: [T(UIP, "컨트롤 테두리는 흰 면 위 비텍스트 3:1 이상"), T(UIP, "Tab 순환: 끝에서 처음으로"), T(UIP, "Modal: role=dialog"), T(UIP, "차트·그림 svg에는 role=img+이름 또는 aria-hidden이 있다"), T(RPT, "Word 차트(표)에도 '값 없음(그리지 않음)'이 남는다")],
    note: "5개 화면을 1440·1280·200% 확대로 측정했다(PROGRESS 단계 15). 편성 비교·보고서 웹·관리자·모바일·실제 스크린리더는 측정하지 못했고, 시간 비례 편성표 칸의 24px 미만은 예외로 두었다." },
  { id: "U05", group: "UX", title: "공식 순위·목표 순위·경쟁군 순위가 같이 보일 때 분모 라벨 명확", status: "verified",
    refs: [T(WRK, "skyUHD: 시장 188위와 경쟁군 목표 2위를 '(188/2)'로 묶지 않는다"), T(MET, "목표 순위는 이름 붙여 표시('(18/6)' 금지)"), T(WRK, "skyUHD: 기준이 다른 순위의 격차는 계산하지 않고 이유를 알린다")] },
  // ── 운영·Avail ──
  { id: "O01", group: "운영·Avail", title: "관리자 권한 서버 검사, 자동 수집·파싱·반영 상태 분리, 원본·결과 추적", status: "verified",
    refs: [T(ADM, "관리자 API의 모든 핸들러가 서버에서 관리자 세션을 검사한다"), T(ADM, "쓰기(POST/PUT/PATCH/DELETE) API는 모두 세션 검사를 한다"), T(ADM, "수집만 된 날짜(received)는 '수집됨·미반영'으로 분리된다"), T(ING, "원장: 원본 헤더(시트명·타깃 라벨)와 교차검증 요약 보존")] },
  { id: "O02", group: "운영·Avail", title: "수동 목표·PD 메모·실적·EPG·예정 편성의 필드 우선순위와 버전", status: "verified",
    refs: [T(ADM, "수동 목표 보호: 잠긴 목표를 Channel Master 파일이 덮지 못한다"), T(ADM, "PD 메모는 공식 시청률 사실을 덮을 수 없다"), T(ADM, "수정 EPG가 자동 EPG보다 우선"), T(ADM, "일간 실적이 주간 예정보다 우선"), T(ADM, "PD 수동 리뷰가 계산 리뷰보다 우선")] },
  { id: "O03", group: "운영·Avail", title: "Avail A01~A19 결과표, 실제 양식 adapter 미검증 상태를 정직하게 표시", status: "needs_real_data",
    refs: [T(AVL, "A01 다른 채널은 unavailable"), T(AVL, "A19 as-of 이전에는 나중에 입력된 권리가 보이지 않는다"), T(AVL, "A18 평가 결과는 AVAIL_NOT_LOADED")],
    note: "A01~A19는 합성 자료로 모두 통과(아래 Avail 표). **실제 Avail 파일 양식 어댑터는 실제 샘플이 없어 검증하지 못했다**(AVAIL_ADAPTER_NOTES.md) — 실제 샘플 필요." },
  { id: "O04", group: "운영·Avail", title: "권리 개정 영향 슬롯 재검증, 공유 풀 동시 예약, 취소·복원, 실적 멱등 반영", status: "verified",
    refs: [T(AVL, "A12 개정 후 기존 초안은 재검증 필요로 바뀐다"), T(AVL, "A08 두 편성자가 동시에 마지막 1회를 잡으면 한 건만 성공"), T(AVL, "A13 해제하면 횟수가 돌아오고 원장에는 이벤트가 남는다"), T(AVL, "A13 실제 방송 실적은 예약을 소진으로 바꾸고, 같은 실적 재수신은 중복 반영하지 않는다")],
    note: "동시 예약은 메모리 원장(합성)에서 한 건만 성공함을 확인했다. DB의 SQL 함수(advisory lock)는 코드 확인만이고 동시 실행은 시험하지 못했다. 편성안 DB 버전 열은 승인 대기이며 확정 준비 검사는 읽기 전용이다." },
  { id: "O05", group: "운영·Avail", title: "unknown 권리 작품은 탐색 가능하되 확정 가능으로 표시하지 않음", status: "verified",
    refs: [T(AVL, "A18 탐색은 작동하고 '권리 미확인'으로 표시"), T(O06, "미확인이 한 칸이라도 있으면 검토안만"), T(AVL, "A14 방수가 빈칸이면 available도 무제한도 아니다(unknown)")] },
  // ── 예측·편성 ──
  { id: "P01", group: "예측·편성", title: "시간 순서 검증, 학습 cutoff·모델·데이터·권리 version 보존", status: "verified",
    refs: [T(O02, "누수 방지: 목표 주의 실측(100)이 예측에 섞이지 않는다"), T(O02, "학습 자료의 마지막 날짜 = 목표 주 전날 이전"), T(O02, "엔진 요약에 모델·특징·장르·제약·설정 버전이 기록된다"), T(AVL, "A19 입력 이후 시점에는 보인다")] },
  { id: "P02", group: "예측·편성", title: "단순 기준모델 대비 MAE·bias, 예측 구간 coverage·폭, 세그먼트별 성능", status: "partial",
    refs: [T(O05, "현재 모델이 최선 기준모델보다 MAE가 낮다"), T(O05, "시나리오 구간 포함률"), T(O05, "집단: 본방·보유 / 본방·신규"), T(O02, "MAE·bias는 예측 있는 건만")],
    note: "합성 세계와 로컬 실측(OPT05 검증 A·B)이다. 합격선은 사용자 승인 대기라 PASS 판정을 내리지 않았다." },
  { id: "P03", group: "예측·편성", title: "후보 간 구간 중첩, 신규 작품 전이, 0 근처 오차, 표본 독립성·고유 회차", status: "partial",
    refs: [T(O05, "신규 프로그램에서는 기준모델보다 낫지 않다"), T(O05, "낙관(보고−정답)은 후보 수가 5개에서 20개로 늘면 커진다"), T(O02, "고유 프로그램·방송일·목표 주 수를 함께 낸다"), T(O03, "T11 경쟁 프로그램의 자사 편성 기대값은 가정(BENCHMARK_TRANSFER)")],
    note: "후보 간 예측 구간 중첩을 순위처럼 보이지 않게 하는 화면 규칙은 구매 검토(단계 13)에서 '범위 넓음' 표시까지만 있고, 구간 겹침 자동 판정은 없다." },
  { id: "P04", group: "예측·편성", title: "hard constraint 위반 0, 불가능한 문제는 실패 사유", status: "verified",
    refs: [T(O03, "T03 높은 점수 B+A(0.0745)는 Avail 위반으로 validator가 거부한다"), T(O04, "KEEP: 하드 제약 위반 0"), T(IDL, "[1] 충돌 구간은 AI도 채우지 않음"), T(AVL, "A17 쓸 수 있는 후보가 없으면 위반 조건을 보여 준다")] },
  { id: "P05", group: "예측·편성", title: "최소 변경·균형·성과 우선 안의 변경분·위험·성과 비교", status: "verified",
    refs: [T(O06, "카드 순서는 기준안→최소변경→균형→성과우선"), T(O06, "최소변경: 같은 시간 기준 평균 0.125→0.150"), T(O06, "근거 부족 비중(C 등급 칸 분)과 경고")] },
  { id: "P06", group: "예측·편성", title: "수동 수정 후 stale 상태·KPI revision 정합성·undo·동시 편집", status: "verified",
    refs: [T(O06, "수정 뒤 다른 버전 재평가는 아직 DIRTY"), T(O06, "실행 취소하면 그 칸은 수동 수정에서 빠진다"), T(O06, "화면이 본 버전과 다르면(다른 곳에서 수정) 확정 불가"), T(O06, "다른 버전(0.047/0.048 사례)의 값은 쓰지 않는다")] },
  { id: "P07", group: "예측·편성", title: "기준안·후보안은 같은 모델·데이터 마감·타깃·시간 분모로 평가", status: "verified",
    refs: [T(O03, "T04 기준안 0.030%, 후보 0.033%"), T(O06, "예상값이 달라지면(재평가) 스냅샷 ID도 달라진다")] },
  { id: "P08", group: "예측·편성", title: "시간가중 주간 기대값, 예측 없는 구간을 분모에서 제거해 부풀리지 않음", status: "verified",
    refs: [T(O03, "T01 시간가중: 30분×0.200 + 90분×0.100 = 평균 0.125"), T(O03, "T06 30%만 평가된 좋은 구간"), T(O06, "DIRTY의 주간 기대는 지금 칸 값의 분 가중")] },
  { id: "P09", group: "예측·편성", title: "합성 벤치마크 T01~T12", status: "partial",
    refs: [T(O03, "T01 시간가중"), T(O03, "T02 완전탐색 정답은 B+A"), T(O03, "T03 높은 점수"), T(O03, "T05 소표본"), T(O03, "T07 한 칸 교체의 부분 delta"), T(O03, "T08 같은 입력이면 같은 해"), T(O03, "T10 전체 탐색을 끝내면 OPTIMAL"), T(O03, "T11 경쟁 특징은 as_of 이전"), T(O03, "T12 화면·엑셀·검증 문구")],
    note: "T09(마감 직전 Avail 갱신·동시 예약)의 '다른 편성자의 동시 예약 원장 기록'은 구현되지 않아 테스트가 '대기 1건'으로 남아 있다(DB 버전 열 승인 필요)." },
  { id: "P10", group: "예측·편성", title: "실제 탐색 시간·유효해율·기준 알고리즘 대비 목적값, 동일 입력·seed 재현, 시간 초과·취소 시 최선안 보존", status: "verified",
    refs: [T(O04, "같은 입력·같은 버전이면 같은 결과·같은 평가 횟수·같은 지문"), T(O04, "T10 취소해도 엔진은 유효한 편성안"), T(O04, "모든 탐색 방법이 낸 해는 하드 제약을 지킨다"), T(O04, "시간 마감(가짜 시계): 사유 DEADLINE")] },
  { id: "P11", group: "예측·편성", title: "예측 정확도·탐색 품질·실제 채택 후 성과를 각각 보고, 방송하지 않은 대안 예상치를 검증 성과로 쓰지 않음", status: "partial",
    refs: [T(O05, "채택 스냅샷: 주간 기대는 예상값이 있는 블록의 분 가중 평균"), T(O05, "대조: 직전 주 같은 슬롯 실제는 참고값일 뿐이며 인과 주장은 하지 않"), T(O03, "T12 개선율에 '모델상 기대 차이이지 실제 시청률 개선이 아님'을 밝힌다")],
    note: "채택 기록의 운영 저장소는 승인 대기라 실제 채택 이력이 없다 — 회고(RETROSPECTIVE.md)는 방법과 도구까지다." },
  // ── 보고서·출시 ──
  { id: "R01", group: "보고서·출시", title: "같은 ReportSnapshot의 웹·Word·PPT·PDF 지표·액션·시점 일치", status: "verified",
    refs: [T(RPT, "가 Word·PPT·문서보기(PDF) 모두에 같다"), T(RPT, "웹·Word·PPT·미리보기 라우트가 모두 resolveSnapshot으로 같은 스냅샷을 얻는다")] },
  { id: "R02", group: "보고서·출시", title: "실제 파일 렌더의 한글·줄바꿈·표·그림·페이지 잘림", status: "partial",
    refs: [T(RPT, "Word 표 머리행 반복(tblHeader)과 행 쪼개짐 방지(cantSplit)"), T(RPT, "Word 표마다 단위·기간·타깃·출처 캡션이 있다")],
    note: "구조 검사는 자동이고, 글자 잘림·쪽 나눔은 Word·PowerPoint·Edge로 직접 렌더해 이미지로 본 기록(PROGRESS 단계 14)이다 — 자동 회귀는 아니다. 보고서가 바뀔 때마다 다시 보아야 한다." },
  { id: "R03", group: "보고서·출시", title: "수정 원본 반영 후 캐시 무효화·과거 snapshot 보존·재발행 버전 관리", status: "verified",
    refs: [T(RPT, "문서(AI 문장 포함)가 바뀌면 다른 ID"), T(RPT, "없는 ID는 null(조용히 다른 내용을 만들지 않는다)"), T(RPT, "운영 저장소는 기존 캐시 테이블에 덮어쓰지 않는 upsert(ignoreDuplicates)"), T(UIP, "입력(수치·기간)이 바뀌면 새로 만든다")],
    note: "스냅샷은 보관 테이블이 아니라 캐시 테이블을 빌려 쓰므로 캐시를 비우면 원본이 사라진다(전용 테이블은 승인 대기)." },
  { id: "R04", group: "보고서·출시", title: "운영 전환 dry-run 수치 차이·영향 범위·rollback·feature flag 준비", status: "partial",
    refs: [T("test-traceability.ts", "읽기 전용 원본 대조 스크립트가 있고 DB에 쓰지 않는다"), T("test-traceability.ts", "feature flag 목록")],
    note: "로컬 원본 대조 도구와 문서까지다. 실제 운영 DB 대조·재계산은 승인 전 실행하지 않았다." },
  { id: "R05", group: "보고서·출시", title: "실제 자료 필요·권한 부족·미실행 테스트는 PASS로 처리하지 않음", status: "verified",
    refs: [T(O05, "측정하지 못한 필수 항목이 있으면 PASS가 될 수 없다"), T("test-traceability.ts", "미검증 항목은 통과로 표시되지 않는다")] },
];

/** 원본 대조 14건(03 JSON의 channel_golden_records)을 한 줄로 묶어 연결한다 — 개별 값 비교는 아래 검사가 14건 전부를 돈다 */
export const GOLDEN_REFS: TraceRef[] = [T(ING, "원본 14개 채널·기간 골든"), T(MET, "원본 ENA 주간: 수도권2049 0.11358%·7위")];

/** 03 JSON parser_edge_cases 5건 */
export const PARSER_EDGE: TraceItem[] = [
  { id: "PE1", group: "파서 예외", title: "ENA PLAY타깃상세: 타깃 헤더로 매핑, 2049·2039 혼동 금지, 총계행", status: "verified_original",
    refs: [T(ING, "원본 ENA PLAY 타깃상세 D14/I14: 2039=0.02327, 2049=0.07742로 헤더 매핑"), T(ING, "원본 하루전체 총계행은 프로그램이 아닌 집계로 분리")] },
  { id: "PE2", group: "파서 예외", title: "ENA PLAY경쟁채널시청률: 동일 방송 교차 검증, 0과 빈 셀 구분", status: "verified_original",
    refs: [T(ING, "원본 경쟁시트 D12/E12(0.07742/0.02327)와 타깃상세 D14/I14 교차 일치"), T(ING, "원본 경쟁시트 E9=0은 결측이 아닌 0으로 유지")] },
  { id: "PE3", group: "파서 예외", title: "ENA경쟁채널시청률 A3: 가구 지표의 채널별 지역 예외를 source override로 보존", status: "not_done",
    refs: [],
    note: "지역 예외 문구를 읽어 보존하는 코드와 테스트가 없다. 경쟁 채널(KBS1·MBC·SBS)의 가구 값은 수도권 기준이므로 National 값과 같은 열에서 비교하면 지역 혼용이 된다 — 출시 보류 후보 H1." },
  { id: "PE4", group: "파서 예외", title: "ONCE·OLIFE·ENA SPORTS 타깃상세: 시트명이 아니라 블록 헤더로 채널 구분", status: "verified_original",
    refs: [T(ING, "원본 시트 4개 블록 헤더(ONCE·OLIFE·ENA STORY 섹션)로 채널 구분")] },
  { id: "PE5", group: "파서 예외", title: "주간 유료방송가입가구: 수도권 2049 순위 7과 전국 가구 순위 12를 섞지 않음", status: "verified_original",
    refs: [T(MET, "원본 ENA 주간: 수도권2049 0.11358%·7위"), T(MET, "F01: ENA 주간 수도권2049 0.11358/7위, 전국가구 0.31771/12위는 서로 다른 문맥")] },
];

/** F01~F19: 검수 발견사항 — 어느 단계에서 어떻게 닫았는지와 남은 한계 */
export const FINDINGS: TraceItem[] = [
  { id: "F01", group: "발견사항", title: "주간 순위 불일치(7위 vs 12위)", status: "verified_original", refs: [T(MET, "F01: ENA 주간 수도권2049 0.11358/7위, 전국가구 0.31771/12위는 서로 다른 문맥")], note: "정의 차이(타깃·지역)와 편성 비교의 일별 순위 평균 혼용을 분리했다(단계 02·10)." },
  { id: "F02", group: "발견사항", title: "기간 전환 중 이전 값이 새 제목에 남음", status: "partial", refs: [T(WRK, "새 요청이 실패하면 error이며 남은 이전 값은 현재 값이 아님을 표시"), T(WRK, "더 새 요청이 시작된 뒤 도착한 이전 응답은 화면에 쓰지 않는다")], note: "홈·보고서는 요청 번호·키 가드로 닫았고, 채널 화면은 새 제목과 이전 값을 배너로 구분하는 완화 수준이다(단계 02·07 기록)." },
  { id: "F03", group: "발견사항", title: "AI 문장이 의미를 바꿈", status: "verified", refs: [T(INS, "전주 vs 12주: 12주 기준 값을 '전주 대비'로 쓰면 차단"), T(INS, "보고서: 방향 불일치 차단(변경 전 통과 결함)"), T(INS, "인과 단정(때문에)은 차단")] },
  { id: "F04", group: "발견사항", title: "시간대 0(시작 시각 집계)", status: "verified_original", refs: [T(BRD, "07:54:58~09:01:07 방송은 8시 구간에 겹쳐"), T(BRD, "겹친 방송이 없는 시간대는 결측(null)이며 0이 아님")] },
  { id: "F05", group: "발견사항", title: "대표 경쟁작 겹침 길이 미사용", status: "verified_original", refs: [T(BRD, "38초 겹침은 대표 경쟁작이 아님"), T(BRD, "원본에서 F05 사례 확인")] },
  { id: "F06", group: "발견사항", title: "홈·상세 액션 충돌", status: "verified", refs: [T(INS, "홈과 상세가 같은 입력이면 같은 action_id·snapshot"), T(WRK, "상승 관측에 MOVE 태그가 붙어도 카드 제목이 '이동 검토'가 되지 않고")] },
  { id: "F07", group: "발견사항", title: "빈 값 0 처리·덮어쓰기", status: "partial", refs: [T(ING, "빈 셀=결측(null), 숫자 0=관측값 0 구분"), T(ING, "같은 날짜 수정본 → 개정 2"), T(ING, "ratings 삽입 실패 → 실패 보고")], note: "닐슨 일간은 닫았다. skyUHD 수기 파일의 빈 시청률 처리와 운영 롤백 정책은 코드 확인만이고 이번 테스트 범위 밖이다." },
  { id: "F08", group: "발견사항", title: "KPI 버전 혼재(run 원시값 분모)", status: "verified", refs: [T(O06, "다른 버전(0.047/0.048 사례)의 값은 쓰지 않는다"), T(O06, "예상값이 달라지면(재평가) 스냅샷 ID도 달라진다")] },
  { id: "F09", group: "발견사항", title: "Avail(권리) 연결", status: "needs_real_data", refs: [T(AVL, "A01 다른 채널은 unavailable"), T(AVL, "A18 탐색은 작동하고 '권리 미확인'으로 표시")], note: "구현은 합성 자료로 검증했고 실제 Avail 양식·계약 해석 확인은 필요하다." },
  { id: "F10", group: "발견사항", title: "예측 검증 수준(구간·표본 독립성)", status: "partial", refs: [T(O05, "시나리오 구간 포함률"), T(O02, "고유 프로그램·방송일·목표 주 수를 함께 낸다")], note: "합격선 승인 대기, 후보 간 구간 겹침 자동 판정 없음(P03 참고)." },
  { id: "F11", group: "발견사항", title: "주간 '36위 이내' 표기", status: "partial", refs: [T(IDL, "예상 순위: 지난주 닐슨 시청률을 기대 비율만큼 옮겨 실적 사이 보간")], note: "표기는 '약 N위·N위 이내·N위 밖'으로 한계를 드러내지만, 경쟁 채널 편성 변화는 반영되지 않는다는 고지는 툴팁 수준이다." },
  { id: "F12", group: "발견사항", title: "인과 단정", status: "verified", refs: [T(INS, "인과 단정(때문에)은 차단"), T(INS, "'~에 밀림' 같은 인과 서술도 차단"), T(WRK, "카드 문구가 원인을 단정하지 않는다")] },
  { id: "F13", group: "발견사항", title: "기여도 표현", status: "verified", refs: [T(INS, "단위 기여 변화의 합 = 모델 평균의 변화(분해에 잔차 없음)"), T(INS, "인과 주장은 항상 불가")] },
  { id: "F14", group: "발견사항", title: "복합 점수·프로파일 단정(약세 1건 + '만')", status: "verified", refs: [T(INS, "무한도전 96/95/94/72/38/0"), T(INS, "평균 미만 집단이 여러 개인데 '~만 평균 이하'는 차단")] },
  { id: "F15", group: "발견사항", title: "포트폴리오 분모(그룹 합산)", status: "verified", refs: [T(PRT, "그룹 합산·MPP 순도달 계산 코드가 없다")], note: "그룹 A/B 분리는 코드로 강제하고 합산 계산을 두지 않았다(단계 09)." },
  { id: "F16", group: "발견사항", title: "보고서·PPT", status: "verified", refs: [T(RPT, "첫 본문 장은 결론·결정 요청, 마지막 본문 장은 전제·한계"), T(RPT, "가 Word·PPT·문서보기(PDF) 모두에 같다")], note: "단계 14에서 같은 스냅샷 기반으로 재구성. 실제 렌더는 수동 확인 기록(R02)." },
  { id: "F17", group: "발견사항", title: "긴 페이지(채널 분석 구조)", status: "not_done", refs: [], note: "단계 08(채널 분석과 차트·콘텐츠 리뷰)이 사용자 결정으로 보류되어 채널 화면의 긴 페이지 재구성은 하지 않았다." },
  { id: "F18", group: "발견사항", title: "구매 추천 기준일 차이", status: "partial", refs: [T(PUR, "추천 API: 모델 버전·계산 시각·정합 결과 제공")], note: "추천 기준일과 지연을 화면에 표시한다(단계 13). 주간 갱신이 멈춘 원인(GitHub secrets 확인)은 사용자 확인 대기." },
  { id: "F19", group: "발견사항", title: "시각·워딩('28분 60초'·'Create Next App' 등)", status: "verified", refs: [T(UIP, "28분 60초가 생기지 않는다"), T(UIP, "기본 템플릿 제목 'Create Next App' 없음"), T(UIP, "모든 화면 경로에 업무별 제목이 있다")] },
];

const avail = (id: string, title: string, find: string): TraceItem => ({ id, group: "Avail", title, status: "needs_real_data", refs: [T(AVL, find)], note: "합성 자료로 통과. 실제 Avail 양식에서의 동작은 미검증." });
export const AVAIL_CASES: TraceItem[] = [
  avail("A01", "허용 채널과 다른 채널: 제외 사유 표시", "A01 다른 채널은 unavailable + 사유 + 원본 행"),
  avail("A02", "시작 전·만료 후 제외, 시작·종료 경계", "A02 종료일 다음 날 제외"),
  avail("A03", "25:30 편성과 자정 만료: 계약 기준에 맞게 달력 날짜 검사", "A03 달력 기준: 10-04 방송일의 25:30은 10-05 01:30이라 만료 후 불가"),
  avail("A04", "시작은 허용, 끝은 만료 이후: 종료 조건에 따라 제외·조건부", "A04 종료까지 허용돼야 하면 불가"),
  avail("A05", "전체 12회 중 특정 회차만 허용: 나머지 제외", "A05 나머지 회차는 불가 + 사유"),
  avail("A06", "동일 제목 다른 시즌·편집판: 매칭 확인 전 unknown", "A06 시즌 표지가 다르면 확인 전 unknown(자동 병합 안 함)"),
  avail("A07", "잔여 0회: 점수와 무관하게 실행 후보 제외", "A07 점수가 높아도 권리가 안 맞으면 실행가능안에 들어가지 않는다"),
  avail("A08", "공유 풀 마지막 1회 동시 예약: 한 건만 성공", "A08 두 편성자가 동시에 마지막 1회를 잡으면 한 건만 성공"),
  avail("A09", "동일 파일·행 재업로드: 중복 없음", "A09 같은 행 재업로드는 변화 없음(권리·횟수 중복 없음)"),
  avail("A10", "콘텐츠별·채널별 파일의 같은 grant: 합산하지 않고 통합·충돌 확인", "A10 확인 전에는 조건부(DUPLICATE_GRANT_UNCONFIRMED) — 합산하지 않음"),
  avail("A11", "부분 파일에서 누락: 기존 권리 자동 삭제 없음", "A11 증분 파일에서 빠진 행은 철회가 아니다"),
  avail("A12", "개정 계약으로 만료 단축: 기존 초안 재검증 필요", "A12 개정 후 기존 초안은 재검증 필요로 바뀐다"),
  avail("A13", "취소·undo·실제 방송 재수신: 예약·소진 정합성", "A13 실제 방송 실적은 예약을 소진으로 바꾸고, 같은 실적 재수신은 중복 반영하지 않는다"),
  avail("A14", "필수 조건 빈칸: available·무제한으로 추정하지 않음", "A14 방수가 빈칸이면 available도 무제한도 아니다(unknown)"),
  avail("A15", "별도 승인 조건: 승인 증빙 없이는 확정 불가", "A15 승인 증빙 없이는 확정할 수 없다"),
  avail("A16", "과거 계획 조회: 당시 rights snapshot 보존, 현재 효력 별도 표시", "A16 당시 판정은 보존하고 현재 효력은 따로 표시"),
  avail("A17", "권리 부족으로 해 없음: 위반 조건을 보여주고 임의 완화 안 함", "A17 임의로 완화하지 않는다"),
  avail("A18", "권리 없는 현재 설치: 성과 분석·탐색은 작동, 실행 가능 판정 보류", "A18 실행 가능 판정은 보류"),
  avail("A19", "미래에 입력된 권리 정보를 과거 as-of 예측 검증에 누출하지 않음", "A19 나중에 한 해석 확인도 과거 시점에는 적용하지 않는다"),
];

export const ALL_ITEMS: TraceItem[] = [...CHECKLIST, ...PARSER_EDGE, ...FINDINGS, ...AVAIL_CASES];

export const STATUS_LABEL: Record<TraceStatus, string> = {
  verified: "검증됨(자동 테스트)",
  verified_original: "검증됨(로컬 원본 파일 필요)",
  partial: "일부만 검증",
  needs_real_data: "실제 자료 필요(합성 검증만)",
  not_done: "미구현·미검증",
};
