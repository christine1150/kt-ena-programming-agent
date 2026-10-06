// Avail 검증 상태 표시(단계 06) — "무엇이 어디까지 검증됐는지"를 화면과 API가 같은 문구로 보여 준다.
// 실제 파일로 확인하지 못한 것을 확인했다고 쓰지 않는다.
export interface ValidationLine {
  area: string;
  state: "verified" | "partial" | "unverified";
  text: string;
}

export const AVAIL_VALIDATION: ValidationLine[] = [
  { area: "표준 모델·판정 엔진", state: "verified", text: "합성 사례로 검증 완료(명세 A01~A19). 실제 계약 조건·가격은 어디에도 넣지 않았습니다." },
  { area: "콘텐츠별 Avail 파일(260930 형식, '소재' 시트)", state: "partial", text: "실제 파일 1건으로 열 이름·값 형식(날짜·회차·채널·방수)을 확인했습니다. 방수 단위·기간 기준·홀드백·방영범위 약어의 계약 해석은 권리 담당자 확인 전이라 '확인 필요'로 남겨 둡니다." },
  { area: "채널별 Avail 파일", state: "unverified", text: "실제 파일을 받지 못했습니다. 표준 양식으로만 받을 수 있고 실제 양식 어댑터는 미검증입니다." },
  { area: "사용 원장(예약·소진·해제)", state: "partial", text: "규칙은 메모리 저장소로 검증했습니다(마지막 1회 동시 예약 등). DB의 원자 처리(SQL 함수)는 로컬 Postgres가 없어 실행해 보지 못했고, 마이그레이션 적용 후 확인 스크립트로 점검해야 합니다." },
  { area: "편성표 뽑기 연결", state: "partial", text: "권리 판정·후보 selector·엔진 게이트를 만들었습니다. Avail 자료가 없으면 현재 동작 그대로이며, 실행 가능 판정은 '보류'로 표시됩니다." },
];

export const STATE_LABEL: Record<ValidationLine["state"], string> = { verified: "검증됨", partial: "일부 검증", unverified: "미검증" };
