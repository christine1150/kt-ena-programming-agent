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
