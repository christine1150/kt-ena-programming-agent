// OPT06 테스트 — 편성안 비교 카드·주요 변경·수동 수정 이력(실행 취소/다시 실행)·권리 판정·확정 준비 재검사·내보내기 머리 정보.
// 합성 입력만 쓴다. DB·네트워크 없음. 실행: npm run test:opt06
import fs from "node:fs";
import path from "node:path";
import * as A from "../src/lib/avail";
import { emptyRules, rowHashOf } from "../src/lib/avail/adapters/common";
import type { Grant } from "../src/lib/avail";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// ── 권리 합성 픽스처(test-avail과 같은 모양, 최소) ───────────────────
const NOW = "2026-10-07T09:00:00+09:00";
const CONFIRMED = A.applyConfirmations({
  endInclusive: { value: true, by: "t", at: "2026-10-01" },
  dayBasis: { value: "broadcast_day", by: "t", at: "2026-10-01" },
  spanPolicy: { value: "start_only", by: "t", at: "2026-10-01" },
  countUnit: { value: "per_episode_pooled", by: "t", at: "2026-10-01" },
  firstWindowGate: { value: "per_episode", by: "t", at: "2026-10-01" },
});
function grant(o: { id?: string; title?: string; eps?: [number, number][]; channels?: string[]; start?: string; end?: string; count?: number | "unknown"; baseline?: Grant["usageBaseline"] } = {}): Grant {
  const g = { id: "G1", title: "샘플 시리즈", eps: [[1, 12]] as [number, number][], channels: ["ENA", "ENA Play"], start: "2026-10-01", end: "2026-12-31", count: 3 as number | "unknown", baseline: "zero" as Grant["usageBaseline"], ...o };
  const rules = emptyRules();
  rules.count = { limit: g.count === "unknown" ? { state: "unknown", raw: null } : { state: "value", value: g.count }, raw: String(g.count) };
  rules.platformsRaw = ["위", "케", "IP"];
  const columns = { id: g.id, title: g.title, start: g.start, end: g.end, count: g.count };
  const rowHash = rowHashOf(columns);
  return {
    grantId: g.id,
    revisionId: `${g.id}#${rowHash}`,
    rowHash,
    supersedesRevisionId: null,
    status: "active",
    contractRefs: [],
    rightsHolder: null,
    source: { kind: "content_avail", batchId: "b1", file: "test.xlsx", sheet: "시트1", row: 2, columns },
    enteredAt: "2026-10-01T00:00:00+09:00",
    content: { titleRaw: g.title, canonicalKey: A.titleVariants(g.title).mainKey, sourceCode: "T-1", genreRaw: null, originRaw: null, aliases: [], productionYear: { state: "unknown", raw: null }, origination: "unknown", runtimeMin: { state: "unknown", raw: null }, episodeCount: { state: "unknown", raw: null } },
    scope: { episodes: { kind: "ranges", ranges: g.eps, excluded: [], raw: "#1~12" }, channels: { kind: "list", ids: g.channels }, season: { state: "not_applicable" }, version: { state: "not_applicable" }, territory: { state: "not_applicable" } },
    window: { start: { state: "value", value: g.start }, end: { state: "value", value: g.end }, termRaw: null, appliesRaw: null, anchor: "fixed_start", grouping: "batch" },
    rules,
    conditions: [],
    usageBaseline: g.baseline,
    mergedInto: null,
    manual: null,
    optionalCommercial: null,
  };
}
function ctxOf(grants: Grant[]): A.EvalContext {
  const cur = A.currentGrants(grants);
  return { grants: cur, ledger: [], links: [], confirmations: [], interpretation: CONFIRMED, originalPolicy: A.DEFAULT_ORIGINAL_POLICY, now: NOW, inventoryVersion: A.inventoryVersionOf(cur) };
}

async function main() {
  const R = await import("../src/lib/idealSchedule/slotRights");
  const V = await import("../src/lib/idealSchedule/planVersion");
  const L = await import("../src/lib/idealSchedule/editLog");
  const C = await import("../src/lib/idealSchedule/planCards");
  const T = await import("../src/lib/idealSchedule/topChanges");
  const D = await import("../src/lib/idealSchedule/readiness");
  const X = await import("../src/lib/idealSchedule/exportMeta");
  const AD = await import("../src/lib/idealSchedule/adoption");

  // ══ 1. 권리 판정(수동 교체가 쓰는 판정) ═══════════════════════════
  console.log("\n— 권리 판정 —");
  {
    const ctx = ctxOf([grant()]);
    const slot = (date: string, ch = "ENA"): A.SlotRef => ({ broadcastDate: date, startMin: 1200, endMin: 1260, channelId: ch });
    const q = (name = "샘플 시리즈"): A.ContentQuery => ({ programId: null, programName: name, episodeNumber: null });
    const ok = R.slotRightsOf(A.evaluateEligibility(q(), slot("2026-10-10"), ctx));
    const noChannel = R.slotRightsOf(A.evaluateEligibility(q(), slot("2026-10-10", "OLIFE"), ctx));
    const expired = R.slotRightsOf(A.evaluateEligibility(q(), slot("2027-02-01"), ctx));
    const missing = R.slotRightsOf(A.evaluateEligibility(q("없는 프로그램"), slot("2026-10-10"), ctx));
    const noAvail = R.slotRightsOf(A.evaluateEligibility(q(), slot("2026-10-10"), ctxOf([])));
    check("권리 가능: available·허용", ok.status === "available" && R.swapRightsVerdict(ok).allowed && !R.swapRightsVerdict(ok).reviewOnly, JSON.stringify(ok));
    check("허용 채널이 아니면 교체 거부(권리상 불가 — 수동 교체 우회 수정)", noChannel.status === "unavailable" && !R.swapRightsVerdict(noChannel).allowed && /권리상 편성할 수 없습니다/.test(R.swapRightsVerdict(noChannel).message ?? ""));
    check("기간 만료 칸도 교체 거부", expired.status === "unavailable" && !R.swapRightsVerdict(expired).allowed);
    check("Avail 행이 없는 프로그램은 미확인 — 교체는 되지만 검토안만(실행 가능 아님)", missing.status === "unknown" && R.swapRightsVerdict(missing).allowed && R.swapRightsVerdict(missing).reviewOnly && !R.isExecutableRights(missing.status));
    check("Avail 자료 없음은 '확인 못함'이지 '가능'이 아니다", noAvail.status === "unknown" && R.swapRightsVerdict(noAvail).reviewOnly);
    const nc = R.notChecked("NO_AVAIL");
    check("not_checked는 허용하되 검토안만, 실행 가능 아님", nc.status === "not_checked" && R.swapRightsVerdict(nc).reviewOnly && !R.isExecutableRights(nc.status));
    check("조건부는 허용·검토안만", R.swapRightsVerdict({ ...ok, status: "conditional" }).reviewOnly && R.swapRightsVerdict({ ...ok, status: "conditional" }).allowed);
    check("방송일 계산은 엔진 게이트와 같다(월요일 + 요일 − 1)", R.broadcastDateOf("2026-10-05", 1) === "2026-10-05" && R.broadcastDateOf("2026-10-05", 7) === "2026-10-11");
  }

  // ══ 2. 편성안 버전·재평가 덮어쓰기·작업본 상태 ═══════════════════
  console.log("\n— 편성안 버전·작업본 상태 —");
  const blk = (id: string, wd: number, s: number, e: number, key: string, exp: number | null, o: Record<string, unknown> = {}) => ({ id, layer: "IDEAL", weekday: wd, start_min: s, end_min: e, candidate_key: key, status: "AI", locked: false, expected_kpi: exp, content_type: "OWN", ...o });
  const base = [blk("b1", 1, 1200, 1260, "A|FIRST", 0.2), blk("b2", 1, 1260, 1320, "B|FIRST", 0.1), blk("b3", 2, 1200, 1260, "C|FIRST", 0.15)];
  {
    const v0 = V.planVersionOf(base);
    check("같은 내용은 순서와 무관하게 같은 버전", v0 === V.planVersionOf([...base].reverse()));
    check("후보 하나만 바뀌어도 다른 버전", v0 !== V.planVersionOf(base.map((b) => (b.id === "b2" ? { ...b, candidate_key: "D|FIRST" } : b))));
    check("잠금·상태만 바뀌면 같은 버전(값은 그대로)", v0 === V.planVersionOf(base.map((b) => (b.id === "b2" ? { ...b, status: "MANUAL_OVERRIDE", locked: true } : b))));
    check("CURRENT 층은 버전에 영향 없음", v0 === V.planVersionOf([...base, { ...blk("c1", 1, 1200, 1260, "Z|FIRST", 0.3), layer: "CURRENT" }]));
    check("시간이 바뀌면 다른 버전", v0 !== V.planVersionOf(base.map((b) => (b.id === "b3" ? { ...b, start_min: 1230, end_min: 1290 } : b))));

    check("주간 기대는 분 가중(60·0.2 + 60·0.1 + 60·0.15)/180 = 0.15", near(V.weeklyExpectedOf(base), 0.15));
    check("경쟁 Benchmark·값 없는 칸은 합계에서 뺀다", near(V.weeklyExpectedOf([...base, blk("x", 3, 0, 60, "BM", 0.9, { content_type: "COMPETITOR_BENCHMARK" }), blk("y", 3, 60, 120, "N", null)]), 0.15));

    const ev = (version: string): import("../src/lib/idealSchedule/planVersion").WorkingEvaluation => ({
      planVersion: version,
      evaluatedAt: NOW,
      kind: "REEVALUATE_WORKING_COPY",
      model: "idx-shrink-v1",
      objective: 1,
      weeklyExpected: 0.16,
      byBlock: { b1: { expected_kpi: 0.21, expected_share: null, expected_time_spent: null, expected_low: 0.1, expected_high: 0.3, range_basis: "BACKTEST", confidence_score: 0.5, block_value: 1, fitness_score: 1, sample_count: 5, fallback_level: 1, penalties: {}, score_components: {}, reasons: [] } },
      skippedBlockIds: ["b3"],
      scope: [...V.EVALUATION_SCOPE],
    });
    const same = V.overlayEvaluation(base, ev(v0), v0);
    check("같은 버전의 재평가 값은 덮어쓴다(b1 0.2→0.21), 건너뛴 칸·없는 칸은 그대로", same.applied && same.blocks[0].expected_kpi === 0.21 && same.blocks[1].expected_kpi === 0.1 && same.blocks[2].expected_kpi === 0.15);
    const stale = V.overlayEvaluation(base, ev("Pstale"), v0);
    check("다른 버전(0.047/0.048 사례)의 값은 쓰지 않는다 — 저장된 원래 값 유지", !stale.applied && stale.blocks[0].expected_kpi === 0.2);
    check("재평가 값이 없으면 그대로", !V.overlayEvaluation(base, null, v0).applied);

    check("수정 없음 = 계산 완료본·값 현재", V.workingStateOf({ activeEditCount: 0, evaluation: null, currentVersion: v0 }).state === "COMPUTED" && V.workingStateOf({ activeEditCount: 0, evaluation: null, currentVersion: v0 }).valuesCurrent);
    const dirty = V.workingStateOf({ activeEditCount: 2, evaluation: null, currentVersion: v0 });
    check("수동 수정 + 재평가 전 = 작업본(재평가 전)·값이 현재 아님(계산 완료 값처럼 표시 금지)", dirty.state === "DIRTY" && !dirty.valuesCurrent && /재평가 전/.test(dirty.label));
    check("수정 뒤 다른 버전 재평가는 아직 DIRTY", V.workingStateOf({ activeEditCount: 2, evaluation: ev("Pold"), currentVersion: v0 }).state === "DIRTY");
    const re = V.workingStateOf({ activeEditCount: 2, evaluation: ev(v0), currentVersion: v0 });
    check("같은 버전 재평가 = 재평가됨, 탐색은 하지 않았다고 안내", re.state === "REEVALUATED" && re.valuesCurrent && /탐색\(다시 계산\)은 하지 않았습니다/.test(re.detail));
  }

  // ══ 3. 수정 이력: 실행 취소·다시 실행·변경 이유 ═══════════════════
  console.log("\n— 수정 이력 —");
  {
    const snap = (key: string, name: string, locked = false) => L.snapshotOf({ candidate_key: key, program_name: name, program_key: key.split("|")[0], status: locked ? "MANUAL_OVERRIDE" : "AI", locked, reasons: [{ code: "X", value: 1 }] });
    const swap = (blockId: string, fromKey: string, toKey: string, reason: string | null = null, wd = 1, start = 1200) => ({
      kind: "SWAP" as const,
      blockId,
      slot: { weekday: wd, startMin: start, endMin: start + 60 },
      before: snap(fromKey, fromKey.split("|")[0]),
      after: snap(toKey, toKey.split("|")[0], true),
      reason,
      actor: "pd:1",
      at: NOW,
      rights: { status: "available", label: "권리 확인됨", reviewOnly: false },
      from: fromKey.split("|")[0],
      to: toKey.split("|")[0],
    });
    let log = L.emptyLog("P0");
    check("빈 이력: 되돌릴 것도 다시 실행할 것도 없다", !L.canUndo(log) && !L.canRedo(log) && L.undoStep(log) === null && L.redoStep(log) === null);
    const r1 = L.recordEdit(log, swap("b1", "A|FIRST", "B|FIRST", "경쟁작 대응"));
    check("수정 기록: seq 1·커서 1·실행 취소 가능", r1.ok && r1.log.seq === 1 && r1.log.cursor === 1 && L.canUndo(r1.log) && !L.canRedo(r1.log));
    log = (r1 as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    const r2 = L.recordEdit(log, swap("b2", "C|FIRST", "D|FIRST", null, 2));
    log = (r2 as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    check("두 칸 수정 = 수동 수정 2칸(이유·권리 요약 포함)", L.netEditedBlocks(log).length === 2 && L.netEditedBlocks(log)[0].reason === "경쟁작 대응" && L.netEditedBlocks(log)[0].rights?.status === "available");
    const u = L.undoStep(log) as { log: import("../src/lib/idealSchedule/editLog").EditLog; entry: import("../src/lib/idealSchedule/editLog").EditEntry };
    check("실행 취소: 마지막 항목을 돌려주고 커서만 이동, seq는 오른다(동시 수정 감지)", u.entry.blockId === "b2" && u.log.cursor === 1 && u.log.seq === log.seq + 1 && L.canRedo(u.log));
    check("실행 취소하면 그 칸은 수동 수정에서 빠진다", L.netEditedBlocks(u.log).length === 1);
    const rd = L.redoStep(u.log) as { log: import("../src/lib/idealSchedule/editLog").EditLog; entry: import("../src/lib/idealSchedule/editLog").EditEntry };
    check("다시 실행: 취소했던 항목을 다시 적용", rd.entry.blockId === "b2" && rd.log.cursor === 2 && L.netEditedBlocks(rd.log).length === 2);
    const branch = L.recordEdit(u.log, swap("b3", "E|FIRST", "F|FIRST", "새 분기", 2, 1260));
    check("취소 뒤 새 수정을 하면 다시 실행 꼬리는 버려진다", branch.ok && branch.log.entries.length === 2 && !L.canRedo(branch.log) && branch.log.entries[1].blockId === "b3");
    // 같은 칸을 여러 번 고치고 원래대로 돌려놓으면 수정 칸이 아니다
    let l2 = L.emptyLog("P0");
    for (const [f, t] of [["A|FIRST", "B|FIRST"], ["B|FIRST", "C|FIRST"], ["C|FIRST", "A|FIRST"]]) l2 = (L.recordEdit(l2, swap("b1", f, t)) as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    check("A→B→C→A로 도로 원래 후보면 수정 0칸(세 번 고쳤어도)", L.netEditedBlocks(l2).length === 0 && l2.entries.length === 3);
    l2 = (L.recordEdit(l2, { ...swap("b1", "A|FIRST", "B|FIRST"), kind: "LOCK" }) as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    check("잠금 항목은 내용 수정으로 세지 않는다", L.netEditedBlocks(l2).length === 0);
    // 한도: 조용히 버리지 않고 거부 + 안내
    let big = L.emptyLog("P0");
    for (let i = 0; i < L.MAX_ENTRIES; i++) big = (L.recordEdit(big, swap(`b${i}`, "A|FIRST", "B|FIRST")) as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    const over = L.recordEdit(big, swap("bx", "A|FIRST", "B|FIRST"));
    check(`이력 ${L.MAX_ENTRIES}건 한도에서는 거부하고 안내한다(수정 개수 제한이 아니라 저장 크기 보호)`, !over.ok && /저장하고/.test((over as { message: string }).message) && big.entries.length === L.MAX_ENTRIES);
    const afterUndo = (L.undoStep(big) as { log: import("../src/lib/idealSchedule/editLog").EditLog }).log;
    check("한도에 닿았어도 실행 취소 뒤에는 다시 수정할 수 있다", L.recordEdit(afterUndo, swap("bx", "A|FIRST", "B|FIRST")).ok);
    check("이력 줄: 최신 순, 취소된 항목은 applied=false", L.historyLines(u.log)[0].applied === false && L.historyLines(u.log)[0].text.includes("→") && L.historyLines(u.log)[1].applied === true);
    check("이유는 공백 정리·200자 제한, 빈 문자열은 null", L.cleanReason("  경쟁작   대응 ") === "경쟁작 대응" && L.cleanReason("x".repeat(500))?.length === 200 && L.cleanReason("   ") === null && L.cleanReason(5) === null);
    check("깨진 저장 JSON은 null(빈 이력으로 시작)", L.parseLog(null) === null && L.parseLog({ seq: 1, cursor: 5, entries: [], baseVersion: "x" }) === null && L.parseLog(log) !== null);
    check("스냅샷은 수동 교체가 바꾸는 열 전체를 담는다(복원 정확성)", L.EDIT_COLUMNS.includes("candidate_key") && L.EDIT_COLUMNS.includes("expected_kpi") && L.EDIT_COLUMNS.includes("reasons") && L.EDIT_COLUMNS.includes("locked") && L.EDIT_COLUMNS.includes("status"));
    // swapWithLog가 바꾸는 열과 EDIT_COLUMNS가 같은 집합인지 소스로 대조(한쪽만 고치면 되돌리기가 틀어진다)
    const swapSrc = read("src/lib/idealSchedule/workingCopy.ts");
    const upd = swapSrc.slice(swapSrc.indexOf("export async function swapWithLog"), swapSrc.indexOf("export async function setLockWithLog"));
    const written = [...upd.slice(upd.indexOf("writeBlock("), upd.indexOf("const rec = recordEdit")).matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    const extra = written.filter((c) => !(L.EDIT_COLUMNS as readonly string[]).includes(c));
    check("swapWithLog가 쓰는 열이 모두 EDIT_COLUMNS에 있다(되돌려도 남는 열 없음)", extra.length === 0 && written.length >= 25, `${extra.join(",")} n=${written.length}`);
    const missing = L.EDIT_COLUMNS.filter((c) => !new RegExp(`\\b${c}\\b`).test(upd));
    check("EDIT_COLUMNS의 열이 모두 swapWithLog 갱신 열에 있다", missing.length === 0, missing.join(","));
  }

  // ══ 4. 비교 카드 ═══════════════════════════════════════════════
  console.log("\n— 비교 카드 —");
  const cb = (wd: number, s: number, e: number, key: string, exp: number | null, o: Partial<import("../src/lib/idealSchedule/planCards").CardBlock> = {}): import("../src/lib/idealSchedule/planCards").CardBlock => ({ weekday: wd, startMin: s, endMin: e, programKey: key, programName: `프로그램${key}`, candidateKey: `${key}|FIRST`, expected: exp, low: exp === null ? null : exp * 0.7, high: exp === null ? null : exp * 1.3, grade: "A", countable: true, rights: "available", poolKey: null, remaining: null, episodes: null, ...o });
  const baseline = [cb(1, 1200, 1260, "A", 0.2), cb(1, 1260, 1320, "B", 0.1), cb(2, 1200, 1260, "C", 0.1), cb(2, 1260, 1320, "D", 0.1)];
  const planMin = [cb(1, 1200, 1260, "A", 0.2), cb(1, 1260, 1320, "E", 0.2), cb(2, 1200, 1260, "C", 0.1), cb(2, 1260, 1320, "D", 0.1)]; // 1칸 변경 +0.1
  const planPerf = [cb(1, 1200, 1260, "A", 0.2), cb(1, 1260, 1320, "E", 0.2), cb(2, 1200, 1260, "F", 0.15, { grade: "C" }), cb(2, 1260, 1320, "G", 0.08)]; // 3칸 변경, 한 칸은 하락
  const rob = { point: 0.3, p10: -0.02, p50: 0.25, p90: 0.5, pPositive: 0.85, scenarios: 400 };
  const mk = (kind: import("../src/lib/idealSchedule/planCards").PlanKind, blocks: import("../src/lib/idealSchedule/planCards").CardBlock[], o: Partial<import("../src/lib/idealSchedule/planCards").PlanCardInput> = {}) => ({ kind, planVersion: `P-${kind}`, blocks, baseline, required: { total: 2, satisfied: 2 }, hardViolations: 0, robustness: kind === "BASELINE" ? null : rob, searched: kind !== "BASELINE", ...o });
  {
    const cards = C.buildPlanCards([mk("PERFORMANCE", planPerf), mk("BASELINE", baseline), mk("MIN_CHANGE", planMin)]);
    check("카드 순서는 기준안→최소변경→균형→성과우선(입력 순서와 무관), 없는 안은 빠진다", cards.map((c) => c.kind).join() === "BASELINE,MIN_CHANGE,PERFORMANCE");
    const b = cards[0];
    const m = cards[1];
    const p = cards[2];
    check("기준안 카드: 자기 자신과의 차이·시나리오는 없다", b.vsBaseline === null && b.scenario === null && b.change.blocks === 0 && b.weekly.value !== null && near(b.weekly.value, 0.125));
    check("최소변경: 같은 시간 기준 평균 0.125→0.150, 차이 +0.025%p·+20%", near(m.vsBaseline?.planAvg, 0.15) && near(m.vsBaseline?.baselineAvg, 0.125) && near(m.vsBaseline?.diffPp, 0.025) && near(m.vsBaseline?.diffPct, 0.2));
    check("변경 부담: 최소변경 1칸·60분·기준안 분의 25%", m.change.blocks === 1 && m.change.slots === 1 && m.change.minutes === 60 && near(m.change.shareOfMinutes, 0.25));
    check("성과우선: 3칸 변경", p.change.blocks === 3 && p.change.slots === 3 && p.change.minutes === 180);
    check("하방 설명: 기준안보다 낮은 칸 1개와 가장 큰 하락", p.downside.lowerSlots === 1 && near(p.downside.worstPp, -0.02) && p.cautions.some((c) => /기대값이 낮습니다/.test(c)));
    check("근거 부족 비중(C 등급 칸 분)과 경고", near(p.evidence.insufficientShare, 0.25) && m.evidence.insufficientShare === 0);
    check("시나리오: 하위 10%가 음수면 경고, 개선 유지 비율 85%<90% 경고", p.cautions.some((c) => /하위 10%/.test(c)) && p.cautions.some((c) => /85%/.test(c)));
    check("가장 기대값이 높은 안에만 '최고 기대안' 표지 — 어느 안도 '최적 증명'은 아니다", cards.filter((c) => c.claims.bestExpected).length === 1 && cards.every((c) => c.claims.optimalProven === false) && /증명은 없습니다/.test(p.claims.note));
    check("카드마다 자기 편성안 버전을 단다(다른 버전 숫자를 섞지 않음)", cards.every((c) => c.planVersion === `P-${c.kind}`));
    check("필수 편성 충족과 하드 위반을 카드에 싣는다", m.required.satisfied === 2 && m.hardViolations === 0);
  }
  {
    // 기준안이 일부 시간 평가값이 없는 경우 — 같은 시간 기준으로만 비교(전체 평균끼리 비교하면 부풀려짐)
    const baseGap = [cb(1, 1200, 1260, "A", 0.1), cb(1, 1260, 1320, "B", null)];
    const planFull = [cb(1, 1200, 1260, "A", 0.1), cb(1, 1260, 1320, "C", 0.3)];
    const card = C.buildPlanCard({ kind: "BALANCED", planVersion: "P", blocks: planFull, baseline: baseGap, required: { total: 0, satisfied: 0 }, hardViolations: 0, robustness: null, searched: true });
    check("평가 시간이 다르면 같은 시간(60분)만 비교: 차이 0, 전체 평균 비교(+100%)로 부풀리지 않는다", near(card.vsBaseline?.diffPp, 0) && near(card.vsBaseline?.diffPct, 0) && card.vsBaseline?.commonMinutes === 60 && card.vsBaseline?.supportDiffers === true);
  }
  {
    // 권리: 확인율은 분 기준, 상태별 칸 수, 공유 권리 소진
    const withRights = [
      cb(1, 1200, 1320, "A", 0.2, { rights: "available", poolKey: "g1", remaining: 2, episodes: null }),
      cb(2, 1200, 1260, "A", 0.2, { rights: "available", poolKey: "g1", remaining: 2, episodes: null }),
      cb(3, 1200, 1260, "A", 0.2, { rights: "available", poolKey: "g1", remaining: 2, episodes: null }),
      cb(4, 1200, 1260, "B", 0.1, { rights: "unknown" }),
      cb(5, 1200, 1260, "C", 0.1, { rights: "unavailable" }),
      cb(6, 1200, 1260, "D", 0.1, { rights: "not_checked" }),
    ];
    const c = C.buildPlanCard({ kind: "BALANCED", planVersion: "P", blocks: withRights, baseline, required: { total: 0, satisfied: 0 }, hardViolations: 0, robustness: null, searched: true });
    check("권리 칸 수: 가능 3·미확인 1·불가 1·확인 안 함 1", c.rights.counts.available === 3 && c.rights.counts.unknown === 1 && c.rights.counts.unavailable === 1 && c.rights.counts.not_checked === 1);
    check("확인율은 분 기준·not_checked는 분모 제외: (120+60+60)/(240+60+60) = 2/3", near(c.rights.confirmedShare, 240 / 360, 1e-9));
    check("공유 권리 소진: 잔여 2회에 3회 편성 → 초과 1건, 경고 문구", c.rights.consumption.overdrawn === 1 && c.cautions.some((x) => /잔여 횟수를 넘습니다/.test(x)) && c.cautions.some((x) => /권리상 불가인 칸이 1칸/.test(x)));
    check("반복 노출: 같은 프로그램 3회 = 반복 2회분·최대 주 3회", c.repeat.repeatedAirings === 2 && c.repeat.repeatedPrograms === 1 && c.repeat.maxWeekly === 3);
    const ep = C.buildPlanCard({ kind: "BALANCED", planVersion: "P", blocks: withRights.map((b) => (b.poolKey ? { ...b, episodes: 3 } : b)), baseline, required: { total: 0, satisfied: 0 }, hardViolations: 0, robustness: null, searched: true });
    check("회차 3개가 열려 있으면 용량은 회차 수×회차당 잔여(6) — 초과 아님", ep.rights.consumption.overdrawn === 0);
  }

  // ══ 5. 주요 변경 5건 ═══════════════════════════════════════════
  console.log("\n— 주요 변경 —");
  {
    const mkIn = (id: string, plan: import("../src/lib/idealSchedule/planCards").CardBlock, baseB: import("../src/lib/idealSchedule/planCards").CardBlock | null, alts: { programName: string; expected: number | null; low: number | null; high: number | null }[] = []) => ({ blockId: id, plan: { ...plan, episode: "12회" }, base: baseB ? { ...baseB, episode: "11회" } : null, rights: { status: "available" as const, label: "권리 확인됨", reasons: [], remaining: null, eligibleEpisodes: null, expiresOn: null, inventoryVersion: null, grantRevisionIds: [], assumptions: [], reasonCodes: [] }, alternatives: alts });
    // 큰 기여: 기준 0.2 → 0.3 (+50%, 120분) / 작은 기준 값의 +400%: 0.01 → 0.05 (30분)
    const baseAll = [cb(1, 1200, 1320, "A", 0.2), cb(2, 1200, 1230, "B", 0.01), cb(3, 1200, 1260, "C", 0.2)];
    const planAll = [cb(1, 1200, 1320, "X", 0.3), cb(2, 1200, 1230, "Y", 0.05), cb(3, 1200, 1260, "C", 0.2)];
    const inputs = [mkIn("n1", planAll[0], baseAll[0], [{ programName: "프로그램X", expected: 0.3, low: 0.2, high: 0.4 }, { programName: "프로그램Q", expected: 0.25, low: 0.2, high: 0.3 }, { programName: "프로그램R", expected: 0.2, low: 0.1, high: 0.3 }]), mkIn("n2", planAll[1], baseAll[1])];
    const top = T.topChanges(inputs, baseAll, planAll, 5);
    check("기여도 순위: 큰 칸(+0.1%p×120분)이 +400% 소분모 칸보다 위", top[0].blockId === "n1" && top[1].blockId === "n2");
    check("+400% 칸의 %는 숨기고 %p만 보인다(기준값이 주간 평균의 25% 미만)", top[1].diffPct === null && /기준안 값이 작아/.test(top[1].pctHiddenReason ?? "") && near(top[1].diffPp, 0.04));
    check("정상 칸은 %도 보인다(+50%)", near(top[0].diffPct, 0.5) && top[0].pctHiddenReason === null);
    check("모든 항목에 '주간 실제 성공 확률이 아니다' 안내", top.every((t) => /주간 실제 성공 확률이 아닙니다/.test(t.note)));
    check("회차·권리·근거를 함께 싣는다(11회 → 12회)", top[0].from?.episode === "11회" && top[0].to.episode === "12회" && top[0].rights?.status === "available" && top[0].to.grade === "A");
    check("대안은 새 프로그램 자신을 빼고 최대 2개", top[0].alternatives.length === 2 && !top[0].alternatives.some((a) => a.programName === "프로그램X"));
    check("포기하는 기회: 이 칸에서 내보내는 프로그램 기준 기대값", top[0].forgone.removedHere?.programName === "프로그램A" && near(top[0].forgone.removedHere?.expected, 0.2));
    // 새 프로그램이 기준안의 다른 자리에서 떠난 경우
    const base2 = [cb(1, 1200, 1260, "A", 0.3), cb(2, 1200, 1260, "B", 0.1)];
    const plan2 = [cb(1, 1200, 1260, "C", 0.1), cb(2, 1200, 1260, "A", 0.3)];
    const t2 = T.topChanges([mkIn("m", plan2[1], base2[1])], base2, plan2, 5);
    check("A가 기준안의 월 자리에서 화로 옮겨졌다면 그 자리(0.3)가 '떠난 자리'로 보인다", t2[0].forgone.movedFrom.length === 1 && t2[0].forgone.movedFrom[0].weekday === 1 && near(t2[0].forgone.movedFrom[0].expected, 0.3));
    const many = Array.from({ length: 8 }, (_, i) => cb(i + 1, 1200, 1260, `P${i}`, 0.1 + i * 0.01));
    const manyBase = Array.from({ length: 8 }, (_, i) => cb(i + 1, 1200, 1260, `Q${i}`, 0.1));
    const t3 = T.topChanges(many.map((b, i) => mkIn(`k${i}`, b, manyBase[i])), manyBase, many, 5);
    check("5건으로 자르고 기여도 큰 순(k7가 첫째)", t3.length === 5 && t3[0].blockId === "k7");
    check("같은 입력은 같은 순서(재현 가능)", JSON.stringify(T.topChanges(many.map((b, i) => mkIn(`k${i}`, b, manyBase[i])), manyBase, many, 5)) === JSON.stringify(t3));
    check("pctGuard: 기준값 0 이하·값 없음은 비율 없음", T.pctGuard(0.1, 0, "A", 0.1).pct === null && T.pctGuard(null, 0.1, "A", 0.1).pct === null && T.pctGuard(0.1, 0.1, "A", 0.1).pct === 1);
    check("+300% 초과는 숨김", T.pctGuard(0.5, 0.1, "A", 0.1).pct === null && /너무 커서/.test(T.pctGuard(0.5, 0.1, "A", 0.1).hidden ?? ""));
  }

  // ══ 6. 확정 준비 재검사(T09) ═══════════════════════════════════
  console.log("\n— 확정 준비 재검사(T09) —");
  {
    const rights = (status: import("../src/lib/idealSchedule/slotRights").SlotRightsStatus, o: Partial<import("../src/lib/idealSchedule/slotRights").SlotRights> = {}): import("../src/lib/idealSchedule/slotRights").SlotRights => ({ status, label: R.RIGHTS_LABEL[status], reasonCodes: [], reasons: status === "available" ? [] : [`${status} 사유`], remaining: null, eligibleEpisodes: null, expiresOn: null, inventoryVersion: "inv1", grantRevisionIds: ["g#1"], assumptions: [], ...o });
    const slot = (id: string, wd: number, start: number, st: import("../src/lib/idealSchedule/slotRights").SlotRightsStatus = "available", o: Partial<import("../src/lib/idealSchedule/readiness").ReadinessSlot> = {}): import("../src/lib/idealSchedule/readiness").ReadinessSlot => ({ blockId: id, weekday: wd, startMin: start, endMin: start + 60, programName: `P${id}`, programKey: `K${id}`, contentType: "OWN", episodeNumber: null, runtimeMin: 60, rights: rights(st, { grantRevisionIds: [`g#${id}`] }), ...o });
    const input = (slots: import("../src/lib/idealSchedule/readiness").ReadinessSlot[], o: Partial<import("../src/lib/idealSchedule/readiness").ReadinessInput> = {}): import("../src/lib/idealSchedule/readiness").ReadinessInput => ({ slots, availConfigured: true, availError: null, violations: [], planVersion: "P1", editSeq: 3, seen: { planVersion: "P1", editSeq: 3 }, evaluationCurrent: true, rightsInventory: { atCompute: "inv1", now: "inv1" }, emptySlots: 0, requiredUnchecked: null, ...o });
    const ok = D.evaluateReadiness(input([slot("a", 1, 1200), slot("b", 2, 1200)]));
    check("모든 검사 통과 = 실행 가능, 하지만 운영 반영은 하지 않는다고 명시", ok.state === "EXECUTABLE" && ok.canMarkExecutable && ok.operationApplied === false && /운영 편성을 바꾸지 않습니다/.test(ok.summary));
    const unk = D.evaluateReadiness(input([slot("a", 1, 1200), slot("b", 2, 1200, "unknown")]));
    check("미확인이 한 칸이라도 있으면 검토안만 — 실행 가능으로 표시 금지, 검토안 저장은 가능", unk.state === "REVIEW_ONLY" && !unk.canMarkExecutable && unk.canSaveAsReview && unk.slots.b.state === "REVIEW_ONLY" && unk.slots.a.state === "EXECUTABLE");
    const cond = D.evaluateReadiness(input([slot("a", 1, 1200, "conditional")]));
    check("조건부 가정도 검토안만", cond.state === "REVIEW_ONLY" && cond.slots.a.reasons.some((r) => /조건부/.test(r)));
    const una = D.evaluateReadiness(input([slot("a", 1, 1200, "unavailable"), slot("b", 2, 1200)]));
    check("권리상 불가는 확정 불가(BLOCKED)", una.state === "BLOCKED" && una.slots.a.state === "BLOCKED" && !una.canMarkExecutable && una.canSaveAsReview);
    const noAvail = D.evaluateReadiness(input([slot("a", 1, 1200, "not_checked")], { availConfigured: false, availError: "테이블 없음" }));
    check("Avail 자료 없음 = 확인 못함이라 실행 가능이 될 수 없다", noAvail.state === "REVIEW_ONLY" && /확인하지 못했습니다/.test(noAvail.checks.find((c) => c.code === "RIGHTS")?.detail ?? ""));
    const noSlots = D.evaluateReadiness(input([]));
    check("칸이 하나도 없으면 실행 가능이 아니다", noSlots.state === "REVIEW_ONLY");

    // 공유 잔여 횟수: 같은 권리 묶음(g#shared)에 잔여 2회, 3회 편성
    const shared = (id: string, wd: number, ep: number | null = null) => slot(id, wd, 1200, "available", { episodeNumber: ep, rights: rights("available", { grantRevisionIds: ["g#shared"], remaining: 2 }) });
    const over = D.evaluateReadiness(input([shared("a", 1), shared("b", 2), shared("c", 3)]));
    check("공유 잔여 2회에 3회 편성: 마지막 한 칸만 막힘(앞의 2회는 유지)", over.state === "BLOCKED" && over.slots.c.state === "BLOCKED" && over.slots.a.state === "EXECUTABLE" && over.slots.b.state === "EXECUTABLE" && over.checks.find((c) => c.code === "POOL")?.status === "fail");
    const within = D.evaluateReadiness(input([shared("a", 1), shared("b", 2)]));
    check("잔여 안이면 통과", within.state === "EXECUTABLE");
    const epDiff = D.evaluateReadiness(input([shared("a", 1, 1), shared("b", 2, 2), shared("c", 3, 3)]));
    check("회차가 서로 다르면 회차별 묶음이라 초과 아님", epDiff.state === "EXECUTABLE");
    const epSame = D.evaluateReadiness(input([shared("a", 1, 5), shared("b", 2, 5), shared("c", 3, 5)]));
    check("같은 회차 3회는 회차당 잔여 2를 넘는다", epSame.state === "BLOCKED" && epSame.slots.c.state === "BLOCKED");
    const unspecified = D.evaluateReadiness(input([1, 2, 3].map((n) => slot(`u${n}`, n, 1200, "available", { rights: rights("available", { grantRevisionIds: ["g#multi"], remaining: 2, eligibleEpisodes: [1, 2, 3] }) }))));
    check("회차 미지정 칸은 회차 수(3)×잔여(2)=6으로 추정 — 3회 편성은 통과", unspecified.state === "EXECUTABLE");

    // 동시 편집·재평가·길이·필수·하드
    const mismatch = D.evaluateReadiness(input([slot("a", 1, 1200)], { seen: { planVersion: "P0", editSeq: 3 } }));
    check("화면이 본 버전과 다르면(다른 곳에서 수정) 확정 불가", mismatch.state === "BLOCKED" && /다른 곳에서 바뀌었습니다/.test(mismatch.checks[0].detail));
    check("수정 이력 토큰이 다르면 확정 불가", D.evaluateReadiness(input([slot("a", 1, 1200)], { seen: { planVersion: "P1", editSeq: 2 } })).state === "BLOCKED");
    check("화면이 본 버전 정보가 없으면 동시 편집 여부 확인 못함 → 검토안만", D.evaluateReadiness(input([slot("a", 1, 1200)], { seen: { planVersion: null, editSeq: null } })).state === "REVIEW_ONLY");
    const stale = D.evaluateReadiness(input([slot("a", 1, 1200)], { evaluationCurrent: false }));
    check("재평가 전 값이면 검토안만(지금 편성안의 값이 아님)", stale.state === "REVIEW_ONLY" && stale.checks.find((c) => c.code === "EVALUATION")?.status === "warn");
    const longEp = D.evaluateReadiness(input([slot("a", 1, 1200, "available", { runtimeMin: 75 })]));
    check("회차가 칸보다 5분 넘게 길면 검토안만", longEp.state === "REVIEW_ONLY" && longEp.slots.a.reasons.some((r) => /회차 길이/.test(r)));
    check("회차가 칸보다 조금(5분 이내) 길거나 짧은 건 경고 안 함", D.evaluateReadiness(input([slot("a", 1, 1200, "available", { runtimeMin: 64 }), slot("b", 2, 1200, "available", { runtimeMin: 40 })])).state === "EXECUTABLE");
    check("회차 길이를 모르면 확인 못함으로 알리되 막지는 않는다", D.evaluateReadiness(input([slot("a", 1, 1200, "available", { runtimeMin: null })])).checks.find((c) => c.code === "RUNTIME")?.detail.includes("확인하지 못했습니다") === true);
    const fixed = D.evaluateReadiness(input([slot("a", 1, 1200)], { violations: [{ constraintId: "FIXED", message: "필수 편성 이탈", weekday: 1, startMin: 1200 }] }));
    check("필수 편성 이탈은 확정 불가", fixed.state === "BLOCKED" && fixed.checks.find((c) => c.code === "REQUIRED")?.status === "fail");
    const reqUnchecked = D.evaluateReadiness(input([slot("a", 1, 1200)], { requiredUnchecked: "설정 조회 실패" }));
    check("필수 편성을 다시 확인하지 못했으면 통과로 세지 않고 검토안만", reqUnchecked.state === "REVIEW_ONLY" && reqUnchecked.checks.find((c) => c.code === "REQUIRED")?.status === "warn" && /확인하지 못했습니다/.test(reqUnchecked.checks.find((c) => c.code === "REQUIRED")?.detail ?? ""));
    const hard = D.evaluateReadiness(input([slot("a", 1, 1200)], { violations: [{ constraintId: "CAPS", message: "주 3회 한도 초과", weekday: 1, startMin: 1200 }] }));
    check("하드 제약 위반(반복 한도)은 확정 불가, 해당 칸에 사유", hard.state === "BLOCKED" && hard.slots.a.state === "BLOCKED" && hard.slots.a.reasons[0] === "주 3회 한도 초과");
    const inv = D.evaluateReadiness(input([slot("a", 1, 1200)], { rightsInventory: { atCompute: "inv0", now: "inv1" } }));
    check("계산 뒤 권리 목록이 갱신됐다는 안내는 정보일 뿐 실행 가능을 막지 않는다(최신 목록으로 다시 판정함)", inv.state === "EXECUTABLE" && inv.checks.find((c) => c.code === "INVENTORY")?.status === "warn");
    check("검사 항목이 8개이고 각각 코드가 있다", ok.checks.map((c) => c.code).sort().join() === "EVALUATION,HARD,INVENTORY,POOL,REQUIRED,RIGHTS,RUNTIME,VERSION");
    check("개수 합: 실행 가능+검토+막힘 = 전체", unk.counts.executable + unk.counts.reviewOnly + unk.counts.blocked === unk.counts.total && unk.counts.total === 2);
  }

  // ══ 7. 내보내기 머리 정보 + 회고 연결 ═══════════════════════════
  console.log("\n— 내보내기·회고 연결 —");
  {
    const eb = (id: number, wd: number, s: number, key: string, exp: number | null, o: Record<string, unknown> = {}): import("../src/lib/idealSchedule/exportMeta").ExportBlock => ({ weekday: wd, start_min: s, end_min: s + 60, candidate_key: `${key}|FIRST`, program_key: key, program_name: `프로그램${key}`, content_type: "OWN", expected_kpi: exp, fallback_level: 1, confidence_score: 0.5, ...o }) as never;
    const blocks = [eb(1, 1, 1200, "A", 0.2), eb(2, 2, 1200, "B", 0.1), eb(3, 3, 1200, "BM", 0.4, { content_type: "COMPETITOR_BENCHMARK" })];
    const versions = { model: "idx-shrink-v1", features: "f6-levels-v1", genreDigest: "g1", constraintsDigest: "c1", configDigest: "k1", rangeBasis: "BACKTEST" as const, validated: false };
    const working = V.workingStateOf({ activeEditCount: 1, evaluation: null, currentVersion: "P1" });
    const meta = X.buildExportMeta({ runId: "run-1", planVersion: "P1", weekStart: "2026-10-12", asOfDate: "2026-10-11", currentWeekStart: "2026-10-05", targetLabel: "수도권 2049", versions, rights: { status: "applied", inventoryVersion: "inv9", mode: "explore" }, working, edits: [{ from: "A", to: "B", weekday: 1, startMin: 1200, reason: "경쟁작 대응" }], searchKind: "SEARCHED_BEST", robustness: { pPositive: 0.8, p10: -0.01, residualN: 120 }, needsConfirm: [{ weekday: 2, startMin: 1200, programName: "B", state: "REVIEW_ONLY", reasons: ["권리 미확인"] }], generatedAt: NOW, blocks });
    const get = (k: string) => meta.rows.find((r) => r[0] === k)?.[1];
    check("머리 정보: 편성안·모델·권리 버전, 기준 주, 자료 기준일", get("편성안 버전") === "P1" && /idx-shrink-v1/.test(get("모델 버전") ?? "") && /inv9/.test(get("권리(Avail) 목록 버전") ?? "") && get("비교 기준 주(기준안)") === "2026-10-05" && get("자료 기준일(이 날까지의 방영·시청률만 사용)") === "2026-10-11");
    check("편성안 상태에 재평가 전 안내가 들어간다", /재평가 전/.test(get("편성안 상태") ?? ""));
    check("수동 수정과 이유가 목록에 있다", meta.rows.some((r) => r[1].includes("A → B") && r[1].includes("경쟁작 대응")));
    check("예측 한계: 검증 전·탐색된 최선안(최적 증명 없음)·선택 편향·실제 효과 아님", meta.limits.some((l) => /검증 전/.test(l)) && meta.limits.some((l) => /최적임을 증명하지 않았습니다/.test(l)) && meta.limits.some((l) => /선택 편향/.test(l)) && meta.limits.some((l) => /실제 효과가 아니라 모델상 차이/.test(l)));
    check("확인이 필요한 슬롯이 따로 실린다", meta.needsConfirm.length === 1 && meta.limits.some((l) => /확인이 필요한 칸 1개/.test(l)));
    const meta2 = X.buildExportMeta({ ...{ runId: "run-1", planVersion: "P1", weekStart: "2026-10-12", asOfDate: "2026-10-11", currentWeekStart: null, targetLabel: "수도권 2049", versions: null, rights: { status: "not_configured" as const, inventoryVersion: null, mode: null }, working: V.workingStateOf({ activeEditCount: 0, evaluation: null, currentVersion: "P1" }), edits: [], searchKind: null, robustness: null, needsConfirm: [], generatedAt: NOW, blocks } });
    check("버전 기록이 없는 오래된 편성안·Avail 없음은 '기록 없음/권리 미확인'으로 정직하게 쓴다", get("모델 버전") !== undefined && meta2.rows.find((r) => r[0] === "모델 버전")?.[1].includes("기록 없음") === true && /권리 미확인/.test(meta2.rows.find((r) => r[0] === "권리(Avail) 목록 버전")?.[1] ?? "") && meta2.limits.some((l) => /권리 미확인/.test(l)));
    check("스냅샷 ID는 같은 내용이면 같고, 후보가 바뀌면 달라진다", meta.snapshotId === X.snapshotIdOf("P1", blocks, versions) && meta.snapshotId !== X.snapshotIdOf("P2", blocks.map((b, i) => (i === 0 ? { ...b, candidate_key: "Z|FIRST" } : b)), versions));
    check("예상값이 달라지면(재평가) 스냅샷 ID도 달라진다 — 다른 버전 값을 한 안의 값으로 섞지 않는다", meta.snapshotId !== X.snapshotIdOf("P1", blocks.map((b, i) => (i === 0 ? { ...b, expected_kpi: 0.21 } : b)), versions));

    // OPT05 채택 스냅샷과 같은 블록·같은 예상값으로 연결(방송 후 회고)
    const input = X.adoptionInputFrom({ runId: "run-1", weekStart: "2026-10-12", targetLabel: "수도권 2049", blocks, versions, rightsInventory: "inv9", planFingerprint: "fp1", decision: { status: "ADOPTED", reason: "경쟁작 대응", decidedBy: "pd:1" }, context: { notes: [], priorSameSlot: [] } });
    check("경쟁 Benchmark 가상 편성은 채택 스냅샷에서 제외", input.blocks.length === 2 && !input.blocks.some((b) => b.programKey === "BM"));
    const snap = AD.buildAdoptionSnapshot(input, 7 * 24 * 60);
    check("채택 스냅샷의 주간 기대값 = 내보낸 편성안 값(분 가중 0.15)", near(snap.weeklyExpected, 0.15) && AD.verifyAdoption(snap));
    const settle = AD.settleAdoption(snap, [{ weekday: 1, startMin: 1200, endMin: 1260, rating: 0.18 }, { weekday: 2, startMin: 1200, endMin: 1260, rating: 0.12 }], "수도권 2049");
    check("방송 후 회고: 같은 스냅샷의 예상과 실적 차이(+0%p)를 같은 분모로 추적", settle.verified && near(settle.weeklyExpectedOnCompared, 0.15) && near(settle.weeklyActualOnCompared, 0.15) && settle.blocks.length === 2 && settle.causal.claim === "none");
  }

  // ══ 8. 코드 구조 대조(소스) ═════════════════════════════════════
  console.log("\n— 연결 확인(소스) —");
  {
    const perm = read("src/lib/admin/permissions.ts");
    check("새 권한 키 schedule_edit가 권한표 한 곳에 있고 편성자(PD)에게 허용", /\| "schedule_edit"/.test(perm) && /schedule_edit: "planner"/.test(perm));
    const api = read("src/lib/idealSchedule/apiUtil.ts");
    check("API는 권한 판정을 permissions.can으로만 한다(requireActorFor)", /requireActorFor/.test(api) && /can\(roleOfSession/.test(api));
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const rd = strip(read("src/app/api/scheduling/ideal-schedule/[runId]/readiness/route.ts"));
    check("확정 준비 검사 API는 schedule_finalize 권한을 요구하고 운영 반영을 하지 않는다(operationApplied=false)", /requireActorFor\("schedule_finalize"\)/.test(rd) && /operationApplied: false/.test(rd));
    const ed = strip(read("src/app/api/scheduling/ideal-schedule/[runId]/edits/route.ts"));
    const bl = strip(read("src/app/api/scheduling/ideal-schedule/[runId]/blocks/[blockId]/route.ts"));
    check("수동 수정 API(교체·잠금·실행 취소·다시 실행·재평가)는 schedule_edit 권한을 요구한다", /requireActorFor\("schedule_edit"\)/.test(ed) && /requireActorFor\("schedule_edit"\)/.test(bl));
    const ex = strip(read("src/app/api/scheduling/ideal-schedule/[runId]/export/route.ts"));
    check("내보내기는 화면과 같은 작업본 보기(loadRunView)와 머리 정보(buildExportMeta)를 쓴다 — 옛 needs_recalc 합산 없음", /loadRunView/.test(ex) && /buildExportMeta/.test(ex) && !/needs_recalc/.test(ex));
    const cmpRoute = strip(read("src/app/api/scheduling/ideal-schedule/[runId]/compare/route.ts"));
    check("비교·실행 조회·내보내기가 모두 같은 작업본 보기를 지난다", /loadRunView/.test(cmpRoute) && /loadRunView/.test(strip(read("src/app/api/scheduling/ideal-schedule/[runId]/route.ts"))));
    const wc = strip(read("src/lib/idealSchedule/workingCopy.ts"));
    check("수동 교체는 권리 판정을 거친다(권리상 불가 거부) — 엔진 게이트 우회 오류 수정", /swapRightsVerdict/.test(wc) && /allowed/.test(wc) && /RIGHTS_AT_SWAP/.test(wc));
    check("교체·이력 저장이 실패하면 블록을 원래대로 되돌린다(유효한 이전 상태 보존)", (wc.match(/writeBlock\(runId, blockId, before/g) ?? []).length >= 2);
    const vs = strip(read("src/lib/idealSchedule/variantsServer.ts"));
    check("비교 카드는 재평가 전(DIRTY) 작업본에서는 만들지 않는다 — 다른 버전 값이 섞이지 않게", /state\.state === "DIRTY"/.test(vs));
    const rs = strip(read("src/lib/idealSchedule/readinessServer.ts"));
    check("비교 카드·확정 준비 서버는 권리 예약·편성 저장을 하지 않는다 — 쓰기는 검사 요약 기록(실행 요약 한 곳)뿐", !/\.(insert|update|upsert|delete)\(/.test(vs) && !/\.(insert|upsert|delete)\(/.test(rs) && (rs.match(/\.update\(/g) ?? []).length === 1 && /from\("ideal_schedule_runs"\)\.update/.test(rs));
    const page = strip(read("src/app/ideal-schedule/page.tsx"));
    check("화면은 교체·실행 취소에 baseSeq(동시 수정 감지)를 보내고 실패 시 이전 편성안 유지를 알린다", /baseSeq: view\?\.working\?\.editSeq/.test(page) && /이전 편성안은 그대로/.test(page));
  }

  // ══ 변이 점검에서 드러난 빈틈 보강 ═════════════════════════════════
  console.log("\n— 보강(변이 점검) —");
  {
    check("실행 가능으로 쓸 수 있는 권리 상태는 '확인됨'뿐 — 조건부·미확인·확인 안 함·불가는 안 된다", R.isExecutableRights("available") && !R.isExecutableRights("conditional") && !R.isExecutableRights("unknown") && !R.isExecutableRights("not_checked") && !R.isExecutableRights("unavailable"));
    // 모든 변형이 기준안보다 낮으면 '최고 기대안' 표지를 달지 않는다
    const worse = [cb(1, 1200, 1260, "A", 0.2), cb(1, 1260, 1320, "E", 0.05), cb(2, 1200, 1260, "C", 0.1), cb(2, 1260, 1320, "D", 0.1)];
    const cardsWorse = C.buildPlanCards([mk("BASELINE", baseline), mk("MIN_CHANGE", worse)]);
    check("기준안보다 낮은 안뿐이면 '최고 기대안' 표지가 없다", cardsWorse.every((c) => !c.claims.bestExpected) && (cardsWorse[1].vsBaseline?.diffPp ?? 0) < 0);
    check("어느 카드도 최적 증명을 주장하지 않는다", C.buildPlanCards([mk("BASELINE", baseline), mk("MIN_CHANGE", planMin), mk("PERFORMANCE", planPerf)]).every((c) => c.claims.optimalProven === false));
    // 상위 변경은 주간 기여(차이×분) 순 — 한 칸의 큰 차이(짧은 칸)보다 긴 칸의 중간 차이가 위에 온다
    const ep = (b: import("../src/lib/idealSchedule/planCards").CardBlock) => ({ ...b, episode: null });
    const shortBig = cb(3, 1200, 1230, "S", 0.3); // 30분, +0.2
    const longMid = cb(3, 1230, 1350, "L", 0.2); // 120분, +0.1
    const baseS = cb(3, 1200, 1230, "s0", 0.1);
    const baseL = cb(3, 1230, 1350, "l0", 0.1);
    const tc = T.topChanges([{ blockId: "s", plan: ep(shortBig), base: ep(baseS), rights: null, alternatives: [] }, { blockId: "l", plan: ep(longMid), base: ep(baseL), rights: null, alternatives: [] }], [baseS, baseL], [shortBig, longMid], 5);
    check("주요 변경 순서는 주간 기여 순(긴 칸의 중간 차이 > 짧은 칸의 큰 차이)", tc[0].blockId === "l" && tc[1].blockId === "s");
    const many = Array.from({ length: 8 }, (_, i) => ({ blockId: `x${i}`, plan: ep(cb(4, 1200 + i * 60, 1260 + i * 60, `P${i}`, 0.1 + i * 0.01)), base: ep(cb(4, 1200 + i * 60, 1260 + i * 60, `Q${i}`, 0.1)), rights: null, alternatives: [] }));
    check("주요 변경은 최대 5건", T.topChanges(many, many.map((m) => m.base), many.map((m) => m.plan), 5).length === 5);
  }

  // ══ 작업본 보기(같은 편성안을 가리킨다) ═══════════════════════════
  console.log("\n— 작업본 보기·되돌리기 기준 —");
  {
    const W = await import("../src/lib/idealSchedule/workingView");
    const mkBlock = (id: string, wd: number, s: number, e: number, key: string, exp: number): Record<string, unknown> & { id: string; weekday: number; start_min: number; end_min: number; candidate_key: string; expected_kpi: number; layer: string } => ({ id, layer: "IDEAL", weekday: wd, start_min: s, end_min: e, candidate_key: key, program_key: key.split("|")[0], program_name: key.split("|")[0], content_type: "OWN", expected_kpi: exp, status: "AI", locked: false });
    const blocks = [mkBlock("b1", 1, 1200, 1260, "A|FIRST", 0.2), mkBlock("b2", 1, 1260, 1320, "B|FIRST", 0.1)];
    const v0 = V.planVersionOf(blocks);
    const clean = W.buildWorkingView({}, blocks);
    check("수정이 없으면 계산 완료본, 버전은 편성안 버전과 같다", clean.view.state.state === "COMPUTED" && clean.view.planVersion === v0 && clean.view.editSeq === 0 && !clean.view.canUndo);
    const before = L.snapshotOf(blocks[1]);
    const swapped = { ...blocks[1], candidate_key: "C|FIRST", program_key: "C", program_name: "C", expected_kpi: 0.3 };
    const rec = L.recordEdit(L.emptyLog(v0), { kind: "SWAP", blockId: "b2", slot: { weekday: 1, startMin: 1260, endMin: 1320 }, before, after: L.snapshotOf(swapped), reason: "경쟁작 대응", actor: "pd", at: NOW, rights: { status: "available", label: "권리 확인됨", reviewOnly: false }, from: "B", to: "C" }) as { ok: true; log: import("../src/lib/idealSchedule/editLog").EditLog };
    const after = [blocks[0], swapped];
    const dirty = W.buildWorkingView({ workingCopy: { editLog: rec.log } }, after);
    check("수정 뒤 재평가 전이면 DIRTY, 버전이 바뀌고 계산 완료본 버전을 따로 기억한다", dirty.view.state.state === "DIRTY" && dirty.view.planVersion !== v0 && dirty.view.baseVersion === v0 && dirty.view.canUndo && dirty.view.editedBlocks.length === 1);
    check("DIRTY의 주간 기대는 지금 칸 값의 분 가중(0.2·60+0.3·60)/120 = 0.25", near(dirty.view.weeklyExpected, 0.25));
    const rb = L.revertToBase(after, rec.log);
    check("revertToBase: 첫 수정 전 스냅샷으로 칸을 되돌린다(원래 후보·값)", rb[1].candidate_key === "B|FIRST" && rb[1].expected_kpi === 0.1 && rb[0].candidate_key === "A|FIRST");
    check("revertToBase: 수정 이력이 없으면 그대로", L.revertToBase(after, L.emptyLog(v0))[1].candidate_key === "C|FIRST");
    const undone = L.undoStep(rec.log) as { log: import("../src/lib/idealSchedule/editLog").EditLog };
    const back = W.buildWorkingView({ workingCopy: { editLog: undone.log } }, blocks);
    check("실행 취소하면 버전이 계산 완료본으로 돌아가고 상태는 COMPUTED, 편수정 이력은 다시 실행 가능", back.view.planVersion === v0 && back.view.state.state === "COMPUTED" && back.view.canRedo && back.view.editSeq === 2);
    const stored = { state: "REVIEW_ONLY", label: "검토안", checkedAt: NOW, planVersion: v0, editSeq: 0, counts: { executable: 0, reviewOnly: 2, blocked: 0, total: 2 }, inventoryVersion: null, checkedBy: "pd" };
    check("확정 준비 기록은 같은 편성안일 때만 current — 편성안이 바뀌면 다시 검사해야 한다", W.buildWorkingView({ workingCopy: { readiness: stored } }, blocks).view.readiness?.current === true && W.buildWorkingView({ workingCopy: { editLog: rec.log, readiness: stored } }, after).view.readiness?.current === false);
    check("깨진 저장 JSON(작업본)은 빈 이력으로 시작한다", W.buildWorkingView({ workingCopy: { editLog: { seq: "x" } } }, blocks).view.state.state === "COMPUTED");
  }

  console.log(`\n통과 ${passed} · 실패 ${failures.length}`);
  if (failures.length) {
    console.log("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
