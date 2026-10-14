// 홈 카드 문구(2026-10-14, 사용자 기준) — 순수 함수. 글자 수를 줄이는 것이 목적이 아니라, 보는 사람이 3초 안에
// ① 현재 상황(목표 대비 달성률) ② 핵심 원인(프로그램·시간대·비교 근거) ③ 필요한 조치를 알게 하는 것이다.
// 이 파일은 이미 계산된 값을 문장으로 옮기기만 한다 — 판정 기준·추천 로직은 건드리지 않는다(진단·추천 변경은 별도 요구사항과 검증을 거친다).
// 원칙: 핵심 수치와 비교 근거를 지우지 않는다 / '구조적 격차'·'반복 약세' 같은 추상어를 단독으로 쓰지 않는다 /
//       카드마다 같은 틀을 기계적으로 채우지 않고 가장 중요한 조치 한 가지를 앞에 둔다(나머지는 '다른 방법'으로 접어 둔다) /
//       근거가 약하면 교체를 권하지 않고 테스트인 이유와 표본 수를 밝힌다 / 구매 검토는 구체적 후보와 추천 근거가 있을 때만 말한다.
import { josaEunNeun, josaIga } from "@/lib/josa";
import { formatRatingDelta } from "@/lib/metrics";
import { heldLabel, type HeldRecommendation } from "./availHeld";
import type { OriginalLeverageView } from "./originalClassify";
import type { WeakSlotRemedyView } from "./weakSlotView";

/** /api/dashboard/ai-suggestions 응답 한 채널분(서버 AiSuggestion과 같은 모양 — 화면에서 쓰는 필드만) */
export interface AiSuggestionPayload {
  channelCode: string;
  weekStart: string;
  weekday?: number;
  currentExpected: number | null;
  aiExpected: number | null;
  change: { weekday: number; startMin: number; from: string; to: string; gain: number; certainty: "HIGH" | "MID" | "LOW" | null; sampleCount?: number; evidence?: "ok" | "weak" } | null;
  widenedLookbackDays?: number | null;
  focus?: string | null;
  remedy?: WeakSlotRemedyView | null;
  /** 구매 검토 추천 중 추천 근거(연평균 대비 추정 배수·비교 채널 수)가 있는 후보 */
  external?: { name: string; vsAvg: number | null; peers: number | null }[];
  originals?: OriginalLeverageView | null;
  /** Avail 보유 콘텐츠 중 타 채널 실적으로 채널 연평균 이상이 기대되는 작품(별도 API로 늦게 채워진다) */
  availHeld?: HeldRecommendation[] | null;
}

export interface CardCopyInput {
  /** 화면에 이미 보이는 목표 달성률(%)과 그 계산에 쓰인 값 — 서로 맞을 때만 숫자를 노출한다 */
  achievementPct: number | null;
  rating: number | null;
  goalRating: number | null;
  /** 전주·전전주 같은 요일 중 높은 값이 목표의 몇 %인가(없으면 null). 구조적 부진 판정이 참일 때만 문구에 쓴다 */
  priorPct: number | null;
  structural: boolean;
  /** 카드가 이미 지목한 약한 프로그램(위 줄이 그 프로그램을 설명한다) */
  program: { name: string; hour: number | null } | null;
  ai: AiSuggestionPayload | null;
}

export interface CardCopy {
  /** 핵심 진단 — 목표 달성률과 상태. 목표 미달이 아니거나 숫자가 맞지 않으면 null */
  headline: string | null;
  /** 원인 및 근거 */
  cause: string | null;
  /** 권고 조치(가장 중요한 한 가지) */
  action: string | null;
  /** 근거가 충분한 구체 조치인가(강조색) */
  positive: boolean;
  /** 다른 방법(접어 둔 보조 조치) */
  more: string[];
}

const CERT_KO = { HIGH: "높음", MID: "보통", LOW: "낮음" } as const;
const hourOf = (startMin: number) => Math.floor(startMin / 60);
const stripEnd = (s: string) => s.replace(/[.\s]+$/, "");
const sentence = (s: string) => `${stripEnd(s)}.`;

/** 목표 달성률 숫자가 달성률 계산 재료(현재 시청률 ÷ 목표 시청률)와 맞는지 — 어긋나면 숫자를 보여 주지 않는다(검증 실패는 숫자 생략). */
export function achievementConsistent(pct: number | null, rating: number | null, goal: number | null): boolean {
  if (pct === null || !Number.isFinite(pct)) return false;
  if (rating === null || goal === null || goal <= 0) return true; // 재료가 없으면 화면의 달성률을 그대로 신뢰(이미 화면에 쓰이는 값)
  return Math.abs((rating / goal) * 100 - pct) <= 1.5;
}

/** 호조 프로그램이 있어도 채널 전체가 목표에 못 미치는 카드의 진단 한 줄 — AI 계산 없이 이미 있는 값만 쓴다. 목표 미달이 아니거나 숫자가 맞지 않으면 null */
export function upProgramHeadline(input: { achievementPct: number | null; rating: number | null; goalRating: number | null; program: { name: string; hour: number | null } }): string | null {
  if (!achievementConsistent(input.achievementPct, input.rating, input.goalRating) || input.achievementPct! >= 100) return null;
  const p = input.program;
  return `목표의 ${Math.round(input.achievementPct!)}% 달성 — '${p.name}'${p.hour !== null ? `(${p.hour}시)` : ""}${josaEunNeun(p.name)} 호조지만 채널 전체는 목표 미달`;
}

/** 한 카드의 문구를 만든다. */
export function buildCardCopy(input: CardCopyInput): CardCopy {
  const { ai, program } = input;
  const r = ai?.remedy ?? null;
  const c = ai?.change ?? null;
  const okChange = !!c && c.evidence !== "weak";
  const pctOk = achievementConsistent(input.achievementPct, input.rating, input.goalRating);
  const below = pctOk && input.achievementPct! < 100;

  // ── 핵심 진단 ──
  let headline: string | null = null;
  if (below) {
    const pct = `목표의 ${Math.round(input.achievementPct!)}% 달성`;
    if (program) headline = `${pct} — '${program.name}'${program.hour !== null ? `(${program.hour}시)` : ""} 성과 점검 필요`;
    else if (r?.hole) headline = `${pct} — ${r.hole.hour}시 '${r.hole.program}'${josaIga(r.hole.program)} 가장 부진`;
    else headline = `${pct} — 전반적으로 시청률이 목표에 못 미침`;
  }

  // ── 원인 및 근거 ──
  const causeParts: string[] = [];
  if (r?.hole && !program) {
    const pct = r.hole.ratioPct !== null ? `의 ${r.hole.ratioPct}% 수준` : "와 비교할 방영 기록이 부족";
    causeParts.push(sentence(`${r.hole.hour}시 '${r.hole.program}'${josaEunNeun(r.hole.program)} 같은 요일·시간대 최근 8회 중앙값${pct}`));
  }
  if (r?.brief?.cause) causeParts.push(sentence(r.brief.cause));
  if (input.structural && input.priorPct !== null) causeParts.push(sentence(`최근 2주 같은 요일도 목표의 ${Math.round(input.priorPct)}% 수준이라 오늘만의 문제가 아닙니다`));
  const cause = causeParts.length > 0 ? causeParts.join(" ") : null;

  // ── 조치 후보(중요도 순) ──
  type Lever = { text: string; positive: boolean };
  const levers: Lever[] = [];
  if (r?.concrete && r.brief) levers.push({ text: sentence(r.brief.action), positive: true });
  if (c && okChange) {
    levers.push({
      text: sentence(`교체 검토 — ${hourOf(c.startMin)}시 '${c.from}' 대신 '${c.to}'${josaEunNeun(c.to) === "은" ? "을" : "를"} 편성하면 기대 시청률 ${formatRatingDelta(c.gain)} (표본 ${c.sampleCount ?? 0}회, 신뢰도 ${c.certainty ? CERT_KO[c.certainty] : "-"})`),
      positive: true,
    });
  }
  const o = ai?.originals ?? null;
  if (o && o.use.length > 0) {
    const mmdd = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
    const names = o.use.slice(0, 2).map((u) =>
      u.verdict === "upcoming" ? `'${u.name}'(${mmdd(u.start)} 시작 예정)` : u.verdict === "test" ? `'${u.name}'(방영 초반이라 시험 편성)` : `'${u.name}'(ENA 본방이 같은 시간대 평균의 ${u.slotIndex?.toFixed(1) ?? "-"}배)`
    );
    levers.push(
      o.use.every((u) => u.verdict === "upcoming")
        ? { text: sentence(`ENA에서 곧 시작하는 ${names.join(", ")} — 본방 시작 후 이 채널 재방 편성 검토`), positive: false }
        : { text: sentence(`재방 편성 확대 검토 — ENA에서 본방 중인 ${names.join(", ")}`), positive: o.use.some((u) => u.verdict === "fit") }
    );
  }
  const held = ai?.availHeld && ai.availHeld.length > 0 ? ai.availHeld.slice(0, 2) : null;
  if (held) levers.push({ text: sentence(`보유 콘텐츠 검토 — Avail 보유작 ${held.map(heldLabel).join(", ")}`), positive: false });
  if (c && !okChange) {
    const n = c.sampleCount ?? 0;
    levers.push({
      text: sentence(
        n < 5
          ? `테스트 편성 검토 — ${hourOf(c.startMin)}시 '${c.to}'${josaEunNeun(c.to)} 표본이 ${n}회뿐이라 교체를 권하기엔 근거가 부족해 시험 편성으로 확인`
          : `테스트 편성 검토 — ${hourOf(c.startMin)}시 '${c.to}'${josaEunNeun(c.to)} 표본은 ${n}회이나 기대 시청률 예측 범위가 넓어(신뢰도 낮음) 교체 대신 시험 편성으로 확인`
      ),
      positive: false,
    });
  }
  if (r?.brief && !r.concrete) levers.push({ text: sentence(r.brief.action), positive: false });
  if (o && o.weak.length > 0) {
    const w = o.weak.slice(0, 2).map((x) => `'${x.name}'(ENA 본방이 같은 시간대 평균의 ${x.slotIndex?.toFixed(1) ?? "-"}배)`);
    levers.push({ text: sentence(`재방 축소 검토 — ${w.join(", ")}: ENA 본방 효율이 낮아 이 채널 재방을 줄이는 방안`), positive: false });
  }
  const ext = (ai?.external ?? []).filter((e) => e.vsAvg !== null && e.vsAvg >= 1.0).slice(0, 2);
  if (!okChange && !r?.concrete && !(o && o.use.length > 0) && !held && ext.length > 0) {
    levers.push({
      text: sentence(`구매 검토 — ${ext.map((e) => `'${e.name}'${josaEunNeun(e.name)} 타 채널 방영 실적${e.peers ? `(비교 ${e.peers}곳)` : ""}으로 이 채널 연평균의 약 ${e.vsAvg!.toFixed(1)}배로 추정`).join(", ")}`),
      positive: false,
    });
  }
  if (levers.length === 0) levers.push({ text: "자사 편성 안에서 근거가 충분한 교체안이 없어 다음 방영 결과를 보고 판단합니다.", positive: false });

  return { headline, cause, action: levers[0].text, positive: levers[0].positive, more: levers.slice(1).map((l) => l.text) };
}
