// 보고서 근거 단락(편성 변경 사후 효과·공휴일 영향·예측 적중·IPTV 요약)이 실제 Word·PPT 파일에 들어가는지 점검한다(읽기 전용 + 파일 출력).
// 스냅샷은 메모리 저장소로 만들어 DB에 저장하지 않는다. 결과 파일에는 실제 시청률이 들어가므로 저장소 밖(기본 임시 폴더)에 쓴다.
// 사용법: npx tsx --env-file=.env scripts/check-report-render.ts <채널코드> <weekly|monthly> [분석 종료일 YYYY-MM-DD] [출력 폴더]
//   weekly = 종료일 앞 7일 vs 그 앞 7일 / monthly = 종료일이 속한 달 직전 한 달(전월 전체) vs 그 앞 달
//   예) npx tsx --env-file=.env scripts/check-report-render.ts ENA_PLAY weekly 2026-11-08
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { getOrCreateSnapshot } from "../src/lib/reportSnapshot/service";
import { createMemoryStore } from "../src/lib/reportSnapshot/store";
import { buildReportModel } from "../src/lib/reportSnapshot/template";
import { renderModelDocx } from "../src/lib/reportSnapshot/renderDocx";
import { renderDeckPptx } from "../src/lib/reportSnapshot/renderPptx";
import { planOf } from "../src/lib/reportSnapshot/deckPlan";
import type { AudienceReportRequest } from "../src/lib/audienceReport/reportBuilder";

const EVIDENCE: { key: string; title: string; needle: string }[] = [
  { key: "change_effect", title: "편성 변경 사후 효과", needle: "편성 변경 사후 효과" },
  { key: "holiday_effect", title: "공휴일 영향", needle: "공휴일 영향" },
  { key: "forecast_accuracy", title: "예측 적중", needle: "예측 적중" },
  { key: "benchmark_gaps", title: "비교군 우수 사례", needle: "비교군 우수 사례" },
  { key: "iptv_summary", title: "IPTV 셋톱 요약", needle: "IPTV 셋톱 요약" },
];
const BAD = [/undefined/, /NaN/, /\[object/, /Infinity/, /null%/];

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function requestFor(cadence: string, end: string): AudienceReportRequest {
  if (cadence === "weekly") return { mode: "compare", dateFrom: addDays(end, -6), dateTo: end, priorDateFrom: addDays(end, -13), priorDateTo: addDays(end, -7) };
  // 월간: 종료일이 속한 달의 직전 한 달 전체 vs 그 앞 달 전체
  const first = `${end.slice(0, 7)}-01`;
  const prevEnd = addDays(first, -1);
  const prevStart = `${prevEnd.slice(0, 7)}-01`;
  const prev2End = addDays(prevStart, -1);
  return { mode: "compare", dateFrom: prevStart, dateTo: prevEnd, priorDateFrom: `${prev2End.slice(0, 7)}-01`, priorDateTo: prev2End };
}

async function textsOf(buf: Buffer, partRe: RegExp): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => partRe.test(n));
  const parts = await Promise.all(names.map((n) => zip.files[n].async("string")));
  // 단락·줄 경계를 공백으로 바꾼 뒤 태그를 제거한다
  return parts.map((x) => x.replace(/<\/(w:p|a:p)>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join("\n");
}

async function main() {
  const [channel, cadence, endArg, outArg] = process.argv.slice(2);
  if (!channel || (cadence !== "weekly" && cadence !== "monthly")) {
    console.error("사용법: check-report-render.ts <채널코드> <weekly|monthly> [분석 종료일] [출력 폴더]");
    process.exit(1);
  }
  const end = endArg ?? new Date(Date.now() + 9 * 3600 * 1000 - 2 * 86400000).toISOString().slice(0, 10);
  const outDir = outArg ?? path.join(os.tmpdir(), "report-render-check");
  fs.mkdirSync(outDir, { recursive: true });

  const t0 = Date.now();
  const res = await getOrCreateSnapshot({ subject: "channel", channelCode: channel, request: requestFor(cadence, end), refresh: true }, createMemoryStore());
  const snap = res.snapshot;
  console.log(`스냅샷 ${snap.id} (${snap.cadence}) ${Math.round((Date.now() - t0) / 1000)}초 — 분석 ${snap.analysis.label}`);
  console.log(`extras: ${Object.keys(snap.extras).join(", ") || "(없음)"}`);

  const model = buildReportModel(snap);
  const all = [...model.body, ...model.appendix];
  console.log(`\n본문 ${model.body.length}개·부록 ${model.appendix.length}개 섹션`);
  for (const e of EVIDENCE) {
    const hit = all.find((s) => s.key === e.key);
    const where = model.body.some((s) => s.key === e.key) ? "본문" : model.appendix.some((s) => s.key === e.key) ? "부록" : "없음";
    console.log(`  ${e.key.padEnd(18)} ${where}${hit ? `  ← ${hit.title} (블록 ${hit.blocks.length}개)` : ""}`);
  }

  // Word
  const docx = await renderModelDocx(model);
  const docxPath = path.join(outDir, `${channel}_${cadence}.docx`);
  fs.writeFileSync(docxPath, docx);
  const docxText = await textsOf(docx, /^word\/document\.xml$/);
  // PPT
  const plan = planOf(model, snap.document);
  const pptx = await renderDeckPptx(plan);
  const pptxPath = path.join(outDir, `${channel}_${cadence}.pptx`);
  fs.writeFileSync(pptxPath, pptx);
  const pptxText = await textsOf(pptx, /^ppt\/slides\/slide\d+\.xml$/);
  console.log(`\nWord ${Math.round(docx.length / 1024)}KB → ${docxPath}\nPPT  ${Math.round(pptx.length / 1024)}KB(슬라이드 ${plan.slides.length}장) → ${pptxPath}`);

  let problems = 0;
  for (const e of EVIDENCE) {
    const inModel = all.some((s) => s.key === e.key);
    if (!inModel) continue; // 이 보고서에는 그 단락이 없다(자료·표본 부족) — 정상
    const w = docxText.includes(e.needle);
    const p = pptxText.includes(e.needle);
    console.log(`  ${w && p ? "✓" : "✗"} ${e.title}: Word ${w ? "있음" : "없음"} · PPT ${p ? "있음" : "없음"}`);
    if (!w || !p) problems++;
  }
  for (const [label, text] of [["Word", docxText], ["PPT", pptxText]] as const) {
    for (const re of BAD) {
      const m = text.match(re);
      if (m) {
        const i = text.indexOf(m[0]);
        console.log(`  ✗ ${label}에 이상 문자열 ${re}: …${text.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, " ")}…`);
        problems++;
      }
    }
  }
  // 새 단락의 대표 문장이 파일 텍스트에 실제로 있는지(제목만이 아니라 본문까지)
  for (const e of EVIDENCE) {
    const sec = all.find((s) => s.key === e.key);
    if (!sec) continue;
    const bullets = sec.blocks.find((b) => b.kind === "bullets") as { items: string[] } | undefined;
    const probe = bullets?.items[0]?.replace(/\s+/g, " ").slice(0, 24);
    if (probe) {
      const found = docxText.replace(/\s+/g, " ").includes(probe);
      console.log(`  ${found ? "✓" : "✗"} ${e.title} 첫 문장 Word 본문 확인("${probe}…")`);
      if (!found) problems++;
    }
  }
  console.log(problems === 0 ? "\n렌더링 점검 통과" : `\n문제 ${problems}건`);
  process.exit(problems === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
