// 구매 시뮬레이터 백테스트: 같은 TS 엔진으로 "그 달 시작 전날까지의 데이터만" 써서 예측하고, 실제 그 달 실적과 비교한다.
// 사용법:
//   npx tsx --env-file=.env scripts/backtest-purchase-sim.ts --collect [--targets A2049,HH] [--from 2025-04] [--to 2026-09] [--limit 50] [--cache path]
//   npx tsx --env-file=.env scripts/backtest-purchase-sim.ts --analyze [--cache path] [--write]   (캐시로 지표·워크포워드 구간 검증, --write 면 보정·스냅샷 DB 저장)
// 평가 단위: (월, 자사 채널, 프로그램 그룹, 슬롯) 셀. 월 내 그 슬롯 방영 ≥4회, 프로그램 월 총 방영 ≥8회, 스페셜 제외.
// 변형: FULL = 엔진 기본(자사 이력 사용), TRANSFER = 자사 이력을 가린 신규 구매 시뮬레이션(타 채널 증거만).
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { fetchSimInputsMulti } from "../src/lib/purchaseSim/dataSource";
import { MODEL_VERSION, PARAMS, predictSlot, withInterval, type CalibrationRow, type SlotPrediction } from "../src/lib/purchaseSim/engine";

const CHANNELS: Record<string, string[]> = {
  A2049: ["ENA", "ENA_PLAY", "ENA_DRAMA"],
  HH: ["ONCE", "OLIFE", "ENA_STORY", "ENA_PLAY", "ENA", "ENA_DRAMA"],
};

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
};
const has = (name: string) => process.argv.includes(`--${name}`);

const CACHE = arg("cache", "backtest-cache.ndjson")!;
const EPS = PARAMS.logEps;

interface Rec {
  month: string;
  channel: string;
  target: "A2049" | "HH";
  group: string;
  display: string;
  slot: string;
  nAir: number;
  actual: number;
  asOf: string;
  variant: "FULL" | "TRANSFER";
  point: SlotPrediction;
}

function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const dayBefore = (ymd: string) => new Date(Date.parse(ymd) - 86400000).toISOString().slice(0, 10);

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    })
  );
}

// ───────────────────────── 수집 ─────────────────────────
async function collect() {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const targets = (arg("targets", "A2049,HH")!).split(",") as ("A2049" | "HH")[];
  const months = monthRange(arg("from", "2025-04")!, arg("to", "2026-09")!);
  const limit = Number(arg("limit", "0"));
  const conc = Number(arg("conc", "4"));

  interface Job {
    target: "A2049" | "HH";
    channel: string;
    month: string;
    c: { group_key: string; display: string; members: string[]; total_n: number; cells: { slot: string; n: number; sum: number }[] };
  }
  const jobs: Job[] = [];
  for (const target of targets) {
    for (const channel of CHANNELS[target]) {
      for (const month of months) {
        const { data, error } = await client.rpc("get_purchase_backtest_cases", { p_own_channel_code: channel, p_target: target, p_from: `${month}-01`, p_to: lastDay(month) });
        if (error) throw new Error(`cases ${target} ${channel} ${month}: ${error.message}`);
        for (const c of (data ?? []) as Job["c"][]) jobs.push({ target, channel, month, c });
      }
    }
  }
  const use = limit > 0 ? jobs.filter((_, i) => i % Math.ceil(jobs.length / limit) === 0) : jobs;
  // 같은 (타깃, 채널, 월)은 기준일이 같으므로 한 번의 배치 RPC 로 모든 그룹의 입력을 받는다.
  const batches = new Map<string, Job[]>();
  for (const j of use) {
    const k = `${j.target}|${j.channel}|${j.month}`;
    batches.set(k, [...(batches.get(k) ?? []), j]);
  }
  const batchList = Array.from(batches.values());
  console.log(`케이스 ${jobs.length}건 중 ${use.length}건, 배치 ${batchList.length}개 (동시 ${conc})`);
  if (has("dry")) return;

  const out = fs.createWriteStream(CACHE, { flags: "w" });
  let done = 0;
  let failed = 0;
  const t0 = Date.now();
  await pool(batchList, conc, async (list) => {
    const { target, channel, month } = list[0];
    const asOf = dayBefore(`${month}-01`);
    try {
      const multi = await fetchSimInputsMulti(client, { groups: list.map((j) => ({ group_key: j.c.group_key, members: j.c.members })), ownChannel: channel, target, asOf });
      for (const j of list) {
        const inputs = multi[j.c.group_key];
        if (!inputs) continue;
        for (const cell of j.c.cells) {
          for (const variant of ['FULL', 'TRANSFER'] as const) {
            const point = predictSlot(inputs, target, cell.slot, [], { ignoreOwnHistory: variant === 'TRANSFER' });
            const rec: Rec = { month, channel, target, group: j.c.group_key, display: j.c.display, slot: cell.slot, nAir: cell.n, actual: cell.sum / cell.n, asOf, variant, point };
            out.write(JSON.stringify(rec) + "\n");
          }
        }
      }
    } catch (e) {
      failed++;
      console.error(`실패 ${target} ${channel} ${month}: ${e instanceof Error ? e.message : e}`);
    }
    done++;
    console.log(`  배치 ${done}/${batchList.length} (${Math.round((Date.now() - t0) / 1000)}s, 실패 ${failed})`);
  });
  await new Promise((r) => out.end(r));
  console.log(`수집 완료: 배치 ${done}개, 실패 ${failed}, ${Math.round((Date.now() - t0) / 1000)}s → ${CACHE}`);
}

// ───────────────────────── 분석 ─────────────────────────
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const resid = (actual: number, pred: number) => Math.log((actual + EPS) / (pred + EPS));
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "-");

function calRows(rs: { scen: { base: string; bucket: string }; r: number }[]): CalibrationRow[] {
  const groups = new Map<string, number[]>();
  for (const x of rs) {
    for (const key of [x.scen.bucket, x.scen.base]) {
      const arr = groups.get(key) ?? [];
      arr.push(x.r);
      groups.set(key, arr);
    }
  }
  const out: CalibrationRow[] = [];
  for (const [scenario, arr] of groups) {
    const s = [...arr].sort((a, b) => a - b);
    out.push({
      scenario,
      n: s.length,
      q05: quantile(s, 0.05),
      q10: quantile(s, 0.1),
      q25: quantile(s, 0.25),
      q50: quantile(s, 0.5),
      q75: quantile(s, 0.75),
      q90: quantile(s, 0.9),
      q95: quantile(s, 0.95),
      mae_log: s.reduce((a, v) => a + Math.abs(v), 0) / s.length,
    });
  }
  return out;
}

import { scenarioOf } from "../src/lib/purchaseSim/engine";

interface Metric {
  n: number;
  wN: number;
  wape: number;
  wapeN1: number;
  maeLog: number;
  maeLogN1: number;
  biasPct: number; // Σ(pred-act)/Σact
  winN1: number; // 모델 절대오차 < N1 절대오차 비율(가중)
}
function metric(rows: { rec: Rec; pred: number; n1: number }[]): Metric {
  let wN = 0, sAbs = 0, sAbsN1 = 0, sAct = 0, sBias = 0, sLog = 0, sLogN1 = 0, win = 0;
  for (const { rec, pred, n1 } of rows) {
    const w = rec.nAir;
    wN += w;
    sAbs += w * Math.abs(pred - rec.actual);
    sAbsN1 += w * Math.abs(n1 - rec.actual);
    sAct += w * rec.actual;
    sBias += w * (pred - rec.actual);
    sLog += Math.abs(resid(rec.actual, pred));
    sLogN1 += Math.abs(resid(rec.actual, n1));
    if (Math.abs(pred - rec.actual) < Math.abs(n1 - rec.actual)) win += w;
  }
  const n = rows.length;
  return { n, wN, wape: sAbs / sAct, wapeN1: sAbsN1 / sAct, maeLog: sLog / n, maeLogN1: sLogN1 / n, biasPct: sBias / sAct, winN1: win / wN };
}
const mline = (label: string, m: Metric) =>
  `${label.padEnd(34)} n=${String(m.n).padStart(5)}  WAPE ${f(m.wape)} (N1 ${f(m.wapeN1)})  logMAE ${f(m.maeLog)} (N1 ${f(m.maeLogN1)})  편향 ${f(m.biasPct * 100, 1)}%  N1 이김 ${f(m.winN1 * 100, 0)}%`;

async function analyze() {
  const recs: Rec[] = fs
    .readFileSync(CACHE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  console.log(`레코드 ${recs.length}건 (${CACHE})`);
  const ok = recs.filter((r) => r.point.prediction !== null && r.point.baseline !== null);
  console.log(`예측 가능 ${ok.length}건 / 불가 ${recs.length - ok.length}건 (증거 부족·기준값 부족)`);

  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };

  // 1) 지표: 변형 × 타깃
  log("\n## 1. 점 예측 정확도 (셀 = 월×채널×프로그램×슬롯, 가중 = 방영 수)");
  for (const target of ["A2049", "HH"] as const) {
    for (const variant of ["FULL", "TRANSFER"] as const) {
      const rows = ok.filter((r) => r.target === target && r.variant === variant).map((rec) => ({ rec, pred: rec.point.prediction!, n1: rec.point.baseline!.mean }));
      if (rows.length === 0) continue;
      log(mline(`${target} ${variant}`, metric(rows)));
      for (const ct of ["OWN_PEER", "OWN", "PEER"]) {
        const sub = rows.filter((x) => x.rec.point.caseType === ct);
        if (sub.length >= 20) log("  " + mline(`└ 유형 ${ct}`, metric(sub)));
      }
      for (const lv of [0, 1, 2, 3]) {
        const sub = rows.filter((x) => x.rec.point.baseline!.level === lv);
        if (sub.length >= 20) log("  " + mline(`└ 기준값 수준 ${lv}`, metric(sub)));
      }
      for (const ch of CHANNELS[target]) {
        const sub = rows.filter((x) => x.rec.channel === ch);
        if (sub.length >= 20) log("  " + mline(`└ 채널 ${ch}`, metric(sub)));
      }
      const byPeer = [
        ["피어 1~2곳", (x: { rec: Rec }) => x.rec.point.peerCount >= 1 && x.rec.point.peerCount <= 2],
        ["피어 3곳+", (x: { rec: Rec }) => x.rec.point.peerCount >= 3],
        ["피어 0곳", (x: { rec: Rec }) => x.rec.point.peerCount === 0],
      ] as const;
      for (const [label, fn] of byPeer) {
        const sub = rows.filter(fn);
        if (sub.length >= 20) log("  " + mline(`└ ${label}`, metric(sub)));
      }
    }
  }

  // 2) 워크포워드 구간·신뢰도 검증
  log("\n## 2. 워크포워드 구간 검증 (각 월은 그 이전 월 잔차로만 보정, 시나리오별 n≥30)");
  const months = Array.from(new Set(ok.map((r) => r.month))).sort();
  const withScen = ok.map((rec) => {
    const scen = scenarioOf(rec.target, rec.point.caseType, rec.point.prediction);
    return { rec, scen, r: resid(rec.actual, rec.point.prediction!) };
  });
  interface Wf {
    rec: Rec;
    pred: SlotPrediction;
    inBand: boolean | null;
  }
  const wf: Wf[] = [];
  for (const m of months) {
    for (const target of ["A2049", "HH"] as const) {
      const past = withScen.filter((x) => x.rec.month < m && x.rec.target === target);
      const cal = calRows(past.map((x) => ({ scen: x.scen, r: x.r })));
      for (const x of withScen.filter((y) => y.rec.month === m && y.rec.target === target)) {
        const p = withInterval(x.rec.point, target, cal);
        const inBand = p.low !== null && p.high !== null ? x.rec.actual >= p.low && x.rec.actual <= p.high : null;
        wf.push({ rec: x.rec, pred: p, inBand });
      }
    }
  }
  for (const target of ["A2049", "HH"] as const) {
    for (const variant of ["FULL", "TRANSFER"] as const) {
      const sub = wf.filter((x) => x.rec.target === target && x.rec.variant === variant && x.inBand !== null);
      if (sub.length === 0) continue;
      const cov = sub.filter((x) => x.inBand).length / sub.length;
      const w = sub.reduce((a, x) => a + (x.pred.high! - x.pred.low!), 0) / sub.length;
      const rel = sub.reduce((a, x) => a + (x.pred.high! - x.pred.low!) / Math.max(x.pred.prediction!, EPS), 0) / sub.length;
      log(`${target} ${variant}: 80% 구간 적중 ${f(cov * 100, 1)}% (n=${sub.length}), 평균 폭 ${f(w, 4)}, 예측 대비 폭 ${f(rel, 2)}배`);
    }
  }

  log("\n## 3. 신뢰도 등급별 오차 (워크포워드)");
  for (const target of ["A2049", "HH"] as const) {
    for (const variant of ["FULL", "TRANSFER"] as const) {
      for (const c of ["HIGH", "MEDIUM", "LOW"] as const) {
        const sub = wf.filter((x) => x.rec.target === target && x.rec.variant === variant && x.pred.confidence === c);
        if (sub.length < 5) continue;
        const m = metric(sub.map((x) => ({ rec: x.rec, pred: x.pred.prediction!, n1: x.rec.point.baseline!.mean })));
        const inb = sub.filter((x) => x.inBand !== null);
        const cov = inb.length ? inb.filter((x) => x.inBand).length / inb.length : NaN;
        log(mline(`${target} ${variant} ${c}`, m) + `  구간적중 ${f(cov * 100, 0)}%`);
      }
    }
  }

  // 3) 최종 보정(전체 기간) 저장
  const finalCal = new Map<string, CalibrationRow[]>();
  for (const target of ["A2049", "HH"] as const) {
    const all = withScen.filter((x) => x.rec.target === target);
    const rows = calRows(all.map((x) => ({ scen: x.scen, r: x.r }))).filter((r) => r.n >= 30);
    finalCal.set(target, rows);
    log(`\n보정 ${target}: ` + rows.map((r) => `${r.scenario}(n=${r.n}, q10=${f(r.q10 ?? NaN, 2)}, q90=${f(r.q90 ?? NaN, 2)}, MAE=${f(r.mae_log ?? NaN, 2)})`).join(" / "));
  }
  fs.writeFileSync(CACHE.replace(/\.ndjson$/, "") + ".report.txt", lines.join("\n"), "utf8");

  if (has("write")) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const runId = `bt-${MODEL_VERSION}-${new Date().toISOString().slice(0, 16)}`;
    for (const [target, rows] of finalCal) {
      await client.from("purchase_sim_calibration").delete().eq("model_version", MODEL_VERSION).eq("target", target);
      const ins = rows.map((r) => ({ model_version: MODEL_VERSION, target, scenario: r.scenario, n: r.n, q05: r.q05, q10: r.q10, q25: r.q25, q50: r.q50, q75: r.q75, q90: r.q90, q95: r.q95, mae_log: r.mae_log, backtest_run_id: runId }));
      if (ins.length) {
        const { error } = await client.from("purchase_sim_calibration").insert(ins);
        if (error) throw new Error(`보정 저장 실패: ${error.message}`);
      }
    }
    // 스냅샷: 워크포워드 예측(그 시점 보정으로 만든 범위·신뢰도)
    await client.from("rating_predictions").delete().eq("is_backtest", true).eq("model_version", MODEL_VERSION);
    const toRow = (x: Wf) => ({
      created_by: "backtest",
      model_version: MODEL_VERSION,
      as_of: x.rec.asOf,
      own_channel_code: x.rec.channel,
      target: x.rec.target,
      program_group_key: x.rec.group,
      program_name: x.rec.display,
      scheduled_isodow: null,
      scheduled_start: null,
      slot: x.rec.slot,
      case_type: x.pred.caseType,
      baseline_rating: x.pred.baseline?.mean ?? null,
      content_index: x.pred.contentIdx,
      peer_index: x.pred.peerIdx,
      own_index: x.pred.ownIdx,
      own_weight: x.pred.ownWeight,
      prediction_rating: x.pred.prediction,
      prediction_low: x.pred.low,
      prediction_high: x.pred.high,
      interval_level: x.pred.intervalLevel,
      confidence: x.pred.confidence,
      sample_counts: { peerCount: x.pred.peerCount, peerAirings: x.pred.peerAirings, ownN: x.pred.ownN, baselineN: x.pred.baseline?.n ?? 0, baselineLevel: x.pred.baseline?.level ?? null, airings: x.rec.nAir },
      components: { variant: x.rec.variant, month: x.rec.month, scenario: x.pred.scenario },
      is_backtest: true,
      backtest_run_id: runId,
      case_key: `${x.rec.month}|${x.rec.channel}|${x.rec.group}|${x.rec.slot}|${x.rec.variant}`,
      actual_rating: x.rec.actual,
      absolute_error: Math.abs((x.pred.prediction ?? 0) - x.rec.actual),
      relative_error: x.rec.actual > 0 ? ((x.pred.prediction ?? 0) - x.rec.actual) / x.rec.actual : null,
      actual_filled_at: new Date().toISOString(),
    });
    const rows = wf.filter((x) => x.pred.caseType !== "NONE").map(toRow);
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await client.from("rating_predictions").insert(rows.slice(i, i + 400));
      if (error) throw new Error(`스냅샷 저장 실패(${i}): ${error.message}`);
    }
    console.log(`\n저장 완료: 보정 + 스냅샷 ${rows.length}건 (run ${runId})`);
  }
}

(has("analyze") ? analyze() : collect()).catch((e) => {
  console.error(e);
  process.exit(1);
});
