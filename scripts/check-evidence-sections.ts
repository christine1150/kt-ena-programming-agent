// 보고서 근거 단락(편성 변경 사후 효과·공휴일 영향)을 실제 자료로 만들어 보는 읽기 전용 점검 — 고도화 B1·A2.
// 사용법: npx tsx --env-file=.env scripts/check-evidence-sections.ts <채널코드> <분석 시작일> <분석 종료일>
//   예) npx tsx --env-file=.env scripts/check-evidence-sections.ts ENA_PLAY 2026-05-01 2026-05-10
// 스냅샷을 만들거나 저장하지 않는다(select만). 결과 문장·표를 그대로 출력해 문구·수치를 눈으로 확인한다.
import { changeEffectSection, forecastAccuracySection, holidayEffectSection } from "../src/lib/reportSnapshot/evidenceText";
import { loadChangeEffect, loadForecastAccuracy, loadHolidayEffect } from "../src/lib/reportSnapshot/evidenceLoaders";

const [channelCode, from, to] = process.argv.slice(2);
if (!channelCode || !from || !to) {
  console.error("사용법: check-evidence-sections.ts <채널코드> <분석 시작일> <분석 종료일>");
  process.exit(1);
}

function print(title: string, sec: ReturnType<typeof changeEffectSection>) {
  console.log(`\n=== ${title} ===`);
  if (!sec) {
    console.log("(섹션 없음 — 사례 부족이거나 해당 날짜 없음)");
    return;
  }
  console.log(`[${sec.key}] ${sec.title}`);
  for (const b of sec.blocks) {
    if (b.kind === "bullets") b.items.forEach((t) => console.log(`  · ${t}`));
    else if (b.kind === "text") console.log(`  ※ ${b.text}`);
    else if (b.kind === "table") {
      console.log(`  | ${b.headers.join(" | ")} |`);
      b.rows.forEach((r) => console.log(`  | ${r.join(" | ")} |`));
    }
  }
}

async function main() {
  const t0 = Date.now();
  const ce = await loadChangeEffect({ channelCode, analysisTo: to });
  console.log(`편성 변경 사후 효과 로드 ${Date.now() - t0}ms`, ce ? `(교체 ${ce.replace.n}·종료 뒤 ${ce.replace.endedN}, 이동 ${ce.move.n}, 최근 ${ce.recent.length}건, 기준 ${ce.basis})` : "(null)");
  print("편성 변경 사후 효과", changeEffectSection(ce, channelCode));
  const t1 = Date.now();
  const he = await loadHolidayEffect({ channelCode, from, to });
  console.log(`\n공휴일 영향 로드 ${Date.now() - t1}ms`, he ? `(날짜 ${he.days.length}개)` : "(null)");
  print("공휴일 영향", holidayEffectSection(he));
  const t2 = Date.now();
  const fa = await loadForecastAccuracy({ channelCode, analysisTo: to });
  console.log(`\n예측 적중 로드 ${Date.now() - t2}ms`, fa ? `(${fa.weeks}주, MATCHED ${fa.slots.matched}칸)` : "(null)");
  print("예측 적중", forecastAccuracySection(fa, channelCode));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
