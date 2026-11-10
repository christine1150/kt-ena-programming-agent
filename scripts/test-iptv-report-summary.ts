// 주간·월간 보고서 "IPTV 셋톱 요약"(src/lib/reportSnapshot/iptvSummary.ts·iptvSummaryText.ts) 테스트 — tsx 로 실행, DB·네트워크 접근 없음(가짜 DB).
// 실행: npm run test:iptv-report-summary
// 보증: 섹션 문장·표(변화율·순위·도달·1인당 시청), 자료 없음이면 섹션 없음, 부분 집계 문구, 채널·타깃 대응, 행 변환, 비교 기간 없을 때 빈 구간.
import { iptvChangePct, iptvChangeText, iptvSummarySection, IPTV_SUMMARY_NOTE } from "../src/lib/reportSnapshot/iptvSummaryText";
import { loadIptvReportSummary } from "../src/lib/reportSnapshot/iptvSummary";
import type { IptvReportSummary } from "../src/lib/reportSnapshot/types";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const base: IptvReportSummary = {
  channelName: "ONCE", targetKind: "household", from: "2026-10-01", to: "2026-10-31", prevFrom: "2026-09-01", prevTo: "2026-09-30", lastDate: "2026-11-09", partial: false,
  airings: 557, avgRating: 0.04404, prevAirings: 541, prevAvgRating: 0.05293, avgReachRate: 0.237, minutesPerReacher: 14.3, observedChannels: 35, ratingRank: 29,
  topPrograms: [{ name: "자이언트", airings: 6, rating: 0.06928, minutesPerReacher: 19.6 }],
};

check("변화율", Math.round((iptvChangePct(0.04404, 0.05293) ?? 0) * 10) === -168 && iptvChangePct(1, 0) === null && iptvChangePct(null, 1) === null);
check("변화 문구", iptvChangeText(-16.8).includes("▼ 16.8%") && iptvChangeText(12.34).includes("▲ 12.3%") && iptvChangeText(0.2) === "직전 기간과 거의 같음" && iptvChangeText(null) === "직전 기간 자료 없음");

const sec = iptvSummarySection(base, "ONCE");
const txt = JSON.stringify(sec);
check("섹션 키·제목", sec?.key === "iptv_summary" && sec.title.includes("IPTV") && sec.title.includes("보조"));
check("시청률·변화·순위·도달·1인당 시청 문장", txt.includes("0.044") && txt.includes("▼ 16.8%") && txt.includes("35개 중 29위") && txt.includes("도달률 0.24%") && txt.includes("1인당 시청 14분"), txt.slice(0, 400));
check("가구 타깃 표기", txt.includes("IPTV 가구"));
check("프로그램 표(IPTV 본방)", txt.includes("프로그램(IPTV 본방)") && txt.includes("자이언트") && txt.includes("6회") && txt.includes("0.069"));
check("보조 자료·닐슨 비교 금지 문구", txt.includes("청약·공식 KPI 기준은 닐슨") && txt.includes(IPTV_SUMMARY_NOTE.slice(0, 12)));
check("문서는 개조식(습니다 없음)", !txt.includes("습니다"));

check("2049 타깃은 추정 표기", JSON.stringify(iptvSummarySection({ ...base, targetKind: "p2049" }, "ENA")).includes("수도권 2049(추정)"));
check("skyUHD 는 시청률 5자리", JSON.stringify(iptvSummarySection({ ...base, channelName: "skyUHD", avgRating: 0.002564 }, "SKYUHD")).includes("0.00256"));
check("프로그램이 없으면 표 없음", !iptvSummarySection({ ...base, topPrograms: [] }, "ONCE")?.blocks.some((b) => b.kind === "table"));
check("순위 자료 없으면 순위 문장 없음", !JSON.stringify(iptvSummarySection({ ...base, ratingRank: null }, "ONCE")).includes("위("));
const part = JSON.stringify(iptvSummarySection({ ...base, partial: true, lastDate: "2026-10-20", to: "2026-10-20" }, "ONCE"));
check("부분 집계는 마지막 날짜와 함께 알린다", part.includes("2026-10-20까지라 그 날까지만 집계"));
check("자료 없음·방영 0이면 섹션 없음", iptvSummarySection(null, "ONCE") === null && iptvSummarySection(undefined, "ONCE") === null && iptvSummarySection({ ...base, airings: 0 }, "ONCE") === null && iptvSummarySection({ ...base, avgRating: null }, "ONCE") === null);

async function loaderTest() {
  const calls: Record<string, unknown>[] = [];
  const row = { last_date: "2026-10-20", airings: "557", avg_rating: "0.04404", avg_reach_rate: "0.2370", minutes_per_reacher: "14.3", prev_airings: 541, prev_avg_rating: "0.05293", observed_channels: 35, rating_rank: 29, top_programs: [{ name: "자이언트", airings: 6, rating: 0.06928, minutes_per_reacher: 19.6 }] };
  const db = { from: () => ({}), rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, ...args }); return Promise.resolve({ data: fn === "iptv_report_summary" ? [row] : [], error: null }); } };
  const s = await loadIptvReportSummary(db, { channelCode: "ONCE", period: { dateFrom: "2026-10-01", dateTo: "2026-10-31", priorDateFrom: "2026-09-01", priorDateTo: "2026-09-30" } });
  check("ONCE 는 IPTV 이름·가구로 DB 함수를 부른다", calls.length === 1 && calls[0].p_channel === "ONCE" && calls[0].p_target === "household" && calls[0].p_prev_from === "2026-09-01", JSON.stringify(calls[0]));
  check("행 변환(숫자화)·부분 집계 판정", !!s && s.airings === 557 && s.avgRating === 0.04404 && s.prevAvgRating === 0.05293 && s.ratingRank === 29 && s.partial && s.to === "2026-10-20" && s.topPrograms[0].name === "자이언트" && s.topPrograms[0].minutesPerReacher === 19.6, JSON.stringify(s));
  await loadIptvReportSummary(db, { channelCode: "ENA", period: { dateFrom: "2026-11-02", dateTo: "2026-11-08" } });
  check("ENA 는 2049, 비교 기간이 없으면 빈 구간", calls[1].p_target === "p2049" && calls[1].p_prev_from === "1900-01-01", JSON.stringify(calls[1]));
  const n = calls.length;
  check("자사 채널이 아니면 null(DB 부르지 않음)", (await loadIptvReportSummary(db, { channelCode: "XXX", period: { dateFrom: "2026-10-01", dateTo: "2026-10-31" } })) === null && calls.length === n);
  const none = { from: () => ({}), rpc: () => Promise.resolve({ data: [{ ...row, airings: 0 }], error: null }) };
  check("방영 0이면 null", (await loadIptvReportSummary(none, { channelCode: "ONCE", period: { dateFrom: "2026-10-01", dateTo: "2026-10-31" } })) === null);
  const bad = { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }) };
  let threw = false;
  try { await loadIptvReportSummary(bad, { channelCode: "ONCE", period: { dateFrom: "2026-10-01", dateTo: "2026-10-31" } }); } catch { threw = true; }
  check("DB 오류는 던진다(호출부가 null 로 받아 섹션을 뺀다)", threw);
}

loaderTest()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
