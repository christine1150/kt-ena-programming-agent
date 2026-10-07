// 홈 데이터 상태·결정 카드 모델(단계 07) — "오늘 결정할 3건"과 "데이터 상태"를 이미 계산된 값에서 규칙으로 고른다.
// 새 지표를 계산하지 않는다: 채널 신호(get_channel_daily_narrative가 주는 값)와 포트폴리오 이상 신호를 읽고,
// 판단 문구는 단계 04의 programActionFor(같은 입력 → 같은 action_id)를 그대로 쓴다. 1회 급락만으로 교체·이동을
// 권하지 않고 확인 조건을 함께 보인다. 인과를 단정하지 않는다(관측·가능한 설명·확인 조건 구분).
import { programActionFor, RISE_PCT } from "@/lib/insight/actionCandidate";
import type { ActionTag } from "@/lib/actionTags";
import { applyPolicy, DEFAULT_OPERATING_POLICY } from "@/lib/insight/operatingPolicy";
import type { EvidenceStrength } from "@/lib/insight/types";
import type { ReviewEvent } from "./actionReview";
import { latestByAction } from "./actionReview";
import { addDays, broadcastHour, daysBetween, kstToday, shortDateKo } from "./dates";
import { formatKpiRating } from "./kpi";
import { hrefFor, type ViewContext } from "./viewContext";
import { describeLag, type Finality } from "./contextBar";
import type { HomeView } from "./viewContext";

// ───────────────────────── 데이터 상태 ─────────────────────────

export interface DataStatusLine {
  text: string;
  tone: "normal" | "warn" | "muted";
}
export interface DataStatus {
  level: "ok" | "warn";
  headline: string;
  lines: DataStatusLine[];
  finality: Finality;
}

export function finalityFor(view: HomeView, o: { hasWeeklyReview: boolean; hasMonthlyReview: boolean }): Finality {
  if (view === "daily") return "provisional";
  if (view === "weekly") return o.hasWeeklyReview ? "official" : "provisional";
  return o.hasMonthlyReview ? "official" : "unknown";
}

export function buildDataStatus(i: {
  view: HomeView;
  asOfDate: string;
  latestAvailableDate: string;
  requestedDateNoData: boolean;
  today: string;
  /** 시청률 값이 비어 있는 채널 이름 */
  missingChannelNames: string[];
  hasWeeklyReview: boolean;
  hasMonthlyReview: boolean;
}): DataStatus {
  const lag = describeLag(i.latestAvailableDate, i.today);
  const lines: DataStatusLine[] = [];
  lines.push({ text: `표시 기준일 ${shortDateKo(i.asOfDate)} · 최신 수신일 ${lag.text}`, tone: lag.tone === "warn" ? "warn" : "normal" });
  if (i.requestedDateNoData) lines.push({ text: "선택한 날짜에는 반영된 Nielsen 데이터가 없어 가장 최근 수신일의 값을 표시합니다.", tone: "warn" });
  if (i.missingChannelNames.length > 0) lines.push({ text: `시청률 미수신 채널: ${i.missingChannelNames.join(", ")} (빈 값은 0이 아니라 미수신으로 처리)`, tone: "warn" });
  const finality = finalityFor(i.view, { hasWeeklyReview: i.hasWeeklyReview, hasMonthlyReview: i.hasMonthlyReview });
  if (finality === "provisional") lines.push({ text: "일간 수신값은 잠정입니다. 공식 주간·월간 값이 수신되면 달라질 수 있습니다.", tone: "muted" });
  if (finality === "unknown") lines.push({ text: "이 달의 확정(공식 월간) 값은 월 마지막 날 수신 후 표시됩니다.", tone: "muted" });
  const warn = lines.some((l) => l.tone === "warn");
  return {
    level: warn ? "warn" : "ok",
    headline: warn ? "확인이 필요한 데이터 상태가 있습니다" : "데이터 수신 상태 정상",
    lines,
    finality,
  };
}

// ───────────────────────── 결정 카드 ─────────────────────────

export interface DecisionSignal {
  channelCode: string;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  top_program_tag?: ActionTag | null;
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_baseline_days: number | null;
  decline_program_delta_pct: number | null;
  decline_program_tag?: ActionTag | null;
}

export interface AnomalyInput {
  triggered: boolean;
  thresholdPct: number;
  minChannelCount: number;
  movedChannels: { channelCode: string; channelName: string; ratingDeltaPct: number }[];
}

export type DecisionKind = "data" | "anomaly" | "program_decline" | "program_rise";

export interface DecisionCard {
  /** 프로그램 카드는 단계 04 action_id, 그 외는 안정적인 합성 ID */
  id: string;
  kind: DecisionKind;
  channelCode: string | null;
  title: string;
  /** 근거 2개(관측만) */
  evidence: [string, string];
  alternatives: string[];
  /** 확인할 조건 */
  confirm: string;
  reviewBy: string | null;
  strength: EvidenceStrength | null;
  /** 검토 주제 키(날짜가 달라져도 같은 프로그램·슬롯이면 같다) — 보류·채택·기각 억제에 쓴다 */
  subject: string;
  priority: number;
  /** 왜 오늘 이 카드를 골랐는지 */
  why: string;
  links: { evidence: string | null; slot: string | null; compare: string | null };
  /** 현재 검토 상태(없으면 null) */
  review: ReviewEvent | null;
  notes: string[];
  /** 프로그램 카드: 대상 프로그램·방송일 기준 시(02~25)·기준 슬롯 평균 문구 — 홈 "대안 비교" 시뮬레이션이 그 자리를 찾는 데 쓴다 */
  programName?: string | null;
  hour?: number | null;
  baselineText?: string | null;
}

export const MAX_DECISIONS = 3;
/** 같은 주제에서 기각·채택 후 이 기간 동안은 카드로 다시 올리지 않는다(가정: 단계 04의 검토 주기와 같은 14일). */
export const SUPPRESS_DAYS = 14;

const STRENGTH_BONUS: Record<EvidenceStrength, number> = { strong: 10, moderate: 6, weak: 3, insufficient: 0 };

/** 검토 기록 때문에 오늘 카드로 올리지 않는 주제인가. */
export function isSuppressed(review: ReviewEvent | null, today: string): boolean {
  if (!review) return false;
  const decidedOn = kstToday(new Date(review.createdAt)); // 기록 시각(UTC)을 한국 날짜로 — 새벽 기록이 하루 일찍 계산되지 않게
  if (review.status === "dismissed") return daysBetween(decidedOn, today) < SUPPRESS_DAYS;
  if (review.status === "adopted") return review.reviewBy ? daysBetween(today, review.reviewBy) > 0 : daysBetween(decidedOn, today) < SUPPRESS_DAYS;
  if (review.status === "hold") return review.reviewBy ? daysBetween(today, review.reviewBy) > 0 : false;
  return false;
}

const subjectOf = (channelCode: string, program: string, hour: number | null) => `${channelCode}|${program}|${hour ?? "-"}`;

function reviewForSubject(events: ReviewEvent[], subject: string): ReviewEvent | null {
  let found: ReviewEvent | null = null;
  for (const e of latestByAction(events).values()) {
    if (e.context?.subject === subject && (!found || e.createdAt > found.createdAt)) found = e;
  }
  return found;
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function buildTodayDecisions(i: {
  ctx: ViewContext;
  asOfDate: string;
  latestAvailableDate: string;
  today: string;
  signals: DecisionSignal[];
  channelNames: Record<string, string>;
  anomaly: AnomalyInput | null | undefined;
  dataStatus: DataStatus;
  reviews: ReviewEvent[];
  snapshotId: string | null;
  max?: number;
}): { cards: DecisionCard[]; suppressed: number; candidates: number } {
  const cards: DecisionCard[] = [];
  const name = (code: string) => i.channelNames[code] ?? code;
  const baseCtx: ViewContext = { ...i.ctx, view: "daily", date: i.asOfDate };

  const linksFor = (code: string, actionId: string, title: string, hour: number | null, subject: string) => {
    // from=액션 ID, ft=표시용 제목, sj=검토 주제 키(보류·채택 억제용), hour/date=해당 슬롯, cut=화면의 데이터 시점
    const extra = { from: actionId, ft: trim(title, 60), sj: subject, hour: hour !== null ? String(hour) : null, date: i.asOfDate, cut: i.latestAvailableDate };
    const chCtx: ViewContext = { ...baseCtx, date: null, channel: code, preset: i.asOfDate === i.latestAvailableDate ? null : "custom", dateFrom: i.asOfDate === i.latestAvailableDate ? null : i.asOfDate, dateTo: i.asOfDate === i.latestAvailableDate ? null : i.asOfDate };
    return {
      evidence: hrefFor("channel", chCtx, { from: actionId, ft: extra.ft, sj: subject, hour: extra.hour }),
      slot: hrefFor("schedule_grid", { ...baseCtx, channel: code }, extra),
      compare: hrefFor("ideal_schedule", { ...baseCtx, channel: code }, { from: actionId, ft: extra.ft, sj: subject, hour: extra.hour }),
    };
  };

  // 1) 데이터 상태 경고는 위의 '데이터 상태' 섹션이 이미 보여 주므로 결정 카드 3건 중 하나를 쓰지 않는다(같은 경고 중복 방지).

  // 2) 다수 채널 동시 변동 — 개별 편성 판단 전에 공통 요인을 확인하도록 안내.
  if (i.anomaly?.triggered) {
    const moved = i.anomaly.movedChannels;
    const list = moved.map((m) => `${m.channelName} ${m.ratingDeltaPct >= 0 ? "▲" : "▼"}${Math.abs(m.ratingDeltaPct).toFixed(1)}%`).join(" · ");
    cards.push({
      id: `anomaly:${i.asOfDate}`,
      kind: "anomaly",
      channelCode: null,
      title: `${moved.length}개 채널이 동시에 크게 변동`,
      evidence: [list, `기준: 평소 대비 ±${i.anomaly.thresholdPct}% 이상 변동한 채널이 ${i.anomaly.minChannelCount}개 이상(현재 ${moved.length}개)`],
      alternatives: ["공휴일·특집 편성·수신 데이터 여부를 먼저 확인하고 개별 채널 판단은 보류", "다음 수신일에도 같은 방향인지 확인한 뒤 채널별로 검토"],
      confirm: "다음 수신일에도 같은 채널들이 같은 방향이면 채널별 원인 확인에 착수",
      reviewBy: addDays(i.asOfDate, 1),
      strength: null,
      subject: `anomaly|${moved.map((m) => m.channelCode).sort().join(",")}`,
      priority: 90,
      why: "여러 채널이 같은 날 함께 움직여 개별 편성 문제인지 공통 요인인지 가려야 합니다.",
      links: { evidence: null, slot: null, compare: null },
      review: null,
      notes: ["동시 변동은 원인이 아니라 관측입니다."],
    });
  }

  // 3) 채널별 프로그램 신호 — 채널 인사이트와 같은 기준(하락 프로그램 우선, 아니면 같은 슬롯 평균 대비 ±30%).
  let candidates = 0;
  let suppressed = 0;
  for (const s of i.signals) {
    let programName: string | null = null;
    let rating: number | null = null;
    let baseline: number | null = null;
    let baselineDays: number | null = null;
    let startTime: string | null = null;
    let dev: number | null = null;
    let tag: ActionTag | null = null;
    if (s.decline_program_name && s.decline_program_delta_pct !== null) {
      programName = s.decline_program_name;
      rating = s.decline_program_rating;
      baseline = s.decline_program_baseline_avg;
      baselineDays = s.decline_program_baseline_days;
      startTime = s.decline_program_start_time;
      dev = s.decline_program_delta_pct;
      tag = s.decline_program_tag ?? null;
    } else if (s.top_program_name && s.top_program_rating !== null && s.top_program_baseline_avg !== null && s.top_program_baseline_avg > 0 && (s.top_program_baseline_days ?? 0) >= 3) {
      const pct = ((s.top_program_rating - s.top_program_baseline_avg) / s.top_program_baseline_avg) * 100;
      if (Math.abs(pct) >= 30) {
        programName = s.top_program_name;
        rating = s.top_program_rating;
        baseline = s.top_program_baseline_avg;
        baselineDays = s.top_program_baseline_days;
        startTime = s.top_program_start_time;
        dev = pct;
        tag = s.top_program_tag ?? null;
      }
    }
    if (!programName || dev === null) continue;
    candidates += 1;
    const hour = startTime ? broadcastHour(startTime) : null;
    const subject = subjectOf(s.channelCode, programName, hour);
    const review = reviewForSubject(i.reviews, subject);
    if (isSuppressed(review, i.today)) {
      suppressed += 1;
      continue;
    }
    const baselineLabel = "본방 슬롯 최근 8주 평균";
    const dir = dev <= 0 ? "▼" : "▲";
    const observation = `'${programName}' 같은 슬롯 평균 대비 ${dir}${Math.abs(dev).toFixed(0)}%`;
    // Fit Score 태그가 관측 방향과 어긋나면(예: 상승인데 MOVE, 하락인데 STRENGTHEN) 한 카드 안에서 판단이 서로 모순되므로
    // 태그를 판단에서 제외하고 그 사실을 노트에 남긴다(단계 04 F06 — 홈·상세 판단 충돌 방지).
    const tagFits = tag === null || (dev <= 0 ? ["MOVE", "REPLACE", "TEST"] : ["STRENGTHEN", "KEEP", "TEST"]).includes(tag);
    const usedTag = tagFits ? tag : null;
    const action = applyPolicy(programActionFor({ programName, startHour: hour, deviationPct: dev, baselineLabel, baselineDays, fitScoreTag: usedTag, observationText: observation, asOfDate: i.asOfDate, snapshotId: i.snapshotId }), DEFAULT_OPERATING_POLICY, s.channelCode);
    const hourLabel = hour !== null ? ` ${hour}시` : "";
    // 제목에는 판단 이름(shortLabel)만 쓴다. 확인 조건은 별도 필드(confirm)로 보여 준다(actionPhrase는 조건까지 붙이는 한 줄용).
    // 이동·교체는 반복 확인이 있어야 권할 수 있다(단계 04). 근거가 부족하면 태그가 MOVE/REPLACE여도 제목은 '추적 점검'이다.
    const premature = (action.kind === "MOVE" || action.kind === "REPLACE") && !action.permanentChangeSupported;
    const title = `${name(s.channelCode)} '${programName}'${hourLabel} — ${premature || (dev <= 0 && action.kind === "MONITOR") ? "다음 방영도 낮으면 이동·교체 검토" : action.shortLabel}`;
    const isDown = dev <= 0;
    const priority = isDown ? 60 + Math.min(30, Math.abs(dev) / 3) + STRENGTH_BONUS[action.evidence.strength] : 30 + Math.min(20, Math.abs(dev) / 5);
    // 상승은 RISE_PCT 이상만 카드로 올린다(단계 04 기준과 동일). 하락은 채널 신호(-30% 이상)가 이미 걸러 준 값.
    if (!isDown && dev < RISE_PCT) continue;
    const ratingText = rating !== null ? `${formatKpiRating(rating, s.channelCode)}%` : "—";
    const baseText = baseline !== null ? `${formatKpiRating(baseline, s.channelCode)}%` : "미확인";
    cards.push({
      id: action.actionId,
      kind: isDown ? "program_decline" : "program_rise",
      channelCode: s.channelCode,
      title,
      evidence: [
        `당일 ${ratingText} — ${baselineLabel}(${baseText}) 대비 ${dir}${Math.abs(dev).toFixed(0)}%`,
        `기준 표본 ${baselineDays ?? "미확인"}회 · 근거 강도 ${action.evidence.strength}${action.evidence.reasons.length ? `(${action.evidence.reasons[0]})` : ""}`,
      ],
      alternatives: action.alternatives.slice(0, 3),
      confirm: action.confirmConditions[0] ?? "추가 관측 후 판단",
      reviewBy: action.reviewBy,
      strength: action.evidence.strength,
      subject,
      priority,
      why: isDown ? "같은 슬롯 평균 대비 큰 하락이 관측되어 확인 순서가 앞섭니다." : "같은 슬롯 평균 대비 큰 상승이 관측되어 강화 여부를 검토할 만합니다.",
      links: linksFor(s.channelCode, action.actionId, title, hour, subject),
      programName,
      hour,
      baselineText: baseline !== null ? baseText : null,
      review,
      notes: [...(tagFits ? [] : [`Fit Score 태그(${tag})는 오늘 관측 방향(${dev <= 0 ? "하락" : "상승"})과 달라 판단에서 제외했습니다.`]), ...(action.hypothesis ? [`가설(관측 아님): ${action.hypothesis}`] : []), ...(action.constraints.avail === "unverified" ? ["Avail(권리) 미확인 — 이동·교체를 확정하기 전에 권리 확인이 필요합니다."] : []), ...action.constraints.notes],
    });
  }

  cards.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "ko"));
  return { cards: cards.slice(0, i.max ?? MAX_DECISIONS), suppressed, candidates };
}
