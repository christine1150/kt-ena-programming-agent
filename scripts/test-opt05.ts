// OPT05 테스트 — 검증 A(예측 정확도 하네스 확장)·검증 B(탐색 품질·낙관 편향)·검증 C(채택 기록·대조)·승격 기준·시나리오 점검 연결.
// 합성 세계만 쓴다(운영 DB·네트워크 없음). 실행: npm run test:opt05
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

async function main() {
  const V = await import("../src/lib/idealSchedule/validation");
  const R = await import("../src/lib/idealSchedule/robustness");
  const A = await import("../src/lib/idealSchedule/adoption");
  const P = await import("../src/lib/idealSchedule/promotion");
  const B = await import("./opt05-bench");
  const { runWorld } = await import("./opt04-bench");

  // ── 검증 A: 집단·노출·강건 기준 ────────────────────────────────────────────
  const row = (o: Partial<import("../src/lib/idealSchedule/validation").EvalRow>): import("../src/lib/idealSchedule/validation").EvalRow => ({
    originWeek: "2026-03-02", model: "m", programId: "P", date: "2026-03-03", dow: 2, hour: 21, airingType: "FIRST", genre: "미분류", newProgram: false, knownOtherSlot: false, programHistory: 5, firstRunSeen: true, actual: 1, predicted: 1, lowRating: false, ...o,
  });
  {
    const G = V.GROUPS;
    check("집단: 본방·보유 / 본방·신규 / 재방·본방 관측 / 재방·본방 미관측을 서로 겹치지 않게 가른다", [
      G.firstRunKnown(row({})) && !G.firstRunNew(row({})),
      G.firstRunNew(row({ newProgram: true, firstRunSeen: false })) && !G.firstRunKnown(row({ newProgram: true, firstRunSeen: false })),
      G.rerunObserved(row({ airingType: "RERUN", firstRunSeen: true })) && !G.rerunUnobserved(row({ airingType: "RERUN", firstRunSeen: true })),
      G.rerunUnobserved(row({ airingType: "RERUN", firstRunSeen: false })) && !G.rerunObserved(row({ airingType: "RERUN", firstRunSeen: false })),
      !G.rerunObserved(row({ airingType: "FIRST", firstRunSeen: true })),
    ].every(Boolean));
    const ex = V.exposureOf([row({ date: "2026-03-03", programId: "A" }), row({ date: "2026-03-03", programId: "A" }), row({ date: "2026-03-05", programId: "B", originWeek: "2026-03-09" }), row({ predicted: null, date: "2026-04-01" })]);
    check("노출: 기간·방송일·고유 프로그램·프로그램×일·목표 주를 센다(예측 없는 행 제외, 같은 날 같은 프로그램은 1)", ex.from === "2026-03-03" && ex.to === "2026-03-05" && ex.airings === 3 && ex.broadcastDays === 2 && ex.programs === 2 && ex.programDays === 2 && ex.originWeeks === 2, JSON.stringify(ex));
  }
  {
    // 본방 관측 판정: 학습에 이 프로그램의 \"본방\"이 있어야 관측으로 본다(재방만 있는 작품은 미관측)
    const { mapOwnAirings } = await import("../src/lib/idealSchedule/mapping");
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const airings: import("../src/lib/idealSchedule/mapping").RawOwn["airings"] = [];
    const dates: string[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 0, 5 + i));
      const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      dates.push(date);
      const lastWeek = i >= 21;
      const mk = (pid: string, hh: number, first: boolean) => ({ date, start: `${pad2(hh)}:00:00`, end: `${pad2(hh + 1)}:00:00`, program_id: pid, program_name: pid, first_run: first, m: { "수도권 2049": { r: 1, s: 10, reach: null, ts: 600 } } });
      airings.push(mk("X", 21, false)); // 재방만 있는 작품
      airings.push(mk("Y", 22, !lastWeek)); // 앞 3주 본방, 마지막 주 재방
    }
    const bundle = mapOwnAirings({ channel_code: "SYN", kpi_label: "수도권 2049", date_from: dates[0], date_to: dates[27], holidays: [], dates_with_data: dates, airings });
    const rows = V.runRollingOrigin(bundle, { targetWeeks: ["2026-01-26"], leadDays: 0, genreOf: () => "미분류", models: [V.slotRecentModel(4)] });
    const rx = rows.find((r) => r.programId === "PX" || r.programId === "X");
    const ry = rows.find((r) => r.programId === "PY" || r.programId === "Y");
    check("본방 관측 판정: 재방만 있던 작품은 미관측, 본방 이력이 있는 작품의 재방은 관측으로 가른다", !!rx && !!ry && rx.airingType !== "FIRST" && rx.firstRunSeen === false && ry.airingType !== "FIRST" && ry.firstRunSeen === true, JSON.stringify([rx?.firstRunSeen, ry?.firstRunSeen, rows.length]));
  }
  const acc = B.runAccuracy({ worlds: 1, leads: [0] });
  const accSpike = B.runAccuracy({ worlds: 1, leads: [0], spikes: 0.02 });
  const cell = (cells: typeof acc, target: string, model: string) => cells.find((c) => c.target === target && c.model === model)!;
  {
    const t = "수도권 2049";
    const ours = cell(acc, t, "exist");
    const baseIds = ["slot4w", "slot8w", "slotmed8w", "program4", "pooled_k3", "channel4w"];
    const best = Math.min(...baseIds.map((id) => cell(acc, t, id).test.mae as number));
    check("두 타깃(수도권 2049·전국 유료가구)을 따로 평가한다", acc.some((c) => c.target === "수도권 2049") && acc.some((c) => c.target === "전국 유료가구"));
    check("현재 모델이 최선 기준모델보다 MAE가 낮다(두 타깃 모두, 같은 holdout·같은 마감)", ["수도권 2049", "전국 유료가구"].every((tg) => {
      const o = cell(acc, tg, "exist").test.mae as number;
      return o < Math.min(...baseIds.map((id) => cell(acc, tg, id).test.mae as number));
    }), `${ours.test.mae} vs ${best}`);
    check("평가 건수·방송일·고유 프로그램·프로그램×일·검증 기간이 모두 보고된다", ours.exposure.airings > 1000 && ours.exposure.broadcastDays > 50 && ours.exposure.programs > 5 && ours.exposure.programDays > 100 && !!ours.exposure.from && !!ours.exposure.to && ours.exposure.originWeeks >= 8, JSON.stringify(ours.exposure));
    const g = ours.groups;
    check("본방 = 본방·보유 + 본방·신규, 재방 = 재방·관측 + 재방·미관측(건수가 정확히 맞는다)", g.firstRun.n === g.firstRunKnown.n + g.firstRunNew.n && g.rerun.n === g.rerunObserved.n + g.rerunUnobserved.n);
    check("'다음 재방 예측'(본방을 관측한 작품)은 '새 작품 본방 예측'보다 훨씬 쉽다 — 둘을 한 숫자로 섞어 말하지 않는다", (g.rerunObserved.mae as number) * 3 < (g.firstRunNew.mae as number), `${g.rerunObserved.mae} vs ${g.firstRunNew.mae}`);
    check("신규 프로그램에서는 기준모델보다 낫지 않다(개선을 주장하지 않는다)", (g.newProgram.mae as number) > (ours.test.mae as number) * 2.5 && (g.newProgram.mae as number) > 0.9 * (cell(acc, t, "slot4w").groups.newProgram.mae as number));
    // 극단값: 평균 기반은 더 크게 흔들리고 중앙값은 덜 흔들린다(T05 발견 확인)
    const jump = (id: string) => (cell(accSpike, t, id).test.mae as number) - (cell(acc, t, id).test.mae as number);
    check("극단값을 섞으면 같은 슬롯 평균은 중앙값보다 더 나빠진다(강건성 확인) — 그래도 현재 모델이 둘 다보다 낫다", jump("slot8w") > jump("slotmed8w") && (cell(accSpike, t, "exist").test.mae as number) < (cell(accSpike, t, "slotmed8w").test.mae as number), `${jump("slot8w")} ${jump("slotmed8w")}`);
  }

  // ── 검증 B: 탐색 품질·낙관 편향 ────────────────────────────────────────────
  {
    const fixed = B.runSearchQuality([1], { skipKeep: true, rotate: false });
    const rot = B.runSearchQuality([1], { skipKeep: true, rotate: true });
    const by = (rows: typeof fixed, plan: string) => rows.find((r) => r.plan === plan)!;
    check("같은 예측표에서 기존 편성·탐욕만·AI 최적화를 비교하고 제약 위반은 모두 0이다", [...fixed, ...rot].every((r) => r.violations === 0) && ["기존 편성(지난주 실제)", "탐욕 구성만", "AI 시간 최적화"].every((p) => fixed.some((r) => r.plan === p)));
    check("프로그램·슬롯 효과가 섞인(고정 편성) 세계에서는 보고 개선율이 정답보다 작다 — 모델이 보수적(과소 보고)", (by(fixed, "AI 시간 최적화").reported as number) < (by(fixed, "AI 시간 최적화").trueImprovement as number) - 0.05);
    check("매주 편성이 바뀌는 세계에서는 보고 개선율이 정답보다 크다 — 고르면서 생기는 낙관(승자의 저주)이 측정된다", (by(rot, "AI 시간 최적화").reported as number) > (by(rot, "AI 시간 최적화").trueImprovement as number) + 0.02 && (by(rot, "AI 시간 최적화").predictionBias as number) > 0.02, `${by(rot, "AI 시간 최적화").reported} vs ${by(rot, "AI 시간 최적화").trueImprovement}`);
    check("선택된 블록의 예측은 정답보다 높고(편향 > 0), 기존 편성은 거의 편향이 없다", (by(rot, "탐욕 구성만").predictionBias as number) > 0.02 && Math.abs(by(rot, "기존 편성(지난주 실제)").predictionBias as number) < 0.02);
    const opt = B.runOptimism([5, 20], [1], 0, ["AI_OPTIMIZED"]);
    const o5 = opt.find((o) => o.programs === 5)!;
    const o20 = opt.find((o) => o.programs === 20)!;
    check("프로그램 간 진짜 차이가 없는 세계(20개)에서 정답 개선율은 0인데 보고 개선율은 5%p 이상 — 근거 없는 개선율이 생긴다", Math.abs(o20.trueImprovement as number) < 0.005 && (o20.reported as number) > 0.05, `${o20.reported} ${o20.trueImprovement}`);
    check("낙관(보고−정답)은 후보 수가 5개에서 20개로 늘면 커진다(진짜 차이 0)", (o20.overshoot as number) > (o5.overshoot as number) - 0.0001, `${o5.overshoot} → ${o20.overshoot}`);
    // 시나리오 구간: 오차가 작으면 포함률이 명목 가까이, 오차가 크고 후보가 많으면 크게 낮아진다
    const mcSmall = B.runRobustnessMc(10, 150, 0.05);
    const mcBig = B.runRobustnessMc(20, 150, 0.25);
    const mcBig40 = B.runRobustnessMc(40, 150, 0.25);
    check("시나리오 구간 포함률: 오차 σ=0.05·후보 10개에서는 명목 80%에 가깝다(70% 이상)", mcSmall.coverage >= 0.7, String(mcSmall.coverage));
    check("오차 σ=0.25·후보 20개에서는 포함률이 60% 미만으로 떨어진다 — 선택 편향을 덮지 못한다", mcBig.coverage < 0.6, String(mcBig.coverage));
    check("σ=0.25에서 후보가 20→40개로 늘면 낙관이 커지고 포함률은 더 낮아진다", mcBig40.overshoot > mcBig.overshoot && mcBig40.coverage < mcBig.coverage, `${mcBig.overshoot}→${mcBig40.overshoot}, ${mcBig.coverage}→${mcBig40.coverage}`);
  }

  // ── 시나리오 점검의 엔진·화면 연결 ─────────────────────────────────────────
  {
    const mkRes = (n: number, level: number, sd: number) =>
      Array.from({ length: n }, (_, i) => ({ expected: 0.1, actual: 0.1 * Math.exp(sd * Math.sin(i * 12.9898) * 1.3), fallbackLevel: level }));
    const rows = [...mkRes(60, 1, 0.1), ...mkRes(30, 3, 0.2), ...mkRes(8, 5, 0.4)];
    const rat = R.ratiosFromResiduals(rows)!;
    check("잔차를 근거 등급별 표본으로 나누고, 표본이 모자란 등급(C 8건)은 전체 분포로 대신하며 그 사실을 알린다", rat.ratios.A.length === 60 && rat.ratios.B.length === 30 && rat.pooledGrades.join() === "C" && rat.ratios.C.length === 98 && rat.n === 98);
    check("잔차가 30건 미만이면 점검을 만들지 않는다(임의 오차를 가정하지 않음)", R.ratiosFromResiduals(mkRes(20, 1, 0.1)) === null && R.ratiosFromResiduals([{ expected: 0, actual: 1, fallbackLevel: 1 }, ...mkRes(5, 1, 0.1)]) === null);
    const without = runWorld(1, "AI_OPTIMIZED").res;
    const withRes = runWorld(1, "AI_OPTIMIZED", undefined, { residuals: rows }).res;
    const rb = withRes.summary.robustness;
    check("잔차가 없으면 summary.robustness는 null(만들지 않음)", without.summary.robustness === null);
    check("잔차가 있으면 시나리오 점검이 붙고 p10 ≤ 중앙 ≤ p90, 근거 등급 비중 합 1, 표본·풀링 정보를 담는다", !!rb && (rb.p10 as number) <= (rb.p50 as number) && (rb.p50 as number) <= (rb.p90 as number) && near(rb.evidenceMix.A + rb.evidenceMix.B + rb.evidenceMix.C, 1, 1e-6) && rb.residualN === 98 && rb.pooledGrades.includes("C") && rb.scenarios > 100);
    const again = runWorld(1, "AI_OPTIMIZED", undefined, { residuals: rows }).res.summary.robustness;
    check("같은 입력이면 시나리오 점검도 같다(시드 고정)", JSON.stringify(again) === JSON.stringify(rb));
  }

  // ── 검증 C: 채택 기록·대조 ─────────────────────────────────────────────────
  {
    const blocks = [
      { weekday: 1, startMin: 1200, endMin: 1260, programKey: "A", programName: "가", expected: 2, grade: "A" as const },
      { weekday: 1, startMin: 1260, endMin: 1320, programKey: "B", programName: "나", expected: 4, grade: "B" as const },
      { weekday: 2, startMin: 1200, endMin: 1260, programKey: "C", programName: "다", expected: null, grade: null },
      { weekday: 2, startMin: 1260, endMin: 1380, programKey: "D", programName: "라", expected: 3, grade: "C" as const },
    ];
    const input = {
      runId: "run-1",
      weekStart: "2026-10-12",
      targetLabel: "수도권 2049",
      blocks,
      versions: { model: "m1", features: "f1", genreDigest: "g", constraintsDigest: "c", configDigest: "cfg", rights: null, planFingerprint: "abc12345" },
      decision: { status: "ADOPTED" as const, reason: "프라임 슬롯 개선 기대, 권리 확인 완료", decidedBy: "PD" },
      context: { notes: [{ kind: "HOLIDAY" as const, text: "대체공휴일 포함 주" }], priorSameSlot: [{ weekday: 1, startMin: 1200, actual: 1.5 }, { weekday: 1, startMin: 1260, actual: 3.5 }] },
    };
    const snap = A.buildAdoptionSnapshot(input, 360);
    check("채택 스냅샷: 주간 기대는 예상값이 있는 블록의 분 가중 평균, 분모는 계획 horizon으로 고정", near(snap.weeklyExpected, (2 * 60 + 4 * 60 + 3 * 120) / 240) && snap.denominatorMinutes === 360 && A.verifyAdoption(snap));
    check("봉인: 채택 뒤 예상값을 고쳐 쓰면 검증이 실패한다", !A.verifyAdoption({ ...snap, blocks: snap.blocks.map((b, i) => (i === 0 ? { ...b, expected: 9 } : b)) }) && !A.verifyAdoption({ ...snap, decision: { ...snap.decision, reason: "바꾼 이유" } }) && !A.verifyAdoption({ ...snap, versions: { ...snap.versions, model: "m2" } }));
    check("봉인은 키 순서와 무관하다(같은 내용 = 같은 봉인)", A.sealOf("a") !== A.sealOf("b") && A.verifyAdoption(JSON.parse(JSON.stringify(snap))));
    check("이유·타깃·버전·horizon이 없으면 채택을 기록하지 않는다", [
      () => A.buildAdoptionSnapshot({ ...input, decision: { ...input.decision, reason: "  " } }, 360),
      () => A.buildAdoptionSnapshot({ ...input, targetLabel: "" }, 360),
      () => A.buildAdoptionSnapshot({ ...input, versions: { ...input.versions, planFingerprint: "" } }, 360),
      () => A.buildAdoptionSnapshot(input, 0),
    ].every((fn) => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    }));
    const actuals = [
      { weekday: 1, startMin: 1200, endMin: 1260, rating: 2.5 },
      { weekday: 1, startMin: 1260, endMin: 1320, rating: 3 },
      { weekday: 2, startMin: 1260, endMin: 1380, rating: null }, // 아직 측정 전
    ];
    const st = A.settleAdoption(snap, actuals, "수도권 2049");
    check("대조: 예상·실적이 모두 있는 방송분만 맞추고 같은 분모로 coverage를 낸다(120/360)", st.comparedMinutes === 120 && near(st.coverage, 120 / 360) && st.denominatorMinutes === 360);
    check("대조: 주간 예상·실적·차이는 대조된 방송분 기준 분 가중 평균", near(st.weeklyExpectedOnCompared, 3) && near(st.weeklyActualOnCompared, 2.75) && near(st.weeklyError, -0.25));
    check("대조: 블록별 오차(실적−예상), 예상 없음·실적 없음은 오차 null", near(st.blocks[0].error, 0.5) && near(st.blocks[1].error, -1) && st.blocks[2].error === null && st.blocks[3].error === null);
    check("대조: 직전 주 같은 슬롯 실제는 참고값일 뿐이며 인과 주장은 하지 않는다(대체안 미관측 명시)", near(st.priorSameSlotActual, 2.5) && st.causal.claim === "none" && st.causal.alternativesObserved === false && st.causal.notes.some((n) => n.includes("관측되지 않았다")) && st.causal.notes.some((n) => n.includes("인과효과로 단정하지 않는다")));
    check("대조: 채택 시점에 기록한 다른 설명 후보(공휴일 등)를 결과에 붙인다", st.otherExplanations.length === 1 && st.otherExplanations[0].kind === "HOLIDAY");
    check("대조: 타깃이 다르면 거부한다(같은 타깃·같은 분모로만)", (() => {
      try {
        A.settleAdoption(snap, actuals, "전국 유료가구");
        return false;
      } catch {
        return true;
      }
    })());
    const tampered = A.settleAdoption({ ...snap, blocks: snap.blocks.map((b, i) => (i === 0 ? { ...b, expected: 9 } : b)) }, actuals, "수도권 2049");
    check("대조: 봉인이 깨진 스냅샷은 verified=false와 경고 문구를 낸다", tampered.verified === false && tampered.causal.notes.some((n) => n.includes("봉인")));
  }

  // ── 승격 기준(제안 합격선) ─────────────────────────────────────────────────
  {
    const measured = {
      source: "synthetic" as const,
      mae: { model: 1.7, bestBaseline: 2.045 },
      maeLead7: { model: 1.829, bestBaseline: 2.189 },
      bias: 0.118,
      coverage: 0.791,
      groups: [
        { name: "보유작·같은 슬롯", n: 1811, maeModel: 1.593, maeBaseline: 1.891 },
        { name: "보유작·다른 슬롯", n: 179, maeModel: 2.245, maeBaseline: 2.752 },
        { name: "신규 프로그램", n: 27, maeModel: 5.196, maeBaseline: 5.236 },
      ],
      newProgramMae: 5.196,
      validRate: 1,
      deadlineStopRate: 0,
      overshoot: 0.067,
      overshootStress: 0.148,
      scenarioContainment: 0.71,
    };
    const base = P.evaluatePromotion(measured);
    check("합성 기준선(OPT05 측정치)은 필수 기준을 모두 통과하지만 합성이라 '실제 자료 미검증'에서 멈춘다", base.verdict === "UNVERIFIED_REAL_DATA" && base.criteria.filter((c) => c.kind === "REQUIRED").every((c) => c.status === "PASS"));
    check("표시 의무가 발생한 항목(신규 프로그램 근거 부족, 후보 수 증가 시 낙관)이 결과에 나온다", base.disclosures.some((d) => d.startsWith("A5")) && base.disclosures.some((d) => d.startsWith("B3b")) && !base.disclosures.some((d) => d.startsWith("B3 ")));
    const withReal = P.evaluatePromotion({ ...measured, source: "real" });
    check("실제 자료로 같은 기준을 통과하면 PASS", withReal.verdict === "PASS");
    check("필수 기준 미달 → 보류: 모델이 기준모델보다 나쁨 / bias 과다 / 구간 적중 이탈 / 유효해율 미달", [
      P.evaluatePromotion({ ...measured, mae: { model: 2.1, bestBaseline: 2.045 } }).verdict,
      P.evaluatePromotion({ ...measured, bias: 0.5 }).verdict,
      P.evaluatePromotion({ ...measured, coverage: 0.6 }).verdict,
      P.evaluatePromotion({ ...measured, coverage: 0.95 }).verdict,
      P.evaluatePromotion({ ...measured, validRate: 0.99 }).verdict,
      P.evaluatePromotion({ ...measured, maeLead7: { model: 2.3, bestBaseline: 2.189 } }).verdict,
      P.evaluatePromotion({ ...measured, deadlineStopRate: 0.2 }).verdict,
    ].every((v) => v === "HOLD"));
    const lim = P.evaluatePromotion({ ...measured, groups: [...measured.groups, { name: "프라임", n: 336, maeModel: 5, maeBaseline: 4 }] });
    check("한 집단만 기준모델보다 뚜렷이 나쁘면(건수 100 이상) 전체 보류가 아니라 그 집단만 제한(LIMITED)", lim.verdict === "LIMITED" && lim.limitedGroups.join() === "프라임");
    check("건수가 적은 집단(100 미만)의 나쁜 값은 제한 사유로 쓰지 않는다", P.evaluatePromotion({ ...measured, groups: [{ name: "소표본", n: 20, maeModel: 9, maeBaseline: 3 }] }).verdict === "UNVERIFIED_REAL_DATA");
    check("측정하지 못한 필수 항목이 있으면 PASS가 될 수 없다(7일 전 성능 미측정 → 미검증)", P.evaluatePromotion({ ...measured, source: "real", maeLead7: null }).verdict === "UNVERIFIED_REAL_DATA");
    check("승격 기준에 '+20% 달성' 같은 목표 수치가 없다", !/\+\s*20\s*%/.test(fs.readFileSync(path.join(process.cwd(), "src/lib/idealSchedule/promotion.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
  }

  // ── 연결·문서 계약 ─────────────────────────────────────────────────────────
  {
    const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const eng = rd("src/lib/idealSchedule/engine.ts");
    const strip = rd("src/app/ideal-schedule/RunStatusStrip.tsx");
    const pkg = rd("package.json");
    check("엔진이 잔차가 있을 때만 시나리오 점검을 요약에 붙이고, 가정 기반 후보는 근거 부족(C)으로 본다", /ratiosFromResiduals\(input\.residuals/.test(eng) && /contentType === "OWN" \? gradeOfLevel\(b\.eval\.fallbackLevel\) : "C"/.test(eng) && /summary\.robustness = null/.test(eng));
    check("화면이 시나리오 점검에서 '고르면서 생기는 낙관을 덜어내지 않은 값'임을 밝힌다", /검증 오차 점검/.test(strip) && /고르면서 생기는 낙관을 덜어내지 않은 값/.test(strip) && /승자의 저주/.test(strip));
    check("벤치·시험 명령이 등록돼 있다(opt05:bench, test:opt05)", /"opt05:bench"/.test(pkg) && /"test:opt05"/.test(pkg));
    const docPath = path.join(process.cwd(), "docs/agent-improvement/OPT05_VALIDATION.md");
    const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
    check("OPT05 문서가 검증 A·B·C, 제안 합격선(승인 대기), 승격 판정, 관측 한계를 담는다", ["검증 A", "검증 B", "검증 C", "합격선", "승인", "UNVERIFIED_REAL_DATA", "승자의 저주", "관측되지 않았", "남은 한계"].every((k) => doc.includes(k)));
  }

  console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
  if (failures.length) {
    console.error("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
