// 닐슨 일일보고서 메일 "감시" 규칙(순수 함수) — 2026-10-18 사용자 지시: 메일은 거의 매일 07:35~08:15(KST)에 오고(07:40~08:00이 가장 많음)
// 드물게 08:30·08:50대로 늦는다. Vercel Hobby 크론은 하루 한 번·시각 정확도가 시간 단위라 그 창을 훑을 수 없어서,
// 07시 크론이 켜지면 메일이 반영될 때까지 몇 분 간격으로 확인하고, 끝나지 않으면 다음 호출을 스스로 이어 붙인다(감시 창 안에서만).
// 시각 판단·"오늘 보고서가 반영됐는가"의 기준을 여기 모아 두어 단위 테스트가 가능하게 한다.

/** 감시 창(KST, 분) — 07:00 이후 ~ 08:55 이전. 메일 도착 분포(07:35~08:15, 지연·재발송 08:30~08:51)를 덮는다. */
export const WATCH_START_MIN = 7 * 60;
export const WATCH_END_MIN = 8 * 60 + 55;

/** 한 번의 호출 안에서 메일을 다시 확인하는 간격(ms). 도착 후 최대 1분 안에 반영되게 하되 네이버 IMAP 로그인을 그 이상 자주 하지는 않는다(2026-10-18 사용자: 8시 20분 전 확인 완료, 도착 시각에 가깝게). */
export const WATCH_POLL_MS = 60_000;
/** 한 번의 호출이 확인에 쓰는 시간 상한(ms) — 함수 최대 시간 300초에서 다음 호출을 이어 붙일 여유를 남긴다. */
export const WATCH_BUDGET_MS = 240_000;
/** 이어 붙이는 호출 횟수 상한(폭주 방지). 정상이면 창(115분)을 덮는 데 약 30번이면 충분하다. */
export const WATCH_MAX_HOPS = 40;

/** 이 시각(KST 07:30) 전에는 메일이 온 적이 없다(사용자 확인: 07:35~08:15) — 그 전에는 접속 없이 기다리기만 한다. */
export const MAIL_CHECK_FROM_MIN = 7 * 60 + 30;

const KST_MS = 9 * 3600_000;

/** 어떤 시각의 KST 날짜(YYYY-MM-DD)와 자정부터의 분 */
export function kstParts(ms: number): { date: string; minutes: number } {
  const d = new Date(ms + KST_MS);
  const date = d.toISOString().slice(0, 10);
  return { date, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** 감시 창 안인가(KST 07:00 이상 08:55 미만) */
export function inWatchWindow(ms: number): boolean {
  const { minutes } = kstParts(ms);
  return minutes >= WATCH_START_MIN && minutes < WATCH_END_MIN;
}

/** 지금 실제로 메일함에 접속해 확인할 시각인가(감시 창 안이면서 07:30 이후) */
export function shouldCheckMailNow(ms: number): boolean {
  return inWatchWindow(ms) && kstParts(ms).minutes >= MAIL_CHECK_FROM_MIN;
}

/** 오늘 아침 와야 하는 일일보고서의 날짜 꼬리표 — 어제(KST)의 YYMMDD. 메일 제목이 "[닐슨] KTENA 일일 보고서 (261017)" 꼴이다. */
export function expectedReportTag(ms: number): string {
  const { date } = kstParts(ms - 24 * 3600_000);
  return date.slice(2).replace(/-/g, "");
}

/** 제목 검색용 조각 — "일일 보고서 (261017)" */
export function expectedSubjectFragment(ms: number): string {
  return `일일 보고서 (${expectedReportTag(ms)})`;
}

/** 이 호출이 끝난 뒤 다음 호출을 이어 붙일지 — 아직 반영 전이고, 창 안이며, 횟수 상한 전일 때만 */
export function shouldChain(opts: { done: boolean; nowMs: number; hop: number }): boolean {
  return !opts.done && opts.hop < WATCH_MAX_HOPS && inWatchWindow(opts.nowMs);
}

/** 이 호출 안에서 한 번 더 확인할지 — 아직 반영 전이고, 대기 뒤에도 창 안이며, 이 호출의 시간 상한 안일 때만 */
export function shouldPollAgain(opts: { done: boolean; nowMs: number; startedMs: number }): boolean {
  if (opts.done) return false;
  const after = opts.nowMs + WATCH_POLL_MS;
  return inWatchWindow(after) && after - opts.startedMs <= WATCH_BUDGET_MS;
}
