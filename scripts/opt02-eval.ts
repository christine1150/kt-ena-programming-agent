// OPT02 — 시간 순서(rolling-origin) 예측 검증: 현재 모델(6단계 수축) vs 단순 기준모델, 같은 테스트 구간·같은 지표.
// 운영 DB·네트워크에 접근하지 않는다. 두 가지 입력:
//   1) 기본: 합성 세계(프로그램 생애주기·신규 편성·본/재방·특집·새벽 0시청률·주별 추세)로 *방법의 성질*을 본다. 실제 채널 결과가 아니다.
//   2) --input <파일.json>: 실제 자사 방영을 내보낸 파일(RawOwn 형식 = get_ideal_schedule_own_airings RPC 응답)로 같은 표를 만든다.
//      내보내기는 사용자가 .env가 있는 PC에서 scripts/export-own-airings.mts로 한다(이 자동 작업은 운영 DB를 읽지 않는다).
// 실행: npm run opt02:eval -- [--worlds 6] [--weeks 40] [--input file.json --origins 20]
import fs from "node:fs";
import { mapOwnAirings, type RawOwn } from "../src/lib/idealSchedule/mapping";
import { addDays } from "../src/lib/idealSchedule/time";
import type { Genre, OwnAiringsBundle } from "../src/lib/idealSchedule/types";
import {
  GROUPS,
  GROUP_LABEL,
  UNVERSIONED_INPUTS,
  channelRecentModel,
  empiricalIntervals,
  existingModel,
  metricsOf,
  pooledModel,
  programRecentModel,
  runRollingOrigin,
  slotRecentModel,
  tuneAndHoldout,
  type EvalRow,
  type GroupKey,
  type ModelSpec,
} from "../src/lib/idealSchedule/validation";

const KPI = "수도권 2049";
const START = "2026-01-05"; // 월

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());
const pad = (n: number) => String(n).padStart(2, "0");
const slotEffect = (h: number) => (h <= 6 ? 0.2 : h <= 11 ? 0.35 : h <= 16 ? 0.5 : h <= 18 ? 0.8 : h === 21 ? 1.3 : h <= 23 ? 1.0 : 0.6);
const GENRES: Genre[] = ["드라마", "예능", "다큐·교양", "미분류"];

interface Prog {
  start: number; // 첫 편성 주
  end: number; // 마지막 편성 주(포함)
  appeal: number;
  trend: number; // 주당 로그 변화
  genre: Genre;
}

/** 합성 세계: 프로그램 생애주기(신규 투입·종영), 안정적인 주간 편성표 + 일부 교체, 본/재방, 특집, 새벽 0시청률. 값은 실제 채널이 아니다. */
function syntheticRaw(seed: number, weeks: number): { raw: RawOwn; genres: Map<string, Genre> } {
  const r = rng(seed);
  const nProg = 34;
  const progs: Prog[] = Array.from({ length: nProg }, (_, i) => {
    const start = i < 14 ? 0 : Math.floor(r() * (weeks - 8));
    return { start, end: Math.min(weeks - 1, start + 8 + Math.floor(r() * 26)), appeal: Math.exp(0.4 * normal(r)), trend: 0.02 * normal(r), genre: GENRES[Math.floor(r() * GENRES.length)] };
  });
  const genres = new Map<string, Genre>(progs.map((p, i) => [`프로그램${i}`, p.genre]));
  const active = (w: number) => progs.map((p, i) => ({ p, i })).filter(({ p }) => w >= p.start && w <= p.end);
  const grid: number[][][] = []; // [w][dow][hour-2] = 프로그램 번호
  for (let w = 0; w < weeks; w++) {
    const act = active(w);
    const cur: number[][] = [];
    for (let d = 0; d < 7; d++) {
      const row: number[] = [];
      for (let h = 0; h < 24; h++) {
        const prev = w > 0 ? grid[w - 1][d][h] : -1;
        const alive = prev >= 0 && w >= progs[prev].start && w <= progs[prev].end;
        const swap = r() < 0.04;
        if (alive && !swap) row.push(prev);
        else {
          // 새로 시작했거나 종영/교체 — 이번 주에 막 시작한 프로그램을 우선, 아니면 활성 중 무작위
          const fresh = act.filter(({ p }) => p.start === w);
          const pick = fresh.length > 0 && r() < 0.6 ? fresh[Math.floor(r() * fresh.length)] : act[Math.floor(r() * act.length)];
          row.push(pick.i);
        }
      }
      cur.push(row);
    }
    grid.push(cur);
  }
  const airings: RawOwn["airings"] = [];
  const dates: string[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = addDays(START, w * 7 + d);
      dates.push(date);
      for (let h = 2; h < 26; h++) {
        const pi = grid[w][d][h - 2];
        const p = progs[pi];
        const age = w - p.start;
        const rerun = h <= 11 || h >= 24 ? r() < 0.7 : r() < 0.1; // 낮·심야는 재방 비중이 높다
        const premiere = !rerun && age < 3 ? 1.3 : 1;
        const special = r() < 0.04 ? (r() < 0.5 ? 1.8 : 0.4) : 1; // 특집·사건
        let rating = 0.1 * p.appeal * Math.exp(p.trend * age) * premiere * special * slotEffect(h) * (d >= 5 ? 1.1 : 1) * (rerun ? 0.55 : 1) * Math.exp(0.25 * normal(r) - 0.03);
        if (h <= 6 && r() < 0.2) rating = 0; // 새벽 0시청률
        airings.push({
          date,
          start: `${pad(h % 24)}:00:00`,
          end: `${pad((h + 1) % 24)}:00:00`,
          program_id: `P${pi}`,
          program_name: `프로그램${pi}`,
          first_run: rerun ? false : true,
          m: { [KPI]: { r: Math.max(0, rating), s: rating * 10, reach: null, ts: 600 } },
        });
      }
    }
  }
  return { raw: { channel_code: "SYN", kpi_label: KPI, date_from: START, date_to: addDays(START, weeks * 7 - 1), holidays: [], dates_with_data: dates, airings }, genres };
}

// ───────────── 모델 구성 ─────────────
const tuneGrid: ModelSpec[] = [];
for (const k of [2, 4, 8]) for (const rw of [1, 2, 4]) tuneGrid.push(existingModel(`exist_k${k}_rw${rw}`, `현재 모델 k=${k}, 최근가중 ${rw}`, { shrinkageK: k, recentWeight: rw }));
const DEFAULT_ID = "exist_k4_rw2";
const baselines: ModelSpec[] = [channelRecentModel(4), slotRecentModel(4), slotRecentModel(8), programRecentModel(4), pooledModel(3)];
const ALL = [...tuneGrid, ...baselines];
const fmt = (v: number | null, d = 4) => (v === null ? "—" : v.toFixed(d));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

interface WorldRun {
  rowsByLead: Map<number, EvalRow[]>;
  nWeeks: number;
}

function evaluate(bundle: OwnAiringsBundle, genreOf: (n: string) => Genre, originWeeks: string[], leads: number[]): WorldRun {
  const rowsByLead = new Map<number, EvalRow[]>();
  for (const lead of leads) rowsByLead.set(lead, runRollingOrigin(bundle, { targetWeeks: originWeeks, leadDays: lead, genreOf, models: ALL }));
  return { rowsByLead, nWeeks: originWeeks.length };
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sd = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

function main() {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const nWorlds = Number(arg("--worlds", "6"));
  const weeks = Number(arg("--weeks", "40"));
  const input = argv.includes("--input") ? arg("--input", "") : null;
  const leads = [0, 7, 14];

  const worlds: { name: string; bundle: OwnAiringsBundle; genreOf: (n: string) => Genre; origins: string[] }[] = [];
  if (input) {
    const raw = JSON.parse(fs.readFileSync(input, "utf8")) as RawOwn;
    const bundle = mapOwnAirings(raw);
    const nOrig = Number(arg("--origins", "20"));
    const mondays = [...new Set(bundle.airings.map((a) => a.date))].sort().filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1);
    const lastFull = mondays.filter((d) => addDays(d, 6) <= (bundle.dateTo || "9999")).slice(-nOrig);
    worlds.push({ name: input, bundle, genreOf: () => "미분류", origins: lastFull });
  } else {
    for (let s = 1; s <= nWorlds; s++) {
      const { raw, genres } = syntheticRaw(s * 101, weeks);
      const bundle = mapOwnAirings(raw);
      const origins = Array.from({ length: weeks - 16 }, (_, i) => addDays(START, (16 + i) * 7));
      worlds.push({ name: `합성 세계 ${s}`, bundle, genreOf: (n) => genres.get(n) ?? "미분류", origins });
    }
  }

  console.log(input ? `실제 자료 ${input}: 목표 주 ${worlds[0].origins.length}개` : `합성 세계 ${nWorlds}개(프로그램 34개, ${weeks}주, 목표 주 ${weeks - 16}개/세계). 실제 채널 결과가 아니라 방법의 성질을 보는 실험이다.`);
  const runs = worlds.map((w) => {
    const t0 = Date.now();
    const run = evaluate(w.bundle, w.genreOf, w.origins, leads);
    process.stderr.write(`${w.name} 완료 ${Date.now() - t0}ms\n`);
    return run;
  });

  const ids = ALL.map((m) => m.id);
  const labelOf = new Map(ALL.map((m) => [m.id, m.label]));

  // ── 표 1: 전체 오차(테스트 구간 = 뒤쪽 절반 origin) ──
  for (const lead of leads) {
    console.log(`\n### 데이터 마감 ${lead === 0 ? "목표 주 전날(현재 백테스트 가정)" : `목표 주 ${lead}일 전`} — 최종 holdout(뒤쪽 절반 목표 주), 세계 평균`);
    console.log("모델 | MAE(%p) | bias(%p) | RMSE | 80% 구간 적중률(구간 계산이 가능한 모든 목표 주) | 상대 폭 | 평가 건수/세계 | 고유 프로그램/세계 | 고유 방송일/세계");
    for (const id of ids) {
      const per = runs.map((run) => {
        const rows = run.rowsByLead.get(lead)!;
        const origins = [...new Set(rows.map((r) => r.originWeek))].sort();
        const test = new Set(origins.slice(Math.floor(origins.length / 2)));
        const mine = rows.filter((r) => r.model === id);
        const m = metricsOf(mine.filter((r) => test.has(r.originWeek)));
        const iv = empiricalIntervals(rows.filter((r) => test.has(r.originWeek) || true), [id])[0]; // 구간은 전체 origin에서 앞선 잔차로 만든다
        return { m, iv };
      });
      console.log(
        `${labelOf.get(id)}${id === DEFAULT_ID ? " ★기본" : ""} | ${fmt(avg(per.map((p) => (p.m.mae === null ? null : p.m.mae * 100))), 3)} | ${fmt(avg(per.map((p) => (p.m.bias === null ? null : p.m.bias * 100))), 3)} | ${fmt(avg(per.map((p) => (p.m.rmse === null ? null : p.m.rmse * 100))), 3)} | ${pct(avg(per.map((p) => p.iv.coverage)))} | ${pct(avg(per.map((p) => p.iv.relativeWidth)))} | ${Math.round(avg(per.map((p) => p.m.n)) ?? 0)} | ${Math.round(avg(per.map((p) => p.m.uniquePrograms)) ?? 0)} | ${Math.round(avg(per.map((p) => p.m.uniqueDates)) ?? 0)}`
      );
    }
  }

  // ── 표 2: 하위 집단별 MAE(%p), lead 0·7, 핵심 모델만 ──
  const key = [DEFAULT_ID, "slot4w", "program4", "pooled_k3"];
  for (const lead of [0, 7]) {
    console.log(`\n### 집단별 MAE(%p) — 데이터 마감 ${lead === 0 ? "목표 주 전날" : "목표 주 7일 전"}, 최종 holdout, 세계 평균(괄호: 평가 건수/세계)`);
    console.log(["집단", ...key.map((k) => labelOf.get(k))].join(" | "));
    for (const g of Object.keys(GROUPS) as GroupKey[]) {
      const cells = key.map((id) => {
        const per = runs.map((run) => {
          const rows = run.rowsByLead.get(lead)!;
          const origins = [...new Set(rows.map((r) => r.originWeek))].sort();
          const test = new Set(origins.slice(Math.floor(origins.length / 2)));
          return metricsOf(rows.filter((r) => r.model === id && test.has(r.originWeek) && GROUPS[g](r)));
        });
        const mae = avg(per.map((p) => (p.mae === null ? null : p.mae * 100)));
        return `${fmt(mae, 3)} (${Math.round(avg(per.map((p) => p.n)) ?? 0)})`;
      });
      console.log([GROUP_LABEL[g], ...cells].join(" | "));
    }
  }

  // ── 표 3: 튜닝(앞 절반)으로 고른 현재 모델 변형의 최종 holdout 성능 ──
  console.log("\n### 튜닝(앞쪽 절반 목표 주)으로 고른 변형 vs 기본(★) — 최종 holdout MAE(%p), 세계별");
  const grid = tuneGrid.map((m) => m.id);
  const picks = new Map<string, number>();
  const chosenMae: (number | null)[] = [];
  const defaultMae: (number | null)[] = [];
  const bestBase: (number | null)[] = [];
  for (const run of runs) {
    const rows = run.rowsByLead.get(0)!;
    const t = tuneAndHoldout(rows, grid);
    picks.set(t.chosen, (picks.get(t.chosen) ?? 0) + 1);
    chosenMae.push(t.testMae[t.chosen] === null ? null : (t.testMae[t.chosen] as number) * 100);
    defaultMae.push(t.testMae[DEFAULT_ID] === null ? null : (t.testMae[DEFAULT_ID] as number) * 100);
    const bt = tuneAndHoldout(rows, baselines.map((b) => b.id));
    bestBase.push(bt.testMae[bt.chosen] === null ? null : (bt.testMae[bt.chosen] as number) * 100);
  }
  console.log(`튜닝이 고른 변형 분포: ${[...picks.entries()].map(([k, v]) => `${labelOf.get(k)} ${v}회`).join(", ")}`);
  console.log(`holdout MAE: 튜닝 선택 ${fmt(avg(chosenMae), 3)}±${fmt(sd(chosenMae), 3)} / 기본 ${fmt(avg(defaultMae), 3)}±${fmt(sd(defaultMae), 3)} / 기준모델 중 튜닝 최선 ${fmt(avg(bestBase), 3)}±${fmt(sd(bestBase), 3)}`);

  console.log(`\n시간 버전이 관리되지 않는 입력(검증이 "현재 값"으로 과거를 재현): ${UNVERSIONED_INPUTS.join(" / ")}`);
  console.log("구간은 이전 목표 주 잔차(실측÷예측)의 10~90% 분위수에서 만든 *실증 범위*이며 미래 적중을 보장하는 예측분포가 아니다. 적중률은 이후 목표 주에서 센 값이다.");
}
main();
