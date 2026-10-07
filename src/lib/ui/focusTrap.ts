// 모달 안 Tab 순환(순수 함수) — 마지막 요소에서 Tab이면 처음으로, 처음에서 Shift+Tab이면 마지막으로 보낸다.
// current가 -1(목록 밖)이면 방향에 맞춰 처음/마지막으로 들어온다. count가 0이면 null(이동할 곳 없음 → 대화상자 자체에 머문다).
export function nextFocusIndex(count: number, current: number, shift: boolean): number | null {
  if (count <= 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

export const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
