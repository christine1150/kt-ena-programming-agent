// 읽기 전용 — AI 편성 교체 기준(optimizer keepInsignificant: 예상 이득 ≥ 지난주 편성 기대값의 3% 또는 표준오차 1배)을 실측으로 다시 맞춘다(2026-10-23, 사용자 지시).
// 원자료는 swap-check.mts가 만든 .cache/skill-baseline/swap-events.json(PD가 실제로 바꾼 교체 사건, 모델 예상 변화·실제 변화)이다.
//
// 미리 정한 것(결과를 보기 전에 고정):
//  · 대상: 교체 사건 중 Y가 마감 전 방영 이력이 있는 것(AI 편성 후보 풀은 최근 방영작이라 이쪽이 맞는 모집단). 보조: 교체 전체.
//  · 구간: 날짜만으로 반씩 나눔 — 튜닝 2026-03-01 이전(교체 143건), 검증 2026-03-01 이후(136건). 검증 구간은 고른 기준과 현재 기준을 한 번만 견준다.
//  · 후보 기준 τ: 예상 상대 이득 3%(현재)·5·10·15·20·25·30·40·50%.
//  · 목표: 사건당 실현 이득 평균 = 예상 ≥ τ면 바꿨다고 보고 실제 로그 변화, 아니면 그대로 둔 것으로 0. 튜닝 구간에서 가장 큰 τ를 고른다.
//    (그대로 뒀을 때 변화를 0으로 둔다 — X가 떨어지던 중이었다면 교체의 가치를 낮게 본다. 채널 흐름 보정 실적으로 같은 계산을 보조로 낸다.)
//  · 함께 보는 것: 바꾼 건수, 바꾼 것 중 실제 +10% 이상 오름·−10% 이상 내림 비율, 결정 단위 복원 추출 95% 구간(고른 τ − 현재).
//  · 실제 편성안 영향: 채널별 가장 최근 저장된 AI 편성(지난주 틀 유지 모드, 채널 주 타깃)의 CHANGE 결정 중 고른 τ 미만이 몇 칸인지 센다(필수·잠금·직접 교체 제외).
// 사용: npx tsx --env-file=.env scripts/skill-baseline/swap-threshold.mts   (쓰기 없음)
import fs from "node:fs";
import { supabase } from "../../src/lib/supabase";
import { loadChannelRef } from "../../src/lib/idealSchedule/dataSource";

type Ev = { ch: string; cluster: string; kind: "replace" | "move"; date: string; newY: boolean; model: number; actual: number; actualAdj: number };
const all = (JSON.parse(fs.readFileSync(".cache/skill-baseline/swap-events.json", "utf8")) as Ev[]).filter((e) => e.kind === "replace");
const SPLIT = "2026-03-01";
const TAUS = [0.03, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const CUR = 0.03;
const L = (x: number) => Math.log(Math.max(1 + x, 1e-6));
const pc = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const lg = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;

function stats(evs: Ev[], tau: number, act: (e: Ev) => number) {
  const sw = evs.filter((e) => e.model >= tau);
  const gain = evs.reduce((s, e) => s + (e.model >= tau ? L(act(e)) : 0), 0) / evs.length;
  const up = sw.filter((e) => act(e) >= 0.1).length, dn = sw.filter((e) => act(e) <= -0.1).length;
  return { n: sw.length, decisions: new Set(sw.map((e) => e.cluster)).size, gain, up: sw.length ? up / sw.length : 0, dn: sw.length ? dn / sw.length : 0, meanSw: sw.length ? sw.reduce((s, e) => s + L(act(e)), 0) / sw.length : 0 };
}
function bootDiff(evs: Ev[], a: number, b: number, act: (e: Ev) => number, iters = 2000): [number, number] {
  const ids = [...new Set(evs.map((e) => e.cluster))];
  const mem = ids.map((id) => evs.filter((e) => e.cluster === id));
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ds: number[] = [];
  for (let i = 0; i < iters; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < ids.length; j++) for (const e of mem[Math.floor(rnd() * ids.length)]) { s += (e.model >= b ? L(act(e)) : 0) - (e.model >= a ? L(act(e)) : 0); n++; }
    ds.push(s / n);
  }
  ds.sort((x, y) => x - y);
  return [ds[Math.floor(iters * 0.025)], ds[Math.floor(iters * 0.975)]];
}

let out = "# 교체 기준 재조정(읽기 전용)\n";
for (const [popName, pop] of [["Y 이력 있는 교체(주)", all.filter((e) => !e.newY)], ["교체 전체(보조)", all]] as const) {
  for (const [actName, act] of [["실적 평균 비", (e: Ev) => e.actual], ["채널 흐름 보정(보조)", (e: Ev) => e.actualAdj]] as const) {
    const tune = pop.filter((e) => e.date < SPLIT), test = pop.filter((e) => e.date >= SPLIT);
    out += `\n## ${popName} · ${actName} — 튜닝 ${tune.length}건(결정 ${new Set(tune.map((e) => e.cluster)).size}) / 검증 ${test.length}건(결정 ${new Set(test.map((e) => e.cluster)).size})\n\n`;
    out += "| τ | 튜닝: 바꾼 건수 | 튜닝: 사건당 실현 이득 | 튜닝: 바꾼 것 오름·내림 |\n|---|---|---|---|\n";
    let best = CUR, bestGain = -Infinity;
    for (const t of TAUS) {
      const s = stats(tune, t, act);
      if (s.gain > bestGain + 1e-12) { bestGain = s.gain; best = t; }
      out += `| ${pc(t)}${t === CUR ? "(현재)" : ""} | ${s.n} | ${lg(s.gain)} | ${Math.round(s.up * 100)}%·${Math.round(s.dn * 100)}% |\n`;
    }
    const c = stats(test, CUR, act), b = stats(test, best, act);
    const [lo, hi] = bootDiff(test, CUR, best, act);
    out += `\n튜닝 구간에서 고른 기준: **${pc(best)}** → 검증 구간에서 한 번 견줌\n\n| 기준 | 바꾼 건수(결정) | 사건당 실현 이득 | 바꾼 것 평균 실제 변화 | 바꾼 것 오름 | 바꾼 것 내림 |\n|---|---|---|---|---|---|\n`;
    out += `| 현재 3% | ${c.n}(${c.decisions}) | ${lg(c.gain)} | ${pc(Math.exp(c.meanSw) - 1)} | ${Math.round(c.up * 100)}% | ${Math.round(c.dn * 100)}% |\n`;
    out += `| 고른 ${pc(best)} | ${b.n}(${b.decisions}) | ${lg(b.gain)} | ${pc(Math.exp(b.meanSw) - 1)} | ${Math.round(b.up * 100)}% | ${Math.round(b.dn * 100)}% |\n`;
    out += `\n사건당 실현 이득 차이(고른 − 현재) ${lg(b.gain - c.gain)}, 결정 단위 95% 구간 ${lg(lo)}~${lg(hi)}${lo > 0 ? " ▲" : hi < 0 ? " ▼" : "(구별 안 됨)"}\n`;
    out += `\n참고(선택에 쓰지 않음) 검증 구간 τ별: ${TAUS.map((t) => { const s = stats(test, t, act); return `${pc(t)} ${s.n}건 ${lg(s.gain)}`; }).join(" · ")}\n`;
  }
}

// 실제 저장된 AI 편성안 영향(채널별 가장 최근 것)
out += "\n## 실제 저장된 AI 편성안에서 기준을 올리면 그대로 두게 되는 칸\n\n| 채널 | 편성안(기준 주·만든 날) | 교체 칸(CHANGE) | 지금 기준이 3%보다 큰 칸(표준오차 쪽) | 예상 이득 <10% | <20% | <30% | ≥30% |\n|---|---|---|---|---|---|---|---|\n";
for (const code of ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]) {
  const ch = await loadChannelRef(code);
  const { data: runs } = await supabase.from("ideal_schedule_runs").select("id, week_start, created_at, structure_mode, status, optimize_target_is_channel_kpi").eq("channel_id", ch.id).eq("structure_mode", "KEEP_CURRENT").eq("status", "DONE").eq("optimize_target_is_channel_kpi", true).order("created_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  if (!run) { out += `| ${code} | 없음 | | | | | | |\n`; continue; }
  const { data: blocks } = await supabase.from("ideal_schedule_blocks").select("status, decision").eq("run_id", run.id).eq("layer", "IDEAL");
  type D = { kind: string; delta: number | null; threshold: number | null; incumbent: { expected: number | null } | null; capBlocked?: boolean };
  const ch2 = (blocks ?? []).filter((b) => !["REQUIRED", "LOCKED", "MANUAL_OVERRIDE"].includes(b.status as string)).map((b) => b.decision as D | null).filter((d): d is D => d?.kind === "CHANGE" && !d.capBlocked && d.delta !== null && !!d.incumbent?.expected);
  const rel = ch2.map((d) => (d.delta as number) / (d.incumbent!.expected as number));
  const seSide = ch2.filter((d) => d.threshold !== null && (d.threshold as number) > 0.03 * (d.incumbent!.expected as number) * 1.0001).length;
  const cnt = (f: (x: number) => boolean) => rel.filter(f).length;
  out += `| ${code} | ${run.week_start}·${String(run.created_at).slice(0, 10)} | ${ch2.length} | ${seSide} | ${cnt((x) => x < 0.1)} | ${cnt((x) => x < 0.2)} | ${cnt((x) => x < 0.3)} | ${cnt((x) => x >= 0.3)} |\n`;
}
console.log(out);
