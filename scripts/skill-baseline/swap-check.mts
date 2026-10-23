// 읽기 전용 — 과거 실제 편성 변경에서 "모델이 예상한 변화"와 "바뀐 뒤 실제 변화"를 견준다(2026-10-23, 사용자 지시).
// AI 편성의 교체·이동 판단(기대값 차이)이 실제로 맞았는지, PD식 단순 규칙보다 나은지를 본다. 화면·판정·DB는 바꾸지 않는다.
//
// 미리 정한 것(결과를 보기 전에 고정, 사후에 규칙을 고르지 않는다):
//  · 사건: 운영 홈 근거와 같은 정의(src/lib/dashboard/changeHistory.ts detectPastChanges) — 교체(같은 요일·시 자리의 프로그램이 X→Y,
//    전후 각 4회 이상) / 이동(한 프로그램의 매주 자리 A가 사라지고 B가 생겨 전후 3주 이상 유지). 공휴일 방영은 사건 탐지·실적에서 뺀다.
//  · 마감: 변경 첫날 D 기준 D − 1 − 7일까지의 자료만(실제 편성 작업 시점, OPT02·SKILL_BASELINE과 같은 규칙). 학습 자료 8주 미만인 사건은 뺀다.
//  · 모델: 운영 기대값(buildFeatureSet + featureOptionsFor, 지금 채널 설정 그대로).
//      교체 = E(Y, 그 자리) ÷ E(X, 그 자리) − 1, 이동 = E(P, 새 자리 B) ÷ E(P, 옛 자리 A) − 1. 방영 유형은 실제 방영 행의 것을 쓴다.
//  · 실제 변화(주 지표): 바뀐 뒤 처음 최대 6회 평균 ÷ 바뀌기 전 마지막 최대 6회 평균 − 1(모델이 기대값=평균을 내므로 평균끼리).
//    보조: 운영 홈 문구와 같은 중앙값 비, 채널 전체 흐름 보정(같은 두 기간 채널 평균의 비로 나눔).
//  · 단순 규칙: R0 "바꿔도 그대로"(예상 변화 0), R1 교체 = Y 최근 4회 평균 ÷ X 최근 4회 평균 − 1(자리 무관, 그 프로그램 평소 성적),
//    이동 = B 자리 최근 4회 평균 ÷ A 자리 최근 4회 평균 − 1(자리 차이만큼). R1은 근거가 없으면(신규 등) R0으로 둔다.
//  · 지표: 로그 비 오차 |ln((1+예상)) − ln((1+실제))|의 평균(0 방지: 분자·분모에 채널 평균의 5%를 더함), 모델÷규칙과 사건 복원 추출 95% 구간,
//    방향 적중(실제 ±10% 이상 움직인 사건에서 부호 일치), "모델이 +10% 이상 오른다고 본 사건" 중 실제 오름·비슷·내림 비율, 순위 상관(스피어만).
// 한계: 사건은 PD가 고른 변경이라 AI가 추천한 교체가 아니다(채택 기록 0건). 실제 변화에는 회차·계절·경쟁이 섞여 있다.
// 사용: npx tsx --env-file=.env scripts/skill-baseline/swap-check.mts [채널...]   원자료는 .cache/skill-baseline/airings-<채널>.json에 둔다(커밋·외부 전송 금지).
import fs from "node:fs";
import { supabase } from "../../src/lib/supabase";
import { loadChannelRef } from "../../src/lib/idealSchedule/dataSource";
import { loadIdealScheduleConfig } from "../../src/lib/idealSchedule/configStore";
import { featureOptionsFor } from "../../src/lib/idealSchedule/engine";
import { targetLabelsToFetch, mapOwnAirings } from "../../src/lib/idealSchedule/mapping";
import { loadGenreMap } from "../../src/lib/idealSchedule/genreStore";
import { resolveGenre } from "../../src/lib/idealSchedule/genreRules";
import { addDays, hourBucket } from "../../src/lib/idealSchedule/time";
import { buildFeatureSet, type FeatureSet } from "../../src/lib/idealSchedule/features";
import type { OwnAiring, OwnAiringsBundle } from "../../src/lib/idealSchedule/types";
import { detectPastChanges, type PastChange } from "../../src/lib/dashboard/changeHistory";

const CHANNELS = process.argv.slice(2).length ? process.argv.slice(2) : ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"];
const AS_OF = "2026-10-21";
const LEAD = 7;
const SEG = 6;
const BAND = 0.1;
const CACHE = ".cache/skill-baseline";
const CHUNKS: [string, number][] = [["2025-06-30", 200], ["2026-01-15", 200], ["2026-08-03", 200], [AS_OF, 79]];
fs.mkdirSync(CACHE, { recursive: true });
const genreMap = await loadGenreMap();

type A = OwnAiring;
const val = (a: A) => (a.kpi.r === null || !Number.isFinite(a.kpi.r) ? null : a.kpi.r);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const slotKey = (a: { dow: number; startMin: number }) => `${a.dow}|${Math.floor(a.startMin / 60)}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const f2 = (x: number) => x.toFixed(2);

async function loadBundle(code: string): Promise<OwnAiringsBundle> {
  const file = `${CACHE}/airings-${code}.json`;
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const labels = targetLabelsToFetch(config, channel.kpiLabel, null);
  const hol = new Set<string>(), dates = new Set<string>(), raw = new Map<string, unknown>();
  let kpi = channel.kpiLabel;
  for (const [asOf, days] of CHUNKS) {
    const { data, error } = await supabase.rpc("get_ideal_schedule_own_airings", { p_channel_code: channel.code, p_as_of_date: asOf, p_lookback_days: days, p_target_labels: labels });
    if (error) throw new Error(`${code} ${asOf}: ${error.message}`);
    const r = data as { kpi_label: string; holidays: string[]; dates_with_data: string[]; airings: { date: string; start: string; program_id: string }[] };
    kpi = r.kpi_label;
    r.holidays.forEach((h) => hol.add(h));
    r.dates_with_data.forEach((d) => dates.add(d));
    for (const a of r.airings) raw.set(`${a.date}|${a.start}|${a.program_id}`, a);
  }
  const ds = [...dates].sort();
  const bundle = mapOwnAirings({ channel_code: channel.code, kpi_label: kpi, date_from: ds[0], date_to: AS_OF, holidays: [...hol], dates_with_data: ds, airings: [...raw.values()] } as never) as OwnAiringsBundle;
  fs.writeFileSync(file, JSON.stringify(bundle));
  return bundle;
}

// cluster = 한 편성 결정(교체: X→Y 쌍, 이동: 프로그램+변경 주). 드라마처럼 여러 자리가 함께 바뀌면 사건이 여러 개로 잡히므로 구간은 결정 단위로 복원 추출한다.
type Ev = { ch: string; cluster: string; kind: PastChange["kind"]; date: string; newY: boolean; model: number; r1: number | null; actual: number; actualMed: number; actualAdj: number; name: string };

function bootRatio(errA: number[], errB: number[], clusters: string[], iters = 1000): [number, number] {
  const ids = [...new Set(clusters)];
  const members = ids.map((id) => clusters.flatMap((c, i) => (c === id ? [i] : [])));
  const n = ids.length;
  const rs: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < iters; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < n; j++) for (const k of members[Math.floor(rnd() * n)]) { a += errA[k]; b += errB[k]; }
    rs.push(b > 0 ? a / b : 1);
  }
  rs.sort((x, y) => x - y);
  return [rs[Math.floor(iters * 0.025)], rs[Math.floor(iters * 0.975)]];
}
const rank = (v: number[]) => { const idx = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); idx.forEach(([, i], k) => (r[i] = k)); return r as number[]; };
function spearman(x: number[], y: number[]) {
  const rx = rank(x), ry = rank(y), n = x.length;
  const mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

const all: Ev[] = [];
for (const code of CHANNELS) {
  const t0 = Date.now();
  const bundle = await loadBundle(code);
  const channel = await loadChannelRef(code);
  const config = await loadIdealScheduleConfig(channel.id);
  const genreOf = (n: string) => resolveGenre(genreMap, "OWN", code, n);
  const airings = bundle.airings.filter((a) => !a.isHoliday && val(a) !== null).sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : p.startMin - q.startMin));
  const chMeanAll = mean(airings.map((a) => val(a) as number)) ?? 0;
  const eps = chMeanAll * 0.05;
  const hist = airings.map((a) => ({ date: a.date, dow: a.dow, startMin: a.startMin, key: a.programId, rating: val(a) as number }));
  const minDate = addDays(bundle.dateFrom, 8 * 7 + LEAD + 1);
  const events = detectPastChanges(hist, AS_OF).filter((c) => c.date >= minDate && c.detail);
  const fsCache = new Map<string, FeatureSet>();
  const fsAt = (asOf: string) => {
    let f = fsCache.get(asOf);
    if (!f) {
      const train = bundle.airings.filter((a) => a.date <= asOf);
      const tb = { ...bundle, dateTo: asOf, airings: train, datesWithData: bundle.datesWithData.filter((d) => d <= asOf) };
      f = buildFeatureSet(tb, featureOptionsFor(config, bundle.kpiLabel, asOf), genreOf);
      fsCache.set(asOf, f);
    }
    return f;
  };
  const inSlot = (key: string, slot: string) => airings.filter((a) => a.programId === key && slotKey(a) === slot).sort((p, q) => (p.date < q.date ? -1 : 1));
  const chMeanBetween = (from: string, to: string) => mean(airings.filter((a) => a.date >= from && a.date <= to).map((a) => val(a) as number));
  const nameOf = new Map(airings.map((a) => [a.programId, a.programName]));
  let used = 0;
  for (const ev of events) {
    const d = ev.detail!;
    const asOf = addDays(ev.date, -1 - LEAD);
    const fset = fsAt(asOf);
    const exp = (pid: string, a: A) => fset.rating.expected(pid, a.airingType, genreOf(a.programName), a.dow, hourBucket(a.startMin)).expected;
    // 전후 방영 행(실제 변화 계산용)
    let before: A[], after: A[];
    if (ev.kind === "replace") {
      before = inSlot(d.prevKey!, d.from).filter((a) => a.date < ev.date).slice(-SEG);
      after = inSlot(d.key, d.to).filter((a) => a.date >= ev.date).slice(0, SEG);
    } else {
      before = inSlot(d.key, d.from).filter((a) => a.date < ev.date).slice(-SEG);
      after = inSlot(d.key, d.to).filter((a) => a.date >= ev.date).slice(0, SEG);
    }
    if (before.length < 3 || after.length < 3) continue;
    const bm = mean(before.map((a) => val(a) as number))!, am = mean(after.map((a) => val(a) as number))!;
    // 모델: 바뀐 뒤 방영 자리에서 새 것(Y 또는 옮긴 P) vs 그대로 뒀을 때(X는 그 자리, P는 옛 자리) — 같은 방영 유형·요일·시로
    let mNew: number | null, mKeep: number | null;
    if (ev.kind === "replace") {
      const xType = before.at(-1)!;
      mNew = mean(after.map((a) => exp(d.key, a)).filter((x): x is number => x !== null));
      mKeep = mean(after.map((a) => exp(d.prevKey!, { ...a, airingType: xType.airingType, programName: xType.programName })).filter((x): x is number => x !== null));
    } else {
      const bRef = before.at(-1)!;
      mNew = mean(after.map((a) => exp(d.key, a)).filter((x): x is number => x !== null));
      mKeep = mean(after.map((a) => exp(d.key, { ...a, dow: bRef.dow, startMin: bRef.startMin })).filter((x): x is number => x !== null));
    }
    if (mNew === null || mKeep === null) continue;
    const train = airings.filter((a) => a.date <= asOf);
    let r1: number | null = null;
    if (ev.kind === "replace") {
      const y4 = train.filter((a) => a.programId === d.key).slice(-4).map((a) => val(a) as number);
      const x4 = train.filter((a) => a.programId === d.prevKey).slice(-4).map((a) => val(a) as number);
      if (y4.length && x4.length) r1 = (mean(y4)! + eps) / (mean(x4)! + eps) - 1;
    } else {
      const s4 = (slot: string) => train.filter((a) => slotKey(a) === slot).slice(-4).map((a) => val(a) as number);
      const b4 = s4(d.to), a4 = s4(d.from);
      if (b4.length && a4.length) r1 = (mean(b4)! + eps) / (mean(a4)! + eps) - 1;
    }
    const chB = chMeanBetween(before[0].date, before.at(-1)!.date), chA = chMeanBetween(after[0].date, after.at(-1)!.date);
    const actual = (am + eps) / (bm + eps) - 1;
    const medB = median(before.map((a) => val(a) as number))!, medA = median(after.map((a) => val(a) as number))!;
    all.push({
      ch: code, cluster: ev.kind === "replace" ? `${code}|${d.prevKey}>${d.key}` : `${code}|${d.key}|${ev.date}`, kind: ev.kind, date: ev.date, newY: ev.kind === "replace" && !train.some((a) => a.programId === d.key),
      model: (mNew + eps) / (mKeep + eps) - 1, r1, actual, actualMed: (medA + eps) / (medB + eps) - 1,
      actualAdj: chB && chA ? (1 + actual) / (chA / chB) - 1 : actual,
      name: ev.kind === "replace" ? `${nameOf.get(d.prevKey!) ?? "?"} → ${nameOf.get(d.key) ?? "?"}` : `${nameOf.get(d.key) ?? "?"} ${d.from}→${d.to}`,
    });
    used++;
  }
  console.error(`${code}: 사건 ${events.length}건 중 평가 ${used}건(${bundle.dateFrom}~), ${((Date.now() - t0) / 1000).toFixed(0)}초`);
}
fs.writeFileSync(`${CACHE}/swap-events.json`, JSON.stringify(all));

// ── 집계 ──
const L = (x: number) => Math.log(Math.max(1 + x, 1e-6));
function table(evs: Ev[], title: string, actualOf: (e: Ev) => number = (e) => e.actual) {
  if (evs.length < 8) return `\n**${title}** — 사건 ${evs.length}건(8건 미만이라 생략)\n`;
  const eM = evs.map((e) => Math.abs(L(e.model) - L(actualOf(e))));
  const e0 = evs.map((e) => Math.abs(L(actualOf(e))));
  const e1 = evs.map((e) => Math.abs(L(e.r1 ?? 0) - L(actualOf(e))));
  const cl = evs.map((e) => e.cluster);
  const [m0lo, m0hi] = bootRatio(eM, e0, cl), [m1lo, m1hi] = bootRatio(eM, e1, cl);
  const moved = evs.filter((e) => Math.abs(actualOf(e)) >= BAND);
  const hit = (p: (e: Ev) => number) => moved.length ? moved.filter((e) => Math.sign(p(e)) === Math.sign(actualOf(e)) && Math.abs(p(e)) > 1e-9).length / moved.length : 0;
  const mark = (lo: number, hi: number) => (hi < 1 ? " ▲" : lo > 1 ? " ▼" : "");
  const s = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  let md = `\n**${title}** — 사건 ${evs.length}건(편성 결정 ${new Set(cl).size}개), 실제 ±10% 넘게 움직인 사건 ${moved.length}건(${Math.round((moved.length / evs.length) * 100)}%)\n\n`;
  md += `| 예상 방법 | 로그 비 오차 평균 | 모델÷이 방법(95% 구간) | 방향 적중(움직인 사건) | 순위 상관 |\n|---|---|---|---|---|\n`;
  md += `| 모델(운영 기대값) | ${s(eM).toFixed(3)} | — | ${Math.round(hit((e) => e.model) * 100)}% | ${f2(spearman(evs.map((e) => e.model), evs.map(actualOf)))} |\n`;
  md += `| R0 바꿔도 그대로(0) | ${s(e0).toFixed(3)} | ${f2(s(eM) / s(e0))} (${f2(m0lo)}~${f2(m0hi)})${mark(m0lo, m0hi)} | — | — |\n`;
  md += `| R1 ${evs[0].kind === "replace" ? "프로그램 평소 성적 비" : "자리 평균 차이"} | ${s(e1).toFixed(3)} | ${f2(s(eM) / s(e1))} (${f2(m1lo)}~${f2(m1hi)})${mark(m1lo, m1hi)} | ${Math.round(hit((e) => e.r1 ?? 0) * 100)}% | ${f2(spearman(evs.map((e) => e.r1 ?? 0), evs.map(actualOf)))} |\n`;
  const calls = (p: (e: Ev) => number, lab: string) => {
    const g = [["+10% 이상 오른다", (x: number) => x >= BAND], ["±10% 안", (x: number) => Math.abs(x) < BAND], ["−10% 이상 내린다", (x: number) => x <= -BAND]] as const;
    return g.map(([gl, f]) => { const xs = evs.filter((e) => f(p(e))); const up = xs.filter((e) => actualOf(e) >= BAND).length, dn = xs.filter((e) => actualOf(e) <= -BAND).length; return `| ${lab} | ${gl} | ${xs.length} | ${xs.length ? Math.round((up / xs.length) * 100) : 0}% | ${xs.length ? Math.round(((xs.length - up - dn) / xs.length) * 100) : 0}% | ${xs.length ? Math.round((dn / xs.length) * 100) : 0}% | ${xs.length ? pct(median(xs.map(actualOf))!) : "—"} |`; }).join("\n");
  };
  md += `\n| 누가 | 예상 | 사건 | 실제 올랐다(≥+10%) | 비슷 | 내렸다(≤−10%) | 실제 변화 중앙값 |\n|---|---|---|---|---|---|---|\n${calls((e) => e.model, "모델")}\n${calls((e) => e.r1 ?? 0, "R1")}\n`;
  md += `\n편향(로그, +는 모델이 더 오른다고 봄): 평균 ${(s(evs.map((e) => L(e.model) - L(actualOf(e))))).toFixed(3)} · 예상 변화 중앙값 ${pct(median(evs.map((e) => e.model))!)} · 실제 변화 중앙값 ${pct(median(evs.map(actualOf))!)}\n`;
  return md;
}

let out = `# 과거 편성 변경: 모델 예상 변화 vs 실제(마감 ${LEAD}일 전, 공휴일 제외)\n`;
for (const kind of ["replace", "move"] as const) {
  const evs = all.filter((e) => e.kind === kind);
  out += `\n## ${kind === "replace" ? "교체(같은 자리 X→Y)" : "이동(한 프로그램 자리 A→B)"}\n`;
  out += table(evs, "전 채널(주 지표: 평균 비)");
  out += table(evs, "보조: 중앙값 비(홈 근거 문구와 같은 정의)", (e) => e.actualMed);
  out += table(evs, "보조: 채널 전체 흐름 보정", (e) => e.actualAdj);
  if (kind === "replace") {
    out += table(evs.filter((e) => !e.newY), "Y가 이력 있는 프로그램");
    out += table(evs.filter((e) => e.newY), "Y가 신규(마감 전 방영 0회)");
  }
  out += `\n채널별 사건 수: ${CHANNELS.map((c) => `${c} ${evs.filter((e) => e.ch === c).length}`).join(" · ")}\n`;
  for (const c of CHANNELS) { const ce = evs.filter((e) => e.ch === c); if (ce.length >= 15) out += table(ce, `${c}`); }
}
console.log(out);
