// 단계 16 — 통합 검증 추적표·dry-run·회고·기능 끄개·운영 문서 테스트. 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:traceability
//
// 이 테스트가 보증하는 것: 체크리스트(04)·원본 대조(03)·발견사항 F01~F19·Avail A01~A19 전부가 추적표에 있고, 연결한 검사 이름이 실제 테스트 파일에 있으며,
// 미검증 항목이 통과로 표시되지 않고, 문서가 원본 표와 같고, 읽기 전용 도구가 쓰기를 하지 않고, 출시 보류 목록·운영 문서가 갖춰졌다.
// 보증하지 못하는 것: 연결한 테스트가 실제로 통과하는지(그건 각 test:* 스크립트의 결과이며 PROGRESS.md에 실행 기록을 둔다).
import fs from "node:fs";
import path from "node:path";
import { ALL_ITEMS, AVAIL_CASES, CHECKLIST, FINDINGS, GOLDEN_REFS, PARSER_EDGE, type TraceItem, type TraceRef } from "./lib/traceability";
import { HOLD_ITEMS, SCENARIOS } from "./lib/traceabilityOps";
import { renderTraceabilityMd } from "./lib/traceabilityRender";
import { compareRankRecords, planBackfill, renderDryRunMarkdown, ROLLBACK_STEPS, type RankRecord } from "../src/lib/ops/dryRun";
import { summarizeByChannelTarget, summarizeByTarget, summarizeRetro, renderRetroMarkdown, type WeekResult } from "../src/lib/ops/retrospective";
import { FEATURE_FLAGS, isFeatureOn } from "../src/lib/featureFlags";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1. 원본 목록과 추적표의 일치 ─────────────────────────────
const ids = (items: TraceItem[]) => new Set(items.map((i) => i.id));
const checklistText = read("ENA_Agent_개선패키지/04_통합수용체크리스트.txt");
const checklistIds = [...checklistText.matchAll(/^([DMUOPR]\d{2})\s/gm)].map((m) => m[1]);
const missingChecklist = checklistIds.filter((id) => !ids(CHECKLIST).has(id));
check(`체크리스트 04의 ${checklistIds.length}개 항목이 모두 추적표에 있다`, checklistIds.length === 39 && missingChecklist.length === 0, missingChecklist.join(","));
check("추적표에 04에 없는 체크리스트 ID가 없다", CHECKLIST.every((i) => checklistIds.includes(i.id)));
const availSpec = read("ENA_Agent_개선패키지/05_Avail_설계명세.txt");
const availIds = [...availSpec.matchAll(/^(A\d{2})\s/gm)].map((m) => m[1]);
check("Avail 명세의 A01~A19 19건이 모두 추적표에 있다", availIds.length === 19 && availIds.every((id) => ids(AVAIL_CASES).has(id)) && AVAIL_CASES.length === 19);
const findingsDoc = read("docs/agent-improvement/FINDINGS.md");
const findingIds = [...new Set([...findingsDoc.matchAll(/^\| (F\d{2}) /gm)].map((m) => m[1]))];
check("발견사항 F01~F19 19건이 모두 추적표에 있다", findingIds.length === 19 && findingIds.every((id) => ids(FINDINGS).has(id)) && FINDINGS.length === 19);
const golden = JSON.parse(read("ENA_Agent_개선패키지/03_원본대조_회귀사례.json")) as { channel_golden_records: unknown[]; parser_edge_cases: unknown[] };
check("원본 대조 14건과 파서 예외 5건이 추적표에 있다", golden.channel_golden_records.length === 14 && golden.parser_edge_cases.length === 5 && PARSER_EDGE.length === 5 && GOLDEN_REFS.length >= 2);

// ── 2. 연결한 검사가 실제로 있다 ─────────────────────────────
const fileCache = new Map<string, string>();
const fileText = (f: string) => {
  if (!fileCache.has(f)) fileCache.set(f, exists(f) ? read(f) : "");
  return fileCache.get(f)!;
};
const allRefs: { owner: string; ref: TraceRef }[] = [
  ...ALL_ITEMS.flatMap((i) => i.refs.map((ref) => ({ owner: i.id, ref }))),
  ...GOLDEN_REFS.map((ref) => ({ owner: "golden", ref })),
  ...SCENARIOS.flatMap((s) => (["daily", "weekly", "monthly"] as const).flatMap((k) => s[k].refs.map((ref) => ({ owner: `${s.id}.${k}`, ref })))),
];
const brokenRefs = allRefs.filter(({ ref }) => !exists(ref.file) || !fileText(ref.file).includes(ref.find));
check(`연결한 검사 ${allRefs.length}개가 모두 실제 테스트 파일에 있다`, brokenRefs.length === 0, brokenRefs.slice(0, 5).map((b) => `${b.owner}: ${b.ref.file} › ${b.ref.find.slice(0, 30)}`).join(" | "));

// ── 3. 상태 규칙: 미검증은 통과가 아니다 ─────────────────────
const noEvidence = ALL_ITEMS.filter((i) => i.status !== "not_done" && i.refs.length === 0);
check("통과·부분 검증으로 적은 항목은 근거 검사가 1개 이상 있다", noEvidence.length === 0, noEvidence.map((i) => i.id).join(","));
const noNote = ALL_ITEMS.filter((i) => (i.status === "partial" || i.status === "needs_real_data" || i.status === "not_done") && !(i.note && i.note.length > 10));
check("부분·실제 자료 필요·미구현 항목에는 사유(note)가 있다", noNote.length === 0, noNote.map((i) => i.id).join(","));
const falselyVerified = ALL_ITEMS.filter((i) => (i.status === "verified" || i.status === "verified_original") && /미검증|미구현|검증하지 못/.test(i.note ?? ""));
check("미검증 항목은 통과로 표시되지 않는다(검증됨 상태의 note에 '미검증·미구현' 표현 없음)", falselyVerified.length === 0, falselyVerified.map((i) => i.id).join(","));
check("Avail 19건은 실제 양식 미검증이라 모두 '실제 자료 필요'로 표시", AVAIL_CASES.every((i) => i.status === "needs_real_data"));
const realOnly = ALL_ITEMS.filter((i) => i.status === "verified_original");
check("로컬 원본 파일이 필요한 항목은 따로 구분돼 있다(파일이 없으면 SKIP인 검사)", realOnly.length >= 8 && realOnly.every((i) => i.refs.length > 0));
const scenarioBad = SCENARIOS.flatMap((s) => (["daily", "weekly", "monthly"] as const).map((k) => ({ s, k, c: s[k] }))).filter(({ c }) => c.status !== "verified" && c.status !== "verified_original" && !(c.note && c.note.length > 10));
check("시나리오 칸 중 검증됨이 아닌 칸에는 사유가 있다", scenarioBad.length === 0, scenarioBad.map((b) => `${b.s.id}.${b.k}`).join(","));
check("월간 칸은 실제 월간 양식 미검증을 합성 검증과 분리해 밝힌다", SCENARIOS.every((s) => s.monthly.status === "verified" || /월간|실제/.test(s.monthly.note ?? "")) && SCENARIOS.filter((s) => s.monthly.status === "needs_real_data").every((s) => (s.monthly.note ?? "").includes("실제 월간 파일 샘플 없음") || (s.monthly.note ?? "").includes("실제 Avail 양식은 미검증")));
check("시나리오 12개 × 일간·주간·월간", SCENARIOS.length === 12 && SCENARIOS.every((s) => s.daily && s.weekly && s.monthly));
const noGoldenHidden = !ALL_ITEMS.some((i) => i.id === "PE3" && i.status !== "not_done");
check("미구현 항목(PE3 지역 예외)이 통과로 바뀌어 있지 않다", noGoldenHidden);

// ── 4. 문서가 원본 표와 같다 ────────────────────────────────
const docPath = "docs/agent-improvement/TRACEABILITY.md";
check("TRACEABILITY.md가 원본 표(traceability*.ts)에서 만든 것과 같다", exists(docPath) && read(docPath).replace(/\r\n/g, "\n") === renderTraceabilityMd(), "npm run gen:traceability로 다시 만든다");

// ── 5. dry-run: 순수 계산 ───────────────────────────────────
const rec = (over: Partial<RankRecord> = {}): RankRecord => ({ date: "2026-10-04", channelCode: "ENA", targetLabel: "개인2049", rank: 7, rating: 0.11358, share: 1.39, reach: 5.15, timeSpentSeconds: 2991, ...over });
{
  const same = compareRankRecords([rec()], [rec()]);
  check("dry-run: 같은 값은 일치", same.matched === 1 && same.diffs.length === 0);
  const changed = compareRankRecords([rec({ rating: 0.12 })], [rec()]);
  check("dry-run: 값이 다르면 어느 필드인지 보고", changed.diffs.length === 1 && changed.diffs[0].kind === "changed" && changed.diffs[0].fields.join() === "rating");
  const nullVsZero = compareRankRecords([rec({ reach: 0 })], [rec({ reach: null })]);
  check("dry-run: 0과 빈 값(null)은 다른 값으로 취급", nullVsZero.diffs.length === 1 && nullVsZero.diffs[0].fields.join() === "reach");
  const kinds = compareRankRecords([rec(), rec({ channelCode: "ONCE" })], [rec(), rec({ channelCode: "OLIFE" })]);
  check("dry-run: 저장 안 됨·원본에 없음을 구분", kinds.diffs.some((d) => d.kind === "missing_in_db" && d.channelCode === "ONCE") && kinds.diffs.some((d) => d.kind === "extra_in_db" && d.channelCode === "OLIFE"));
  const plan = planBackfill(compareRankRecords([rec({ rating: 0.2 }), rec({ date: "2026-10-05", rank: 9 }), rec({ date: "2026-10-06", channelCode: "ONCE" })], [rec(), rec({ date: "2026-10-05" }), rec({ date: "2026-10-06", channelCode: "OLIFE" })]), { martRowsByDate: { "2026-10-04": 10, "2026-10-05": 8 }, llmTextRowsByDate: { "2026-10-04": 4 }, reportSnapshotCount: 4 });
  check("dry-run: 영향 채널·날짜·쓸 행·되돌릴 마트 범위", plan.affectedChannels.join() === "ENA,OLIFE,ONCE" && plan.affectedDates.join() === "2026-10-04,2026-10-05,2026-10-06" && plan.rowsToWrite === 3 && plan.rowsToReview === 1 && plan.martRowsAffected === 18 && plan.llmTextRowsAffected === 4);
  check("dry-run: 저장돼 있으나 원본에 없는 행은 지우지 않고 사람이 확인(쓸 행에 넣지 않음)", plan.rowsToReview === 1 && plan.rowsToWrite === plan.byKind.changed + plan.byKind.missing_in_db);
  const md = renderDryRunMarkdown("제목", { files: 3, dateFrom: "2026-10-04", dateTo: "2026-10-06" }, plan);
  check("dry-run 보고서: 읽기 전용 명시·rollback 절차·보고서 스냅샷 불변·승인 전 실행 금지", md.includes("운영 데이터를 바꾸지 않았다") && ROLLBACK_STEPS.length >= 5 && md.includes("rollback") && md.includes("불변") && md.includes("별도 승인 전에는 실행하지 않는다"));
}
{
  const script = code("scripts/dryrun-engine-diff.ts");
  const writes = /\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/.test(script);
  check("읽기 전용 원본 대조 스크립트가 있고 DB에 쓰지 않는다(insert·update·upsert·delete·rpc 호출 없음)", exists("scripts/dryrun-engine-diff.ts") && !writes && script.includes(".select("));
  const retro = code("scripts/retrospective.ts");
  check("회고 스크립트도 DB에 쓰지 않는다", !/\.(insert|update|upsert|delete)\s*\(|\.rpc\s*\(/.test(retro) && retro.includes(".select("));
  check("dry-run 순수 모듈은 DB·네트워크를 가져오지 않는다", !/supabase|fetch\(|from "node:(fs|http)/.test(code("src/lib/ops/dryRun.ts")) && !/supabase|fetch\(/.test(code("src/lib/ops/retrospective.ts")));
}

// ── 6. 회고: 순수 계산 ──────────────────────────────────────
{
  const wr = (channelCode: string, targetLabel: string, weekStart: string, detail: WeekResult["detail"]): WeekResult => ({ channelCode, targetLabel, weekStart, detail });
  const rs = summarizeRetro([wr("ENA", "수도권 2049", "2026-09-07", [
    { expected: 0.1, actual: 0.12, fallbackLevel: 1, low: 0.08, high: 0.13 },
    { expected: 0.2, actual: 0.15, fallbackLevel: 4, low: 0.1, high: 0.16 },
    { expected: null, actual: 0.3 },
    { expected: 0.2, actual: null },
  ])]);
  check("회고: 예상·실적이 모두 있는 방영만 비교하고 나머지는 센다", rs.compared === 2 && rs.notCompared === 2);
  check("회고: MAE·편향(예상−실적)·근거 등급·범위 적중", Math.abs((rs.mae ?? 0) - 0.035) < 1e-9 && Math.abs((rs.bias ?? 0) - 0.015) < 1e-9 && rs.byGrade.A.n === 1 && rs.byGrade.C.n === 1 && rs.rangeHitRate === 1);
  const mixed = summarizeByChannelTarget([wr("ENA", "수도권 2049", "w1", [{ expected: 0.1, actual: 0.1 }]), wr("ONCE", "전국 유료가구", "w1", [{ expected: 0.5, actual: 0.4 }])]);
  check("회고: 타깃이 다른 채널의 값은 합치지 않는다", mixed.length === 2 && summarizeByTarget([wr("ENA", "수도권 2049", "w1", []), wr("ONCE", "전국 유료가구", "w1", [])]).length === 2);
  const md = renderRetroMarkdown(mixed, summarizeByTarget([wr("ENA", "수도권 2049", "w1", [{ expected: 0.1, actual: 0.1 }])]));
  check("회고 표: 타깃별 전체에 '합치지 않았다' 안내", md.includes("타깃이 다른 값은 합치지 않았다"));
}

// ── 7. 기능 끄개(feature flag) ──────────────────────────────
{
  check("feature flag 목록: 새 경로마다 끄는 방법과 끄면 어떻게 되는지가 있다", Object.values(FEATURE_FLAGS).every((f) => f.env.length > 0 && f.whenOff.length > 10 && f.since.length > 0) && Object.keys(FEATURE_FLAGS).length >= 2);
  check("기능 끄개 기본값은 켜짐", isFeatureOn("llm_text_cache", {}) && isFeatureOn("report_snapshot_store", {}));
  check("FEATURE_*=off(0·false·off)이면 꺼진다", !isFeatureOn("llm_text_cache", { FEATURE_LLM_TEXT_CACHE: "off" }) && !isFeatureOn("report_snapshot_store", { FEATURE_REPORT_SNAPSHOT_STORE: "0" }) && !isFeatureOn("llm_text_cache", { FEATURE_LLM_TEXT_CACHE: " FALSE " }));
  check("다른 값(on·빈 문자열 아님)은 켜짐으로 본다", isFeatureOn("llm_text_cache", { FEATURE_LLM_TEXT_CACHE: "on" }));
  check("끄개가 실제 경로에 연결돼 있다(LLM 캐시·보고서 저장)", code("src/lib/llmTextCache.ts").includes('isFeatureOn("llm_text_cache")') && code("src/lib/reportSnapshot/service.ts").includes('isFeatureOn("report_snapshot_store")'));
  check("끄개 모듈은 환경 변수 값이 아니라 이름만 다룬다(키·토큰 이름 없음)", !/"[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z_]*"/.test(code("src/lib/featureFlags.ts")));
}

// ── 8. 출시 준비·운영 문서 ──────────────────────────────────
{
  const rr = exists("docs/agent-improvement/RELEASE_READINESS.md") ? read("docs/agent-improvement/RELEASE_READINESS.md") : "";
  check("출시 준비 문서: 보류 항목 H1~H8이 모두 있다", HOLD_ITEMS.every((h) => rr.includes(h.id) && rr.includes(h.title)));
  check("출시 준비 문서: 기능 끄개 환경 변수와 이전 동작이 있다", Object.values(FEATURE_FLAGS).every((f) => rr.includes(`FEATURE_${f.env}`)));
  check("출시 준비 문서: 단계적 전환·기존 안 보존·오류 모니터링·알림 기준·rollback·승인 요청", ["단계적 전환", "기존 안 보존", "오류 모니터링", "알림 기준", "rollback", "승인 요청"].every((k) => rr.includes(k)));
  const retro = exists("docs/agent-improvement/RETROSPECTIVE.md") ? read("docs/agent-improvement/RETROSPECTIVE.md") : "";
  check("회고 문서: 방법·결과 표·측정 못 한 항목·인과 주장 금지가 있다", ["방법", "비교 방영", "측정하지 못한", "AI 단독 인과"].every((k) => retro.includes(k)));
  const guides = ["docs/operations/README.md", "docs/operations/운영자_사용가이드.md", "docs/operations/지표_사전.md", "docs/operations/데이터_품질_대응.md", "docs/operations/Avail_매칭과_예약_복원.md", "docs/operations/모델_승격과_회귀.md", "docs/operations/보고서_재발행.md"];
  const guideTitles = ["운영 문서", "운영자 사용 가이드", "지표 사전", "데이터 품질 문제 대응", "Avail 매칭과 예약 복원", "모델 승격과 회귀", "보고서 재발행"];
  check("운영 문서 6종과 목차가 있다(제목·분량)", guides.every((g, i) => exists(g) && read(g).length > 400 && read(g).split("\n")[0].includes(guideTitles[i])), guides.filter((g) => !exists(g)).join(","));
  check("운영 문서 목차가 6종을 모두 연결한다", guides.slice(1).every((g) => read("docs/operations/README.md").includes(path.basename(g))));
  const dict = exists("docs/operations/지표_사전.md") ? read("docs/operations/지표_사전.md") : "";
  check("지표 사전: 표준 용어(콘텐츠·도달률·시청시간 비율)를 쓰고 금지 표기가 없다", dict.includes("도달률") && dict.includes("시청시간 비율") && !/컨텐츠|도달율/.test(dict.split("\n").filter((l) => !l.includes("원본 용어:")).join("\n")));
}

console.log(`\n${passed}개 통과, ${failures.length}개 실패`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
