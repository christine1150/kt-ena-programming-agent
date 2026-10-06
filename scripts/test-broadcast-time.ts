// 방송시간·시간대·경쟁 겹침(단계 03) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크 접근 없음(조회 계층은 메모리 대역).
// 실행: npm run test:broadcast   (실제 원본 XLS 대조는 파일이 있을 때만, 없으면 SKIP으로 표시)
import fs from "node:fs";
import path from "node:path";
import { FakeDb } from "./lib/fakeSupabase";
import {
  DEFAULT_OVERLAP_CONFIG,
  OVERLAP_BASIS_NOTE,
  PRIME_RULES,
  airingInterval,
  allocateByHour,
  analyzeLayout,
  classifySlot,
  clockToBroadcastSeconds,
  compareSlotConditions,
  describeHolidayCalendar,
  estimateHourlyPattern,
  overlapSeconds,
  parseClock,
  primeOverlap,
  primeRuleFor,
  scoreOverlap,
  selectRepresentativeCompetitors,
  slotConditions,
  type HourlyAiring,
  type PrimeRule,
} from "../src/lib/broadcastTime";

let passed = 0;
let skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;
const iv = (date: string, s: string, e: string) => {
  const r = airingInterval(date, s, e);
  if (!r.interval) throw new Error(`구간 없음: ${date} ${s}~${e} (${r.issue})`);
  return r.interval;
};
const hourRow = (est: ReturnType<typeof estimateHourlyPattern>, h: number) => est.rows.find((r) => r.broadcastHour === h)!;
const A = (date: string, s: string | null, e: string | null, rating: number | null, extra: Partial<HourlyAiring> = {}): HourlyAiring => ({ date, startClock: s, endClock: e, rating, ...extra });

async function main() {
  // ── 구간·경계 ───────────────────────────────────────────────
  check("시계 시각 → 방송 초: 07:54:58=28498, 02:00=7200, 24시 표기 24:25:32=87932", clockToBroadcastSeconds("07:54:58") === 28498 && clockToBroadcastSeconds("02:00:00") === 7200 && clockToBroadcastSeconds("24:25:32") === 87932);
  check("00:25는 같은 방송일의 24:25(다음 날로 재분류하지 않음), 01:59:59는 25:59:59", clockToBroadcastSeconds("00:25:00") === 24 * 3600 + 25 * 60 && clockToBroadcastSeconds("01:59:59") === 25 * 3600 + 59 * 60 + 59);
  check("형식 오류·범위 밖은 null", parseClock("25:61:00") === null && parseClock("abc") === null && parseClock(null) === null && parseClock("31:00:00") === null);

  const prem = iv("2026-10-04", "07:54:58", "09:01:07");
  check("07:54:58~09:01:07 길이 3969초, 달력·방송일·시간대 보존", prem.durationSec === 3969 && prem.calendarStart === "2026-10-04T07:54:58+09:00" && prem.timezone === "Asia/Seoul" && prem.endConvention.kind === "exclusive_assumed" && prem.endConvention.verified === false);
  const late = iv("2026-10-04", "23:30:00", "01:10:00");
  check("23:30~01:10: 방송일은 10/4 유지, 달력 종료는 10/5 01:10, 길이 6000초", late.broadcastDate === "2026-10-04" && late.durationSec === 6000 && late.calendarEnd === "2026-10-05T01:10:00+09:00" && late.endSec === 25 * 3600 + 600);
  const cross = iv("2026-10-04", "01:30:00", "03:00:00");
  check("01:30~03:00(방송일 25:30~27:00)은 분리 없이 하나의 구간", cross.startSec === 91800 && cross.endSec === 97200 && cross.durationSec === 5400);
  check("종료 시각 없음·0초 방송은 구간을 만들지 않고 이유를 반환(종료 추정 금지)", airingInterval("2026-10-04", "10:00:00", null).interval === null && /종료/.test(airingInterval("2026-10-04", "10:00:00", null).issue ?? "") && airingInterval("2026-10-04", "10:00:00", "10:00:00").interval === null && airingInterval("2026-10-04", null, "10:00:00").interval === null);
  check("날짜 경계: 12/31 25:30 → 다음 해 1/1 01:30, 평년 2/28 → 3/1, 윤년 2/29 → 3/1, 월말 9/30 → 10/1", iv("2026-12-31", "01:30:00", "02:30:00").calendarStart === "2027-01-01T01:30:00+09:00" && iv("2026-02-28", "01:30:00", "02:00:00").calendarStart === "2026-03-01T01:30:00+09:00" && iv("2028-02-29", "01:30:00", "02:00:00").calendarStart === "2028-03-01T01:30:00+09:00" && iv("2026-09-30", "01:30:00", "02:00:00").calendarStart === "2026-10-01T01:30:00+09:00");

  // ── 겹침(반개구간) ──────────────────────────────────────────
  const ours = iv("2026-10-04", "14:10:50", "15:16:59");
  const theirs = iv("2026-10-04", "15:16:21", "16:44:00");
  check("14:10:50~15:16:59 vs 15:16:21~16:44:00 교집합은 38초", overlapSeconds(ours, theirs) === 38);
  check("끝과 시작이 맞닿으면 겹침 0, 같은 구간은 전체, 포함 관계는 짧은 쪽 길이", overlapSeconds(iv("2026-10-04", "20:00:00", "21:00:00"), iv("2026-10-04", "21:00:00", "22:00:00")) === 0 && overlapSeconds(iv("2026-10-04", "20:00:00", "21:00:00"), iv("2026-10-04", "20:00:00", "21:00:00")) === 3600 && overlapSeconds(iv("2026-10-04", "20:00:00", "22:00:00"), iv("2026-10-04", "20:30:00", "21:00:00")) === 1800);
  check("방송일이 다른 구간의 겹침(일요일 25:30~27:30과 월요일 02:00~03:00 → 3600초)", overlapSeconds(iv("2026-10-04", "01:30:00", "03:30:00"), iv("2026-10-05", "02:00:00", "03:00:00")) === 3600);

  // ── 시간대 배분 ─────────────────────────────────────────────
  const alloc = allocateByHour(prem);
  check("07:54:58~09:01:07은 7시 302초·8시 3600초·9시 67초로 배분(합계=길이)", alloc.get(7) === 302 && alloc.get(8) === 3600 && alloc.get(9) === 67 && [...alloc.values()].reduce((a, b) => a + b, 0) === 3969);
  const al2 = allocateByHour(late);
  check("23→24→25시 가로지르는 방송: 23시 1800·24시 3600·25시 600", al2.get(23) === 1800 && al2.get(24) === 3600 && al2.get(25) === 600);
  const al3 = allocateByHour(iv("2026-10-04", "25:30:00", "27:30:00"));
  check("26시 이후 구간은 같은 시계 시각 버킷(26시→2시)으로 접힘", al3.get(25) === 1800 && al3.get(2) === 3600 && al3.get(3) === 1800 && [...al3.values()].reduce((a, b) => a + b, 0) === 7200);

  // ── 시간대 추정 vs 시작 시각별 평균 ─────────────────────────
  const e1 = estimateHourlyPattern([A("2026-10-04", "07:54:58", "09:01:07", 0.07742)]);
  check("07:54:58~09:01:07 방송은 8시 구간에 겹쳐 '방송 없음 0'이 되지 않음(추정 0.07742, 커버리지 100%)", close(hourRow(e1, 8).estimatedRating, 0.07742) && hourRow(e1, 8).estimatedRating !== 0 && close(hourRow(e1, 8).coverageRatio, 1) && hourRow(e1, 8).overlappingCount === 1);
  check("시작 시각별 평균은 별도 metric: 8시에 시작한 방송이 없으므로 null(0 아님), 7시에는 0.07742", hourRow(e1, 8).startAvgRating === null && hourRow(e1, 8).programCount === 0 && close(hourRow(e1, 7).startAvgRating, 0.07742) && hourRow(e1, 7).programCount === 1);
  check("겹친 방송이 없는 시간대는 결측(null)이며 0이 아님, 커버리지 0", hourRow(e1, 12).estimatedRating === null && hourRow(e1, 12).coverageRatio === 0 && hourRow(e1, 12).overlappingCount === 0);
  check("7시 커버리지는 302/3600(일부만 관측)", close(hourRow(e1, 7).coverageRatio, 302 / 3600));
  const e2 = estimateHourlyPattern([A("2026-10-04", "19:30:00", "20:15:00", 0.2), A("2026-10-04", "20:15:00", "21:00:00", 0.1)]);
  check("시간가중: 20시에 A 900초(0.2)+B 2700초(0.1) → 0.125, 시작 평균은 20시에 시작한 B만 0.1", close(hourRow(e2, 20).estimatedRating, 0.125) && close(hourRow(e2, 20).startAvgRating, 0.1) && hourRow(e2, 20).overlappingCount === 2);
  const e3 = estimateHourlyPattern([A("2026-10-04", "20:00:00", "21:00:00", 0)]);
  check("실제 시청률 0은 관측값 0(추정 0)이고, 방송이 없는 시간은 null — 둘이 구분됨", hourRow(e3, 20).estimatedRating === 0 && hourRow(e3, 21).estimatedRating === null);
  const e4 = estimateHourlyPattern([A("2026-10-04", "20:00:00", "21:00:00", null), A("2026-10-04", "21:00:00", "22:00:00", 0.3)]);
  check("시청률 결측 방송은 추정 평균에서 빠지지만 편성 횟수·겹침 수에는 남음", hourRow(e4, 20).estimatedRating === null && hourRow(e4, 20).programCount === 1 && hourRow(e4, 20).overlappingCount === 1 && close(hourRow(e4, 21).estimatedRating, 0.3));
  const e5 = estimateHourlyPattern([A("2026-10-04", "10:00:00", "11:00:00", 0.1), A("2026-10-05", "12:00:00", "13:00:00", 0.1)]);
  check("여러 날 커버리지: 상세가 있는 2일 중 1일만 관측된 시간대는 0.5", e5.daysWithDetail === 2 && close(hourRow(e5, 10).coverageRatio, 0.5));
  const e6 = estimateHourlyPattern([A("2026-10-04", "23:30:00", "01:10:00", 0.05)]);
  check("23시→24시→25시: 세 시간대 모두 같은 추정값(자정 넘김 방송이 24·25시 칸에도 반영)", [23, 24, 25].every((h) => close(hourRow(e6, h).estimatedRating, 0.05)) && hourRow(e6, 24).programCount === 0 && hourRow(e6, 23).programCount === 1);
  const e7 = estimateHourlyPattern([A("2026-10-04", "10:00:00", null, 0.1), A("2026-10-04", "11:00:00", "12:00:00", 0.2)]);
  check("종료 없는 방송은 구간 배분에서 제외(이유 기록)하되 시작 시각별 평균·편성 횟수에는 포함", e7.skipped.length === 1 && /종료/.test(e7.skipped[0].reason) && hourRow(e7, 10).programCount === 1 && hourRow(e7, 10).estimatedRating === null && close(hourRow(e7, 10).startAvgRating, 0.1));
  check("방법·한계가 메타데이터에 명시", e1.method === "overlap_weighted_program_average" && /분 단위 실측 아님/.test(e1.note));
  check("24개 시간대(2~25시)를 항상 반환", e1.rows.length === 24 && e1.rows[0].broadcastHour === 2 && e1.rows[23].broadcastHour === 25);

  // ── 배치 점검(공백·맞닿음·겹침·중복) ────────────────────────
  const lay = analyzeLayout([iv("2026-10-04", "20:00:00", "20:58:00"), iv("2026-10-04", "21:00:00", "22:00:00"), iv("2026-10-04", "22:00:00", "23:00:00"), iv("2026-10-04", "22:30:00", "23:30:00"), iv("2026-10-04", "22:30:00", "23:30:00")]);
  check("광고·프로모 공백 120초 / 맞닿음 / 겹침 / 중복 구간을 구분", lay.map((f) => f.kind).join() === "gap,adjacent,overlap,duplicate" && lay[0].seconds === 120 && lay[2].seconds === 1800);

  // ── 프라임 ──────────────────────────────────────────────────
  const rule = primeRuleFor("ENA", "2026-10-05")!;
  const none: ReadonlySet<string> = new Set();
  const p1 = primeOverlap(iv("2026-10-05", "18:30:00", "19:30:00"), rule, none);
  check("평일(월) 18:30~19:30은 프라임(19~23)과 30분만 겹침", p1.dayType === "weekday" && p1.primeSeconds === 1800 && close(p1.primeShare, 0.5));
  const p2 = primeOverlap(iv("2026-10-04", "18:30:00", "19:30:00"), primeRuleFor("ENA", "2026-10-04")!, none);
  check("일요일은 18시부터 프라임: 18:30~19:30 전체가 프라임", p2.dayType === "weekend" && p2.primeSeconds === 3600);
  const p3 = primeOverlap(iv("2026-10-05", "18:30:00", "19:30:00"), rule, new Set(["2026-10-05"]));
  check("공휴일(월요일이라도)은 주말 규칙: 18:30~19:30 전체 프라임", p3.dayType === "weekend" && p3.primeSeconds === 3600);
  const p4 = primeOverlap(iv("2026-10-05", "22:30:00", "00:10:00"), rule, none);
  check("프라임 끝(23시)을 가로지르는 22:30~00:10은 30분만 프라임(전체 6000초)", p4.primeSeconds === 1800 && p4.totalSeconds === 6000);
  check("프라임 경계: 22:00~23:00은 정확히 3600, 23:00~00:00은 0(반열림)", primeOverlap(iv("2026-10-05", "22:00:00", "23:00:00"), rule, none).primeSeconds === 3600 && primeOverlap(iv("2026-10-05", "23:00:00", "00:00:00"), rule, none).primeSeconds === 0);
  const custom: PrimeRule[] = [
    ...PRIME_RULES,
    { channelCode: "OLIFE", validFrom: "2026-11-01", validTo: null, weekday: { fromHour: 20, toHour: 24 }, weekend: { fromHour: 20, toHour: 24 }, source: "테스트" },
  ];
  check("프라임 규칙: 채널·적용기간별 설정(OLIFE는 11/1부터 별도, 이전·다른 채널은 기본)", primeRuleFor("OLIFE", "2026-11-05", custom)?.weekday.fromHour === 20 && primeRuleFor("OLIFE", "2026-10-05", custom)?.weekday.fromHour === 19 && primeRuleFor("ENA", "2026-11-05", custom)?.weekday.fromHour === 19);
  check("현행 프라임(평일 19~23·주말 18~23) 보존", PRIME_RULES[0].weekday.fromHour === 19 && PRIME_RULES[0].weekday.toHour === 23 && PRIME_RULES[0].weekend.fromHour === 18 && PRIME_RULES[0].weekend.toHour === 23 && /2026-09-09/.test(PRIME_RULES[0].source));
  const hc1 = describeHolidayCalendar(["2026-10-03", "2026-10-09"]);
  const hc2 = describeHolidayCalendar(["2026-10-03", "2026-10-09", "2026-12-25"]);
  check("공휴일 달력 버전·시간대·범위 관리(날짜가 바뀌면 버전 변경)", hc1.version !== hc2.version && hc1.timezone === "Asia/Seoul" && hc1.count === 2 && hc1.range?.from === "2026-10-03" && describeHolidayCalendar(["2026-10-09", "2026-10-03"]).version === hc1.version);

  // ── 경쟁 대표성 ─────────────────────────────────────────────
  const sc = scoreOverlap({ ourStart: "14:10:50", ourEnd: "15:16:59", theirStart: "15:16:21", theirEnd: "16:44:00" });
  check("38초 겹침은 대표 경쟁작이 아님(근거 문구에 38초와 기준 표시), 프로그램 평균 비교 한계 문구 포함", !sc.representative && sc.overlapSeconds === 38 && /38초/.test(sc.reason) && sc.basisNote === OVERLAP_BASIS_NOTE && /분 단위 시청률 비교가 아닙니다/.test(sc.basisNote));
  check("임계값은 설정 가능(기준을 30초·비율 0으로 낮추면 같은 38초가 대표)", scoreOverlap({ ourStart: "14:10:50", ourEnd: "15:16:59", theirStart: "15:16:21", theirEnd: "16:44:00" }, { minOverlapSec: 30, minRatio: 0 }).representative);
  const strong = scoreOverlap({ ourStart: "20:00:00", ourEnd: "21:10:00", theirStart: "20:30:00", theirEnd: "22:00:00" });
  check("충분한 겹침(2400초, 우리 방송의 57%)은 대표", strong.representative && strong.overlapSeconds === 2400 && close(strong.oursRatio, 2400 / 4200) && /겹침 2400초/.test(strong.reason));
  check("짧은 경쟁 방송이 우리 방송 안에 통째로 들어간 10분은 대표(경쟁 방송의 100%), 9분 59초는 아님", scoreOverlap({ ourStart: "20:00:00", ourEnd: "21:00:00", theirStart: "20:10:00", theirEnd: "20:20:00" }).representative && !scoreOverlap({ ourStart: "20:00:00", ourEnd: "21:00:00", theirStart: "20:10:00", theirEnd: "20:19:59" }).representative);
  check("겹침이 길어도 양쪽 길이 대비 비율이 낮으면(우리 3시간·경쟁 3시간 중 10분) 대표 아님", !scoreOverlap({ ourStart: "18:00:00", ourEnd: "21:00:00", theirStart: "20:50:00", theirEnd: "23:50:00" }).representative);
  const cav = scoreOverlap({ ourStart: "20:00:00", ourEnd: "21:00:00", theirStart: "20:00:00", theirEnd: "21:00:00", ourTargetLabel: "개인2049", theirTargetLabel: "National 유료방송가입가구", theirName: "프로야구 중계" });
  check("타깃·지역·중계 특성이 다르면 직접 비교 한계를 caveat로 표시", cav.representative && cav.caveats.length === 3 && cav.caveats.some((c) => /지역/.test(c)) && cav.caveats.some((c) => /시청 대상/.test(c)) && cav.caveats.some((c) => /중계/.test(c)));
  const rows = [
    { our_start_time: "20:00:00", our_end_time: "21:00:00", our_program_name: "우리", competitor_name: "A", competitor_program_name: "경쟁A", competitor_start_time: "20:00:00", competitor_end_time: "20:12:00", competitor_rating: 0.3 },
    { our_start_time: "20:00:00", our_end_time: "21:00:00", our_program_name: "우리", competitor_name: "B", competitor_program_name: "경쟁B", competitor_start_time: "19:00:00", competitor_end_time: "21:00:00", competitor_rating: 0.5 },
    { our_start_time: "20:00:00", our_end_time: "21:00:00", our_program_name: "우리", competitor_name: "C", competitor_program_name: "경쟁C", competitor_start_time: "20:59:22", competitor_end_time: "23:00:00", competitor_rating: 0.9 },
    { our_start_time: "20:00:00", our_end_time: "21:00:00", our_program_name: "우리", competitor_name: "D", competitor_program_name: "경쟁D", competitor_start_time: "20:00:00", competitor_end_time: null, competitor_rating: null },
  ];
  const sel = selectRepresentativeCompetitors(rows, DEFAULT_OVERLAP_CONFIG, { topN: 3 });
  check("대표 경쟁작 선별: 38초 겹침(시청률 0.9)은 제외, 대표 둘은 시청률 순(B→A), 종료 불명 D는 '확인 불가'로 남김", sel.map((r) => r.competitor_name).join() === "B,A,D" && !sel.some((r) => r.competitor_name === "C") && sel.find((r) => r.competitor_name === "D")?.unverifiable === true && sel.find((r) => r.competitor_name === "A")?.representative === true);
  check("topN 제한 적용", selectRepresentativeCompetitors(rows, DEFAULT_OVERLAP_CONFIG, { topN: 1 }).length === 1);

  // ── 슬롯 비교 조건 ─────────────────────────────────────────
  const hol = new Set(["2026-10-09"]);
  const base = slotConditions("나는SOLO<본>", "2026-10-07", hol);
  check("비교 조건 구분: 본방/재방·요일 유형·특집·중계·시즌", slotConditions("나는SOLO<재>", "2026-10-07", hol).airingType === "rerun" && base.airingType === "first" && slotConditions("나는SOLO", "2026-10-07", hol).airingType === "untagged" && slotConditions("나는SOLO", "2026-10-10", hol).dayType === "weekend" && slotConditions("나는SOLO", "2026-10-09", hol).dayType === "weekend" && slotConditions("추석특집 영화", "2026-10-07", hol).special && slotConditions("프로야구 중계", "2026-10-07", hol).sportsOrLive && slotConditions("강철부대 시즌2", "2026-10-07", hol).season === "2");
  check("같은 슬롯 평균에 섞으면 안 되는 조합을 거부, 같은 조건은 허용", !compareSlotConditions(base, slotConditions("나는SOLO<재>", "2026-10-07", hol)).comparable && compareSlotConditions(base, slotConditions("나는SOLO<재>", "2026-10-07", hol)).mismatches[0] === "본방/재방" && !compareSlotConditions(base, slotConditions("나는SOLO<본>", "2026-10-10", hol)).comparable && compareSlotConditions(base, slotConditions("나는SOLO<본>", "2026-10-08", hol)).comparable);
  check("미편성·시청률 0·시청률 결측·미수신을 별도 상태로 구분", classifySlot(true, null) === "not_aired" && classifySlot(true, { rating: 0 }) === "zero_rating" && classifySlot(true, { rating: null }) === "rating_missing" && classifySlot(true, { rating: 0.1 }) === "rated" && classifySlot(false, null) === "unobserved");

  // ── 조회 계층(대역 DB): 기존 RPC와 같은 모집단 ──────────────
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-real";
  const { supabase } = await import("../src/lib/supabase");
  const db = new FakeDb();
  (supabase as unknown as { from: (t: string) => unknown }).from = (t) => db.from(t);
  const { fetchHourlyPattern, sameDowDates } = await import("../src/lib/broadcastTime/hourlyFetch");
  db.rows("channels").push({ id: "c-ena", code: "ENA" }, { id: "c-play", code: "ENA_PLAY" });
  db.rows("targets").push({ id: "t-2049", label: "수도권 2049" }, { id: "t-hh", label: "전국 유료가구" });
  const R = (o: Record<string, unknown>) => ({ channel_id: "c-ena", target_id: "t-2049", source_type: "nielsen_daily", program_id: "p1", broadcast_date: "2026-10-04", start_time: "07:54:58", end_time: "09:01:07", rating: 0.07742, share: 1, reach: 2, time_spent_seconds: 100, ...o });
  db.seed("ratings", [
    R({}),
    R({ target_id: "t-hh", rating: 0.5 }), // 다른 타깃
    R({ channel_id: "c-play", rating: 0.9 }), // 다른 채널
    R({ source_type: "annual_2025", rating: 0.9 }), // 제외 소스
    R({ program_id: null, rating: 0.9 }), // 채널 집계 행
    R({ start_time: null, rating: 0.9 }), // 시작 시각 없음
    R({ broadcast_date: "2026-09-01", rating: 0.9 }), // 기간 밖
    R({ target_id: null, source_type: "skyuhd", start_time: "10:00:00", end_time: "11:00:00", rating: 0.04 }), // 타깃 구분 없는 skyUHD 행은 포함
  ]);
  const fr = await fetchHourlyPattern({ channelCode: "ENA", targetLabel: "수도권 2049", dateFrom: "2026-10-01", dateTo: "2026-10-07" });
  const frData = fr.data ?? [];
  const f8 = frData.find((r) => r.broadcast_hour === 8);
  const f10 = frData.find((r) => r.broadcast_hour === 10);
  check("조회 계층: 기존 RPC와 같은 필터(채널·타깃·소스·program_id·시작시각·기간, 타깃 null 행 포함)", !fr.error && frData.length === 24 && close(f8?.avg_rating, 0.07742) && f8?.program_count === 0 && close(f10?.avg_rating, 0.04) && frData.find((r) => r.broadcast_hour === 7)?.program_count === 1 && frData.find((r) => r.broadcast_hour === 12)?.avg_rating === null, JSON.stringify(f8));
  check("조회 계층: 결과 모양 호환(avg_*·program_count)에 추정 표시 필드 추가", f8?.estimated === true && typeof f8?.coverage_ratio === "number" && f8?.start_avg_rating === null);
  check("동요일 날짜 산출(Postgres dow 0=일): 10/7(수=3) 최근 2주 → 9/30, 10/7", JSON.stringify([...sameDowDates("2026-10-07", 3, 2)].sort()) === JSON.stringify(["2026-09-30", "2026-10-07"]) && sameDowDates("2026-10-07", 3, 4).length === 4);
  db.seed("ratings", [R({ broadcast_date: "2026-10-07", start_time: "20:00:00", end_time: "21:00:00", rating: 0.2 })]);
  const dow = await fetchHourlyPattern({ channelCode: "ENA", targetLabel: "수도권 2049", dateFrom: "2026-09-01", dateTo: "2026-10-07", targetDow: 3, targetWeeks: 2 });
  check("동요일 조회: 선택한 요일 날짜만 집계(10/4 일요일 행 제외)", close(dow.data?.find((r) => r.broadcast_hour === 20)?.avg_rating, 0.2) && dow.data?.find((r) => r.broadcast_hour === 8)?.avg_rating === null);
  const many: Record<string, unknown>[] = [];
  for (let i = 0; i < 2300; i++) many.push(R({ broadcast_date: "2026-10-02", start_time: "15:00:00", end_time: "16:00:00", rating: 0.1 }));
  db.seed("ratings", many);
  const paged = await fetchHourlyPattern({ channelCode: "ENA", targetLabel: "수도권 2049", dateFrom: "2026-10-02", dateTo: "2026-10-02" });
  check("조회 계층: 1000건 초과(2300건)도 페이지를 이어 모두 집계", paged.data?.find((r) => r.broadcast_hour === 15)?.program_count === 2300);
  const missing = await fetchHourlyPattern({ channelCode: "NOPE", targetLabel: "수도권 2049", dateFrom: "2026-10-01", dateTo: "2026-10-07" });
  check("없는 채널은 빈 결과(오류 아님)", !missing.error && missing.data?.length === 0);

  // ── 실제 원본(파일이 있을 때만) ─────────────────────────────
  const fixtureDir = process.env.NIELSEN_FIXTURE_DIR ?? path.resolve("Nielsen Data/2026/10");
  const file = path.join(fixtureDir, "닐슨_채널시청률(261004).xls");
  if (!fs.existsSync(file)) {
    skipped++;
    console.log(`⏭️  SKIP 실제 원본 시간대·겹침 대조 — 파일 없음(${file})`);
  } else {
    const { parseNielsenDailyWorkbook } = await import("../src/lib/nielsenDaily");
    const parsed = parseNielsenDailyWorkbook(fs.readFileSync(file), "닐슨_채널시청률(261004).xls", new Set(["MBC every1"]));
    if (!parsed.ok) check("실제 일간 파일 파싱", false, parsed.message);
    else {
      const playRows = parsed.programRows.filter((r) => r.channelCode === "ENA_PLAY" && !r.isDailyAggregate && r.targetLabel === "수도권 2049");
      const airings: HourlyAiring[] = playRows.map((r) => ({ date: parsed.reportDate, startClock: r.startTime, endClock: r.endTime, rating: r.rating }));
      const est = estimateHourlyPattern(airings);
      const premiere = playRows.find((r) => r.startTime === "07:54:58" && r.endTime === "09:01:07");
      check("원본 ENA PLAY 2049: 07:54:58~09:01:07(0.07742) 방송이 8시 추정에 반영되어 8시가 결측·0이 아님", !!premiere && close(premiere.rating, 0.07742) && hourRow(est, 8).estimatedRating !== null && hourRow(est, 8).overlappingCount >= 1 && hourRow(est, 8).coverageRatio > 0);
      const noEnd = airings.filter((a) => !a.endClock).length;
      check("원본 ENA PLAY: 모든 방송 구간 생성 성공(종료 없음·0초·형식 오류 0건), 하루 방송 시간 합 ≤ 24시간", est.skipped.length === 0 && noEnd === 0, JSON.stringify(est.skipped.slice(0, 3)));
      const conserved = playRows.every((r) => {
        const i = airingInterval(parsed.reportDate, r.startTime, r.endTime).interval;
        return !!i && [...allocateByHour(i).values()].reduce((a, b) => a + b, 0) === i.durationSec;
      });
      check("원본 전 방송에서 시간대 배분 합계 = 방송 길이(초 보존)", conserved);
      const oursRow = parsed.programRows.find((r) => r.channelCode === "ENA_PLAY" && !r.isDailyAggregate && r.startTime === "14:10:50" && r.endTime === "15:16:59");
      const comp = parsed.competitorProgramRows.find((r) => r.competitorName === "MBC every1" && r.startTime === "15:16:21" && r.endTime === "16:44:00");
      check("원본에서 F05 사례 확인(ENA PLAY 14:10:50~15:16:59, MBC every1 15:16:21~16:44:00)", !!oursRow && !!comp, `ours=${!!oursRow} comp=${!!comp} ${comp?.programName ?? ""}`);
      if (oursRow && comp) {
        const s = scoreOverlap({ ourStart: oursRow.startTime, ourEnd: oursRow.endTime, theirStart: comp.startTime, theirEnd: comp.endTime });
        check("원본 값으로 계산해도 교집합 38초·대표 경쟁작 아님", s.overlapSeconds === 38 && !s.representative && close(comp.rating, 0.23319, 1e-5), `${s.overlapSeconds}초 rating=${comp.rating}`);
      }
      const lays = analyzeLayout(playRows.map((r) => airingInterval(parsed.reportDate, r.startTime, r.endTime).interval!).filter(Boolean));
      check("원본 ENA PLAY 하루 배치 점검이 겹침·중복을 보고(값은 정보용, 오류 없이 계산)", Array.isArray(lays));
    }
  }

  console.log(`\n${passed}건 통과, ${failures.length}건 실패${skipped ? `, ${skipped}건 SKIP(검증 안 됨)` : ""}`);
  if (failures.length) {
    console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
