// 닐슨 메일 감시 규칙(mailWatch.ts) 단위 테스트 — 실행: npm run test:mailwatch
import { WATCH_BUDGET_MS, WATCH_MAX_HOPS, WATCH_POLL_MS, expectedReportTag, expectedSubjectFragment, inWatchWindow, kstParts, shouldChain, shouldPollAgain } from "../src/lib/mailWatch";

let pass = 0;
let fail = 0;
function t(name: string, ok: boolean) {
  if (ok) {
    pass++;
    console.log(`✅ ${name}`);
  } else {
    fail++;
    console.log(`❌ ${name}`);
  }
}

/** KST 시각 → epoch ms */
const kst = (iso: string) => new Date(`${iso}+09:00`).getTime();

t("KST 변환: UTC 22:03 = 다음 날 KST 07:03", kstParts(Date.UTC(2026, 9, 17, 22, 3)).minutes === 7 * 60 + 3 && kstParts(Date.UTC(2026, 9, 17, 22, 3)).date === "2026-10-18");
t("감시 창: 06:59는 밖, 07:00부터 08:54까지 안, 08:55부터 밖", !inWatchWindow(kst("2026-10-18T06:59:00")) && inWatchWindow(kst("2026-10-18T07:00:00")) && inWatchWindow(kst("2026-10-18T08:54:59")) && !inWatchWindow(kst("2026-10-18T08:55:00")));
t("메일 도착 분포(07:35~08:15·지연 08:30·08:51)가 모두 창 안", ["07:35", "07:40", "08:00", "08:15", "08:34", "08:51"].every((hm) => inWatchWindow(kst(`2026-10-18T${hm}:00`))));
t("오늘 아침 와야 하는 보고서 꼬리표는 어제(KST) 날짜 YYMMDD", expectedReportTag(kst("2026-10-18T08:09:00")) === "261017");
t("월 경계: 11/01 아침 보고서는 261031", expectedReportTag(kst("2026-11-01T07:50:00")) === "261031");
t("제목 검색 조각은 메일 제목 꼴과 맞는다", "[닐슨] KTENA 일일 보고서 (261017)".includes(expectedSubjectFragment(kst("2026-10-18T08:09:00"))));
t("이어 붙이기: 반영 전·창 안이면 계속", shouldChain({ done: false, nowMs: kst("2026-10-18T07:20:00"), hop: 3 }));
t("이어 붙이기: 반영됐으면 멈춘다", !shouldChain({ done: true, nowMs: kst("2026-10-18T07:20:00"), hop: 3 }));
t("이어 붙이기: 창이 끝나면 멈춘다", !shouldChain({ done: false, nowMs: kst("2026-10-18T08:56:00"), hop: 3 }));
t("이어 붙이기: 횟수 상한에서 멈춘다(폭주 방지)", !shouldChain({ done: false, nowMs: kst("2026-10-18T07:20:00"), hop: WATCH_MAX_HOPS }));
{
  const start = kst("2026-10-18T07:10:00");
  t("재확인: 시작 직후는 계속", shouldPollAgain({ done: false, nowMs: start + 5_000, startedMs: start }));
  t("재확인: 상한(240초)을 넘기게 되면 멈춘다", !shouldPollAgain({ done: false, nowMs: start + WATCH_BUDGET_MS, startedMs: start }));
  t("재확인: 반영됐으면 멈춘다", !shouldPollAgain({ done: true, nowMs: start + 5_000, startedMs: start }));
  t("재확인: 대기 뒤 창을 벗어나면 멈춘다", !shouldPollAgain({ done: false, nowMs: kst("2026-10-18T08:54:30"), startedMs: kst("2026-10-18T08:54:00") }));
}
t("한 호출이 덮는 시간 × 최대 호출 수가 감시 창(115분)을 넘는다", ((WATCH_BUDGET_MS + 10_000) * WATCH_MAX_HOPS) / 60_000 >= 115);

console.log(`\n${pass}건 통과, ${fail}건 실패`);
if (fail > 0) process.exit(1);
