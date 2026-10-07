// 단계 13 테스트 — 콘텐츠 구매 검토: Avail 단계(보유/보유 예정)·방영권 종료·제작년도·권리 표시·추천 기준일 정합·구간 비교·근거 강도·스냅샷·조회 무부작용.
// 합성 입력만 쓴다. DB·네트워크 없음. 실행: npm run test:purchase-review
import fs from "node:fs";
import path from "node:path";
import { buildEvalContext } from "../src/lib/avail/context";
import { evaluateEligibility, matchGrants } from "../src/lib/avail/evaluate";
import { buildManualGrants } from "../src/lib/avail/manualGrant";
import { slotRightsOf, type SlotRights } from "../src/lib/idealSchedule/slotRights";
import type { Grant } from "../src/lib/avail/types";
import { classifyAcquisition, endText, briefOf, type AcquisitionStage } from "../src/lib/purchaseReview/acquisition";
import { alignmentOf, recoVsSim, RECO_MAX_AGE_DAYS } from "../src/lib/purchaseReview/alignment";
import { compareEstimates, rankWithTies } from "../src/lib/purchaseReview/compare";
import { markerSpread, productionYearOf } from "../src/lib/purchaseReview/productionYear";
import { purchaseRightsView } from "../src/lib/purchaseReview/rightsDisplay";
import { buildReviewSnapshot, verifyReviewSnapshot } from "../src/lib/purchaseReview/snapshot";
import { judgeFromDate, kstNow, nextAirDate } from "../src/lib/purchaseReview/slotDate";
import { evidenceOf, transferOf } from "../src/lib/purchaseReview/transfer";
import { MODEL_VERSION, PARAMS, peerIndexes, predictSlot, type SimInputs, type SlotAgg } from "../src/lib/purchaseSim/engine";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const TODAY = "2026-10-07";
const TITLE = "결이 다른 전쟁사";

// ── 합성 Avail: 운영자 입력 2건(ENA Drama 10/25 23:50, 나머지 5채널 11/20 23:50) ──
const built = buildManualGrants({
  title: TITLE,
  windows: [
    { channels: ["ENA Drama"], startDate: "2026-10-25", startTime: "23:50" },
    { channels: ["ENA Play", "ENA Story", "OLIFE", "ONCE", "skyUHD"], startDate: "2026-11-20", startTime: "23:50" },
  ],
  actor: "tester",
  enteredAt: "2026-10-07T00:00:00Z",
});
if (!built.ok) throw new Error(built.message);
const GRANTS = built.grants;
const ctxOf = (grants: Grant[], now = "2026-10-07T09:00:00+09:00") => buildEvalContext({ revisions: grants, addenda: [], ledger: [], links: [], confirmations: [], interpretationConfirmations: {} }, { now }).ctx;
const withEnd = (g: Grant, end: string): Grant => ({ ...g, window: { ...g.window, end: { state: "value", value: end } } });
const withYear = (g: Grant, y: string): Grant => ({ ...g, content: { ...g.content, productionYear: { state: "value", value: y } } });

// ── 1) 단계 분류: 보유 / 보유 예정(두 근거) / 확인 못함 ─────────────────
{
  const ctx = ctxOf(GRANTS);
  const m = matchGrants({ programId: null, programName: TITLE }, ctx);
  const drama = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_DRAMA", today: TODAY });
  check("ENA Drama 시작 전(10/25) → 보유 예정(Avail 행 있음)", drama.stage === "PLANNED" && drama.plannedBasis === "avail_row", `${drama.stage}/${drama.plannedBasis}`);
  const ena = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA", today: TODAY });
  check("권리 행이 없는 채널(ENA)은 미확보가 아니라 보유 예정(권리 획득 가정)", ena.stage === "PLANNED" && ena.plannedBasis === "assumed", `${ena.stage}/${ena.plannedBasis}`);
  check("단계는 보유·보유 예정 둘뿐(미확보 신규 구매 단계 없음)", !("NOT_ACQUIRED" in ({ OWNED: 1, PLANNED: 1, NEEDS_LINK: 1, NO_AVAIL_DATA: 1 } as Record<string, number>)) && !read("src/lib/purchaseReview/acquisition.ts").includes('"NOT_ACQUIRED"'));
  const later = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: "2026-11-21" });
  check("시작일이 지나면 보유", later.stage === "OWNED", later.stage);
  const sameDayBefore = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: "2026-11-20", nowMinKst: 23 * 60 });
  check("시작일 당일이라도 23:50 전이면 보유 예정", sameDayBefore.stage === "PLANNED", sameDayBefore.stage);
  const sameDayAfter = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: "2026-11-20", nowMinKst: 23 * 60 + 55 });
  check("시작일 당일 23:50 이후면 보유", sameDayAfter.stage === "OWNED", sameDayAfter.stage);
  const none = matchGrants({ programId: null, programName: "아무도 모르는 신작" }, ctx);
  const airing = classifyAcquisition({ availConfigured: true, match: none, channelCode: "ENA_PLAY", today: TODAY, ownRecentAiring: true });
  check("이 채널에서 최근 방영 중이면 Avail 행이 없어도 보유(권리 확인 못함)", airing.stage === "OWNED" && airing.ownedBasis === "airing_only" && airing.plannedBasis === null && airing.note.includes("확인하지 못했습니다"));
  const airingRights = purchaseRightsView(airing.stage, airing.plannedBasis, slotRightsOf(evaluateEligibility({ programId: null, programName: "아무도 모르는 신작" }, { broadcastDate: "2026-10-09", startMin: 22 * 60, endMin: 23 * 60, channelId: "ENA_PLAY" }, ctx)));
  check("방영 중이지만 Avail 행이 없으면 칸 권리는 미확인이라 실행 가능 아님", !airingRights.executable && airingRights.chip.includes("미확인"), airingRights.chip);
  const otherChOnly = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA", today: TODAY, ownRecentAiring: true });
  check("다른 채널용 권리만 있어도 이 채널에서 방영 중이면 보유(권리 확인 못함)로 알림", otherChOnly.stage === "OWNED" && otherChOnly.ownedBasis === "airing_only" && otherChOnly.note.includes("다른 채널용 권리만"));
  const notAiring = classifyAcquisition({ availConfigured: true, match: none, channelCode: "ENA_PLAY", today: TODAY, ownRecentAiring: false });
  check("방영 이력이 없다는 사실만으로 구매 가능성을 말하지 않음(보유 예정 가정으로만 둠)", notAiring.stage === "PLANNED" && notAiring.plannedBasis === "assumed");
  check("Avail 행이 있으면 방영 중 여부와 무관하게 행을 따름", classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: "2026-11-21", ownRecentAiring: false }).ownedBasis === "avail_row");
  const newBuy = classifyAcquisition({ availConfigured: true, match: none, channelCode: "ENA_PLAY", today: TODAY });
  check("Avail에 없는 신규 구매 후보 → 보유 예정(가정), 단계 이름은 보유 예정", newBuy.stage === "PLANNED" && newBuy.plannedBasis === "assumed" && newBuy.label === "보유 예정");
  check("신규 후보 설명에 '방영한 적 없다는 사실은 구매 가능성의 증거가 아님'을 밝힘", newBuy.note.includes("구매 가능성의 증거가 아닙니다"));
  const noAvail = classifyAcquisition({ availConfigured: false, match: null, channelCode: "ENA", today: TODAY });
  check("Avail 미입력 → 확인 못함(보유 예정으로 보지 않음)", noAvail.stage === "NO_AVAIL_DATA" && noAvail.plannedBasis === null);
  const similar = matchGrants({ programId: null, programName: "결이 다른 전쟁사 시즌2" }, ctx);
  const link = classifyAcquisition({ availConfigured: true, match: similar, channelCode: "ENA_PLAY", today: TODAY });
  check("시즌이 다른 제목은 자동 병합하지 않고 연결 확인 필요", link.stage === "NEEDS_LINK" || (link.stage === "PLANNED" && link.plannedBasis === "assumed" && similar.grants.length === 0), `${link.stage} grants=${similar.grants.length}`);
  check("연결 확인 필요일 때 권리 행을 가져다 쓰지 않음", similar.grants.length === 0);
  const revoked = classifyAcquisition({ availConfigured: true, match: { ...m, grants: GRANTS.map((g) => ({ ...g, status: "revoked" as const })) }, channelCode: "ENA_PLAY", today: "2026-12-01" });
  check("철회된 권리만 있으면 보유가 아니라 보유 예정(재확보 가정)", revoked.stage === "PLANNED" && revoked.plannedBasis === "assumed");
}

// ── 2) 방영권 종료 표기 ───────────────────────────────────────────────
{
  const g = GRANTS.find((x) => (x.scope.channels.kind === "list" ? x.scope.channels.ids.includes("ENA Play") : false))!;
  const ctxFor = (grant: Grant) => matchGrants({ programId: null, programName: TITLE }, ctxOf([grant]));
  const unknown = briefOf(g, "ENA_PLAY", "2026-12-01");
  check("종료일 빈칸 → 미확인(무제한으로 쓰지 않음)", unknown.endState === "unknown" && unknown.endLabel.includes("미확인") && !unknown.endLabel.includes("제한 없음"), unknown.endLabel);
  const open = briefOf(withEnd(g, "2027-06-30"), "ENA_PLAY", "2026-12-01");
  check("종료일이 멀면 남은 일수 표기", open.endState === "open" && open.daysToEnd === 211 && open.endLabel.includes("2027-06-30"), `${open.endState}/${open.daysToEnd}/${open.endLabel}`);
  const soon = briefOf(withEnd(g, "2026-12-20"), "ENA_PLAY", "2026-12-01");
  check("60일 이내면 종료 임박", soon.endState === "ends_soon" && soon.endLabel.includes("종료 임박"), soon.endLabel);
  const ended = briefOf(withEnd(g, "2026-11-30"), "ENA_PLAY", "2026-12-01");
  check("종료일이 지났으면 종료됨 표기", ended.endState === "ended" && ended.endLabel.includes("종료"), ended.endLabel);
  const unb = briefOf({ ...g, window: { ...g.window, end: { state: "unbounded" } } }, "ENA_PLAY", "2026-12-01");
  check("무제한은 Avail이 명시한 경우만", unb.endState === "unbounded" && unb.endLabel.includes("명시"));
  const grantEnded = withEnd(g, "2026-11-30");
  const v = classifyAcquisition({ availConfigured: true, match: ctxFor(grantEnded), channelCode: "ENA_PLAY", today: "2026-12-01" });
  check("방영권이 종료된 작품은 보유가 아니라 보유 예정(재확보 가정)이며 종료 사유를 밝힘", v.stage === "PLANNED" && v.plannedBasis === "assumed" && v.note.includes("종료"), `${v.stage} ${v.note}`);
  const owned = classifyAcquisition({ availConfigured: true, match: ctxFor(withEnd(g, "2027-06-30")), channelCode: "ENA_PLAY", today: "2026-12-01" });
  check("보유 상태의 대표 종료 표기 제공", owned.stage === "OWNED" && owned.rightsEnd?.state === "open" && owned.rightsEnd.text.includes("2027-06-30"), JSON.stringify(owned.rightsEnd));
  const mixed = classifyAcquisition({ availConfigured: true, match: ctxFor(g), channelCode: "ENA_PLAY", today: "2026-12-01" });
  check("종료일 미확인이면 대표 표기도 미확인", mixed.rightsEnd?.state === "unknown");
  check("endText: 종료됨 문구에 경과 일수", endText({ end: "2026-11-30", daysToEnd: -1, endState: "ended" }).includes("1일 전 종료"));
}

// ── 3) 권리 표시: 실행 가능은 '보유 + available'뿐 ─────────────────────
{
  const stages: [AcquisitionStage, "avail_row" | "assumed" | null][] = [["OWNED", null], ["PLANNED", "avail_row"], ["PLANNED", "assumed"], ["NEEDS_LINK", null], ["NO_AVAIL_DATA", null]];
  const statuses: SlotRights["status"][] = ["available", "conditional", "unknown", "unavailable", "not_checked"];
  const mk = (status: SlotRights["status"]): SlotRights => ({ status, label: "", reasonCodes: [], reasons: ["사유"], remaining: null, eligibleEpisodes: null, expiresOn: null, inventoryVersion: null, grantRevisionIds: [], assumptions: [] });
  const leaks: string[] = [];
  for (const [st, basis] of stages) {
    for (const status of [...statuses, null] as (SlotRights["status"] | null)[]) {
      const v = purchaseRightsView(st, basis, status ? mk(status) : null);
      const shouldExec = st === "OWNED" && status === "available";
      if (v.executable !== shouldExec) leaks.push(`${st}/${basis}/${status}=${v.executable}`);
    }
  }
  check("모든 단계×판정 조합에서 실행 가능은 보유+available일 때만", leaks.length === 0, leaks.join(","));
  const assumed = purchaseRightsView("PLANNED", "assumed", mk("available"));
  check("권리 획득 가정은 판정이 available이어도 실행 가능이 아니며 가정 표시", !assumed.executable && assumed.assumed && assumed.chip.includes("실행 가능 아님"));
  check("신규 후보 안내에 '방영한 적 없다는 사실은 증거 아님'", assumed.lines.some((l) => l.includes("구매 가능성의 증거가 아닙니다")));
  const ownedUnknown = purchaseRightsView("OWNED", null, mk("unknown"));
  check("보유라도 권리 미확인이면 실행 가능 아님", !ownedUnknown.executable && ownedUnknown.tone === "warn");
  const ownedBad = purchaseRightsView("OWNED", null, mk("unavailable"));
  check("보유라도 권리상 불가면 불가 표시", ownedBad.tone === "bad" && !ownedBad.executable);

  // 실제 판정기와 연결: 운영자 입력(시작 전) → unavailable, 시작 후(종료·방수 빈칸) → unknown
  const ctx = ctxOf(GRANTS);
  const slotBefore = slotRightsOf(evaluateEligibility({ programId: null, programName: TITLE }, { broadcastDate: "2026-10-26", startMin: 22 * 60, endMin: 23 * 60, channelId: "ENA_DRAMA" }, ctx));
  check("실제 판정: 시작(10/25 23:50) 이후 방송은 종료·방수 빈칸이라 미확인", slotBefore.status === "unknown", slotBefore.status);
  const slotPre = slotRightsOf(evaluateEligibility({ programId: null, programName: TITLE }, { broadcastDate: "2026-10-20", startMin: 22 * 60, endMin: 23 * 60, channelId: "ENA_DRAMA" }, ctx));
  check("실제 판정: 시작 전 방송은 불가", slotPre.status === "unavailable", slotPre.status);
  check("실제 판정 → 표시: 보유 예정(행 있음)+불가는 불가 문구를 알리되 실행 가능 아님", (() => { const v = purchaseRightsView("PLANNED", "avail_row", slotPre); return !v.executable && v.lines.some((l) => l.includes("불가")); })());
  const slotUnknownOwned = purchaseRightsView("OWNED", null, slotBefore);
  check("실제 판정 → 표시: 보유+미확인은 실행 가능 아님", !slotUnknownOwned.executable);
}

// ── 4) 제작년도 표기 ─────────────────────────────────────────────────
{
  const a = productionYearOf({ availYears: ["2021"], featured: { startDate: "2026-11-03", endDate: "2026-12-08", expectedEpisodes: 6 } });
  check("Avail 제작년도가 있으면 그 값(확정)", a.source === "avail" && a.confirmed && a.text === "제작년도 2021", a.text);
  const b = productionYearOf({ availYears: [], featured: { startDate: "2026-11-03", endDate: "2027-01-12", expectedEpisodes: 12 } });
  check("주요 콘텐츠 관리만 있으면 방영 시작년도로 표기하되 제작년도가 아님을 명시", b.source === "featured_start_year" && !b.confirmed && b.text.includes("제작년도 아님") && b.text.includes("2026~2027"), b.text);
  const c = productionYearOf({ availYears: ["2019", "2023"], featured: null });
  check("Avail 행마다 제작년도가 다르면 충돌로 표시", c.conflict && c.text.includes("2019 / 2023"), c.text);
  const d = productionYearOf({ availYears: [], featured: null });
  check("자료가 없으면 미확인(추정하지 않음)", d.source === "unknown" && d.text === "제작년도 미확인" && d.years.length === 0);
  const e = productionYearOf({ availYears: [], featured: null, title: "나는솔로 (2019)" });
  check("제목의 연도는 표지일 뿐 제작년도로 확정하지 않음", e.source === "title_marker" && !e.confirmed && e.text.includes("확인 전"), e.text);
  check("후보끼리 시즌이 다르면 알림", markerSpread(["나는솔로 시즌1", "나는솔로 시즌2"]).differs);
  check("표지가 같으면 알림 없음", !markerSpread(["라디오스타", "라디오스타 "]).differs);
  const g1 = withYear(GRANTS[0], "2024");
  check("Avail 행의 제작년도 값을 briefOf가 노출", briefOf(g1, "ENA_DRAMA", TODAY).productionYear === "2024");
}

// ── 5) 추천 목록 ↔ 시뮬레이션 기준일·모델 정합 ───────────────────────
{
  const ok = alignmentOf({ asOf: "2026-10-05", modelVersion: MODEL_VERSION, computedAt: "2026-10-06T00:00:00Z" }, { asOf: "2026-10-05", modelVersion: MODEL_VERSION }, "2026-10-07T00:00:00Z");
  check("기준일·모델이 같으면 정합", ok.aligned && ok.messages.length === 0);
  const lag = alignmentOf({ asOf: "2026-09-28", modelVersion: MODEL_VERSION, computedAt: "2026-09-29T00:00:00Z" }, { asOf: "2026-10-05", modelVersion: MODEL_VERSION }, "2026-10-07T00:00:00Z");
  check("기준일이 7일 뒤처지면 오래된 추천", !lag.aligned && lag.asOfLagDays === 7 && lag.messages[0].includes("오래된 추천"), lag.messages.join("|"));
  const model = alignmentOf({ asOf: "2026-10-05", modelVersion: "purchase-v1.0", computedAt: "2026-10-06T00:00:00Z" }, { asOf: "2026-10-05", modelVersion: MODEL_VERSION }, "2026-10-07T00:00:00Z");
  check("모델 버전이 다르면 오래된 추천", !model.aligned && model.modelDiffers);
  const overdue = alignmentOf({ asOf: "2026-10-05", modelVersion: MODEL_VERSION, computedAt: "2026-09-20T00:00:00Z" }, { asOf: "2026-10-05", modelVersion: MODEL_VERSION }, "2026-10-07T00:00:00Z");
  check(`계산 후 ${RECO_MAX_AGE_DAYS}일 넘으면 주간 갱신 지연 알림`, overdue.refreshOverdue && !overdue.aligned && overdue.messages.some((m) => m.includes("주간 갱신")));
  const unknownModel = alignmentOf({ asOf: "2026-10-05", modelVersion: null, computedAt: null }, { asOf: "2026-10-05", modelVersion: MODEL_VERSION }, "2026-10-07T00:00:00Z");
  check("모델·계산 시각을 모르는 추천은 있는 정보로만 판단(날짜가 같으면 정합)", unknownModel.aligned);
  const diff = recoVsSim(0.5, 0.4);
  check("추천 값과 최신 값의 차이를 숨기지 않음", diff.changePct !== null && Math.abs(diff.changePct + 20) < 1e-9 && diff.text.includes("낮아짐 20%"), diff.text);
  check("값이 없으면 비교 불가를 알림", recoVsSim(null, 0.4).changePct === null);
}

// ── 6) 구간 비교: 겹치면 확정 우열 금지 ───────────────────────────────
{
  const hi = { value: 0.52, low: 0.4, high: 0.66, confidence: "MEDIUM" };
  const lo = { value: 0.5, low: 0.38, high: 0.63, confidence: "MEDIUM" };
  const ov = compareEstimates(hi, lo, { a: "신규", b: "보유작" });
  check("범위가 겹치면 우열을 확정하지 않음", ov.verdict === "OVERLAP" && ov.text.includes("확정할 수 없습니다") && ov.likely === null);
  const clear = compareEstimates({ value: 0.9, low: 0.8, high: 1.0, confidence: "MEDIUM" }, { value: 0.4, low: 0.3, high: 0.5, confidence: "MEDIUM" }, { a: "신규", b: "보유작" });
  check("범위가 겹치지 않아도 '확정'이라 쓰지 않고 가능성으로만 표현", clear.verdict === "A_HIGHER" && clear.likely === "A" && clear.text.includes("확정은 아님") && clear.decisive === false);
  const rev = compareEstimates({ value: 0.4, low: 0.3, high: 0.5, confidence: "MEDIUM" }, { value: 0.9, low: 0.8, high: 1.0, confidence: "MEDIUM" });
  check("반대 방향도 대칭", rev.verdict === "B_HIGHER" && rev.likely === "B");
  const noInt = compareEstimates({ value: 0.6, low: null, high: null }, { value: 0.3, low: 0.2, high: 0.4 });
  check("범위가 없으면 우열을 판단하지 않음", noInt.verdict === "NO_INTERVAL" && noInt.likely === null && noInt.text.includes("참고용"));
  const insuff = compareEstimates({ value: 0.6, low: 0.5, high: 0.7, confidence: "INSUFFICIENT" }, lo);
  check("근거 부족 값은 비교하지 않음", insuff.verdict === "INCOMPARABLE");
  check("한쪽이 예측 불가면 비교하지 않음", compareEstimates({ value: null, low: null, high: null }, lo).verdict === "INCOMPARABLE");
  const items = [
    { n: "A", v: 0.52, l: 0.4, h: 0.66 },
    { n: "B", v: 0.5, l: 0.38, h: 0.63 },
    { n: "C", v: 0.2, l: 0.1, h: 0.25 },
    { n: "D", v: 0.3, l: null as number | null, h: null as number | null },
  ];
  const ranked = rankWithTies(items, (x) => ({ value: x.v, low: x.l, high: x.h }));
  const byName = Object.fromEntries(ranked.map((r) => [r.item.n, r]));
  check("순위: 1위와 범위가 겹치는 2위는 공동권 표시", ranked[0].item.n === "A" && !byName.A.tiedWithTop && byName.B.tiedWithTop);
  check("순위: 범위가 떨어진 항목은 공동권이 아님", !byName.C.tiedWithTop, `C=${byName.C.tiedWithTop}`);
  check("순위: 범위가 없는 항목은 단정할 수 없어 공동권으로 봄", byName.D.tiedWithTop);
  check("순위: 1위와의 점 예측 차이", Math.abs(byName.C.gapToTop + 0.32) < 1e-9);
}

// ── 7) 예측 근거 강도·전이 보정 (엔진 합성 입력) ───────────────────────
{
  const ownChan: SlotAgg[] = [{ w: 91, slot: "WD|6", sum: 0.5 * 40, n: 40 }];
  const peerChan = (ch: string): SlotAgg[] => [{ w: 91, ch, slot: "WD|6", sum: 0.6 * 60, n: 60 }];
  const peerProg = (ch: string, jae = 0): SlotAgg[] => [{ w: 91, ch, slot: "WD|6", sum: 0.9 * 20, n: 20, jae }];
  const mkInputs = (chs: string[]): SimInputs => ({
    as_of: "2026-10-05",
    windows: [91],
    target: "HH",
    own_channel: "ENA_PLAY",
    peer_chan_slots: chs.flatMap(peerChan),
    peer_prog_slots: chs.flatMap((c) => peerProg(c, 10)),
    own_chan_slots: ownChan,
    own_prog_slots: [],
    comp_max_date: "2026-10-05",
    own_max_date: "2026-10-05",
  });
  const cal = [{ scenario: "PEER|HIGH_LEVEL", n: 100, q05: -0.6, q10: -0.4, q25: -0.2, q50: 0, q75: 0.2, q90: 0.4, q95: 0.6, mae_log: 0.2 }];

  const none = predictSlot(mkInputs([]), "HH", "WD|6", cal, { windowDays: 91, ignoreOwnHistory: true });
  const evNone = evidenceOf(none);
  check("비교 표본 0 → 근거 없음(고신뢰로 표시하지 않음)", none.prediction === null && evNone.level === "NONE" && evNone.label === "근거 없음", `${none.status}/${evNone.level}`);
  const tNone = transferOf(none, peerIndexes(mkInputs([]), 91), "HH");
  check("표본 0은 예측값을 만들지 못했다고 밝힘", tNone.noSample && tNone.uncertainty.text.includes("높은 신뢰로 표시하지 않습니다"));

  const three = mkInputs(["TVING_A", "CHANNEL_B", "CHANNEL_C"]);
  const p3 = predictSlot(three, "HH", "WD|6", cal, { windowDays: 91, ignoreOwnHistory: true });
  const e3 = evidenceOf(p3);
  check("타 채널 실적만 있는 신규 구매는 근거 '강함'이 되지 않음", p3.prediction !== null && e3.level !== "STRONG", `${p3.confidence}/${e3.level}`);
  check("엔진 신뢰도 HIGH가 와도 PEER는 보통으로 상한", evidenceOf({ ...p3, confidence: "HIGH" }).level === "MODERATE" && evidenceOf({ ...p3, confidence: "HIGH" }).caps.some((c) => c.includes("강함")));
  const one = predictSlot(mkInputs(["CHANNEL_B"]), "HH", "WD|6", cal, { windowDays: 91, ignoreOwnHistory: true });
  check("비교 채널 1곳이면 근거 약함 이하", one.prediction === null || ["WEAK", "NONE"].includes(evidenceOf(one).level), evidenceOf(one).level);
  const noCal = predictSlot(three, "HH", "WD|6", [], { windowDays: 91, ignoreOwnHistory: true });
  check("보정 범위가 없으면 약함으로 낮춤", noCal.prediction !== null && evidenceOf({ ...noCal, confidence: "MEDIUM" }).level === "WEAK");

  const tr = transferOf(p3, peerIndexes(three, 91), "HH");
  check("전이: 보정한 것(채널 기저·시간대·타깃·표본 수)을 나열", ["채널 기저", "시간대", "타깃", "표본 수"].every((l) => tr.adjusted.some((a) => a.label === l)));
  check("전이: 보정하지 않은 것(본/재방·회차·편성 빈도·시즌판)을 나열", ["본/재방 구성", "회차", "편성 빈도", "시즌·판"].every((l) => tr.notAdjusted.some((a) => a.label === l)));
  check("전이: 본/재방 비중을 수치로 보임", tr.notAdjusted.find((a) => a.label === "본/재방 구성")!.detail.includes("50%"), tr.notAdjusted[0].detail);
  check("전이: 단순 배수 방식의 한계를 설명", tr.limit.includes("단순 배수") && tr.method.includes("콘텐츠 지수"));
  check("전이: 불확실성에 예측 범위·과거 오차 표시", tr.uncertainty.interval !== null && (tr.uncertainty.calibration ?? "").includes("평균 오차"), JSON.stringify(tr.uncertainty));
  const a2049 = transferOf({ ...p3, caseType: "PEER" }, peerIndexes(three, 91), "A2049");
  check("수도권 2049 신규 구매는 검증 한계를 덧붙임", a2049.uncertainty.text.includes("슬롯 평균 수준"));
  const wide = transferOf({ ...p3, low: 0.1, high: 0.5 }, peerIndexes(three, 91), "HH");
  check("범위가 2배 이상 벌어지면 범위로 읽으라고 안내", wide.uncertainty.text.includes("범위로 읽어야"));
  check("제목 일치 점수는 근거 강도 계산의 입력이 아님", !read("src/lib/purchaseReview/transfer.ts").match(/from "@\/lib\/purchaseSim\/identity"/) && !/identityConfidence|score:/.test(read("src/lib/purchaseReview/transfer.ts").replace(/\/\/.*$/gm, "")));
  void PARAMS;
}

// ── 8) 스냅샷 ────────────────────────────────────────────────────────
{
  const input = {
    createdAt: "2026-10-07T00:00:00Z",
    selection: { repKey: "결이다른전쟁사", displayName: TITLE, memberKeys: ["결이다른전쟁사"], identityConfidence: 0.95, productionYear: "제작년도 미확인" },
    conditions: { channel: "ENA_PLAY", targets: ["HH"], slots: [{ isoDow: 5, startTime: "22:00" }], windowDays: 91, desiredStartDate: null },
    versions: { modelVersion: MODEL_VERSION, asOf: "2026-10-05", availInventoryVersion: "inv-1", recoAsOf: "2026-09-28" },
    acquisition: { stage: "PLANNED", plannedBasis: "avail_row", ownedBasis: null, rightsEnd: "방영권 종료일 미확인" },
    results: [{ target: "HH", slotLabel: "금 22:00", prediction: 0.5, low: 0.4, high: 0.6, evidence: "근거 보통", rights: "보유 예정 — 실행 가능 아님", executable: false }],
    alternatives: [],
    flags: { rightsAssumed: true, priceEntered: false as const, smallSample: false, recoStale: true },
    caveats: ["가격 미입력"],
  };
  const s1 = buildReviewSnapshot(input);
  check("스냅샷은 같은 내용이면 같은 지문", buildReviewSnapshot({ ...input, caveats: [...input.caveats] }).fingerprint === s1.fingerprint && verifyReviewSnapshot(s1));
  check("스냅샷은 구매·권리 예약·편성 저장이 없었음을 명시", s1.execution.purchaseRequested === false && s1.execution.rightsReserved === false && s1.execution.scheduleSaved === false && s1.flags.priceEntered === false);
  const tampered = { ...s1, results: [{ ...s1.results[0], prediction: 0.9 }] };
  check("예상값을 고쳐 쓰면 지문이 어긋남", !verifyReviewSnapshot(tampered));
  check("키 순서가 달라도 같은 지문", buildReviewSnapshot({ ...input, selection: { productionYear: input.selection.productionYear, identityConfidence: 0.95, memberKeys: ["결이다른전쟁사"], displayName: TITLE, repKey: "결이다른전쟁사" } }).fingerprint === s1.fingerprint);
  let threw = false;
  try {
    buildReviewSnapshot({ ...input, selection: { ...input.selection, repKey: "" } });
  } catch {
    threw = true;
  }
  check("선택된 작품이 없으면 스냅샷을 거부", threw);
  check("기준일이 바뀌면 다른 스냅샷", buildReviewSnapshot({ ...input, versions: { ...input.versions, asOf: "2026-10-06" } }).fingerprint !== s1.fingerprint);
}

// ── 9) 방송일 계산 ───────────────────────────────────────────────────
{
  check("2026-10-07(수) 이후 첫 금요일 = 10-09", nextAirDate("2026-10-07", 5) === "2026-10-09");
  check("같은 요일이면 당일", nextAirDate("2026-10-07", 3) === "2026-10-07");
  check("월요일은 다음 주로", nextAirDate("2026-10-07", 1) === "2026-10-12");
  const k = kstNow(new Date("2026-10-06T15:30:00Z"));
  check("KST 변환: UTC 15:30 = 다음날 00:30", k.date === "2026-10-07" && k.min === 30, `${k.date} ${k.min}`);
}

// ── 9-2) 판정 기준 방송일 ─────────────────────────────────────────────
{
  const ctx = ctxOf(GRANTS);
  const m = matchGrants({ programId: null, programName: TITLE }, ctx);
  const drama = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_DRAMA", today: TODAY });
  check("시작 시각이 있는 시작 전 권리는 시작 다음 날부터 판정(시작 전 날짜로 '불가'만 보이지 않게)", judgeFromDate(null, TODAY, drama) === "2026-10-26", judgeFromDate(null, TODAY, drama));
  const play = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: TODAY });
  check("다른 채널 묶음의 시작일도 그 채널 기준", judgeFromDate(null, TODAY, play) === "2026-11-21");
  check("희망 시작일이 있으면 그 날짜가 우선", judgeFromDate("2026-12-01", TODAY, drama) === "2026-12-01");
  check("지난 희망 시작일은 무시", judgeFromDate("2026-09-01", TODAY, drama) === "2026-10-26");
  const owned = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA_PLAY", today: "2026-11-25" });
  check("보유 상태는 오늘 기준", judgeFromDate(null, "2026-11-25", owned) === "2026-11-25");
  const assumed = classifyAcquisition({ availConfigured: true, match: m, channelCode: "ENA", today: TODAY });
  check("권리 획득 가정은 오늘 기준", judgeFromDate(null, TODAY, assumed) === TODAY);
}

// ── 10) 조회 무부작용·화면 연결(원본 대조) ─────────────────────────────
{
  const server = read("src/lib/purchaseReview/server.ts");
  const code = (t: string) => t.replace(/\/\/.*$/gm, "");
  check("검토 서버 모듈은 Avail 쓰기 함수를 쓰지 않음", !/saveImport|saveSnapshot|saveLink|saveConfirmation|saveInterpretation|saveAddenda/.test(code(server)));
  check("검토 서버 모듈은 쓰기 쿼리(insert/update/upsert/delete)가 없음", !/\.(insert|update|upsert|delete)\(/.test(code(server)));
  const route = read("src/app/api/scheduling/purchase-sim/review/route.ts");
  check("검토 API는 쓰기 쿼리가 없음", !/\.(insert|update|upsert|delete)\(/.test(code(route)));
  const predict = read("src/lib/purchaseSim/predict.ts");
  check("예측 기록 저장 건수를 응답에 담아 실행 후 알림", predict.includes("history.saved = await savePredictions") && predict.includes("계약 권리 소진·구매 요청은 일어나지 않았습니다"));
  check("예측 기록은 끌 수 있음(save:false)", read("src/app/api/scheduling/purchase-sim/predict/route.ts").includes("save: body.save !== false"));
  const page = read("src/app/ideal-schedule/purchase/page.tsx");
  check("화면: 늦은 응답 방지(검색·예측·검토 모두 요청 번호 확인)", (page.match(/my !== seq\.current/g) ?? []).length >= 4, String((page.match(/my !== seq\.current/g) ?? []).length));
  check("화면: 작품을 고르면 이전 결과·요청을 무효화(pick → resetResult)", /const pick = \(k: string, n: string\) => \{\s*resetResult\(\);/.test(page) && page.includes("seq.current++"));
  check("화면: 후보 선택은 모두 pick을 사용", !/onPick=\{\(k, n\) => \{ setGroupKey/.test(page) && (page.match(/onPick=\{pick\}/g) ?? []).length === 2);
  check("화면: 선택 작품·조건·기준일·모델을 헤더에 고정", page.includes("선택한 작품과 비교 기준") && page.includes("조건이 바뀌어 아래 결과는 이전 조건의 값입니다"));
  check("화면: 제목 일치와 예측 근거를 다른 말로 표시", page.includes("제목 일치") && page.includes("이름이 비슷한 정도일 뿐, 예측 근거 강도와 별개") && page.includes('HIGH: "근거 강함"'));
  check("화면: 오래된 추천 표시", page.includes("오래된 추천입니다") && page.includes("1위와 예측 범위가 겹침"));
  check("화면: 가격 미입력 시 ROI·최대 구매가를 만들지 않는다고 표시", page.includes("ROI·최대 구매가는 만들지 않습니다"));
  check("화면: 보유작 최선 대안 비교와 남은 방수·종료 표기", page.includes("보유작 최선 대안과 비교하기") && page.includes("남은 방수") && page.includes("종료 "));
  check("화면: 권리가 확인된 최선 대안을 따로 표시", page.includes("권리가 확인된 최선 대안") && read("src/lib/purchaseReview/server.ts").includes("bestConfirmed: items.find((i) => i.rights?.status === \"available\")"));
  check("화면: 방영권 종료 열", page.includes("방영권 종료</th>"));
  check("화면: 스냅샷 내려받기", page.includes("검토 스냅샷 내려받기"));
  check("화면: 실행 가능 표시는 view.executable만 따름", page.includes("r.view.executable") && !/executable:\s*true/.test(page));
  check("화면: 전이 보정·한계 블록", page.includes("보정하지 않은 것(따로 판단)") && page.includes("<TransferBlock"));
  const reco = read("src/app/api/scheduling/purchase-sim/recommendations/route.ts");
  check("추천 API: 모델 버전·계산 시각·정합 결과 제공", reco.includes("model_version") && reco.includes("computed_at") && reco.includes("alignmentOf"));
}

console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
  console.log("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
