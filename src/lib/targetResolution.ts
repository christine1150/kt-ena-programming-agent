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

// 사용자 지시(2026-08-21, 재확인): 채널별로 정확히 지정된 "비교 시청률" 타깃 — 채널 고유(KPI)
// 타깃 외에 참고로 함께 보여줄 타깃(들). Page 2(02~26시 그래프 체크박스)와 Page 1(오늘의 상위
// 프로그램 "비교 시청률" 열)이 같은 목록을 공유한다(한 곳만 고치면 되도록 여기 하나로 관리).
// DB를 직접 조회해 §1.3 타깃상세 시트에 실제로 프로그램 단위(시간대별) 데이터가 있는 조합만
// 반영했다(CLAUDE.md 원칙: 없는 데이터를 임의로 만들지 않음) — OLIFE/ONCE/ENA Story의
// "개인2049"와 ENA Story의 "여자3049"는 그 시트 자체에 해당 컬럼이 없어(전국 스코프 채널이라
// "수도권 2049"/"수도권 여3049" 데이터가 없음) 제외했다. ENA Story는 요청하신 두 타깃(개인2049·
// 여자3049) 모두 없어 빈 목록.
export const EXTRA_TARGET_LABELS_BY_CHANNEL: Record<string, string[]> = {
  ENA: ["수도권 2039", "전국 유료가구"],
  ENA_PLAY: ["수도권 2039", "전국 유료가구"],
  ENA_DRAMA: ["전국 유료가구", "수도권 여3049"],
  OLIFE: ["전국 5064"],
  ONCE: ["전국 5064"],
  ENA_STORY: [],
};
