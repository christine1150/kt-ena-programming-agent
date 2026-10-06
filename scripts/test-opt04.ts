// OPT04 테스트 — 탐색 속도·재현성·시간 예산·취소·best-so-far·시작점·소형 문제 탐색 방법 비교.
// 합성 세계(운영 DB·네트워크 없음). 시간(ms)은 기계마다 달라 단정하지 않고, 평가 횟수·결과 지문·유효성으로 확인한다. 실행: npm run test:opt04
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-6) => a !== null && a !== undefined && Math.abs(a - b) < eps;
const sigOf = (blocks: { weekday: number; startMin: number; endMin: number; candidate: { key: string } }[], objective: number) =>
  blocks.map((b) => `${b.weekday}|${b.startMin}|${b.endMin}|${b.candidate.key}`).join(";") + `#${objective.toFixed(10)}`;

async function main() {
  const { runWorld } = await import("./opt04-bench");
  const { fingerprint } = await import("../src/lib/idealSchedule/engine");
  const M = await import("../src/lib/idealSchedule/searchMethods");
  const MC = await import("./opt04-methods");
  type World = ReturnType<typeof runWorld>["res"];
  const valid = (r: World) => r.summary.validation?.ok === true && (r.summary.validation?.violations.length ?? 1) === 0;
  const hash = (r: World) => fingerprint(sigOf(r.output.blocks, r.output.objective));

  // ── 1) 속도 개선이 결과를 바꾸지 않는다(최적화 전 측정값을 고정해 둔 기준) ──────────────
  const keep = runWorld(1, "KEEP_CURRENT").res;
  const ks = keep.summary.search!;
  check("기준(최적화 전 측정): KEEP_CURRENT 합성 세계 1 결과 지문·목적함수·교체 횟수가 그대로다", hash(keep) === "c49df440" && near(keep.output.objective, 564.611665) && keep.output.localSearchMoves === 82, `${hash(keep)} ${keep.output.objective} ${keep.output.localSearchMoves}`);
  check("탐색 경로(차분 평가 호출 수)가 최적화 전과 같다 — 같은 후보를 같은 순서로 평가했다", ks.deltaCalls === 64867, String(ks.deltaCalls));
  check("편성 평가 호출이 최적화 전(약 805만 회)의 1/5 이하로 줄었다(바뀐 블록만 평가)", ks.evaluations < 1_600_000, String(ks.evaluations));
  check("KEEP: 수렴해서 끝났고 재현 가능으로 표시된다", ks.stoppedBy === "CONVERGED" && ks.reproducible === true && !ks.alternativesSkipped);
  check("KEEP: 구성 직후 → 탐색 직후 목적함수는 줄지 않는다(채택은 개선뿐)", (ks.objectiveAfterSearch as number) >= (ks.objectiveAfterConstruction as number) - 1e-9, `${ks.objectiveAfterConstruction} → ${ks.objectiveAfterSearch}`);
  check("KEEP: 유지 판단(지난주 편성 복귀) 때문에 최종값은 탐색 직후 값보다 낮을 수 있고, 두 값을 따로 보고한다", ks.objectiveAfterSearch !== null && typeof ks.objectiveFinal === "number" && ks.objectiveAfterSearch >= ks.objectiveFinal - 1e-9);
  check("KEEP: 하드 제약 위반 0", valid(keep));
  check("KEEP: 단계별 시간(구성·국소탐색·판단·대체 후보)을 기록한다", !!ks.phaseMs && ["construct", "local_search", "decisions", "alternatives"].every((k) => typeof ks.phaseMs![k] === "number"));

  const ai = runWorld(1, "AI_OPTIMIZED").res;
  check("기준(최적화 전 측정): AI_OPTIMIZED 합성 세계 1 결과 지문·목적함수·교체 횟수가 그대로다", hash(ai) === "b9069c3e" && near(ai.output.objective, 581.929593) && ai.output.localSearchMoves === 4, `${hash(ai)} ${ai.output.objective}`);
  check("AI: 하드 제약 위반 0, 단계별 시간(DP·국소탐색·대체 후보)을 기록한다", valid(ai) && !!ai.summary.search?.phaseMs && ["dp", "local_search", "alternatives"].every((k) => typeof ai.summary.search!.phaseMs![k] === "number"));

  // ── 2) 차분 평가 = 전체 재평가(T07) ──────────────────────────────────────────────
  for (const [label, mode, genres] of [
    ["KEEP·장르 없음", "KEEP_CURRENT", false],
    ["KEEP·장르 있음(장르 편중·상위 묶음 경로)", "KEEP_CURRENT", true],
    ["AI·장르 있음", "AI_OPTIMIZED", true],
  ] as const) {
    const r = runWorld(2, mode, { verifyDelta: true }, { genres, maxIter: mode === "KEEP_CURRENT" ? 12 : 2000 }).res;
    const dc = r.summary.search?.deltaCheck;
    check(`T07 ${label}: 차분 평가가 전체 재평가와 일치(비교 ${dc?.checked ?? 0}건, 불일치 0, 최대 차이 ≤ 1e-9)`, !!dc && dc.checked > 100 && dc.mismatches === 0 && dc.maxAbsDiff <= 1e-9, JSON.stringify(dc));
  }

  // ── 3) 재현성 ──────────────────────────────────────────────────────────────────
  {
    const a = runWorld(3, "KEEP_CURRENT", undefined, { maxIter: 20 }).res;
    const b = runWorld(3, "KEEP_CURRENT", undefined, { maxIter: 20 }).res;
    check("같은 입력·같은 버전이면 같은 결과·같은 평가 횟수·같은 지문(KEEP)", hash(a) === hash(b) && a.summary.search!.evaluations === b.summary.search!.evaluations && a.fingerprint === b.fingerprint);
    const c = runWorld(3, "AI_OPTIMIZED").res;
    const d = runWorld(3, "AI_OPTIMIZED").res;
    check("같은 입력이면 AI 모드도 같은 결과·같은 지문", hash(c) === hash(d) && c.fingerprint === d.fingerprint);
    // 탐색 제어를 주지 않은 것과 시계만 준 것은 같은 지문(입력 지문은 평가 횟수 예산만 반영)
    const e = runWorld(3, "AI_OPTIMIZED", { deadlineAt: Number.MAX_SAFE_INTEGER }).res;
    check("시간 마감·취소 설정은 입력 지문에 들어가지 않는다(결과가 같으면 지문도 같다)", e.fingerprint === c.fingerprint && hash(e) === hash(c));
  }

  // ── 4) 평가 횟수 예산: 재현 가능한 중단 + 항상 유효한 최선안 ────────────────────────
  {
    const b1 = runWorld(1, "KEEP_CURRENT", { maxEvaluations: 100_000 }).res;
    const b2 = runWorld(1, "KEEP_CURRENT", { maxEvaluations: 100_000 }).res;
    const s = b1.summary.search!;
    check("평가 예산(10만 회): 예산 소진으로 멈추고 재현 가능으로 표시된다", s.stoppedBy === "EVAL_BUDGET" && s.reproducible === true, s.stoppedBy);
    check("평가 예산: 같은 예산이면 같은 결과·같은 지문(재현)", hash(b1) === hash(b2) && b1.fingerprint === b2.fingerprint);
    check("평가 예산: 예산이 지문에 들어가 예산 없는 실행과 구분된다", b1.fingerprint !== keep.fingerprint);
    check("평가 예산: 멈춘 시점의 편성안도 하드 제약 위반 0, 칸 수·빈칸 수가 완주 결과와 같다", valid(b1) && b1.output.blocks.length === keep.output.blocks.length && b1.output.emptySlots.length === keep.output.emptySlots.length);
    check("평가 예산: 예산을 다 쓰면 경고로 알린다", b1.resolution.warnings.some((w) => w.startsWith("[탐색 중단]")));
    check("평가 예산: 목적함수는 구성 직후보다 나빠지지 않는다", (s.objectiveAfterSearch as number) >= (s.objectiveAfterConstruction as number) - 1e-9);
    check("평가 예산 10만 회로도 완주 탐색 직후 목적함수의 99.5% 이상(이 합성 세계 기준, 일반화 아님)", (s.objectiveAfterSearch as number) >= 0.995 * (ks.objectiveAfterSearch as number), `${s.objectiveAfterSearch} / ${ks.objectiveAfterSearch}`);
    const zero = runWorld(1, "KEEP_CURRENT", { maxEvaluations: 0 }).res;
    const zs = zero.summary.search!;
    check("예산 0: 구성 단계에서도 빠른 채움으로 모든 칸을 채우고 유효하다(best-so-far 보장)", zs.fastFilledSlots > 0 && valid(zero) && zero.output.blocks.length === keep.output.blocks.length && zero.output.emptySlots.length === keep.output.emptySlots.length, `${zs.fastFilledSlots} ${zero.output.blocks.length}`);
    check("예산 0: 국소탐색을 하지 않았고(교체 0회) 사유가 EVAL_BUDGET이다", zs.moves === 0 && zs.stoppedBy === "EVAL_BUDGET");
  }

  // ── 5) 취소·시간 마감(T10) ─────────────────────────────────────────────────────
  {
    const c0 = runWorld(1, "KEEP_CURRENT", { isCancelled: () => true }).res;
    const s0 = c0.summary.search!;
    check("T10 취소(시작 직후): 사유 CANCELLED, 재현 불가 표시, 대체 후보 계산 생략", s0.stoppedBy === "CANCELLED" && s0.reproducible === false && s0.alternativesSkipped === true);
    check("T10 취소해도 엔진은 유효한 편성안(하드 제약 위반 0)을 돌려주고 경고로 알린다", valid(c0) && c0.output.blocks.length === keep.output.blocks.length && c0.resolution.warnings.some((w) => w.includes("취소")));
    let n = 0;
    const cm = runWorld(1, "KEEP_CURRENT", { isCancelled: () => ++n > 4000 }).res;
    const sm = cm.summary.search!;
    check("T10 취소(국소탐색 도중): 그때까지의 최선안이 유효하고 구성 직후보다 나빠지지 않는다", sm.stoppedBy === "CANCELLED" && valid(cm) && (sm.objectiveAfterSearch as number) >= (sm.objectiveAfterConstruction as number) - 1e-9 && sm.moves > 0, `${sm.stoppedBy} moves=${sm.moves}`);
    // 가짜 시계: 호출마다 10ms 흐른다 — 같은 입력이면 멈추는 지점도 같다(테스트용 결정론)
    const clock = () => {
      let t = 0;
      return () => (t += 10);
    };
    const d1 = runWorld(1, "KEEP_CURRENT", { now: clock(), deadlineAt: 600 }).res;
    const d2 = runWorld(1, "KEEP_CURRENT", { now: clock(), deadlineAt: 600 }).res;
    const ds = d1.summary.search!;
    check("시간 마감(가짜 시계): 사유 DEADLINE, 재현 불가 표시, 유효한 편성안", ds.stoppedBy === "DEADLINE" && ds.reproducible === false && valid(d1) && d1.output.blocks.length === keep.output.blocks.length, ds.stoppedBy);
    check("시간 마감: 시계가 같으면 멈춘 지점·결과도 같다(엔진 자체에는 시계·난수가 없다)", hash(d1) === hash(d2) && ds.evaluations === d2.summary.search!.evaluations);
    const ca = runWorld(1, "AI_OPTIMIZED", { isCancelled: () => true }).res;
    check("AI 모드 취소: DP 결과 그대로 유효한 편성안, 사유 CANCELLED", ca.summary.search!.stoppedBy === "CANCELLED" && valid(ca) && ca.output.blocks.length === ai.output.blocks.length);
  }

  // ── 6) 시작점(웜 스타트) 옵션 ──────────────────────────────────────────────────
  {
    const w = runWorld(1, "KEEP_CURRENT", { startFrom: "INCUMBENT" }, { maxIter: 60 }).res;
    const g = runWorld(1, "KEEP_CURRENT", undefined, { maxIter: 60 }).res;
    check("시작점 INCUMBENT: 지난주 편성에서 시작했다고 보고하고 유효하다", w.summary.search!.startedFrom === "INCUMBENT" && valid(w));
    check("시작점 기본값은 GREEDY(기존 동작)다", g.summary.search!.startedFrom === "GREEDY");
    check("시작점을 바꾸면 입력 지문이 달라진다(같은 지문이면 같은 결과)", w.fingerprint !== g.fingerprint);
    // 지난주 편성이 반복 한도(하루 2회·주 12회)를 어기는 세계에서도 웜 스타트는 한도를 지킨다
    const wc = runWorld(1, "KEEP_CURRENT", { startFrom: "INCUMBENT" }, { maxIter: 5, caps: { daily: 2, weekly: 12 } }).res;
    check("시작점 INCUMBENT: 지난주 편성이 반복 한도를 어겨도 한도를 지키는 유효한 편성안만 시작점으로 쓴다", valid(wc) && wc.summary.search!.startedFrom === "INCUMBENT", JSON.stringify(wc.summary.validation?.violations.slice(0, 2)));
  }

  // ── 7) 소형 문제에서 탐색 방법 비교(정답 = 완전탐색, 이웃 가산 포함) ──────────────
  {
    // 정답기 자체 검증: 4슬롯×3후보 전수 열거와 같다
    const sp = MC.makeProblem(7, "adjacent");
    const small = { ...sp, problem: { ...sp.problem, slots: sp.problem.slots.slice(0, 4) } };
    const ex = M.solveExactAdj(small);
    let naive = -Infinity;
    const ids = small.problem.candidates.map((c) => c.id);
    const slots = small.problem.slots;
    const rec = (i: number, plan: Record<string, string | null>) => {
      if (i === slots.length) {
        if (M.isValid(small, plan)) naive = Math.max(naive, M.scorePlan(small, plan));
        return;
      }
      for (const id of ids) rec(i + 1, { ...plan, [slots[i].id]: id });
    };
    rec(0, {});
    check("정답기(이웃 가산 포함)가 전수 열거와 같은 최고 점수를 낸다", ex.score !== null && Math.abs(ex.score - naive) < 1e-9, `${ex.score} vs ${naive}`);

    const res = MC.compareMethods(100);
    const by = (name: string) => res.summaries.find((s) => s.method.startsWith(name))!;
    const greedy = by("탐욕 구성만");
    const replace = by("탐욕 + 교체");
    const current = by("탐욕 + 교체 + 맞교환");
    const multi = by("다중 시작");
    const beam10 = by("빔 탐색 폭 10");
    check("모든 탐색 방법이 낸 해는 하드 제약을 지킨다(유효 해 비율 100%, T08)", res.summaries.every((s) => s.validRate === 1), res.summaries.map((s) => `${s.method}:${s.validRate}`).join(" "));
    check("정답 도달률: 탐욕만 < 교체 ≤ 교체+맞교환(현재 엔진의 이웃) — 맞교환이 실제로 기여한다", greedy.optimalRate < replace.optimalRate + 1e-9 && replace.optimalRate <= current.optimalRate + 1e-9 && greedy.optimalRate < current.optimalRate, `${greedy.optimalRate} ${replace.optimalRate} ${current.optimalRate}`);
    check("다중 시작(8회, 시드 고정)은 현재 이웃보다 정답 도달률이 높고 평균 격차가 작다", multi.optimalRate > current.optimalRate && multi.meanGapPct < current.meanGapPct, `${multi.optimalRate} vs ${current.optimalRate}; ${multi.meanGapPct} vs ${current.meanGapPct}`);
    check("다중 시작은 평가가 약 5배 이상 든다(비용 대비 효과 판단 근거)", multi.meanEvals > 5 * current.meanEvals, `${multi.meanEvals} vs ${current.meanEvals}`);
    check("빔 탐색 폭 10은 현재 이웃과 비슷한 수준(정답 도달률 ±10%p)이면서 평가가 2.5배 이상 든다 — 엔진에 채택하지 않는 근거", Math.abs(beam10.optimalRate - current.optimalRate) <= 0.1 && beam10.meanEvals > 2.5 * current.meanEvals, `${beam10.optimalRate} vs ${current.optimalRate}; ${beam10.meanEvals} vs ${current.meanEvals}`);
    check("소형 문제의 무작위 시작은 시드가 같으면 같은 결과다(재현)", (() => {
      const p = MC.makeProblem(5, "adjacent");
      const x = M.methodMultiStart(p, 8, 99);
      const y = M.methodMultiStart(p, 8, 99);
      return x.score === y.score && JSON.stringify(x.plan) === JSON.stringify(y.plan);
    })());
    check("서로 다른 시드의 다중 시작도 항상 하드 제약을 지킨다(T08)", (() => {
      let ok = true;
      for (let s = 1; s <= 12; s++) {
        const p = MC.makeProblem(s, s % 2 ? "capped" : "locked");
        const r = M.methodMultiStart(p, 6, s * 31);
        if (!r.plan || !M.isValid(p, r.plan)) ok = false;
      }
      return ok;
    })());
  }

  // ── 8) 연결(러너·API·화면) 계약 ────────────────────────────────────────────────
  {
    const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    const runner = rd("src/lib/idealSchedule/engineRunner.ts");
    const route = rd("src/app/api/scheduling/ideal-schedule/route.ts");
    const recalc = rd("src/app/api/scheduling/ideal-schedule/[runId]/recalculate/route.ts");
    const backtest = rd("src/lib/idealSchedule/backtest.ts");
    const page = rd("src/app/ideal-schedule/page.tsx");
    const strip = rd("src/app/ideal-schedule/RunStatusStrip.tsx");
    const opt = rd("src/lib/idealSchedule/optimizer.ts");
    const eng = rd("src/lib/idealSchedule/engine.ts");
    check("러너가 요청 시작 기준 탐색 마감과 취소 신호를 엔진에 넘긴다(서버 60초 제한 전에 최선안으로 마무리)", /search:\s*\{\s*now:\s*Date\.now,\s*deadlineAt:\s*t0\s*\+\s*deadlineMs,\s*isCancelled:/.test(runner) && /DEFAULT_SEARCH_DEADLINE_MS/.test(runner));
    check("편성 생성·다시 계산 API가 요청 취소 신호를 넘기고, 취소된 계산은 저장하지 않는다", [route, recalc].every((s) => /runIdealSchedule\(req,\s*\{\s*signal:\s*request\.signal\s*\}\)/.test(s) && /if \(out\.cancelled\) return NextResponse\.json/.test(s)) && route.indexOf("out.cancelled") < route.indexOf("saveRun("));
    check("백테스트는 시간 마감·취소·예산으로 끝난 탐색을 검증 자료로 쓰지 않고 거부한다", /stop === "DEADLINE" \|\| stop === "CANCELLED" \|\| stop === "EVAL_BUDGET"/.test(backtest) && backtest.indexOf("stop ===") < backtest.indexOf("saveRun("));
    check("화면: 계산 중 경과 시간(가짜 퍼센트 없음)과 [계산 취소] 버튼, 취소·실패 시 이전 편성안 유지 안내", /computeElapsed/.test(page) && /AbortController/.test(page) && /계산 취소/.test(page) && /이전 편성안은 그대로입니다/.test(page) && !/진행률\s*\d|%\s*완료/.test(page));
    check("화면: 상태 띠가 탐색 종료 사유(수렴·예산 소진·마감·취소)를 알리고 중단된 결과를 '최적'으로 부르지 않는다", /searchNote\(s\.search\)/.test(strip) && /탐색 중단\(최선안\)/.test(strip) && !strip.includes("최적안"));
    check("엔진: 국소탐색·탐욕 구성 반복마다 정지 판정(gate.check)을 거친다", (opt.match(/gate\.check\(\)/g) ?? []).length >= 4);
    check("엔진 요약·경고·지문에 탐색 보고서가 연결된다", /search:\s*output\.search/.test(eng) && /\[탐색 중단\]/.test(eng) && /eb:\s*input\.search\.maxEvaluations/.test(eng));
    check("엔진 자체는 시계·난수를 쓰지 않는다(시간은 주입된 now만 사용)", !/Date\.now\(|performance\.now\(|Math\.random\(/.test(opt) && !/Date\.now\(|performance\.now\(|Math\.random\(/.test(rd("src/lib/idealSchedule/searchControl.ts")));
  }

  // ── 9) 문서 ────────────────────────────────────────────────────────────────────
  {
    const docPath = path.join(process.cwd(), "docs/agent-improvement/OPT04_SEARCH.md");
    const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
    check("OPT04 문서가 측정(전·후), 탐색 방법 비교(채택·보류 사유), 시간 예산·취소 설계, job 분리 설계, 남은 한계를 담는다", ["측정", "차분 평가", "다중 시작", "빔", "웜 스타트", "best-so-far", "idempotency", "남은 한계"].every((k) => doc.includes(k)));
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
