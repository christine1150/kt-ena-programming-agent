// OPT04 탐색 방법 비교 — 정답(완전탐색)을 아는 작은 문제 N개에서 탐욕·국소탐색·다중 시작·빔 탐색이 정답에 얼마나 가까운지 잰다.
// 운영 DB·네트워크에 접근하지 않는다. 합성 문제(시드 고정)이므로 "방법의 성질"을 보는 실험이지 실제 채널의 결과가 아니다.
// 실행: npm run opt04:methods  (옵션: --n 60 --json 결과파일)
import fs from "node:fs";
import type { Problem, ProblemCandidate, ProblemSlot } from "../src/lib/idealSchedule/exactSolver";
import {
  isValid,
  methodBeam,
  methodGreedy,
  methodLocal,
  methodMultiStart,
  mulberry,
  scorePlan,
  solveExactAdj,
  type MethodResult,
  type SearchProblem,
} from "../src/lib/idealSchedule/searchMethods";

export type ProblemKind = "separable" | "adjacent" | "capped" | "locked";

const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

/** 슬롯 7개(두 요일) × 후보 5개 안팎의 작은 문제. 종류별로 탐욕이 약한 구조를 일부러 섞는다. */
export function makeProblem(seed: number, kind: ProblemKind): SearchProblem {
  const r = mulberry(seed * 104729 + kind.length);
  const nSlots = 7;
  const nCands = 5;
  const slots: ProblemSlot[] = [];
  for (let i = 0; i < nSlots; i++) {
    const dow = i < 4 ? 1 : 2;
    const k = i < 4 ? i : i - 4;
    slots.push({ id: `S${i}`, dow, startMin: 1200 + k * 60, endMin: 1260 + k * 60 }); // 20시부터 1시간 단위
  }
  const cands: ProblemCandidate[] = [];
  for (let i = 0; i < nCands; i++) cands.push({ id: `C${i}`, programKey: kind === "capped" && i < 2 ? "SAME" : `P${i}` });
  const base = cands.map(() => Math.exp(0.35 * normal(r)));
  const slotFx = slots.map((_, i) => 0.8 + 0.5 * r() + (i % 4 === 2 ? 0.3 : 0));
  const noise = slots.map(() => cands.map(() => Math.exp(0.15 * normal(r))));
  const banned = slots.map(() => cands.map(() => r() < 0.12));
  // 한 슬롯에 모든 후보가 막히지 않도록 최소 하나는 열어 둔다
  banned.forEach((row, i) => {
    if (row.every(Boolean)) row[Math.floor(r() * nCands)] = false;
    void i;
  });
  const expected: Problem["expected"] = (s, c) => 0.1 * base[cands.indexOf(c)] * slotFx[slots.indexOf(s)] * noise[slots.indexOf(s)][cands.indexOf(c)];
  const problem: Problem = {
    slots,
    candidates: cands,
    expected,
    constraints: {
      allowed: (s, c) => (banned[slots.indexOf(s)][cands.indexOf(c)] ? { constraintId: "AVAIL", source: "synthetic", message: "권리 불가" } : true),
      maxPerProgram: { P0: { value: 2, source: "synthetic" }, SAME: { value: 2, source: "synthetic" } },
      maxPerCandidate: { C1: { value: 3, source: "synthetic" } },
      ...(kind === "locked" ? { locks: [{ slotId: "S2", candId: "C3", source: "synthetic", kind: "LOCK" as const }] } : {}),
    },
  };
  // 연속 가산: 앞 편성이 특정 후보일 때 뒤 후보가 특히 좋아지는 짝(탐욕이 놓치기 쉬운 구조)
  const synergy = new Map<string, number>();
  if (kind === "adjacent") {
    for (let k = 0; k < 4; k++) synergy.set(`C${Math.floor(r() * nCands)}>C${Math.floor(r() * nCands)}`, 0.06 + 0.06 * r());
  }
  return { problem, adjacency: kind === "adjacent" ? (a, b) => synergy.get(`${a.id}>${b.id}`) ?? 0 : undefined };
}

export interface MethodSummary {
  method: string;
  problems: number;
  validRate: number;
  optimalRate: number;
  meanGapPct: number;
  worstGapPct: number;
  meanEvals: number;
}

export const METHODS: { name: string; run: (sp: SearchProblem, seed: number) => MethodResult }[] = [
  { name: "탐욕 구성만", run: (sp) => methodGreedy(sp) },
  { name: "탐욕 + 교체", run: (sp) => methodLocal(sp, { swap: false }) },
  { name: "탐욕 + 교체 + 맞교환(현재 엔진과 같은 이웃)", run: (sp) => methodLocal(sp, { swap: true }) },
  { name: "다중 시작 8회(시드 고정) + 교체·맞교환", run: (sp, seed) => methodMultiStart(sp, 8, seed) },
  { name: "빔 탐색 폭 3", run: (sp) => methodBeam(sp, 3) },
  { name: "빔 탐색 폭 10", run: (sp) => methodBeam(sp, 10) },
];

export function compareMethods(n: number, kinds: ProblemKind[] = ["separable", "adjacent", "capped", "locked"]): { summaries: MethodSummary[]; infeasible: number; byKind: Record<string, MethodSummary[]> } {
  const acc = new Map<string, { gaps: number[]; valid: number; opt: number; evals: number[]; total: number }>();
  const accKind = new Map<string, Map<string, { gaps: number[]; valid: number; opt: number; evals: number[]; total: number }>>();
  let infeasible = 0;
  for (let seed = 1; seed <= n; seed++) {
    for (const kind of kinds) {
      const sp = makeProblem(seed, kind);
      const exact = solveExactAdj(sp);
      if (!exact.plan || exact.score === null) {
        infeasible++;
        continue;
      }
      for (const m of METHODS) {
        const res = m.run(sp, seed);
        const valid = res.plan !== null && isValid(sp, res.plan);
        const score = valid ? scorePlan(sp, res.plan as never) : null;
        const gap = score === null ? null : Math.max(0, (exact.score - score) / exact.score);
        for (const bucket of [acc, (accKind.get(kind) ?? accKind.set(kind, new Map()).get(kind)!)]) {
          const a = bucket.get(m.name) ?? bucket.set(m.name, { gaps: [], valid: 0, opt: 0, evals: [], total: 0 }).get(m.name)!;
          a.total++;
          a.evals.push(res.evals);
          if (valid) {
            a.valid++;
            a.gaps.push(gap as number);
            if ((gap as number) <= 1e-9) a.opt++;
          }
        }
      }
    }
  }
  const sum = (m: Map<string, { gaps: number[]; valid: number; opt: number; evals: number[]; total: number }>): MethodSummary[] =>
    METHODS.map(({ name }) => {
      const a = m.get(name) ?? { gaps: [], valid: 0, opt: 0, evals: [], total: 0 };
      const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0);
      return {
        method: name,
        problems: a.total,
        validRate: a.total ? a.valid / a.total : 0,
        // 유효하지 않은 해(구성 실패)는 "정답에 도달"로 세지 않는다
        optimalRate: a.total ? a.opt / a.total : 0,
        meanGapPct: 100 * mean(a.gaps),
        worstGapPct: 100 * (a.gaps.length ? Math.max(...a.gaps) : 0),
        meanEvals: mean(a.evals),
      };
    });
  const byKind: Record<string, MethodSummary[]> = {};
  for (const [k, m] of accKind) byKind[k] = sum(m);
  return { summaries: sum(acc), infeasible, byKind };
}

const fmt = (v: number, d = 1) => v.toFixed(d);
function printTable(rows: MethodSummary[]) {
  console.log("방법 | 문제 수 | 유효 해 비율 | 정답 도달률 | 평균 격차(%) | 최악 격차(%) | 평균 점수 계산 횟수");
  for (const r of rows) console.log(`${r.method} | ${r.problems} | ${fmt(100 * r.validRate)}% | ${fmt(100 * r.optimalRate)}% | ${fmt(r.meanGapPct, 2)} | ${fmt(r.worstGapPct, 2)} | ${fmt(r.meanEvals, 0)}`);
}

if (process.argv[1] && /opt04-methods/.test(process.argv[1])) {
  const argv = process.argv.slice(2);
  const n = Number(argv[argv.indexOf("--n") + 1]) || 40;
  const jsonOut = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
  const t0 = Date.now();
  const res = compareMethods(n);
  console.log(`합성 소형 문제 ${n}개 × 4종(슬롯 7·후보 5, 정답=완전탐색) — 해 없음 ${res.infeasible}건 제외, ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  console.log("\n[전체]");
  printTable(res.summaries);
  for (const [k, rows] of Object.entries(res.byKind)) {
    console.log(`\n[${k}]`);
    printTable(rows);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(res, null, 1));
}
