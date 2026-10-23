// 읽기 전용 — 약한 자리 판정 기준선 보정·검증(2026-10-23, docs/agent-improvement/SKILL_BASELINE.md §4 제안 1).
// weakSlotRemedy와 같은 자리 정의(같은 요일·시(방송일 02시 기준)·본/재방 표시, 같은 프로그램 3회 이상이면 그 프로그램, 아니면 그 자리 전체)로
// 2025-01-01~기준일 닐슨 방영을 다시 읽어 두 규칙을 견준다.
//   · 기존: 오늘 ≤ 직전 8회 중앙값 × 0.8 이면 '낮음'
//   · 새 규칙: 최근 N회 평균(오늘 포함, N=채널 설정) < 그 앞 최대 8회 중앙값 × 채널 기준선 이면 '낮음'
// 평상시 = 판정에 쓴 방영(최근 N회 + 비교 회차)이 모두 같은 프로그램이고 정확히 7일 간격으로 이어진 경우(편성을 바꾸지 않은 자리).
// 기준선은 보정 구간(2026-04-01 전)의 평상시 비율 10%선으로 고르고, 헛경보율은 검증 구간(그 이후)에서 따로 낸다.
// 사용: npx tsx --env-file=.env scripts/skill-baseline/weak-calibrate.mts [calibrate|verify|weekly] [기준일=2026-10-21]   (weekly: 기준일 앞 WEEKS=4주의 주별 경보 수 — 4주 재판단용)
// PATTERN_FILL=1 이면 weakSlotRemedy처럼 닐슨 본/재방 표시가 없는 방영을 업로드 편성표·본방 편성 패턴(관리자 등록·네이버)으로 보완한다(2026-10-23 연결 전후 비교용).
import { supabase } from "../../src/lib/supabase";
import { loadChannelRef } from "../../src/lib/idealSchedule/dataSource";
import { isoDow } from "../../src/lib/idealSchedule/time";
import { normalizeProgramCanonicalName } from "../../src/lib/programNameMatch";
import { judgeWeakSlot, weakSlotRuleFor } from "../../src/lib/dashboard/weakSlotVerdict";
import { fillChannelRuns } from "../../src/lib/broadcastPattern/channelFill";

const mode = process.argv[2] ?? "verify";
const AS_OF = process.argv[3] ?? "2026-10-21";
const FROM = "2025-01-01";
const SPLIT = "2026-04-01";
const CHANNELS = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"];
const keyOf = (s: string) => normalizeProgramCanonicalName(s).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
const broadcastMin = (t: string) => { const [h, m] = t.split(":").map((v) => parseInt(v, 10)); return (h < 2 ? h + 24 : h) * 60 + (m || 0); };
const dn = (d: string) => Date.parse(`${d}T00:00:00Z`) / 864e5;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const q = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const pc = (x: number | null) => (x === null || !Number.isFinite(x) ? "—" : `${(100 * x).toFixed(0)}%`);

type A = { date: string; dow: number; startMin: number; key: string; rating: number; rerun: boolean };
const slotKey = (a: A) => `${a.dow}|${Math.floor(a.startMin / 60)}|${a.rerun ? "R" : "B"}`;

async function load(code: string): Promise<A[]> {
  const ch = await loadChannelRef(code);
  const { data: tg } = await supabase.from("targets").select("id").eq("code", ch.kpiLabel).maybeSingle();
  const out: A[] = [];
  const raw: { programId: string; name: string; startTime: string; firstRun: boolean | null }[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from("ratings").select("broadcast_date, start_time, rating, is_first_run, program_id, programs(canonical_name)").eq("channel_id", ch.id).eq("target_id", tg!.id).eq("source_type", "nielsen_daily").gte("broadcast_date", FROM).lte("broadcast_date", AS_OF).not("program_id", "is", null).not("rating", "is", null).order("broadcast_date").order("start_time").order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${code}: ${error.message}`);
    for (const r of (data ?? []) as unknown as { broadcast_date: string; start_time: string | null; rating: number; is_first_run: boolean | null; program_id: string; programs: { canonical_name: string } | null }[]) {
      if (!r.programs?.canonical_name || !r.start_time) continue;
      out.push({ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), key: keyOf(r.programs.canonical_name), rating: Number(r.rating), rerun: r.is_first_run === false });
      raw.push({ programId: r.program_id, name: r.programs.canonical_name, startTime: r.start_time, firstRun: r.is_first_run });
    }
    if ((data ?? []).length < 1000) break;
  }
  if (process.env.PATTERN_FILL === "1") {
    const idx = raw.flatMap((r, i) => (r.firstRun === null ? [i] : []));
    const runs = await fillChannelRuns(supabase, { channelId: ch.id, channelCode: code, rows: idx.map((i) => ({ ...raw[i], date: out[i].date })) });
    let n = 0;
    idx.forEach((i, j) => { if (runs[j].firstRun === false) { out[i].rerun = true; n++; } });
    console.error(code + ": 표시 없는 방영 " + idx.length + "건 중 편성표·패턴으로 재방 판정 " + n + "건");
  }
  return out;
}

/** 옛 비교 목록(최신순, 오늘 제외) — 같은 프로그램 3회 이상이면 그것, 아니면 자리 전체. take개까지 */
function basis(bySlot: Map<string, A[]>, a: A, take: number): A[] {
  const list = (bySlot.get(slotKey(a)) ?? []).filter((x) => x.date < a.date).sort((p, r) => (p.date < r.date ? 1 : -1));
  const own = list.filter((x) => x.key === a.key);
  return (own.length >= 3 ? own : list).slice(0, take);
}
/** weakSlotRemedy.priorBasisAirings와 같은 새 목록 — 최근 창(window−1회)은 자기 방영, 비교 회차는 자기 3회 이상이면 자기, 아니면 그보다 앞선 자리 전체 */
function basisWindow(bySlot: Map<string, A[]>, a: A, window: number): A[] {
  const k = window - 1;
  const list = (bySlot.get(slotKey(a)) ?? []).filter((x) => x.date < a.date).sort((p, r) => (p.date < r.date ? 1 : -1));
  const own = list.filter((x) => x.key === a.key).slice(0, k + 8);
  if (own.length >= k + 3 || own.length < k) return own;
  const recent = own.slice(0, k);
  const before = k > 0 ? recent[k - 1].date : a.date;
  return [...recent, ...list.filter((x) => x.date < before).slice(0, 8)];
}

for (const code of CHANNELS) {
  const all = await load(code);
  const bySlot = new Map<string, A[]>();
  for (const a of all) (bySlot.get(slotKey(a)) ?? bySlot.set(slotKey(a), []).get(slotKey(a))!).push(a);
  const rule = weakSlotRuleFor(code);
  if (mode === "calibrate") {
    // 창 2·4 각각의 평상시 비율 분포(보정 구간) → 10%선
    for (const win of [1, 2, 4]) {
      const cal: number[] = [], test: number[] = [];
      for (const a of all) {
        const prior = basis(bySlot, a, win - 1 + 8);
        const recent = [a, ...prior.slice(0, win - 1)];
        const base = prior.slice(win - 1);
        if (recent.length < win || base.length < 4) continue;
        const chain = [...recent, ...base];
        if (!chain.every((x) => x.key === a.key) || !chain.every((x, i) => i === 0 || dn(chain[i - 1].date) - dn(x.date) === 7)) continue;
        const m = median(base.map((x) => x.rating));
        if (!m || m <= 0) continue;
        const r = recent.reduce((s, x) => s + x.rating, 0) / recent.length / m;
        (a.date < SPLIT ? cal : test).push(r);
      }
      const line = q(cal, 0.1);
      console.log(`${code} 창 ${win}: 보정 ${cal.length}건 10%선 ×${line?.toFixed(2)} (5%선 ×${q(cal, 0.05)?.toFixed(2)}) · 검증 ${test.length}건에서 그 선 아래 ${pc(line === null ? null : test.filter((x) => x < line).length / test.length)}`);
    }
    continue;
  }
  if (mode === "weekly") {
    // 4주 재판단용(확인 대기 1, 2026-10-23 "헛경보 10% 유지 후 4주 실제 경보로 다시 판단") — 기준일 앞 WEEKS주의 주별 '낮음' 판정 수와 그 뒤 2회도 낮았던 수
    const WEEKS = Number(process.env.WEEKS ?? 4);
    const monday = (d: string) => { const n = dn(d); return new Date((n - ((((n + 3) % 7) + 7) % 7)) * 864e5).toISOString().slice(0, 10); };
    const from = new Date((dn(monday(AS_OF)) - 7 * (WEEKS - 1)) * 864e5).toISOString().slice(0, 10);
    const byWeek = new Map<string, { n: number; low: number; stay: number; judged: number }>();
    for (const a of all) {
      if (a.date < from || a.date > AS_OF) continue;
      const v = judgeWeakSlot(a.rating, basisWindow(bySlot, a, rule.window).map((x) => x.rating), rule);
      const w = byWeek.get(monday(a.date)) ?? { n: 0, low: 0, stay: 0, judged: 0 };
      w.n++;
      if (v.status === "short_persist" || v.status === "persistent") {
        w.low++;
        const next = (bySlot.get(slotKey(a)) ?? []).filter((x) => x.date > a.date && x.key === a.key).sort((p, r) => (p.date < r.date ? -1 : 1)).slice(0, 2);
        if (next.length === 2 && v.median && v.median > 0) { w.judged++; if ((next[0].rating + next[1].rating) / 2 < v.median * rule.line) w.stay++; }
      }
      byWeek.set(monday(a.date), w);
    }
    for (const [wk, w] of [...byWeek].sort()) console.log(`| ${code} | ${wk} | ${w.n} | ${w.low} | ${w.judged ? `${w.stay}/${w.judged}` : "—"} |`);
    continue;
  }
  // verify — 기존 규칙과 새 규칙(weakSlotVerdict의 채널 설정)을 같은 방영에 적용
  const rows = { calm: { n: 0, old: 0, neu: 0 }, all: { n: 0, old: 0, neu: 0 }, oldKeep: { n: 0, k: 0 }, neuKeep: { n: 0, k: 0 } };
  const weeks = new Set<string>();
  for (const a of all) {
    if (a.date < SPLIT) continue;
    weeks.add(String(Math.floor((dn(a.date) - 3) / 7)));
    const prior8 = basis(bySlot, a, 8);
    const oldMed = median(prior8.map((x) => x.rating));
    const oldOk = prior8.length >= 3 && oldMed !== null && oldMed > 0;
    const oldLow = oldOk && a.rating <= (oldMed as number) * 0.8;
    const priorN = basisWindow(bySlot, a, rule.window);
    const v = judgeWeakSlot(a.rating, priorN.map((x) => x.rating), rule);
    const neuOk = v.status !== "hold";
    const neuLow = v.status === "short_persist" || v.status === "persistent";
    if (!oldOk && !neuOk) continue;
    // 평상시 여부: 새 규칙이 쓴 방영 전체(최근 창 + 비교)와 기존 규칙의 8회가 모두 같은 프로그램·7일 간격
    const chain = [a, ...priorN];
    const calm = chain.length >= rule.window + 4 && chain.every((x) => x.key === a.key) && chain.every((x, i) => i === 0 || dn(chain[i - 1].date) - dn(x.date) === 7);
    rows.all.n++; if (oldLow) rows.all.old++; if (neuLow) rows.all.neu++;
    if (calm) { rows.calm.n++; if (oldLow) rows.calm.old++; if (neuLow) rows.calm.neu++; }
    // 경보 뒤 실제로 낮은 수준이 이어졌나: 같은 자리 다음 2회 평균이 그 비교 중앙값의 0.8배 아래
    const next = (bySlot.get(slotKey(a)) ?? []).filter((x) => x.date > a.date && x.key === a.key).sort((p, r) => (p.date < r.date ? -1 : 1)).slice(0, 2);
    const ref = oldMed ?? v.median;
    if (next.length === 2 && ref && ref > 0) {
      const stay = (next[0].rating + next[1].rating) / 2 < ref * 0.8;
      if (oldLow) { rows.oldKeep.n++; if (stay) rows.oldKeep.k++; }
      if (neuLow) { rows.neuKeep.n++; if (stay) rows.neuKeep.k++; }
    }
  }
  const perWeek = (x: number) => (x / weeks.size).toFixed(1);
  console.log(`| ${code} | 최근 ${rule.window}회 평균 < 중앙값×${rule.line} | ${rows.calm.n} | ${pc(rows.calm.old / rows.calm.n)} | ${pc(rows.calm.neu / rows.calm.n)} | ${perWeek(rows.all.old)} → ${perWeek(rows.all.neu)} | ${pc(rows.oldKeep.k / rows.oldKeep.n)}(${rows.oldKeep.n}) → ${pc(rows.neuKeep.k / rows.neuKeep.n)}(${rows.neuKeep.n}) |`);
}
if (mode === "weekly") console.log(`\n(열: 채널 | 주 시작 | 판정한 방영 | 낮음(단기 부진·지속 부진) | 그 뒤 2회 평균도 기준선 아래 / 다음 2회가 있는 경보)`);
else if (mode !== "calibrate") console.log(`\n(검증 구간 ${SPLIT}~${AS_OF}. 열: 채널 | 새 규칙 | 평상시 사례 | 평상시 헛경보율 기존 | 새 규칙 | 주당 '낮음' 판정 수 기존 → 새 | 경보 뒤 다음 2회도 낮았던 비율 기존(건) → 새(건))`);
