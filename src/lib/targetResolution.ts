// 같은 타깃인데 시트마다 표기가 다른 문제(DATA_DICTIONARY.md §1.1 참고)를 다루는 도우미.
// 채널의 KPI 문구(channels.primary_target, 예: "수도권 개인2049")로부터
// **프로그램 단위(타깃상세 시트) 데이터**에 실제로 쓰인 타깃 라벨을 찾는다.
// 아래 매핑은 추측이 아니라 DB에 실제로 있는 라벨을 직접 조회해서 확인한 값이다:
//   - "National 유료방송가입가구"(Channel Master 표기) → "전국 유료가구"(타깃상세 표기)
//   - "수도권 개인2049"(Channel Master 표기) → "수도권 2049"(타깃상세 표기, "개인"만 빠짐)
export function resolveProgramLevelTargetLabel(primaryTarget: string): string {
  if (primaryTarget.includes("유료방송가입가구")) return "전국 유료가구";
  return primaryTarget.replace("개인", "").trim();
}

// 사용자 지시(2026-08-21, 세 번째 재확인): 채널별로 정확히 지정된 "비교 시청률" 타깃 — 채널
// 고유(KPI) 타깃 외에 참고로 함께 보여줄 타깃(들). Page 2(02~26시 그래프 체크박스)와 Page 1
// (오늘의 상위 프로그램 "비교 시청률" 열)이 같은 목록을 공유한다(한 곳만 고치면 되도록 여기
// 하나로 관리). 사용자가 "OLIFE/ONCE/ENA Story는 유료방송가구·개인5064·개인2049(ENA Story는
// 여자3049)로 되어있다"고 재차 지시해, DB 전체 targets 테이블 + 세 채널의 §1.3 타깃상세 시트가
// 실제로 쓰는 target_id를 다시 직접 조회해 재검증했다(추측 아님) — 그 결과:
//   - "유료방송가구"는 이미 이 세 채널의 KPI 타깃 자체(원문 "National 유료방송가입가구"
//     → "전국 유료가구")라 그래프 1번째 선(주 타깃 라인)으로 이미 표시되고 있다(중복 추가 불필요).
//   - "개인5064"는 §1.3 시트에 "전국 5064"라는 표기로 세 채널 모두 실존해 이미 반영돼 있었다
//     (OLIFE/ONCE). ENA Story는 데이터는 있는데 이 목록에서 빠져있던 실제 누락이라 이번에 추가.
//   - "개인2049"/"여자3049"(전국 스코프)는 targets 테이블에도, 세 채널의 §1.3 시트가 실제로 쓰는
//     target_id 목록에도 존재하지 않는다 — 있는 건 "수도권 2049"/"수도권 여3049"·"수도권
//     여자3049"뿐이고 이는 수도권 채널(ENA 등)에서만 쓰인다. 즉 전국 스코프 채널인 OLIFE/ONCE/
//     ENA Story의 §1.3 시트 자체에 2049·30대 여성을 묶은 복합 연령대 컬럼이 없다(개별 10살
//     단위 연령대·성별 컬럼만 있음) — 만들어낼 수 없는 데이터라 계속 제외한다(CLAUDE.md 원칙).
export const EXTRA_TARGET_LABELS_BY_CHANNEL: Record<string, string[]> = {
  ENA: ["수도권 2039", "전국 유료가구"],
  ENA_PLAY: ["수도권 2039", "전국 유료가구"],
  ENA_DRAMA: ["전국 유료가구", "수도권 여3049"],
  OLIFE: ["전국 5064"],
  ONCE: ["전국 5064"],
  ENA_STORY: ["전국 5064"],
};

// 사용자 지시(2026-08-21): "26년 채널 누적 시청률.xlsx"(시장 전체 ~217개 채널 기준 누적 순위,
// market_ytd_rank_snapshot 테이블) 업로드분을 Page 1 히어로 카드의 "누적 순위"에서 우선 사용한다.
// 이 파일의 채널명 표기(예: "ENA Drama"→"ENA DRAMA", "skyUHD"→"SkyUHD")는 channels.name과
// 대소문자·띄어쓰기가 달라 직접 매칭이 안 돼 별도 매핑이 필요하다(원본 그대로 저장했으므로 —
// CLAUDE.md 원칙: 원본 데이터를 임의로 고치지 않고, 매칭 계층에서만 흡수).
export const MARKET_YTD_CHANNEL_NAME_BY_CODE: Record<string, string> = {
  ENA: "ENA",
  ENA_PLAY: "ENA PLAY",
  ENA_DRAMA: "ENA DRAMA",
  ENA_STORY: "ENA STORY",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "SkyUHD",
};

// 이 파일이 지금 제공하는 타깃은 "유료방송가구"(시장 전체, 스코프 구분 없음)와 "수도권2049" 둘뿐이다
// — channels.primary_target 문구에 "2049"가 있으면 2049 타깃을, 아니면(유료방송가입가구 KPI)
// 유료방송가구 타깃을 그 채널의 진짜 KPI와 같은 성격으로 매칭한다.
export function resolveMarketYtdTargetLabel(primaryTarget: string): string {
  return primaryTarget.includes("2049") ? "수도권2049" : "유료방송가구";
}
