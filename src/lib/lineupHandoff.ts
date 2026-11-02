// 월간 리뷰 "이어받기(라인업 흐름)" 분석 — 사용자 지시(2026-11-02).
//
// 왜 필요한가: 프로그램별 기여도 분해(get_channel_monthly_program_drivers)는 "신병4 사보타주가 본방을
// 끝내고 재방으로 돌아 시청률이 줄었다"를 그대로 하락 요인으로 적었다. 하지만 편성 PD가 봐야 할 실체는
// "신병4 본방 자리를 이어받은 연애박사가 그만큼 제몫을 못 했다"는 것이다. 또 "내아이의사생활 스페셜이
// 빠졌다(0회)", "쯔양몇끼 4회" 같은 단발성 편성 변화가 프라임 등락 1위로 잡혔다.
//
// 그래서 프로그램이 아니라 "자리(요일 × 시작 시각 슬롯)"를 단위로 본다.
//   1) 채널의 편성시간 가중 평균 시청률 변화를 슬롯별 몫으로 항등 분해한다
//      c(s) = 이번 기간 (슬롯 시청률×분)/전체 분 − 직전 기간 같은 값. Σc(s) = 채널 가중 평균 변화.
//   2) 하락은 슬롯을 "직전 기간 주 점유 프로그램"으로 묶는다 — 그 프로그램이 지키던 자리가 얼마나
//      빠졌고, 그 자리를 누가 이어받았는지(후속작)를 함께 낸다.
//   3) 상승은 "이번 기간 주 점유 프로그램"으로 묶는다 — 누가 어느 자리에 들어가 끌어올렸는지.
//   4) 묶음 안에서 가장 크게 움직인 같은 짝(직전→현재)의 슬롯들을 "핵심 슬롯"으로 잡아, 그 자리의
//      성·연령별(수도권 남·여 20/30/40대) 시청률 유지율을 낸다 — 어떤 시청자층이 얼마나 빠졌는지.
//   5) 프라임 시간대 상승/하락도 같은 슬롯 단위로 본다. 직전·이번 기간 모두 그 자리에 2회 이상
//      편성된 경우만 후보로 삼아 1~2회 특집·단발 편성이 "주요 등락"으로 잡히지 않게 한다.
//
// 수치는 전부 DB 원본 방영 행(닐슨 일일)에서 결정적으로 계산한다 — LLM·화면은 계산하지 않는다.
// (원본 행을 서버 순수 함수로 읽는 방식은 콘텐츠 적합도(src/lib/contentFit)와 같은 예외 패턴.)
import { supabase } from "@/lib/supabase";
import { isWeekendIsoDow, PRIME } from "@/lib/audienceReport/primeTime";

export interface HandoffAiring {
  programName: string;
  targetLabel: string;
  date: string;
  startTime: string;
  endTime: string;
  rating: number;
  firstRun: boolean;
}

export interface DemoRetention {
  label: string; // "남40대" 등 짧은 표기
  prior: number;
  current: number;
  retentionPct: number | null; // 직전 값이 너무 작으면(노이즈) null
  delta: number;
}

export interface KeySlot {
  dows: number[]; // isodow 1=월 … 7=일
  hours: number[]; // 방송 시간 2~25
  // true면 한두 자리가 아니라 여러 시간대(주로 재방)에 흩어진 변화 — 화면은 요일·시각 대신 "N개 시간대"로 쓴다.
  dispersed: boolean;
  slotCount: number;
  // dispersed일 때는 슬롯마다 주 점유 프로그램이 다를 수 있어 첫(가장 큰) 슬롯 기준 이름이다.
  // 그래서 맞은편(하락이면 이어받은 쪽, 상승이면 내준 쪽) 상위 이름을 편성 분량 순으로 따로 둔다(최대 2개).
  counterparts: string[];
  priorProgram: string | null;
  currentProgram: string | null;
  priorAvg: number | null;
  currentAvg: number | null;
  priorFirstRun: boolean;
  currentFirstRun: boolean;
  priorAirings: number;
  currentAirings: number;
}

export interface LineupShift {
  // 하락: 직전 점유 프로그램(그 자리를 지키던 프로그램) / 상승: 이번 점유 프로그램(끌어올린 프로그램)
  anchorProgram: string;
  // 이어받기 성격 — handoff: 다른 프로그램이 자리를 이어받음, self: 같은 프로그램 자체 등락,
  // vacated: 자리가 비거나 편성 축소, added: 직전 기간엔 비어 있던 자리에 새로 편성
  mode: "handoff" | "self" | "vacated" | "added";
  contributionDelta: number;
  keySlot: KeySlot;
  demos: DemoRetention[];
}

export interface LineupShiftResult {
  decline: LineupShift | null;
  rise: LineupShift | null;
  primeUp: LineupShift | null;
  primeDown: LineupShift | null;
}

// 수도권 2049 채널의 성·연령 세부 타깃(DB targets.label 그대로). 가구 KPI 채널은 세부 타깃 행이 없어 쓰지 않는다.
export const METRO_DEMO_LABELS = ["수도권 남20대", "수도권 남30대", "수도권 남40대", "수도권 여20대", "수도권 여30대", "수도권 여40대"] as const;
// 유지율을 계산할 최소 직전 시청률 — 이 프로젝트 전역 노이즈 바닥(0.05)과 같은 눈금.
const DEMO_RETENTION_FLOOR = 0.05;
// 핵심 슬롯: 묶음 안 최대 슬롯 몫의 30% 이상인 같은 짝 슬롯만 함께 묶는다(작은 자투리 슬롯이 평균을 흐리지 않게).
const KEY_SLOT_SHARE = 0.3;
const DISPERSED_SHARE = 0.4;
// 프라임 등락 후보 — 직전·이번 기간 모두 그 자리에 최소 이만큼 편성됐어야 한다(월간 기본값).
// 주간은 한 자리가 주 1회뿐이라 호출부가 1을 넘긴다(그래도 양쪽 주 모두 편성 + 채널 평균 2% 문턱은 유지).
const MIN_PRIME_SLOT_AIRINGS = 2;
// 채널 가중 평균 대비 이 비율 미만의 움직임은 "주요 등락"으로 올리지 않는다.
const MATERIALITY_RATIO = 0.02;
// 성·연령 유지율은 그 자리 KPI 시청률이 이 값 이상일 때만 낸다 — 0.05 바닥의 두 배. 시청률이 아주 낮은
// 자리(ENA Play 재방 등)는 세부 타깃 값이 0과 0.07 사이를 오가 유지율이 0%·300%로 튀기 때문.
const DEMO_SLOT_FLOOR = 0.1;

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
const durationOf = (a: HandoffAiring) => {
  let d = toMin(a.endTime) - toMin(a.startTime);
  if (d <= 0) d += 1440;
  return d;
};
const isoDowOf = (date: string) => {
  const x = new Date(`${date}T00:00:00`).getDay();
  return x === 0 ? 7 : x;
};
// 방송 시간 2~25 정규화(primeTime.ts 관례).
const broadcastHourOf = (t: string) => {
  const h = Math.floor(toMin(t) / 60) % 24;
  return h < 2 ? h + 24 : h;
};
const isPrimeSlot = (dow: number, hour: number) =>
  isWeekendIsoDow(dow) ? hour >= PRIME.weekendFrom && hour < PRIME.weekendTo : hour >= PRIME.weekdayFrom && hour < PRIME.weekdayTo;

interface ProgAcc {
  minutes: number;
  ratingMinutes: number;
  firstRunMinutes: number;
  airings: number;
}
interface SideAcc {
  minutes: number;
  ratingMinutes: number;
  progs: Map<string, ProgAcc>;
  demo: Map<string, { minutes: number; ratingMinutes: number }>;
}
interface Slot {
  key: string;
  dow: number;
  hour: number;
  prior: SideAcc;
  current: SideAcc;
  contribution: number;
  priorMain: string | null;
  currentMain: string | null;
}

const emptySide = (): SideAcc => ({ minutes: 0, ratingMinutes: 0, progs: new Map(), demo: new Map() });
const mainOf = (side: SideAcc) => [...side.progs.entries()].sort((a, b) => b[1].minutes - a[1].minutes)[0]?.[0] ?? null;

/** 순수 함수 — 두 기간의 방영 행으로 이어받기 기준 상승·하락·프라임 등락을 고른다. */
export function analyzeLineupShifts(
  prior: HandoffAiring[],
  current: HandoffAiring[],
  kpiLabel: string,
  demoLabels: readonly string[],
  minPrimeSlotAirings: number = MIN_PRIME_SLOT_AIRINGS
): LineupShiftResult {
  const slots = new Map<string, Slot>();
  // 요일별 실제 방송 날짜 수 — 9월은 수요일 5번, 10월은 4번처럼 달력 차이가 있어 그대로 합하면 같은 자리가
  // 시청률이 올라도 "몫이 줄었다"로 잡힌다(실측: 나는SOLO 수 22시 1.58→1.75인데 하락으로 계산됨). 슬롯 값을
  // 그 요일 날짜 수로 나눠 "한 주 편성표" 기준으로 맞춘다.
  const datesByDow = { prior: new Map<number, Set<string>>(), current: new Map<number, Set<string>>() };
  const add = (rows: HandoffAiring[], side: "prior" | "current") => {
    for (const r of rows) {
      const dow = isoDowOf(r.date);
      if (r.targetLabel === kpiLabel) {
        const set = datesByDow[side].get(dow) ?? new Set<string>();
        set.add(r.date);
        datesByDow[side].set(dow, set);
      }
      const hour = broadcastHourOf(r.startTime);
      const key = `${dow}|${hour}`;
      let s = slots.get(key);
      if (!s) {
        s = { key, dow, hour, prior: emptySide(), current: emptySide(), contribution: 0, priorMain: null, currentMain: null };
        slots.set(key, s);
      }
      const d = durationOf(r);
      const acc = s[side];
      if (r.targetLabel === kpiLabel) {
        acc.minutes += d;
        acc.ratingMinutes += r.rating * d;
        const p = acc.progs.get(r.programName) ?? { minutes: 0, ratingMinutes: 0, firstRunMinutes: 0, airings: 0 };
        p.minutes += d;
        p.ratingMinutes += r.rating * d;
        p.airings += 1;
        if (r.firstRun) p.firstRunMinutes += d;
        acc.progs.set(r.programName, p);
      } else if (demoLabels.includes(r.targetLabel)) {
        const dm = acc.demo.get(r.targetLabel) ?? { minutes: 0, ratingMinutes: 0 };
        dm.minutes += d;
        dm.ratingMinutes += r.rating * d;
        acc.demo.set(r.targetLabel, dm);
      }
    }
  };
  add(prior, "prior");
  add(current, "current");
  const perWeek = (side: "prior" | "current", s: Slot) => 1 / (datesByDow[side].get(s.dow)?.size || 1);
  const totals = { prior: 0, current: 0 };
  let priorRatingMinutes = 0;
  for (const s of slots.values()) {
    totals.prior += s.prior.minutes * perWeek("prior", s);
    totals.current += s.current.minutes * perWeek("current", s);
    priorRatingMinutes += s.prior.ratingMinutes * perWeek("prior", s);
  }
  if (totals.prior === 0 || totals.current === 0) return { decline: null, rise: null, primeUp: null, primeDown: null };

  for (const s of slots.values()) {
    s.contribution = (s.current.ratingMinutes * perWeek("current", s)) / totals.current - (s.prior.ratingMinutes * perWeek("prior", s)) / totals.prior;
    s.priorMain = mainOf(s.prior);
    s.currentMain = mainOf(s.current);
  }
  const materiality = (priorRatingMinutes / totals.prior) * MATERIALITY_RATIO;
  const all = [...slots.values()];

  // 프로그램 묶음은 "그 프로그램이 떠난 자리 + 새로 들어간 자리"를 함께 합한 순변화로 고른다 — 재방이 매주
  // 시간대를 옮겨 다니면 떠난 자리만 보면 하락, 새 자리만 보면 상승으로 같은 프로그램이 양쪽에 잡힌다(실측:
  // 10/26주 OLIFE 세계테마기행이 하락 −0.009·상승 +0.017로 동시에 뽑힘). 대표 슬롯은 하락이면 그 프로그램이
  // 지키던 자리, 상승이면 그 프로그램이 들어간 자리에서만 고른다.
  const family = (s: Slot) => [...new Set([s.priorMain, s.currentMain].filter((x): x is string => !!x))];
  const decline = pickGroup(all, family, "priorMain", -1, materiality, demoLabels);
  const rise = pickGroup(all, family, "currentMain", 1, materiality, demoLabels);

  // 프라임 등락 — 같은 (직전→현재) 짝의 프라임 슬롯을 묶는다. 양쪽 모두 그 자리에 2회 이상 편성된 슬롯만.
  // 이미 상승 견인/하락 요인으로 짚은 짝은 같은 말을 두 번 하지 않도록 뺀다.
  const used = new Set([decline, rise].filter((x): x is LineupShift => !!x).map((x) => `${x.keySlot.priorProgram}→${x.keySlot.currentProgram}`));
  const primeSlots = all.filter((s) => {
    if (!isPrimeSlot(s.dow, s.hour) || !s.priorMain || !s.currentMain) return false;
    const pa = s.prior.progs.get(s.priorMain)?.airings ?? 0;
    const ca = s.current.progs.get(s.currentMain)?.airings ?? 0;
    return pa >= minPrimeSlotAirings && ca >= minPrimeSlotAirings && !used.has(`${s.priorMain}→${s.currentMain}`);
  });
  const pairKey = (s: Slot) => [`${s.priorMain}→${s.currentMain}`];
  const primeDown = pickGroup(primeSlots, pairKey, null, -1, materiality, demoLabels);
  const primeUp = pickGroup(primeSlots, pairKey, null, 1, materiality, demoLabels);
  return { decline, rise, primeUp, primeDown };
}

function pickGroup(
  slots: Slot[],
  keysOf: (s: Slot) => string[],
  anchorSide: "priorMain" | "currentMain" | null,
  sign: 1 | -1,
  materiality: number,
  demoLabels: readonly string[]
): LineupShift | null {
  const groups = new Map<string, Slot[]>();
  for (const s of slots) {
    for (const k of keysOf(s)) {
      const arr = groups.get(k) ?? [];
      arr.push(s);
      groups.set(k, arr);
    }
  }
  let best: { name: string; slots: Slot[]; sum: number } | null = null;
  for (const [name, arr] of groups) {
    if (anchorSide && !arr.some((s) => s[anchorSide] === name)) continue;
    const sum = arr.reduce((a, s) => a + s.contribution, 0);
    if (sum * sign <= 0) continue;
    if (!best || sum * sign > best.sum * sign) best = { name, slots: arr, sum };
  }
  if (!best || Math.abs(best.sum) < materiality) return null;
  const bestName = best.name;

  // 핵심 슬롯 — 방향이 같은 가장 큰 슬롯과 같은 (직전→현재) 짝이면서 그 몫의 30% 이상인 슬롯들.
  // 그 자리 시청률 자체가 같은 방향으로 움직인 슬롯만(편성 분량만 바뀌고 시청률은 반대로 간 슬롯은 제외).
  const avgMovedWith = (s: Slot) => {
    const pa = s.prior.minutes > 0 ? s.prior.ratingMinutes / s.prior.minutes : 0;
    const ca = s.current.minutes > 0 ? s.current.ratingMinutes / s.current.minutes : 0;
    return (ca - pa) * sign > 0;
  };
  // 시작 시각이 10분만 밀려도 다른 시각 슬롯이 되어 한쪽이 빈 자리가 생긴다 — 대표 슬롯은 양쪽 기간 모두
  // 편성이 있는 자리를 먼저 쓰고, 그런 자리가 없을 때만 한쪽이 빈 자리를 쓴다.
  const anchored = [...best.slots].filter((s) => !anchorSide || s[anchorSide] === bestName).filter(avgMovedWith);
  const bothSided = anchored.filter((s) => s.priorMain && s.currentMain);
  const ordered = (bothSided.length > 0 ? bothSided : anchored).sort((a, b) => (b.contribution - a.contribution) * sign);
  const top = ordered[0];
  if (!top || top.contribution * sign <= 0) return null;
  const key = ordered.filter(
    (s) =>
      s.priorMain === top.priorMain &&
      s.currentMain === top.currentMain &&
      s.contribution * sign > 0 &&
      Math.abs(s.contribution) >= Math.abs(top.contribution) * KEY_SLOT_SHARE
  );
  // 한두 자리에 몰린 변화가 아니라 재방 여러 시간대에 흩어진 변화면(핵심 슬롯 몫이 묶음 전체의 40% 미만),
  // 새벽 한 슬롯 같은 자투리를 대표로 내세우지 않고 같은 방향으로 움직인 묶음 전체를 요약한다.
  const keyShare = key.reduce((a, s) => a + s.contribution, 0) / best.sum;
  const dispersed = keyShare < DISPERSED_SHARE;
  if (dispersed) {
    key.length = 0;
    key.push(...ordered.filter((s) => s.contribution * sign > 0));
  }
  const keySlot = summarizeKeySlot(key, dispersed, sign < 0 ? "current" : "prior");
  const demoBase = sign < 0 ? keySlot.priorAvg : Math.max(keySlot.priorAvg ?? 0, keySlot.currentAvg ?? 0);
  const anchorProgram = anchorSide ? bestName : sign < 0 ? (top.priorMain as string) : (top.currentMain as string);
  const mode: LineupShift["mode"] =
    !keySlot.currentProgram || keySlot.currentAirings === 0
      ? "vacated"
      : !keySlot.priorProgram || keySlot.priorAirings === 0
        ? "added"
        : keySlot.priorProgram === keySlot.currentProgram
          ? "self"
          : "handoff";
  const demos = demoBase !== null && demoBase >= DEMO_SLOT_FLOOR ? demoRetention(key, demoLabels) : [];
  return { anchorProgram, mode, contributionDelta: best.sum, keySlot, demos };
}

function summarizeKeySlot(key: Slot[], dispersed: boolean, counterSide: "prior" | "current"): KeySlot {
  const priorProgram = key[0]?.priorMain ?? null;
  const currentProgram = key[0]?.currentMain ?? null;
  const anchor = counterSide === "current" ? priorProgram : currentProgram;
  const counterMinutes = new Map<string, number>();
  for (const s of key) for (const [name, p] of s[counterSide].progs) if (name !== anchor) counterMinutes.set(name, (counterMinutes.get(name) ?? 0) + p.minutes);
  const counterparts = [...counterMinutes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  let pm = 0, prm = 0, cm = 0, crm = 0, pfr = 0, cfr = 0, pa = 0, ca = 0;
  for (const s of key) {
    pm += s.prior.minutes;
    prm += s.prior.ratingMinutes;
    cm += s.current.minutes;
    crm += s.current.ratingMinutes;
    const pp = priorProgram ? s.prior.progs.get(priorProgram) : undefined;
    const cp = currentProgram ? s.current.progs.get(currentProgram) : undefined;
    pfr += pp?.firstRunMinutes ?? 0;
    cfr += cp?.firstRunMinutes ?? 0;
    pa += pp?.airings ?? 0;
    ca += cp?.airings ?? 0;
  }
  return {
    dows: [...new Set(key.map((s) => s.dow))].sort((a, b) => a - b),
    hours: [...new Set(key.map((s) => s.hour))].sort((a, b) => a - b),
    dispersed,
    slotCount: key.length,
    counterparts,
    priorProgram,
    currentProgram,
    priorAvg: pm > 0 ? prm / pm : null,
    currentAvg: cm > 0 ? crm / cm : null,
    // 그 자리 편성의 절반 이상이 본방일 때만 "본방"으로 부른다.
    priorFirstRun: pm > 0 && pfr / pm >= 0.5,
    currentFirstRun: cm > 0 && cfr / cm >= 0.5,
    priorAirings: pa,
    currentAirings: ca,
  };
}

function demoRetention(key: Slot[], demoLabels: readonly string[]): DemoRetention[] {
  const out: DemoRetention[] = [];
  for (const label of demoLabels) {
    let pm = 0, prm = 0, cm = 0, crm = 0;
    for (const s of key) {
      const p = s.prior.demo.get(label);
      const c = s.current.demo.get(label);
      if (p) { pm += p.minutes; prm += p.ratingMinutes; }
      if (c) { cm += c.minutes; crm += c.ratingMinutes; }
    }
    if (pm === 0 || cm === 0) continue;
    const prior = prm / pm;
    const current = crm / cm;
    out.push({
      label: label.replace(/^수도권\s*/, ""),
      prior,
      current,
      retentionPct: prior >= DEMO_RETENTION_FLOOR ? (current / prior) * 100 : null,
      delta: current - prior,
    });
  }
  return out;
}

const PAGE = 1000;

/** DB에서 두 기간의 프로그램 방영 행(KPI 타깃 + 세부 타깃)을 읽어 분석한다. 읽기 전용. */
export async function loadLineupShifts(params: {
  channelId: string;
  kpiLabel: string;
  dateFrom: string;
  dateTo: string;
  priorDateFrom: string;
  priorDateTo: string;
  minPrimeSlotAirings?: number;
}): Promise<LineupShiftResult | null> {
  const { channelId, kpiLabel, dateFrom, dateTo, priorDateFrom, priorDateTo, minPrimeSlotAirings } = params;
  const demoLabels = kpiLabel.startsWith("수도권") ? METRO_DEMO_LABELS : [];
  const labels = [kpiLabel, ...demoLabels];
  const [{ data: targetRows }, { data: programRows }] = await Promise.all([
    supabase.from("targets").select("id, label").in("label", labels),
    supabase.from("programs").select("id, canonical_name").eq("channel_id", channelId),
  ]);
  const labelById = new Map(((targetRows ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));
  if (![...labelById.values()].includes(kpiLabel)) return null;
  const nameById = new Map(((programRows ?? []) as { id: string; canonical_name: string }[]).map((p) => [p.id, p.canonical_name]));

  type Raw = { program_id: string; target_id: string; broadcast_date: string; start_time: string | null; end_time: string | null; rating: number | null; is_first_run: boolean | null };
  const rows: Raw[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from("ratings")
      .select("program_id, target_id, broadcast_date, start_time, end_time, rating, is_first_run")
      .eq("channel_id", channelId)
      .eq("source_type", "nielsen_daily")
      .not("program_id", "is", null)
      .in("target_id", [...labelById.keys()])
      .gte("broadcast_date", priorDateFrom)
      .lte("broadcast_date", dateTo)
      .order("id")
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Raw[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const toAiring = (r: Raw): HandoffAiring | null => {
    const name = nameById.get(r.program_id);
    const label = labelById.get(r.target_id);
    if (!name || !label || r.rating === null || !r.start_time || !r.end_time) return null;
    return { programName: name, targetLabel: label, date: r.broadcast_date, startTime: r.start_time, endTime: r.end_time, rating: Number(r.rating), firstRun: !!r.is_first_run };
  };
  const prior: HandoffAiring[] = [];
  const current: HandoffAiring[] = [];
  for (const r of rows) {
    const a = toAiring(r);
    if (!a) continue;
    if (a.date >= dateFrom && a.date <= dateTo) current.push(a);
    else if (a.date >= priorDateFrom && a.date <= priorDateTo) prior.push(a);
  }
  return analyzeLineupShifts(prior, current, kpiLabel, demoLabels, minPrimeSlotAirings);
}
