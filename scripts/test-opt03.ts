// OPT03 테스트 — 합성 벤치마크 T01~T12(06_편성표뽑기_심화검수와개선안.txt), 완전탐색 정답기·검증기, 변경량 경계, 불확실성 점검, 엔진 산출물 검증.
// 예시 수치는 테스트용이며 실제 목표가 아니다. DB·네트워크 없음. 실행: npm run test:opt03
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
const pending: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
function todo(name: string, where: string) {
  pending.push(`${name} → ${where}`);
  console.log(`⏳ ${name} (미구현 — ${where})`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

async function main() {
  const opt04Src = fs.existsSync(path.join(process.cwd(), "scripts/test-opt04.ts")) ? fs.readFileSync(path.join(process.cwd(), "scripts/test-opt04.ts"), "utf8") : "";
  const enginePath = fs.readFileSync(path.join(process.cwd(), "src/lib/idealSchedule/optimizer.ts"), "utf8") + fs.readFileSync(path.join(process.cwd(), "src/lib/idealSchedule/engine.ts"), "utf8") + fs.readFileSync(path.join(process.cwd(), "src/lib/idealSchedule/searchControl.ts"), "utf8");
  const S = await import("../src/lib/idealSchedule/exactSolver");
  const H = await import("../src/lib/idealSchedule/horizon");
  const B = await import("../src/lib/idealSchedule/changeBudget");
  const R = await import("../src/lib/idealSchedule/robustness");
  const C = await import("../src/lib/idealSchedule/comparison");
  type P = import("../src/lib/idealSchedule/exactSolver").Problem;
  type Slot = import("../src/lib/idealSchedule/exactSolver").ProblemSlot;

  const slot = (id: string, dow: number, start: number, len = 60): Slot => ({ id, dow, startMin: start, endMin: start + len });
  const table = (t: Record<string, Record<string, number | null>>) => (s: Slot, c: { id: string }) => t[c.id]?.[s.id] ?? null;

  // ── T01 시간가중 ─────────────────────────────────────────
  {
    const h = H.horizonExpected([{ startMin: 1200, endMin: 1230, expected: 0.2 }, { startMin: 1230, endMin: 1320, expected: 0.1 }], 120);
    check("T01 시간가중: 30분×0.200 + 90분×0.100 = 평균 0.125(단순평균 0.150은 오류)", near(h.avgOverEvaluated, 0.125) && !near(h.avgOverEvaluated, 0.15), String(h.avgOverEvaluated));
    check("T01 같은 계산: 개선율 모듈도 분 가중", near(C.compareOnCommonSupport([{ weekday: 1, startMin: 0, endMin: 30, expected: 0.2 }, { weekday: 1, startMin: 30, endMin: 120, expected: 0.1 }], [{ weekday: 1, startMin: 0, endMin: 120, expected: 0.125 }]).ratio, 0, 1e-9));
  }

  // ── T02 완전탐색 정답 vs 탐욕(공유 횟수) ──────────────────
  const t02 = (): P => ({
    slots: [slot("S1", 1, 1200), slot("S2", 2, 1200)],
    candidates: [{ id: "A", programKey: "A" }, { id: "B", programKey: "B" }],
    expected: table({ A: { S1: 0.05, S2: 0.1 }, B: { S1: 0.049, S2: 0.01 } }),
    constraints: { maxPerProgram: { A: { value: 1, source: "권리: A 주 1회" } } },
  });
  {
    const p = t02();
    const g = S.greedyPlan(p);
    const gr = S.objectiveOf(p, g);
    const ex = S.solveExact(p);
    check("T02 탐욕(슬롯별 최고값)은 A+B, 평균 0.030으로 실패", g.S1 === "A" && g.S2 === "B" && near(gr.rating, 0.03, 1e-9), JSON.stringify(g) + gr.rating);
    check("T02 완전탐색 정답은 B+A, 평균 0.0745", ex.status === "OPTIMAL" && ex.plan?.S1 === "B" && ex.plan?.S2 === "A" && near(ex.rating, 0.0745, 1e-9), JSON.stringify(ex));
    check("T02 탐욕안도 유효하지만 정답보다 낮다(점수 비교)", S.validatePlan(p, g).length === 0 && (ex.rating as number) > gr.rating);
  }

  // ── T03 Avail 불가 → 높은 점수안 거부, 유효한 차선안 ─────────
  {
    const p = t02();
    p.constraints.allowed = (s, c) => (c.id === "A" && s.id === "S2" ? { constraintId: "RIGHTS", source: "Avail: A의 S2 구간 권리 없음", message: "A는 S2에서 권리상 불가" } : true);
    const bad = { S1: "B", S2: "A" };
    const v = S.validatePlan(p, bad);
    check("T03 높은 점수 B+A(0.0745)는 Avail 위반으로 validator가 거부한다", v.length === 1 && v[0].constraintId === "RIGHTS" && v[0].source.includes("Avail"));
    const ex = S.solveExact(p);
    check("T03 유효한 차선안(A+B, 평균 0.030)을 선택", ex.status === "OPTIMAL" && ex.plan?.S1 === "A" && ex.plan?.S2 === "B" && near(ex.rating, 0.03, 1e-9) && S.validatePlan(p, ex.plan as never).length === 0);
  }

  // ── T04 기준안·후보 동일 모델 비교 ─────────────────────────
  {
    const cmp = C.compareOnCommonSupport([{ weekday: 1, startMin: 0, endMin: 60, expected: 0.033 }], [{ weekday: 1, startMin: 0, endMin: 60, expected: 0.03 }]);
    check("T04 기준안 0.030%, 후보 0.033%(과거 실적 0.020%): 모델상 개선 +0.003%p / +10%", near(cmp.ratio, 0.1, 1e-9) && near((cmp.idealAvg as number) - (cmp.currentAvg as number), 0.003, 1e-12));
    // 과거 실적 0.020 대비 +65%로 쓰지 않는다: 실적과 기대의 비교는 개선율로 쓰지 않음(문구 검사는 T12)
    check("T04 후보 예측을 과거 실적과 나눈 +65%는 개선율 정의가 아니다(분모는 동일 모델 기준안)", !near(cmp.ratio, 0.033 / 0.02 - 1, 1e-6));
  }

  // ── T05 소표본 극단값 수축 ───────────────────────────────
  {
    const { buildFeatureSet } = await import("../src/lib/idealSchedule/features");
    const { mapOwnAirings } = await import("../src/lib/idealSchedule/mapping");
    const { addDays } = await import("../src/lib/idealSchedule/time");
    const KPI = "수도권 2049";
    const airings: { date: string; start: string; end: string; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number; s: number; reach: null; ts: number }> }[] = [];
    const dates: string[] = [];
    for (let i = 0; i < 28; i++) {
      const date = addDays("2026-08-31", i);
      dates.push(date);
      airings.push({ date, start: "21:00:00", end: "22:00:00", program_id: "BASE", program_name: "기본편성", first_run: null, m: { [KPI]: { r: 0.1, s: 1, reach: null, ts: 1 } } });
    }
    // 소표본 1회 극단값(0.9) — 같은 슬롯 평균의 9배
    airings.push({ date: "2026-09-27", start: "21:00:00", end: "22:00:00", program_id: "ONE", program_name: "일회성", first_run: null, m: { [KPI]: { r: 0.9, s: 9, reach: null, ts: 1 } } });
    const bundle = mapOwnAirings({ channel_code: "T", kpi_label: KPI, date_from: "2026-08-31", date_to: "2026-09-27", holidays: [], dates_with_data: dates, airings } as never);
    const fs = buildFeatureSet(bundle, { asOfDate: "2026-09-27", lookbackDays: 28, recentDays: 28, recentWeight: 2, excludeHolidays: true, shrinkageK: 4, minN: 3, fullConfidenceN: 12, composition: null, extraTargets: [] }, () => "미분류");
    const e = fs.rating.expected("ONE", "UNTAGGED", "미분류", 7, 21);
    check("T05 소표본 1회 극단값은 수축되어 원값(0.9)보다 낮고 슬롯 기준(0.1)보다는 높다", e.expected !== null && e.expected < 0.9 * 0.7 && e.expected > 0.1, JSON.stringify({ expected: e.expected, baseline: e.baseline, index: e.index }));
    check("T05 근거 수준이 표시된다(프로그램 단계 표본 1건 → 근거 부족, 신뢰도 낮음)", e.fallbackLevel > 1 && e.confidence < 0.2 && e.programSampleCount < 3, JSON.stringify({ level: e.fallbackLevel, conf: e.confidence }));
  }

  // ── T06 평가 못 한 시간을 분모에서 삭제하지 않는다 ──────────
  {
    const horizon = 1000;
    const h = H.horizonExpected([{ startMin: 0, endMin: 300, expected: 0.5 }], horizon);
    check("T06 30%만 평가된 좋은 구간: coverage 30%, 평균은 '평가된 시간' 값임을 밝힌다", near(h.coverage, 0.3) && !h.full && near(h.avgOverEvaluated, 0.5));
    check("T06 나머지 70%를 0으로 둔 하한(0.15)이 함께 나와 주간 기대치가 부풀려 보이지 않는다", near(h.lowerBound, 0.15) && (H.coverageNote(h) ?? "").includes("30%") && (H.coverageNote(h) ?? "").includes("0.150"));
    check("T06 전체가 평가되면 안내 없음", H.coverageNote(H.horizonExpected([{ startMin: 0, endMin: 1000, expected: 0.1 }], 1000)) === null);
    check("T06 기대값 없는 편성 분은 unevaluated로 센다", H.horizonExpected([{ startMin: 0, endMin: 100, expected: null }, { startMin: 100, endMin: 200, expected: 1 }], 200).unevaluatedMinutes === 100);
  }

  // ── T07 부분 delta vs 전체 재계산 ─────────────────────────
  {
    const p: P = {
      slots: [slot("S1", 1, 1200), slot("S2", 1, 1260), slot("S3", 2, 1200), slot("S4", 2, 1260)],
      candidates: [{ id: "A", programKey: "A" }, { id: "B", programKey: "B" }, { id: "C", programKey: "C" }],
      expected: (s, c) => 0.01 * (c.id.charCodeAt(0) - 64) * (1 + Number(s.id.slice(1)) * 0.1),
      constraints: {},
    };
    const base: import("../src/lib/idealSchedule/exactSolver").Plan = { S1: "A", S2: "B", S3: "C", S4: "A" };
    const full = (plan: typeof base) => S.objectiveOf(p, plan).sum;
    let ok = true;
    for (const s of ["S1", "S2", "S3", "S4"]) {
      for (const c of ["A", "B", "C"]) {
        const next = { ...base, [s]: c };
        const slotObj = p.slots.find((x) => x.id === s) as Slot;
        const delta = (slotObj.endMin - slotObj.startMin) * ((p.expected(slotObj, { id: c } as never) as number) - (p.expected(slotObj, { id: base[s] as string } as never) as number));
        if (Math.abs(full(next) - full(base) - delta) > 1e-12) ok = false;
      }
    }
    check("T07 한 칸 교체의 부분 delta = 전체 재계산 차이(합산 목적함수)", ok);
    check("T07 엔진 수준: 차분 평가 = 전체 재평가는 OPT04 검증 모드(verifyDelta)로 합성 세계 1.7만 건 비교(test:opt04)", opt04Src.includes('T07 ${label}: 차분 평가가 전체 재평가와 일치') && enginePath.includes("verifyDelta"));
  }

  // ── T08 재현·하드 제약 위반 0 ─────────────────────────────
  {
    const p = t02();
    const a = JSON.stringify(S.solveExact(p));
    const b = JSON.stringify(S.solveExact(p));
    check("T08 같은 입력이면 같은 해(결정적)", a === b);
    check("T08 서로 다른 시드의 다중 시작도 hard 제약 위반 0 — OPT04 소형 문제에서 확인(test:opt04), 엔진은 '탐색된 최선안'만 주장", opt04Src.includes("서로 다른 시드의 다중 시작도 항상 하드 제약을 지킨다(T08)") && enginePath.includes("SEARCHED_BEST"));
  }

  // ── T09 마감 직전 Avail 갱신·동시 예약 → 확정 전 재검증 ───────
  {
    // OPT06에서 구현: 확정 준비 검사(읽기 전용) — 상세 합성 시험은 test:opt06
    const opt06Src = fs.existsSync(path.join(process.cwd(), "scripts/test-opt06.ts")) ? fs.readFileSync(path.join(process.cwd(), "scripts/test-opt06.ts"), "utf8") : "";
    const rs = fs.readFileSync(path.join(process.cwd(), "src/lib/idealSchedule/readinessServer.ts"), "utf8");
    check(
      "T09 확정 직전 최신 Avail·공유 잔여·동시 수정을 다시 확인하고, 읽기 전용이라 작업본을 바꾸지 않는다(OPT06 확정 준비 검사 — test:opt06)",
      rs.includes("loadRightsLookup") && rs.includes("seen") && opt06Src.includes("회차 미지정 칸은 회차 수") && opt06Src.includes("operationApplied") && opt06Src.includes("확정 준비 검사 API는 schedule_finalize")
    );
    pending.push("T09 일부 — 다른 편성자의 동시 *예약*(원장 기록)은 아직 없다: 검사는 읽기 전용이고 DB 수준 동시성 보호는 별도 승인(버전 열) 필요 → 단계 13/채택 저장소");
  }

  // ── T10 timeout/취소 시 best-so-far ──────────────────────
  {
    // 탐색 한도에서 멈춘 결과는 '최적'이 아니라 '탐색된 최선안'으로 표시된다
    const big: P = {
      slots: Array.from({ length: 10 }, (_, i) => slot(`S${i}`, 1 + (i % 7), 1200 + i * 60)),
      candidates: Array.from({ length: 6 }, (_, i) => ({ id: `C${i}`, programKey: `P${i}` })),
      expected: (s, c) => 0.05 + ((Number(s.id.slice(1)) * 7 + Number(c.id.slice(1)) * 13) % 17) / 200,
      constraints: {},
    };
    const cut = S.solveExact(big, { maxNodes: 50 });
    const full = S.solveExact(big);
    check("T10 탐색 한도에서 멈추면 최적이라 하지 않고 '탐색된 최선안'(SEARCHED_BEST)", cut.status !== "OPTIMAL" && (cut.status === "SEARCHED_BEST" || cut.plan === null));
    check("T10 전체 탐색을 끝내면 OPTIMAL(증명됨)", full.status === "OPTIMAL" && full.plan !== null);
    check("T10 엔진 시간 예산·취소 시 best-so-far(유효 편성안) 반환, 취소는 저장하지 않음 — OPT04에서 확인(test:opt04)", opt04Src.includes("T10 취소해도 엔진은 유효한 편성안") && opt04Src.includes("취소된 계산은 저장하지 않는다"));
  }

  // ── T11 경쟁사 미래 편성을 사실로 채우지 않는다 ─────────────
  {
    const engineSrc = fs.readFileSync(path.resolve(__dirname, "../src/lib/idealSchedule/engine.ts"), "utf8");
    check("T11 경쟁 특징은 as_of 이전 방영만으로 만든다(competitorBundle ≤ asOfDate, 지문에도 같은 필터)", engineSrc.includes("input.competitorBundle.airings.filter((a) => a.date <= input.asOfDate)") && engineSrc.includes("asOfDate: input.asOfDate"));
    const scoringSrc = fs.readFileSync(path.resolve(__dirname, "../src/lib/idealSchedule/scoring.ts"), "utf8");
    check("T11 경쟁 프로그램의 자사 편성 기대값은 가정(BENCHMARK_TRANSFER)으로 표시하고 신뢰도 상한을 둔다", scoringSrc.includes("BENCHMARK_TRANSFER") && scoringSrc.includes("benchmark_confidence_cap"));
  }

  // ── T12 방송하지 않은 대체 편성안 예측을 '실제 검증 성과'로 쓰지 않는다 ──
  {
    const ROOT = path.resolve(__dirname, "..");
    const files = ["src/app/ideal-schedule/page.tsx", "src/app/ideal-schedule/SummaryPanel.tsx", "src/app/ideal-schedule/RunStatusStrip.tsx", "src/app/ideal-schedule/BlockDrawer.tsx", "src/app/ideal-schedule/CompareTable.tsx", "src/app/ideal-schedule/BacktestPanel.tsx", "src/lib/idealSchedule/excel.ts", "src/app/api/scheduling/ideal-schedule/[runId]/export/route.ts", "src/lib/idealSchedule/backtest.ts"];
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const forbidden = [/실제\s*(시청률\s*)?(80|[0-9]+)%\s*개선/, /과거\s*재편성\s*백테스트에서\s*실제/, /검증된\s*(시청률\s*)?개선/, /실제로\s*(시청률이\s*)?(오릅니다|상승합니다|올랐습니다)/, /개선이\s*보장/, /보장합니다/];
    const hits: string[] = [];
    for (const f of files) {
      const src = strip(fs.readFileSync(path.join(ROOT, f), "utf8"));
      for (const re of forbidden) if (re.test(src)) hits.push(`${f}: ${re}`);
    }
    check("T12 화면·엑셀·검증 문구에 '실제 개선/검증된 개선/보장' 표현이 없다", hits.length === 0, hits.join(" | "));
    const page = fs.readFileSync(path.join(ROOT, "src/app/ideal-schedule/page.tsx"), "utf8");
    check("T12 개선율에 '모델상 기대 차이이지 실제 시청률 개선이 아님'을 밝힌다", page.includes("실제 시청률 개선이 아닙니다"));
    const bt = fs.readFileSync(path.join(ROOT, "src/lib/idealSchedule/backtest.ts"), "utf8");
    check("T12 백테스트 요약은 추정 개선폭이 같은 모델 기준 기대값 차이이며 실현값이 아니라고 적는다", bt.includes("같은 모델 기준 기대값 차이이며 실현된 시청률이 아님"));
  }

  // ── 완전탐색: 연속 길이·공유 풀·회차 순서·잠금·만료 경계·해 없음 ──
  {
    // 연속 길이: A가 S1~S3에서 가장 높지만 연속 2슬롯까지 → 탐욕은 A,A,B가 아니라 상한 때문에 실패할 수 있다
    const cons: P = {
      slots: [slot("S1", 1, 1200), slot("S2", 1, 1260), slot("S3", 1, 1320), slot("S4", 1, 1380)],
      candidates: [{ id: "A", programKey: "A" }, { id: "B", programKey: "B" }, { id: "C", programKey: "C" }],
      expected: table({ A: { S1: 0.1, S2: 0.1, S3: 0.1, S4: 0.1 }, B: { S1: 0.08, S2: 0.02, S3: 0.09, S4: 0.02 }, C: { S1: 0.01, S2: 0.01, S3: 0.01, S4: 0.099 } }),
      constraints: { maxConsecutive: { A: { value: 2, source: "계약: A 연속 2슬롯 이내" } } },
    };
    const g = S.greedyPlan(cons);
    const ex = S.solveExact(cons);
    check("연속 길이 제한: 탐욕안은 유효하지만 정답이 더 높거나 같다", S.validatePlan(cons, g).length === 0 && (ex.rating as number) >= S.objectiveOf(cons, g).rating - 1e-12);
    check("연속 길이 제한: A 3연속 편성안은 validator가 거부", S.validatePlan(cons, { S1: "A", S2: "A", S3: "A", S4: "C" }).some((v) => v.constraintId === "MAX_CONSECUTIVE"));
    check("연속 길이 제한: 정답은 A를 3연속 쓰지 않는다", S.validatePlan(cons, ex.plan as never).length === 0);

    // 공유 풀: A1·A2는 같은 작품을 두 채널이 나눠 쓰는 풀(잔여 1회)
    const pool: P = {
      slots: [slot("S1", 1, 1200), slot("S2", 2, 1200)],
      candidates: [{ id: "A1", programKey: "A1", poolKey: "SHARED" }, { id: "A2", programKey: "A2", poolKey: "SHARED" }, { id: "B", programKey: "B" }],
      expected: table({ A1: { S1: 0.1, S2: 0.1 }, A2: { S1: 0.09, S2: 0.09 }, B: { S1: 0.02, S2: 0.02 } }),
      constraints: { maxPerPool: { SHARED: { value: 1, source: "공유 풀 잔여 1회" } } },
    };
    const exPool = S.solveExact(pool);
    check("공유 풀 잔여 1회: 풀 후보를 두 번 쓰는 안은 거부, 정답은 풀 1회 + B", S.validatePlan(pool, { S1: "A1", S2: "A2" }).some((v) => v.constraintId === "MAX_PER_POOL") && exPool.plan !== null && Object.values(exPool.plan).filter((c) => c === "A1" || c === "A2").length === 1);

    // 회차 순서
    const ep: P = {
      slots: [slot("S1", 1, 1200), slot("S2", 2, 1200)],
      candidates: [{ id: "E1", programKey: "E", episode: { series: "드라마", no: 1 } }, { id: "E2", programKey: "E", episode: { series: "드라마", no: 2 } }],
      expected: table({ E1: { S1: 0.05, S2: 0.05 }, E2: { S1: 0.2, S2: 0.05 } }),
      constraints: { episodeOrder: { source: "회차 순서" }, maxPerProgram: { E: { value: 2, source: "한도" } }, maxPerCandidate: { E1: { value: 1, source: "한 회차는 한 번" }, E2: { value: 1, source: "한 회차는 한 번" } } },
    };
    const exEp = S.solveExact(ep);
    check("회차 순서: 2회를 1회보다 먼저 배치한 높은 점수안은 거부", S.validatePlan(ep, { S1: "E2", S2: "E1" }).some((v) => v.constraintId === "EPISODE_ORDER"));
    check("회차 순서: 정답은 1회 → 2회", exEp.plan?.S1 === "E1" && exEp.plan?.S2 === "E2");

    // 잠금
    const lock: P = { ...t02(), constraints: { ...t02().constraints, locks: [{ slotId: "S1", candId: "B", source: "사용자 LOCK", kind: "LOCK" }] } };
    const exLock = S.solveExact(lock);
    check("잠금: S1은 B로 고정, 나머지는 최적(B+A)", exLock.plan?.S1 === "B" && exLock.plan?.S2 === "A" && S.validatePlan(lock, { S1: "A", S2: "B" }).some((v) => v.constraintId === "LOCK" && v.source === "사용자 LOCK"));

    // 만료 경계: 권리가 S1(포함)까지만 유효 — S2는 만료 후
    const exp: P = {
      slots: [slot("S1", 1, 1200), slot("S2", 2, 1200)],
      candidates: [{ id: "A", programKey: "A" }, { id: "B", programKey: "B" }],
      expected: table({ A: { S1: 0.05, S2: 0.2 }, B: { S1: 0.04, S2: 0.04 } }),
      constraints: { allowed: (s, c) => (c.id === "A" && s.dow > 1 ? { constraintId: "EXPIRY", source: "권리 만료: 월요일까지", message: "A 권리 만료 후" } : true) },
    };
    check("만료 경계: 만료 후 슬롯의 A 배치는 거부, 정답은 A(만료 전)+B", S.validatePlan(exp, { S1: "B", S2: "A" }).some((v) => v.constraintId === "EXPIRY") && S.solveExact(exp).plan?.S1 === "A" && S.solveExact(exp).plan?.S2 === "B");

    // 해 없음 + 이유
    const none: P = {
      slots: [slot("S1", 1, 1200)],
      candidates: [{ id: "A", programKey: "A" }],
      expected: table({ A: { S1: 0.1 } }),
      constraints: { locks: [{ slotId: "S1", candId: "A", source: "필수 편성: A 월 20:00", kind: "REQUIRED" }], allowed: () => ({ constraintId: "RIGHTS", source: "Avail: A 월 20:00 권리 없음", message: "권리 없음" }) },
    };
    const exNone = S.solveExact(none);
    const why = S.explainInfeasible(none);
    check("해 없음: 필수 편성과 권리 불가가 충돌하면 INFEASIBLE", exNone.status === "INFEASIBLE" && exNone.plan === null);
    check("해 없음: 어느 제약 묶음을 풀면 해가 생기는지 출처와 함께 알려 준다(허용 슬롯의 Avail 출처)", !why.feasible && why.blockers.some((b) => b.group.includes("허용 슬롯") && b.sources.some((s) => s.includes("Avail"))));
    check("해 없음: 필수 편성과 권리 불가의 충돌은 두 출처를 함께 보고한다", why.lockConflicts.length === 1 && why.lockConflicts[0].lockSource.includes("필수 편성") && why.lockConflicts[0].blockedBy.includes("Avail"));
    check("해 없음: 계약에 없는 사유를 만들지 않는다(풀어도 해가 안 생기는 묶음은 나열하지 않음)", !why.blockers.some((b) => b.group.includes("공유 풀") || b.group.includes("회차 순서")));

    // baseline이 feasible이면 최종 후보 점수가 baseline보다 낮지 않다
    const base = S.greedyPlan(cons);
    check("기준안이 유효하면 정답(최종 후보)의 점수는 기준안보다 낮지 않다", S.validatePlan(cons, base).length === 0 && (S.solveExact(cons).rating as number) >= S.objectiveOf(cons, base).rating - 1e-12);

    // null 기대값은 배치 불가(예측 불가를 0·평균으로 채우지 않는다)
    const unev: P = { slots: [slot("S1", 1, 1200)], candidates: [{ id: "A", programKey: "A" }, { id: "B", programKey: "B" }], expected: table({ A: { S1: null }, B: { S1: 0.01 } }), constraints: {} };
    check("기대값이 없는 후보는 배치하지 않는다(예측 불가를 채우지 않음)", S.solveExact(unev).plan?.S1 === "B" && S.validatePlan(unev, { S1: "A" }).some((v) => v.constraintId === "UNEVALUABLE"));
  }

  // ── 변경량 경계 ─────────────────────────────────────────
  {
    // 슬롯 4개를 기준안(A,A,A,A)에서 목표안(B,C,D,E)로 바꾸는 경로. 각 변경의 이득: 4,3,2,-1 (마지막은 손해라 목표안이어도 전체 변경은 손해)
    const gains: Record<string, number> = { S1: 4, S2: 3, S3: 2, S4: -1 };
    const spec: import("../src/lib/idealSchedule/changeBudget").FrontierSpec<string[]> = {
      changes: Object.keys(gains).map((k) => ({ key: k, minutes: 60 })),
      apply: (keys) => keys,
      evaluate: (keys) => ({ objective: 10 + keys.reduce((s, k) => s + gains[k], 0), feasible: true }),
    };
    const pts = B.buildChangeFrontier(spec);
    check("효율 경계: 기준안에서 시작해 이득이 큰 변경부터 채택(4→3→2→-1)", pts.map((p) => p.objective).join() === "10,14,17,19,18");
    const v = B.variantsOf(pts);
    check("최소변경안은 전체 개선분(9)의 50% 이상을 내는 가장 적은 변경(2칸=이득 7), 성과우선안은 개선이 최대인 점(3칸)", v.MIN_CHANGE.changedSlots === 2 && v.PERFORMANCE.objective === 19 && v.PERFORMANCE.changedSlots === 3);
    check("균형안은 80% 이상(이득 7.2 이상 → 2칸 이득 7)이 아니므로 3칸", v.BALANCED.changedSlots === 3);
    check("변경 예산 안의 최선: 예산 2칸 → 17", B.pickWithinBudget(pts, { maxSlots: 2 }).objective === 17 && B.pickWithinBudget(pts, { maxMinutes: 60 }).objective === 14);
    const ex = B.exactFrontier(spec);
    check("작은 문제에서 탐욕 경로 = 정확한 경계(변경 개수별 최대)", [1, 2, 3].every((k) => ex.get(k) === pts[k].objective) && ex.get(4) === 18);
    // 유효하지 않은 변경은 채택하지 않는다(권리·필수 제약을 푸는 안은 만들지 않음)
    const constrained = { ...spec, evaluate: (keys: string[]) => ({ objective: 10 + keys.reduce((s, k) => s + gains[k], 0), feasible: !keys.includes("S1") }) };
    const pc = B.buildChangeFrontier(constrained);
    check("제약 때문에 유효하지 않은 변경(S1)은 어떤 경계 점에도 들어가지 않는다", pc.every((p) => !p.keys.includes("S1")) && pc[pc.length - 1].objective === 14);
    check("개선이 없으면 모든 변형이 기준안", B.variantsOf([{ keys: [], changedSlots: 0, changedMinutes: 0, objective: 5 }]).PERFORMANCE.changedSlots === 0);
  }

  // ── 선택 불확실성(시나리오) ─────────────────────────────
  {
    const mk = (programKey: string, minutes: number, expected: number, grade: "A" | "B" | "C") => ({ programKey, minutes, expected, grade });
    const ratios = { A: [0.95, 1, 1.05], B: [0.8, 1, 1.2], C: [0.4, 0.8, 1.2, 1.6] };
    const base = [mk("X", 60, 0.1, "A"), mk("Y", 60, 0.1, "A")];
    const same = R.robustnessCheck(base, base, ratios, { seed: 3 });
    check("같은 편성이면 점추정 0, 모든 시나리오에서 개선 0(오차 상쇄)", near(same.point, 0) && near(same.p10, 0) && near(same.p90, 0));
    const safe = R.robustnessCheck([mk("X", 60, 0.1, "A"), mk("Z", 60, 0.12, "A")], base, ratios, { seed: 3 });
    const risky = R.robustnessCheck([mk("X", 60, 0.1, "A"), mk("Z", 60, 0.12, "C")], base, ratios, { seed: 3 });
    check("근거 등급이 낮은(C) 프로그램에 기댄 개선은 하방이 더 넓고 양수일 확률이 낮다", (risky.p10 as number) < (safe.p10 as number) && (risky.pPositive as number) <= (safe.pPositive as number), JSON.stringify({ safe: [safe.p10, safe.pPositive], risky: [risky.p10, risky.pPositive] }));
    check("후보안에만 있는 프로그램의 비중과 등급별 비중을 알려 준다", near(risky.uniqueShare, (0.12 * 60) / (0.1 * 60 + 0.12 * 60), 1e-9) && risky.evidenceMix.C > 0.5);
    check("같은 seed면 재현, 다른 seed에서도 하드 결과 분포가 비슷한 범위", JSON.stringify(R.robustnessCheck(risky === null ? [] : [mk("X", 60, 0.1, "A"), mk("Z", 60, 0.12, "C")], base, ratios, { seed: 3 })) === JSON.stringify(risky) && Math.abs((R.robustnessCheck([mk("X", 60, 0.1, "A"), mk("Z", 60, 0.12, "C")], base, ratios, { seed: 9 }).p50 as number) - (risky.p50 as number)) < 0.1);
    check("임의의 위험 계수를 시청률에 더하지 않는다(결과는 분포·확률·비중뿐)", Object.keys(risky).sort().join() === "evidenceMix,p10,p50,p90,pPositive,point,scenarios,uniqueShare");
  }

  // ── 엔진 산출물 검증 ─────────────────────────────────────
  {
    const V = await import("../src/lib/idealSchedule/outputValidator");
    const { mapOwnAirings } = await import("../src/lib/idealSchedule/mapping");
    const { mergeIdealConfig } = await import("../src/lib/idealSchedule/config");
    const { runIdealScheduleEngine } = await import("../src/lib/idealSchedule/engine");
    const { addDays } = await import("../src/lib/idealSchedule/time");
    const KPI = "수도권 2049";
    const cfg = mergeIdealConfig(
      {
        weights: { kpi: 35, target: 20, weekday_slot: 20, trend: 10, stability: 5, lead: 10 },
        repeat_rules: { daily_cap: 3, weekly_cap: 14, consecutive_penalty: 0.15, same_slot_penalty: 0.05, genre_concentration_penalty: 0.05, low_confidence_penalty: 0.1, runtime_mismatch_penalty: 0.1 },
        expected_kpi: { lookback_days: 84, recent_days: 28, recent_weight: 2, shrinkage_k: 4, min_n: 3, full_confidence_n: 12, exclude_holidays: true },
        strategy: { strong_threshold: 1.2, match_weight: 0.5, counter_weight: 0.5, benchmark_confidence_cap: 0.4, target_mismatch_penalty: 0.2, include_benchmark_in_totals: false, competitor_target_mode: "AUTO_MATCH_KPI", benchmark_placement: "NONE" },
        structure: { default_mode: "KEEP_CURRENT", skeleton_weeks: 4, grid_minutes: 5, runtime_tolerance_min: 10, max_gap_min: 10, max_local_search_iter: 2000 },
        targets: { GROUP_A: { kpi: KPI, extra: [], composition: null }, GROUP_B: { kpi: "전국 유료가구", extra: [], composition: null }, SKYUHD: { kpi: null, extra: [], composition: null } },
      } as never,
      null
    );
    const progs = [
      { id: "A", s: "20:00:00", e: "21:00:00", r: 1.0 },
      { id: "B", s: "21:00:00", e: "22:00:00", r: 0.8 },
      { id: "C", s: "22:00:00", e: "23:00:00", r: 0.5 },
      { id: "D", s: "23:00:00", e: "00:00:00", r: 0.4 },
    ];
    const airings: { date: string; start: string; end: string; program_id: string; program_name: string; first_run: boolean | null; m: Record<string, { r: number; s: number; reach: null; ts: number }> }[] = [];
    const dates: string[] = [];
    for (let i = 0; i < 28; i++) {
      const date = addDays("2026-08-31", i);
      dates.push(date);
      for (const p of progs) airings.push({ date, start: p.s, end: p.e, program_id: p.id, program_name: `프로그램${p.id}`, first_run: null, m: { [KPI]: { r: p.r, s: p.r * 10, reach: null, ts: 600 } } });
    }
    const raw = { channel_code: "ENA", kpi_label: KPI, date_from: "2026-08-31", date_to: "2026-09-27", holidays: [] as string[], dates_with_data: dates, airings };
    const base = { weekStart: "2026-09-28", asOfDate: "2026-09-27", strategyMode: "AUTO" as const, config: cfg, competitorBundle: null, constraints: [], genreOf: () => "미분류" as const };
    for (const mode of ["KEEP_CURRENT", "AI_OPTIMIZED"] as const) {
      const r = runIdealScheduleEngine({ ...base, mode, bundle: mapOwnAirings(raw as never) });
      check(`엔진 산출물(${mode})이 하드 제약 검증을 통과하고 요약에 기록된다`, r.summary.validation?.ok === true && (r.summary.validation?.checked ?? []).length === 5 && r.summary.searchKind === "SEARCHED_BEST", JSON.stringify(r.summary.validation?.violations));
      check(`엔진 요약에 주간 horizon 평가 범위(${mode})가 있다`, !!r.summary.horizon && r.summary.horizon.horizonMinutes === 10080 && r.summary.horizon.evaluatedMinutes > 0, JSON.stringify(r.summary.horizon));
      check(`선택 점수와 보고 지표의 구분(${mode}): 기본 가중치는 혼합 점수임을 기록`, r.summary.objectiveInfo?.selectionScoreMixed === true && r.summary.objectiveInfo?.primary === "weekly_expected_rating" && near(r.summary.objectiveInfo?.nonKpiWeightShare, 0.65, 1e-9), JSON.stringify(r.summary.objectiveInfo));
    }
    const kpiOnly = runIdealScheduleEngine({ ...base, mode: "AI_OPTIMIZED", config: { ...cfg, weights: { kpi: 100, target: 0, weekday_slot: 0, trend: 0, stability: 0, lead: 0 } }, bundle: mapOwnAirings(raw as never) });
    check("시청률 우선(KPI 100%)이면 선택 점수 혼합 아님", kpiOnly.summary.objectiveInfo?.selectionScoreMixed === false);

    // 검증기가 잘못된 산출을 실제로 거부하는가 — 엔진 결과를 일부러 망가뜨린다
    const good = runIdealScheduleEngine({ ...base, mode: "KEEP_CURRENT", bundle: mapOwnAirings(raw as never) });
    const blocks = good.output.blocks;
    const args = { blocks, fixed: good.resolution.fixed, config: cfg, capOverride: undefined as undefined | Map<string, { daily: number; weekly: number }> };
    check("정상 산출물은 검증 통과", V.validateEngineOutput(args).ok);
    const overlap = blocks.map((b, i) => (i === 1 ? { ...b, startMin: blocks[0].startMin, weekday: blocks[0].weekday } : b));
    check("겹치는 블록을 거부한다(OVERLAP)", V.validateEngineOutput({ ...args, blocks: overlap }).violations.some((v) => v.constraintId === "OVERLAP"));
    const out = blocks.map((b, i) => (i === 0 ? { ...b, startMin: 60, endMin: 30 } : b));
    check("범위·길이가 잘못된 블록을 거부한다(BOUNDS)", V.validateEngineOutput({ ...args, blocks: out }).violations.some((v) => v.constraintId === "BOUNDS"));
    const dup = [...blocks, ...blocks.filter((b) => !b.fixed).slice(0, 1).flatMap((b) => Array.from({ length: 20 }, (_, i) => ({ ...b, startMin: b.startMin + (i + 1) * 0, weekday: 1 + (i % 7) })))];
    const sameDay = [...blocks, ...blocks.filter((b) => !b.fixed).slice(0, 1).flatMap((b) => Array.from({ length: 5 }, (_, i) => ({ ...b, startMin: b.startMin + 10 * (i + 1), weekday: b.weekday })))];
    check("하루 한도(3회) 초과도 거부한다(CAPS · daily_cap)", V.validateEngineOutput({ ...args, blocks: sameDay }).violations.some((v) => v.constraintId === "CAPS" && v.source.includes("daily_cap")));
    check("프로그램 반복 한도 초과를 거부한다(CAPS)", V.validateEngineOutput({ ...args, blocks: dup }).violations.some((v) => v.constraintId === "CAPS"));
    check("권리 게이트가 막은 슬롯에 배치된 블록을 거부한다(RIGHTS)", V.validateEngineOutput({ ...args, slotAllowed: () => false }).violations.some((v) => v.constraintId === "RIGHTS"));
    const fixedMissing = V.validateEngineOutput({ ...args, fixed: [{ input: { id: "X", rank: 3, priority: 0, source: "WEEKLY_INPUT", constraintType: "WEEKLY_PREMIERE", programId: null, programName: "필수작", weekday: 2, startMin: 1200, durationMin: 60, activeFrom: null, activeTo: null, locked: false }, date: "2026-09-29", weekday: 2, startMin: 1200, endMin: 1260 }] });
    check("고정·필수 편성이 정해진 자리에 없으면 거부한다(FIXED)", fixedMissing.violations.some((v) => v.constraintId === "FIXED" && v.source.includes("WEEKLY_PREMIERE")));
  }

  // ── 화면 연결(정적) ──
  {
    const strip = fs.readFileSync(path.resolve(__dirname, "../src/app/ideal-schedule/RunStatusStrip.tsx"), "utf8");
    check("상태 띠: 제약 검증 결과(통과/실패)와 실패 시 경고를 보인다", strip.includes("제약 검증 통과") && strip.includes("제약 검증 실패") && strip.includes('role="alert"'));
    check("상태 띠: '탐색된 최선안'(최적 증명 없음)과 평가 범위(coverage) 안내", strip.includes("탐색된 최선안") && strip.includes("coverageNote(s.horizon)"));
    check("상태 띠: 선택 점수가 시청률 외 성분과 섞였음을 알린다", strip.includes("selectionScoreMixed") && strip.includes("최대안이 아닐 수 있습니다"));
    const eng = fs.readFileSync(path.resolve(__dirname, "../src/lib/idealSchedule/engine.ts"), "utf8");
    check("엔진이 매 실행 끝에 독립 검증을 돌리고 위반을 경고로 남긴다", eng.includes("validateEngineOutput({ blocks: output.blocks") && /if \(!validation\.ok\) resolution\.warnings\.push\(/.test(eng) && eng.includes("[제약 검증 실패]") && eng.includes('searchKind: "SEARCHED_BEST"'));
  }

  // ── 문서·코드 일치 ───────────────────────────────────────
  {
    const doc = fs.readFileSync(path.resolve(__dirname, "../docs/agent-improvement/OPT03_DESIGN.md"), "utf8");
    check("설계 문서가 T01~T12 전부와 하드 제약 표, '탐색된 최선안'을 언급한다", Array.from({ length: 12 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`).every((t) => doc.includes(t)) && doc.includes("하드 제약") && doc.includes("탐색된 최선안"));
    check("설계 문서가 검증기가 보는 제약 5종을 모두 적는다", ["BOUNDS", "OVERLAP", "FIXED", "RIGHTS", "CAPS"].every((c) => doc.includes(c)));
  }

  console.log(`\n통과 ${passed} / 실패 ${failures.length}${pending.length ? ` / 대기 ${pending.length}` : ""}`);
  if (pending.length) console.log("대기(다음 단계에서 구현): \n" + pending.map((p) => ` - ${p}`).join("\n"));
  if (failures.length) {
    console.error("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
