// 주요 콘텐츠 리뷰 "편성 전략 점검"(사용자 지시 2026-11-19).
//
// 사용자 지시 원문 요지: "<크래시2>의 방영 4주차(12월 7일~)부터는 tvN <시그널2>와 정면승부가 예정되어 있어 그 주차부터
// 편성시간을 5분 앞당긴다. 채널 접근성이 3배 이상, IP 파워도 강한 작품과의 대결이라 자존심보다 실리. 다만 앞당기는 선택이라
// 시청자에게 제대로 전달되지 못하면 초반부에 손해를 볼 수도 있다." + "<나의 유죄인간>이 11/24에 12회로 종영하는데 경쟁력은
// 어떤지, 종영 후 시청률 추이는 어떤지, <크래시2>가 시장에서 경쟁력이 있는지, 채널 전략이 먹히는지를 기간에 맞게 리뷰".
//
// 이 파일은 순수 함수만 둔다: 계획(기간·사건·맥락)은 상수, 점검 문장은 DB에서 읽어 온 회차 값(strategyReviewFetch.ts)을 받아
// 비교·평균만 한다(원칙 1: 시청률 자체는 DB 값 그대로, 여기서는 구간 평균·증감률·시각 차이만 계산). LLM은 쓰지 않는다.

export interface StrategyRival {
  key: string;
  /** 화면 표기 */
  label: string;
  /** competitor_program_ratings.competitor_name */
  competitorName: string;
  /** program_name에 들어 있어야 하는 글자(공백 없이) */
  programPattern: string;
  /** 리뷰에서의 역할 — lead: 우리 직전 시간대의 강한 드라마, head: 정면 맞대결 */
  role: "lead" | "head";
  /** 본방 시작 시각 범위(HH:MM) — 같은 이름의 특집·스페셜(예: 티벤터뷰)을 걸러낸다 */
  startFrom: string;
  startTo: string;
}

export interface StrategyPhase {
  key: string;
  from: string; // YYYY-MM-DD(포함)
  to: string; // YYYY-MM-DD(포함)
  title: string;
  /** 이 구간에서 우리 본방의 계획 시작 시각(HH:MM) */
  plannedStart: string;
  /** 이 구간에서 무엇을 보는지(화면에 그대로) */
  focus: string;
}

export interface StrategyEvent {
  date: string;
  label: string;
}

export interface StrategyReviewPlan {
  id: string;
  channelCode: string;
  /** 우리 프로그램 canonical_name 후보(공백·문장부호 무시 비교) */
  programNames: string[];
  /** 같은 자리 전작(비교 기준) */
  predecessor: { programNames: string[]; label: string; from: string; to: string } | null;
  startDate: string;
  endDate: string;
  totalEpisodes: number;
  /** 본방으로 볼 시작 시각 범위(HH:MM) — 같은 날 재방을 걸러낸다 */
  slotFrom: string;
  slotTo: string;
  /** 본방 요일(0=일 … 6=토) — 같은 시간대의 다른 요일 재방을 걸러낸다 */
  weekdays: number[];
  /** 사용자가 밝힌 전략·배경(사용자 진술, 날짜 표기) */
  context: string[];
  rivals: StrategyRival[];
  phases: StrategyPhase[];
  events: StrategyEvent[];
}

export const STRATEGY_REVIEW_PLANS: StrategyReviewPlan[] = [
  {
    id: "crash2-2026-11",
    channelCode: "ENA",
    programNames: ["크래시2 : 분노의 도로", "크래시2"],
    predecessor: { programNames: ["연애박사"], label: "전작 <연애박사>", from: "2026-10-05", to: "2026-11-10" },
    startDate: "2026-11-16",
    endDate: "2026-12-22",
    totalEpisodes: 12,
    slotFrom: "21:30",
    slotTo: "22:30",
    weekdays: [1, 2],
    context: [
      "4주차(12/7)부터 tvN <시그널2>와 정면승부 — 채널 접근성 3배 이상·IP 파워가 강한 상대라 자존심보다 실리를 택해 본방을 5분 앞당긴다(22:00 → 21:55).",
      "앞당기는 변경이라 시청자에게 제대로 전달되지 않으면 초반부 손해 가능성이 있다(채널 판단, 2026-11-19).",
      "tvN 월화드라마 <나의 유죄인간>(20:50 시작)이 11/24 12회로 종영한다.",
    ],
    rivals: [
      { key: "guilty", label: "tvN <나의 유죄인간>", competitorName: "tvN", programPattern: "나의유죄인간", role: "lead", startFrom: "20:30", startTo: "21:30" },
      // 시그널2의 정확한 편성 시각은 아직 자료가 없어 저녁 전체(20:00~23:30)에서 찾고, 실제 겹친 시간은 회차마다 계산한다
      { key: "signal2", label: "tvN <시그널2>", competitorName: "tvN", programPattern: "시그널2", role: "head", startFrom: "20:00", startTo: "23:30" },
    ],
    phases: [
      {
        key: "A",
        from: "2026-11-16",
        to: "2026-11-24",
        title: "1~4회 · <나의 유죄인간> 방영 중(기준선)",
        plannedStart: "22:00",
        focus: "첫 주 시장 경쟁력과 기준선 — 전작 대비 출발, tvN 20:50 드라마가 끝난 직후 22시 진입 흐름",
      },
      {
        key: "B",
        from: "2026-11-25",
        to: "2026-12-06",
        title: "5~6회 · <나의 유죄인간> 종영 후, <시그널2> 전",
        plannedStart: "22:00",
        focus: "tvN 월화드라마 종영이 크래시2 추이에 준 변화(종영 전 평균 대비)와 tvN 같은 시간대 후속 편성",
      },
      {
        key: "C",
        from: "2026-12-07",
        to: "2026-12-22",
        title: "7~12회 · 21:55 조기 시작 · <시그널2> 맞대결",
        plannedStart: "21:55",
        focus: "앞당긴 시각이 실제로 반영됐는지, 맞대결 속 시청률 유지(1~6회 평균 대비), 겹친 시간과 상대 성적",
      },
    ],
    events: [
      { date: "2026-11-24", label: "tvN <나의 유죄인간> 12회 종영" },
      { date: "2026-12-07", label: "<크래시2> 21:55 시작 · tvN <시그널2> 맞대결 시작" },
      { date: "2026-12-22", label: "<크래시2> 12회 종영 — 구간별 결산" },
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// 입력(서버가 DB에서 읽어 넘기는 값)

export interface OurEpisodePoint {
  date: string;
  start: string; // HH:MM:SS
  end: string | null;
  p2049: number | null;
  household: number | null;
}

export interface RivalPoint {
  date: string;
  programName: string;
  start: string;
  end: string | null;
  rating: number | null;
  share: number | null;
}

export interface StrategyReviewInput {
  plan: StrategyReviewPlan;
  asOfDate: string;
  ours: OurEpisodePoint[]; // asOfDate까지, 본방만
  predecessor: OurEpisodePoint[];
  rivals: Record<string, RivalPoint[]>; // rival.key → 본방 회차
  /** 경쟁 채널(rival.competitorName)이 우리 본방 날짜에 20:00~23:30 사이 시작한 본방 프로그램(후속 편성 확인용) */
  rivalChannelSlot: RivalPoint[];
}

export interface StrategyReviewOutput {
  planId: string;
  phaseKey: string;
  phaseTitle: string;
  focus: string;
  context: string[];
  findings: string[];
  upcoming: string[];
}

// ---------------------------------------------------------------------------------------------

const norm = (s: string) => s.replace(/[\s:：,·.!?'"()<>\[\]-]/g, "").toLowerCase();

export function findStrategyPlan(channelCode: string, programName: string | null, date: string): StrategyReviewPlan | null {
  if (!programName) return null;
  const n = norm(programName);
  return (
    STRATEGY_REVIEW_PLANS.find(
      (p) => p.channelCode === channelCode && date >= p.startDate && date <= p.endDate && p.programNames.some((name) => norm(name) === n)
    ) ?? null
  );
}

export function phaseFor(plan: StrategyReviewPlan, date: string): StrategyPhase | null {
  return plan.phases.find((ph) => date >= ph.from && date <= ph.to) ?? null;
}

/** "HH:MM(:SS)" → 분. 26시 표기(예: 25:10)도 그대로 더한다 */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 두 방송 구간이 겹친 분(끝이 시작보다 작으면 자정을 넘긴 것으로 본다) */
export function overlapMinutes(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): number | null {
  if (!aEnd || !bEnd) return null;
  const a0 = toMinutes(aStart);
  let a1 = toMinutes(aEnd);
  if (a1 < a0) a1 += 1440;
  const b0 = toMinutes(bStart);
  let b1 = toMinutes(bEnd);
  if (b1 < b0) b1 += 1440;
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const pct = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);
const r3 = (v: number | null) => (v === null ? "—" : v.toFixed(3));
const r2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
const signed = (v: number | null) => (v === null ? "" : `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)}%`);
const hm = (t: string | null) => (t ? t.slice(0, 5) : "—");
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 회차 범위 표기 — ours는 날짜순 본방 목록이라 순번 = 회차(결방이 있으면 실제 회차와 다를 수 있어 '순번'임을 알고 쓴다) */
function epRange(from: number, to: number): string {
  return from === to ? `${from}회` : `${from}~${to}회`;
}

export function buildStrategyReview(input: StrategyReviewInput): StrategyReviewOutput | null {
  const { plan, asOfDate } = input;
  const phase = phaseFor(plan, asOfDate);
  if (!phase) return null;
  const ours = [...input.ours].filter((p) => p.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date));
  if (ours.length === 0) return null;
  const findings: string[] = [];
  const latest = ours[ours.length - 1];
  const epOf = (d: string) => ours.findIndex((p) => p.date === d) + 1;
  const inPhase = (key: string) => {
    const ph = plan.phases.find((p) => p.key === key)!;
    return ours.filter((p) => p.date >= ph.from && p.date <= ph.to);
  };
  const segA = inPhase("A");
  const segB = inPhase("B");
  const segC = inPhase("C");
  const avgOf = (seg: OurEpisodePoint[]) => ({ p2049: mean(seg.map((s) => s.p2049)), household: mean(seg.map((s) => s.household)) });
  const segLabel = (seg: OurEpisodePoint[]) => epRange(epOf(seg[0].date), epOf(seg[seg.length - 1].date));
  const guiltyKey = plan.rivals.find((r) => r.role === "lead")?.key;
  const headKey = plan.rivals.find((r) => r.role === "head")?.key;
  const guilty = guiltyKey ? (input.rivals[guiltyKey] ?? []).filter((r) => r.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const head = headKey ? (input.rivals[headKey] ?? []).filter((r) => r.date <= asOfDate).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const guiltyLabel = plan.rivals.find((r) => r.key === guiltyKey)?.label ?? "";
  const headLabel = plan.rivals.find((r) => r.key === headKey)?.label ?? "";

  // 1) 누적 성적 — 전작 대비(시장 경쟁력의 기본선)
  const all = avgOf(ours);
  const predSorted = [...input.predecessor].sort((a, b) => a.date.localeCompare(b.date));
  // 전작과는 같은 회차 수끼리 비교한다(드라마는 초반·후반 시청률 수준이 달라 전체 평균과 견주면 초반이 불리하다)
  const predSame = avgOf(predSorted.slice(0, ours.length));
  const predAll = avgOf(predSorted);
  if (plan.predecessor && predSame.p2049 !== null) {
    findings.push(
      `1~${ours.length}회 본방 평균 2049 ${r3(all.p2049)}(가구 ${r2(all.household)}) — ${plan.predecessor.label} 같은 1~${Math.min(ours.length, predSorted.length)}회 ${r3(predSame.p2049)}(가구 ${r2(predSame.household)}) 대비 2049 ${signed(pct(all.p2049, predSame.p2049))}, 가구 ${signed(pct(all.household, predSame.household))}` +
        (predSorted.length > ours.length ? ` · 전작 전체 ${predSorted.length}회 평균 ${r3(predAll.p2049)} 대비 ${signed(pct(all.p2049, predAll.p2049))}.` : ".")
    );
  } else {
    findings.push(`1~${ours.length}회 본방 평균 2049 ${r3(all.p2049)}(가구 ${r2(all.household)}).`);
  }

  if (phase.key === "A") {
    // tvN 20:50 드라마 — 같은 날 성적과 끝난 시각(우리 시작과의 간격)
    const g = guilty.find((x) => x.date === latest.date) ?? guilty[guilty.length - 1];
    if (g) {
      const gap = g.end ? toMinutes(latest.start) - toMinutes(g.end) : null;
      const gAvg = mean(guilty.map((x) => x.rating));
      findings.push(
        `${guiltyLabel} ${md(g.date)} 본방 ${hm(g.start)}~${hm(g.end)} 2049 ${r3(g.rating)}(본방 ${guilty.length}회 평균 ${r3(gAvg)}) — 크래시2 시작(${hm(latest.start)})${gap !== null ? (gap >= 0 ? `까지 ${gap}분 간격으로 직접 겹치지 않는다` : `과 ${-gap}분 겹친다`) : ""}.`
      );
      if (gAvg !== null && all.p2049 !== null) {
        findings.push(`크래시2 본방 평균은 ${guiltyLabel} 본방 평균의 ${((all.p2049 / gAvg) * 100).toFixed(0)}% 수준 — 종영(11/24) 뒤 tvN 월화 시청층의 이동이 다음 구간의 관전 포인트.`);
      }
    }
  }

  if (phase.key === "B" || phase.key === "C") {
    // <나의 유죄인간> 결산(종영 회차와 시리즈 평균) + 종영 전후 크래시2 비교
    if (guilty.length > 0) {
      const last = guilty[guilty.length - 1];
      const firstHalf = mean(guilty.slice(0, Math.ceil(guilty.length / 2)).map((x) => x.rating));
      const secondHalf = mean(guilty.slice(Math.ceil(guilty.length / 2)).map((x) => x.rating));
      findings.push(
        `${guiltyLabel} 결산: 본방 ${guilty.length}회 평균 2049 ${r3(mean(guilty.map((x) => x.rating)))}, 후반부 평균 ${r3(secondHalf)}(전반 ${r3(firstHalf)} 대비 ${signed(pct(secondHalf, firstHalf))}), 마지막 회(${md(last.date)}) ${r3(last.rating)}.`
      );
    }
    if (segA.length > 0 && segB.length > 0) {
      const a = avgOf(segA);
      const b = avgOf(segB);
      findings.push(
        `<나의 유죄인간> 종영 전(${segLabel(segA)}) 평균 2049 ${r3(a.p2049)} → 종영 후(${segLabel(segB)}) ${r3(b.p2049)} ${signed(pct(b.p2049, a.p2049))}(가구 ${r2(a.household)} → ${r2(b.household)}).`
      );
    }
    if (phase.key === "B") {
      const slot = input.rivalChannelSlot.filter((x) => x.date === latest.date).sort((a, b) => a.start.localeCompare(b.start));
      if (slot.length > 0) {
        findings.push(`${md(latest.date)} tvN 저녁 본방 편성: ${slot.map((x) => `${hm(x.start)} ${x.programName} ${r3(x.rating)}`).join(" · ")}.`);
      }
    }
  }

  if (phase.key === "C") {
    const planned = phase.plannedStart;
    const diff = toMinutes(latest.start) - toMinutes(planned);
    findings.push(
      Math.abs(diff) <= 1
        ? `${md(latest.date)} 실제 시작 ${hm(latest.start)} — 계획(${planned}) 대로 앞당긴 시각이 반영됐다.`
        : `${md(latest.date)} 실제 시작 ${hm(latest.start)} — 계획(${planned})과 ${Math.abs(diff)}분 차이, 시각 변경 반영 여부 확인 필요.`
    );
    const h = head.find((x) => x.date === latest.date);
    if (h) {
      const ov = overlapMinutes(latest.start, latest.end, h.start, h.end);
      findings.push(
        `${headLabel} ${md(h.date)} 본방 ${hm(h.start)}~${hm(h.end)} 2049 ${r3(h.rating)} — 크래시2 ${r3(latest.p2049)}${h.rating && latest.p2049 !== null ? `(상대의 ${((latest.p2049 / h.rating) * 100).toFixed(0)}%)` : ""}${ov !== null ? `, 겹친 시간 ${ov}분` : ""}${h.start && toMinutes(h.start) > toMinutes(latest.start) ? `, 상대보다 ${toMinutes(h.start) - toMinutes(latest.start)}분 먼저 시작` : ""}.`
      );
    } else {
      findings.push(`${headLabel} 본방 기록을 ${md(latest.date)} 경쟁채널 자료에서 아직 찾지 못했다(프로그램명·편성 확인 필요).`);
    }
    const before = [...segA, ...segB];
    if (before.length > 0) {
      const b = avgOf(before);
      const c = avgOf(segC);
      findings.push(
        `조기 시작·맞대결 전(${segLabel(before)}) 평균 2049 ${r3(b.p2049)} → 이후(${segLabel(segC)}) ${r3(c.p2049)} ${signed(pct(c.p2049, b.p2049))}(가구 ${r2(b.household)} → ${r2(c.household)}).`
      );
      // 사용자가 우려한 '초반부 손해' — 시각을 바꾼 첫 회가 직전 2회 평균 대비 어땠는지
      const firstC = segC[0];
      const prev2 = before.slice(-2);
      const prev2Avg = mean(prev2.map((p) => p.p2049));
      if (firstC && prev2Avg !== null) {
        const ch = pct(firstC.p2049, prev2Avg);
        findings.push(
          `시각 변경 첫 회(${md(firstC.date)}) 2049 ${r3(firstC.p2049)} — 직전 2회 평균 ${r3(prev2Avg)} 대비 ${signed(ch)}${ch !== null && ch < -10 ? ": 변경 고지가 충분히 전달되지 않았을 가능성(시작 직후 분당 자료로 확인 권장)." : "."}`
        );
      }
    }
    if (latest.date === plan.endDate || ours.length >= plan.totalEpisodes) {
      const parts = [segA, segB, segC].filter((s) => s.length > 0).map((s) => `${segLabel(s)} ${r3(avgOf(s).p2049)}`);
      findings.push(`종영 결산(2049 구간 평균): ${parts.join(" → ")} · 전체 ${r3(all.p2049)}.`);
    }
  }

  const upcoming = plan.events.filter((e) => e.date > asOfDate).map((e) => `${md(e.date)} ${e.label}`);
  return { planId: plan.id, phaseKey: phase.key, phaseTitle: phase.title, focus: phase.focus, context: plan.context, findings, upcoming };
}
