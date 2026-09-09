/**
 * 채널별 기간 심층 분석 엔진(2026-09-10, 사용자 지시).
 *
 * 전부 순수 함수다 — I/O 없이 dataCollector가 모아 온 원자료를 받아 판정·순위·라벨링만 한다.
 * 시청률 자체를 다시 계산하지 않는다(DB가 이미 방영시간 가중으로 낸 값을 고르고 묶기만 함) —
 * CLAUDE.md "DB/Analytics Layer = Source of Truth" 원칙 그대로.
 *
 * 이 파일이 답하는 질문 순서(화면·문서의 섹션 순서와 같다):
 *   01 무엇이 잘됐나        → computeEfficiencyRanking
 *   02 자리 때문인가         → computePrimeGap
 *   03 누가 보는가           → computeProgramProfiles
 *   04 무엇을 바꿔야 하나    → computeScheduleCanvas
 *   + 오리지널 재방 확산     → computeOriginalRerunInsights
 *   + 본방/본방 외 효율      → computeFirstRunInsights
 */
import type {
  ProgramSlotProfileRow,
  DowHourProfileRow,
  ProgramTargetProfileRow,
  OriginalRerunProfileRow,
  FirstRunEfficiencyRow,
} from "./dataCollector";

/** 편성 횟수가 이보다 적으면 회당 성과 비교에서 제외한다.
 *  실측 근거: ENA 2026-08의 "내아이의사생활추사랑스페셜"은 1회 편성으로 시청률 0.323·도달율
 *  0.780이 나와 어떤 순위든 1위를 차지해 버린다. R절에서 같은 함정을 이미 확인했다. */
export const MIN_AIRINGS_FOR_RANKING = 3;

/** 채널 평균 대비 지수의 강세/미진 판정선. Health Score의 ±15% 임계값과 같은 성격의 v1 값이며
 *  추후 조정 가능하게 상수로 열어 둔다. */
export const TARGET_INDEX_STRONG = 120;
export const TARGET_INDEX_WEAK = 80;

/**
 * 총량형/효율형 판정선 — 편성 물량 백분위와 회당 성과 백분위의 차이(%p).
 *
 * 두 번 고쳤다. (1) 처음에는 두 순위의 "등수 차"로 판정했는데, 프로그램 수가 적은 채널
 * (OLIFE 16편)에서는 등수 차가 2~3에 머물러 전부 "균형형"으로 뭉개졌다 — 등수 차는 모집단
 * 크기에 따라 의미가 달라진다. (2) 그래서 총 기여도 백분위와 비교하도록 바꿨더니 여전히 전부
 * "균형형"이었는데, 기여도 = 회당 시청률 × 총 방영시간이라 **회당 시청률 백분위와 구조적으로
 * 상관**돼 차이가 벌어질 수 없는 조합이었다(실측으로 확인).
 *
 * 지금은 편성 물량(총 방영시간) 백분위와 회당 성과(시청률) 백분위를 직접 대비한다 — 이것이
 * 사용자가 말한 구분("108회 편성에 평균 0.100" vs "35회 편성에 평균 0.204")과 정확히 같은 축이다.
 */
const TYPE_PCTL_GAP = 20;

export type ProgramType = "총량형" | "효율형" | "균형형";

export interface EfficiencyRow {
  canonicalName: string;
  airings: number;
  airtimeMin: number;
  avgRating: number | null;
  avgShare: number | null;
  avgReach: number | null;
  avgTimeSpentShare: number | null;
  /** 방영시간 가중 총 기여(= 평균 시청률 × 총 방영시간). 순위 비교에만 쓰는 상대값. */
  contribution: number;
  /** 총 시청률 합산 기여도 — 기간 내 모든 방영분의 시청률을 그대로 더한 값.
   *  "이 프로그램이 기간 동안 벌어들인 시청률 총량"이며, 편성 횟수가 곱해져 있다. */
  sumRating: number;
  /** 채널의 회당 평균 시청률(전 프로그램 방영시간 가중) — 상회 여부 판단의 기준선. */
  channelAvgRating: number | null;
  /** 회당 평균 ÷ 채널 평균 × 100. 100을 넘으면 채널 평균을 상회한다는 뜻. */
  vsChannelAvgPct: number | null;
  /** 회당 평균이 채널 평균을 상회하는지 — 효율형 판정의 필수 조건. */
  aboveChannelAvg: boolean;
  /** 시청률은 채널 평균 이하인데 다른 지표는 채널 평균을 넘는 경우 그 지표 이름.
   *  사용자 지시(2026-09-10): "시청률은 평균보다 낮아도 점유율이 높거나 시청시간이 길다거나
   *  하면 그 지표도 반드시 체크." 시청률만 보면 놓치는 콘텐츠를 건져내는 자리다. */
  compensatingMetrics: string[];
  /** 편성 물량(총 방영시간)의 채널 내 백분위 — 총량형/효율형 판정의 한 축. */
  airtimePctl: number;
  ratingEfficiencyPctl: number;
  reachPctl: number;
  timeSpentSharePctl: number;
  /** 세 백분위의 평균 — 복합 지수. */
  efficiencyIndex: number;
  programType: ProgramType;
}

export interface PrimeGapRow {
  canonicalName: string;
  primeAirings: number;
  primeAvgRating: number | null;
  offPrimeAirings: number;
  offPrimeAvgRating: number | null;
  /** 주요시간 평균 ÷ 비주요시간 평균. 어느 한쪽 표본이 없으면 null. */
  primeRatio: number | null;
  /** 표본이 한쪽으로 크게 쏠려 배율을 그대로 믿기 어려운 행인지. */
  sampleSkewed: boolean;
}

export interface HourPoint {
  hour: number;
  airings: number;
  avgRating: number | null;
  isPrime: boolean;
}

export interface TargetIndexPoint {
  demographicLabel: string;
  avgRating: number | null;
  channelBaseline: number | null;
  /** 채널 동일 연령대 평균 = 100 기준 지수. */
  index: number | null;
}

export interface ProgramProfile {
  canonicalName: string;
  airings: number;
  hourPoints: HourPoint[];
  peakHour: number | null;
  peakRating: number | null;
  weakestHour: number | null;
  weakestRating: number | null;
  targetPoints: TargetIndexPoint[];
  strongTargets: TargetIndexPoint[];
  weakTargets: TargetIndexPoint[];
  /** 도달율·시청시간 비율의 조합 유형 — 시청률만 보면 안 보이는 축. */
  engagementType: "넓고 오래" | "넓지만 짧게" | "좁지만 오래" | "좁고 짧게" | null;
}

export interface QuadrantRow {
  dayType: string;
  primeLabel: string;
  airings: number;
  airtimeMin: number;
  avgRating: number | null;
  avgShare: number | null;
  avgReach: number | null;
  avgTimeSpentShare: number | null;
}

export interface DowHourCell {
  dow: number;
  dowLabel: string;
  hour: number;
  isPrime: boolean;
  airings: number;
  avgRating: number | null;
}

export interface MoveCandidate {
  dow: number;
  dowLabel: string;
  hour: number;
  airings: number;
  avgRating: number | null;
  kind: "편성 대비 성과 낮음" | "성과 대비 편성 적음";
}

export interface OriginalRerunInsight {
  canonicalName: string;
  category: string | null;
  liveEpisodes: number;
  liveAvgRating: number | null;
  rerunChannelCode: string | null;
  rerunAvgRating: number | null;
  retentionPct: number | null;
  immediateRerunEpisodes: number;
  sameDayRerunEpisodes: number;
  selfRerunEpisodes: number;
  windowAirings: number;
  windowSumRating: number | null;
  amplificationRatio: number | null;
  /** 재방까지 포함한 확산이 큰지 작은지 — 억지 판정하지 않고 표본 있을 때만 채운다. */
  amplificationLabel: "확산 큼" | "확산 보통" | "확산 낮음" | null;
}

export interface FirstRunInsight {
  canonicalName: string;
  firstRunAirings: number;
  firstRunAvgRating: number | null;
  otherAirings: number;
  otherAvgRating: number | null;
  retentionPct: number | null;
}

// ── 공용 헬퍼 ────────────────────────────────────────────────────────────────

/** 값 배열에서 v의 백분위(0~100). 같은 값이 여럿이면 같은 백분위를 준다.
 *  Fit Score의 percent_rank()와 같은 정의(자기보다 작은 값의 비율)를 TS로 옮긴 것. */
function percentile(values: number[], v: number): number {
  const valid = values.filter((x) => Number.isFinite(x));
  if (valid.length <= 1) return 50;
  const below = valid.filter((x) => x < v).length;
  return Math.round((below / (valid.length - 1)) * 1000) / 10;
}

/** 방영시간 가중 평균 — 합칠 때 항상 이 방식을 쓴다(SQL과 동일해야 값이 어긋나지 않음). */
function weightedMean(rows: { w: number; v: number | null }[]): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.v === null || !Number.isFinite(r.v) || r.w <= 0) continue;
    num += r.v * r.w;
    den += r.w;
  }
  return den > 0 ? num / den : null;
}

// ── 01 회당 성과가 높은 프로그램 ─────────────────────────────────────────────

export function computeEfficiencyRanking(slotProfile: ProgramSlotProfileRow[], limit = 10): EfficiencyRow[] {
  const byProgram = new Map<string, ProgramSlotProfileRow[]>();
  for (const r of slotProfile) {
    const list = byProgram.get(r.canonicalName);
    if (list) list.push(r);
    else byProgram.set(r.canonicalName, [r]);
  }

  const base = [...byProgram.entries()]
    .map(([name, rows]) => {
      const airings = rows.reduce((a, r) => a + r.airings, 0);
      const airtimeMin = rows.reduce((a, r) => a + (r.airtimeMin ?? 0), 0);
      const w = rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }));
      const avgRating = weightedMean(w);
      const avgShare = weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgShare })));
      const avgReach = weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgReach })));
      const avgTimeSpentShare = weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgTimeSpentShare })));
      // 총 시청률 합산 — 방영분마다의 시청률을 그대로 더한 값(회당 평균 × 그 조합의 편성 횟수).
      const sumRating = rows.reduce((a, r) => a + (r.avgRating ?? 0) * r.airings, 0);
      return {
        canonicalName: name,
        airings,
        airtimeMin,
        avgRating,
        avgShare,
        avgReach,
        avgTimeSpentShare,
        contribution: (avgRating ?? 0) * airtimeMin,
        sumRating,
      };
    })
    // 1~2회 편성분은 극단값을 만들어 순위를 지배하므로 후보에서 아예 뺀다.
    .filter((p) => p.airings >= MIN_AIRINGS_FOR_RANKING);

  if (base.length === 0) return [];

  const ratings = base.map((p) => p.avgRating ?? 0);
  const reaches = base.map((p) => p.avgReach ?? 0);
  const tsShares = base.map((p) => p.avgTimeSpentShare ?? 0);

  const airtimes = base.map((p) => p.airtimeMin);

  // 채널의 회당 평균 시청률 — 순위 후보 전체를 방영시간 가중으로 묶은 값. "이 프로그램의 회당
  // 평균이 채널 평균을 상회하는가"가 효율 판정의 핵심 기준이므로(사용자 지시 2026-09-10)
  // 백분위와 별개로 이 절대 기준선을 함께 낸다.
  const channelAvgRating = weightedMean(slotProfile.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
  const channelAvgShare = weightedMean(slotProfile.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgShare })));
  const channelAvgReach = weightedMean(slotProfile.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgReach })));
  const channelAvgTss = weightedMean(slotProfile.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgTimeSpentShare })));

  const rows: EfficiencyRow[] = base.map((p) => {
    const ratingEfficiencyPctl = percentile(ratings, p.avgRating ?? 0);
    const reachPctl = percentile(reaches, p.avgReach ?? 0);
    const timeSpentSharePctl = percentile(tsShares, p.avgTimeSpentShare ?? 0);
    const efficiencyIndex = Math.round(((ratingEfficiencyPctl + reachPctl + timeSpentSharePctl) / 3) * 10) / 10;

    const vsChannelAvgPct =
      p.avgRating !== null && channelAvgRating !== null && channelAvgRating > 0
        ? Math.round((p.avgRating / channelAvgRating) * 1000) / 10
        : null;
    const aboveChannelAvg = vsChannelAvgPct !== null && vsChannelAvgPct > 100;

    // 시청률이 채널 평균 이하인데 점유율·도달율·시청시간 비율 중 채널 평균을 넘는 것이 있으면
    // 그 지표를 따로 붙여 둔다 — 시청률 하나로만 잘라내면 놓치는 콘텐츠를 건지기 위함.
    const compensatingMetrics: string[] = [];
    if (!aboveChannelAvg) {
      if (p.avgShare !== null && channelAvgShare !== null && p.avgShare > channelAvgShare) compensatingMetrics.push("점유율");
      if (p.avgReach !== null && channelAvgReach !== null && p.avgReach > channelAvgReach) compensatingMetrics.push("도달율");
      if (p.avgTimeSpentShare !== null && channelAvgTss !== null && p.avgTimeSpentShare > channelAvgTss)
        compensatingMetrics.push("시청시간 비율");
    }

    // 총량형 = 편성 물량은 많은데 회당 성과는 그만큼 높지 않은 경우.
    // 효율형 = 편성 물량은 적은데 회당 성과가 높은 경우 —— 단, 회당 평균이 채널 평균을
    //          실제로 상회해야 한다. 채널 내 상대 백분위만 보면 전 프로그램이 부진한 기간에도
    //          누군가는 "효율형"이 되어 버리므로, 절대 기준선을 필수 조건으로 건다.
    const airtimePctl = percentile(airtimes, p.airtimeMin);
    let programType: ProgramType = "균형형";
    if (airtimePctl - ratingEfficiencyPctl >= TYPE_PCTL_GAP) programType = "총량형";
    else if (ratingEfficiencyPctl - airtimePctl >= TYPE_PCTL_GAP && aboveChannelAvg) programType = "효율형";

    return {
      ...p,
      channelAvgRating,
      vsChannelAvgPct,
      aboveChannelAvg,
      compensatingMetrics,
      airtimePctl,
      ratingEfficiencyPctl,
      reachPctl,
      timeSpentSharePctl,
      efficiencyIndex,
      programType,
    };
  });

  return rows.sort((a, b) => b.efficiencyIndex - a.efficiencyIndex).slice(0, limit);
}

// ── 01b 저시청 시간대 주목 콘텐츠 ────────────────────────────────────────────
//
// 사용자 지시(2026-09-10): "02~08시는 원래 시청률이 낮기 때문에 그 시간대에 편성되는 콘텐츠들은
// 그 요일/시간대 평균보다 시청률이 높거나, 점유율이 높거나, 시청시간이 길면 그 부분은 주목해야
// 한다." 채널 전체 평균과 비교하면 새벽 편성물은 예외 없이 전부 '이하'로 나와 한 건도 건지지
// 못한다. 그래서 채널 평균이 아니라 **그 프로그램이 실제로 놓인 시간대의 채널 평균**을 기준선으로
// 삼는다.
//
// 정직하게 밝히는 한계: 기준선은 요일이 아니라 시간대(hour) 단위다. 프로그램 × 요일 × 시간대
// 3원 교차는 6개월 구간에서 1,578행이 나와 PostgREST 1000행 캡을 넘기므로 수집하지 않았고,
// 새벽 효과는 요일보다 시각이 지배하므로 시간대 기준선으로도 판정이 성립한다고 판단했다.

/** 원래 시청률이 낮게 형성되는 시간대 — 방송일 기준 02~08시(닐슨 관행의 하루 시작 구간). */
export const LOW_RATING_HOURS = { from: 2, to: 8 } as const;

export interface SlotRelativeRow {
  canonicalName: string;
  airings: number;
  /** 이 프로그램 방영시간의 몇 %가 저시청 시간대(02~08시)에 있는지. */
  lowSlotAirtimePct: number;
  avgRating: number | null;
  avgShare: number | null;
  avgTimeSpentShare: number | null;
  /** 그 프로그램이 놓인 시간대들의 채널 평균(방영시간 가중) — 비교 기준선. */
  slotBaselineRating: number | null;
  slotBaselineShare: number | null;
  slotBaselineTimeSpentShare: number | null;
  /** 기준선 대비 비율(%). 100을 넘으면 같은 시간대 채널 평균을 상회한다는 뜻. */
  slotRatingPct: number | null;
  slotSharePct: number | null;
  slotTimeSpentPct: number | null;
  /** 기준선을 넘은 지표 이름 — 하나라도 있으면 주목 대상이다. */
  standoutMetrics: string[];
}

/**
 * 프로그램이 놓인 시간대의 채널 평균 대비 성과.
 * lowSlotOnly=true면 방영시간의 절반 이상이 02~08시인 프로그램만 남긴다.
 */
export function computeSlotRelativePerformance(
  slotProfile: ProgramSlotProfileRow[],
  opts: { lowSlotOnly?: boolean; limit?: number } = {}
): SlotRelativeRow[] {
  const { lowSlotOnly = false, limit = 8 } = opts;

  // 시간대별 채널 기준선 — 전 프로그램을 그 시각으로 묶은 방영시간 가중 평균.
  const baselineByHour = new Map<number, { rating: number | null; share: number | null; tss: number | null }>();
  const hours = new Set(slotProfile.map((r) => r.broadcastHour));
  for (const h of hours) {
    const rows = slotProfile.filter((r) => r.broadcastHour === h);
    baselineByHour.set(h, {
      rating: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }))),
      share: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgShare }))),
      tss: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgTimeSpentShare }))),
    });
  }

  const byProgram = new Map<string, ProgramSlotProfileRow[]>();
  for (const r of slotProfile) {
    const list = byProgram.get(r.canonicalName);
    if (list) list.push(r);
    else byProgram.set(r.canonicalName, [r]);
  }

  const out: SlotRelativeRow[] = [];
  for (const [name, rows] of byProgram) {
    const airings = rows.reduce((a, r) => a + r.airings, 0);
    if (airings < MIN_AIRINGS_FOR_RANKING) continue;

    const totalAirtime = rows.reduce((a, r) => a + (r.airtimeMin ?? 0), 0);
    const lowAirtime = rows
      .filter((r) => r.broadcastHour >= LOW_RATING_HOURS.from && r.broadcastHour < LOW_RATING_HOURS.to)
      .reduce((a, r) => a + (r.airtimeMin ?? 0), 0);
    const lowSlotAirtimePct = totalAirtime > 0 ? Math.round((lowAirtime / totalAirtime) * 1000) / 10 : 0;
    if (lowSlotOnly && lowSlotAirtimePct < 50) continue;

    const w = (v: (r: ProgramSlotProfileRow) => number | null) => weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: v(r) })));
    // 기준선도 그 프로그램의 방영시간 분포로 가중한다 — 같은 시간대 조합끼리 비교하기 위함.
    const wb = (pick: (b: { rating: number | null; share: number | null; tss: number | null }) => number | null) =>
      weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: pick(baselineByHour.get(r.broadcastHour) ?? { rating: null, share: null, tss: null }) })));

    const avgRating = w((r) => r.avgRating);
    const avgShare = w((r) => r.avgShare);
    const avgTimeSpentShare = w((r) => r.avgTimeSpentShare);
    const slotBaselineRating = wb((b) => b.rating);
    const slotBaselineShare = wb((b) => b.share);
    const slotBaselineTimeSpentShare = wb((b) => b.tss);

    const pct = (v: number | null, b: number | null) => (v !== null && b !== null && b > 0 ? Math.round((v / b) * 1000) / 10 : null);
    const slotRatingPct = pct(avgRating, slotBaselineRating);
    const slotSharePct = pct(avgShare, slotBaselineShare);
    const slotTimeSpentPct = pct(avgTimeSpentShare, slotBaselineTimeSpentShare);

    const standoutMetrics: string[] = [];
    if (slotRatingPct !== null && slotRatingPct > 100) standoutMetrics.push("시청률");
    if (slotSharePct !== null && slotSharePct > 100) standoutMetrics.push("점유율");
    if (slotTimeSpentPct !== null && slotTimeSpentPct > 100) standoutMetrics.push("시청시간 비율");

    out.push({
      canonicalName: name,
      airings,
      lowSlotAirtimePct,
      avgRating,
      avgShare,
      avgTimeSpentShare,
      slotBaselineRating,
      slotBaselineShare,
      slotBaselineTimeSpentShare,
      slotRatingPct,
      slotSharePct,
      slotTimeSpentPct,
      standoutMetrics,
    });
  }

  return out
    .filter((r) => !lowSlotOnly || r.standoutMetrics.length > 0)
    .sort((a, b) => b.standoutMetrics.length - a.standoutMetrics.length || (b.slotRatingPct ?? 0) - (a.slotRatingPct ?? 0))
    .slice(0, limit);
}

// ── 02 주요시간이 만든 차이 ──────────────────────────────────────────────────

/** 채널 전체의 주요/비주요 배율 — 프로그램별 배율을 이 기준선 대비로 읽어야
 *  "주요시간이라 다 오르는 효과"와 "이 프로그램이 특히 강한 것"이 구분된다. */
export function computeChannelPrimeBaseline(slotProfile: ProgramSlotProfileRow[]): number | null {
  const prime = weightedMean(slotProfile.filter((r) => r.isPrime).map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
  const off = weightedMean(slotProfile.filter((r) => !r.isPrime).map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
  if (prime === null || off === null || off === 0) return null;
  return Math.round((prime / off) * 100) / 100;
}

export function computePrimeGap(slotProfile: ProgramSlotProfileRow[], limit = 8): PrimeGapRow[] {
  const byProgram = new Map<string, ProgramSlotProfileRow[]>();
  for (const r of slotProfile) {
    const list = byProgram.get(r.canonicalName);
    if (list) list.push(r);
    else byProgram.set(r.canonicalName, [r]);
  }

  const rows: PrimeGapRow[] = [...byProgram.entries()]
    .map(([name, all]) => {
      const p = all.filter((r) => r.isPrime);
      const o = all.filter((r) => !r.isPrime);
      const primeAirings = p.reduce((a, r) => a + r.airings, 0);
      const offPrimeAirings = o.reduce((a, r) => a + r.airings, 0);
      const primeAvgRating = weightedMean(p.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
      const offPrimeAvgRating = weightedMean(o.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
      const primeRatio =
        primeAvgRating !== null && offPrimeAvgRating !== null && offPrimeAvgRating > 0
          ? Math.round((primeAvgRating / offPrimeAvgRating) * 100) / 100
          : null;
      // 한쪽 표본이 3회 미만이거나 10배 이상 쏠려 있으면 배율을 그대로 믿기 어렵다고 표시한다.
      const minAir = Math.min(primeAirings, offPrimeAirings);
      const maxAir = Math.max(primeAirings, offPrimeAirings);
      const sampleSkewed = minAir < MIN_AIRINGS_FOR_RANKING || (minAir > 0 && maxAir / minAir >= 10);
      return { canonicalName: name, primeAirings, primeAvgRating, offPrimeAirings, offPrimeAvgRating, primeRatio, sampleSkewed };
    })
    .filter((r) => r.primeAirings > 0 && r.offPrimeAirings > 0);

  return rows.sort((a, b) => (b.primeRatio ?? 0) - (a.primeRatio ?? 0)).slice(0, limit);
}

// ── 03 프로그램별 시간대·타깃 프로파일 ───────────────────────────────────────

export function computeProgramProfiles(
  slotProfile: ProgramSlotProfileRow[],
  targetProfile: ProgramTargetProfileRow[],
  limit = 8
): ProgramProfile[] {
  // 채널의 타깃별 기준선 — 같은 연령대끼리만 비교해야 지수가 의미를 갖는다.
  const baselineByTarget = new Map<string, number | null>();
  const targetsSeen = new Set(targetProfile.map((t) => t.demographicLabel));
  for (const label of targetsSeen) {
    const rows = targetProfile.filter((t) => t.demographicLabel === label);
    baselineByTarget.set(label, weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }))));
  }

  const ranked = computeEfficiencyRanking(slotProfile, limit);

  return ranked.map((p) => {
    const slotRows = slotProfile.filter((r) => r.canonicalName === p.canonicalName);
    const byHour = new Map<number, ProgramSlotProfileRow[]>();
    for (const r of slotRows) {
      const list = byHour.get(r.broadcastHour);
      if (list) list.push(r);
      else byHour.set(r.broadcastHour, [r]);
    }
    const hourPoints: HourPoint[] = [...byHour.entries()]
      .map(([hour, rows]) => ({
        hour,
        airings: rows.reduce((a, r) => a + r.airings, 0),
        avgRating: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }))),
        isPrime: rows.some((r) => r.isPrime),
      }))
      .sort((a, b) => a.hour - b.hour);

    const withValue = hourPoints.filter((h) => h.avgRating !== null);
    const peak = withValue.length > 0 ? withValue.reduce((m, h) => ((h.avgRating ?? 0) > (m.avgRating ?? 0) ? h : m)) : null;
    const weakest = withValue.length > 0 ? withValue.reduce((m, h) => ((h.avgRating ?? 0) < (m.avgRating ?? 0) ? h : m)) : null;

    const tRows = targetProfile.filter((t) => t.canonicalName === p.canonicalName);
    const byTarget = new Map<string, ProgramTargetProfileRow[]>();
    for (const t of tRows) {
      const list = byTarget.get(t.demographicLabel);
      if (list) list.push(t);
      else byTarget.set(t.demographicLabel, [t]);
    }
    const targetPoints: TargetIndexPoint[] = [...byTarget.entries()].map(([label, rows]) => {
      const avgRating = weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating })));
      const channelBaseline = baselineByTarget.get(label) ?? null;
      const index =
        avgRating !== null && channelBaseline !== null && channelBaseline > 0
          ? Math.round((avgRating / channelBaseline) * 100)
          : null;
      return { demographicLabel: label, avgRating, channelBaseline, index };
    });

    const strongTargets = targetPoints
      .filter((t) => t.index !== null && t.index >= TARGET_INDEX_STRONG)
      .sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
    const weakTargets = targetPoints
      .filter((t) => t.index !== null && t.index <= TARGET_INDEX_WEAK)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    // 도달율과 시청시간 비율은 채널 내 백분위로 이미 계산돼 있으니 그 조합만 라벨링한다.
    const wide = p.reachPctl >= 50;
    const deep = p.timeSpentSharePctl >= 50;
    const engagementType =
      p.avgReach === null || p.avgTimeSpentShare === null
        ? null
        : wide && deep
          ? ("넓고 오래" as const)
          : wide && !deep
            ? ("넓지만 짧게" as const)
            : !wide && deep
              ? ("좁지만 오래" as const)
              : ("좁고 짧게" as const);

    return {
      canonicalName: p.canonicalName,
      airings: p.airings,
      hourPoints,
      peakHour: peak?.hour ?? null,
      peakRating: peak?.avgRating ?? null,
      weakestHour: weakest?.hour ?? null,
      weakestRating: weakest?.avgRating ?? null,
      targetPoints: targetPoints.sort((a, b) => (b.index ?? 0) - (a.index ?? 0)),
      strongTargets,
      weakTargets,
      engagementType,
    };
  });
}

// ── 04 요일 × 시간대 편성 배분과 성과 ────────────────────────────────────────

export function computeQuadrants(dowHourProfile: DowHourProfileRow[]): QuadrantRow[] {
  const combos: { dayType: string; isPrime: boolean }[] = [
    { dayType: "평일", isPrime: true },
    { dayType: "평일", isPrime: false },
    { dayType: "주말·공휴일", isPrime: true },
    { dayType: "주말·공휴일", isPrime: false },
  ];
  return combos.map(({ dayType, isPrime }) => {
    const rows = dowHourProfile.filter((r) => r.dayType === dayType && r.isPrime === isPrime);
    return {
      dayType,
      primeLabel: isPrime ? "주요시간" : "그 외",
      airings: rows.reduce((a, r) => a + r.airings, 0),
      airtimeMin: rows.reduce((a, r) => a + (r.airtimeMin ?? 0), 0),
      avgRating: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }))),
      avgShare: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgShare }))),
      avgReach: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgReach }))),
      avgTimeSpentShare: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgTimeSpentShare }))),
    };
  });
}

export function computeDowHourCells(dowHourProfile: DowHourProfileRow[]): DowHourCell[] {
  const byCell = new Map<string, DowHourProfileRow[]>();
  for (const r of dowHourProfile) {
    const key = `${r.dow}_${r.broadcastHour}`;
    const list = byCell.get(key);
    if (list) list.push(r);
    else byCell.set(key, [r]);
  }
  return [...byCell.values()]
    .map((rows) => ({
      dow: rows[0].dow,
      dowLabel: rows[0].dowLabel,
      hour: rows[0].broadcastHour,
      isPrime: rows.some((r) => r.isPrime),
      airings: rows.reduce((a, r) => a + r.airings, 0),
      avgRating: weightedMean(rows.map((r) => ({ w: r.airtimeMin ?? 0, v: r.avgRating }))),
    }))
    .sort((a, b) => a.dow - b.dow || a.hour - b.hour);
}

/**
 * 이동 후보 — 편성 시간을 많이 쓰는데 회당 성과는 낮은 (요일, 시간대)와 그 반대.
 * 상·하위 3분위로만 가르는 단순 규칙이며(신규 v1 휴리스틱), 원인을 단정하지 않고
 * "확인해볼 지점"으로만 제시한다.
 */
export function computeMoveCandidates(cells: DowHourCell[], lowLimit = 3, highLimit = 2): MoveCandidate[] {
  // 편성 3회 미만 셀은 제외한다. 실측에서 이 가드가 없으니 "화 21시 1회 0.412" 같은 단발
  // 편성이 "성과 대비 편성 적음" 후보로 올라왔다 — 1회 방영분의 성과를 근거로 편성을 늘리라고
  // 제안하는 것은 위험하다. 순위 계산 자체에서도 빼야 상·하위 3분위가 왜곡되지 않는다.
  const usable = cells.filter((c) => c.avgRating !== null && c.airings >= MIN_AIRINGS_FOR_RANKING);
  if (usable.length < 6) return [];

  const byAirtime = [...usable].sort((a, b) => b.airings - a.airings);
  const byRating = [...usable].sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));
  const tertile = Math.max(1, Math.floor(usable.length / 3));
  const topAirtime = new Set(byAirtime.slice(0, tertile).map((c) => `${c.dow}_${c.hour}`));
  const bottomAirtime = new Set(byAirtime.slice(-tertile).map((c) => `${c.dow}_${c.hour}`));
  const topRating = new Set(byRating.slice(0, tertile).map((c) => `${c.dow}_${c.hour}`));
  const bottomRating = new Set(byRating.slice(-tertile).map((c) => `${c.dow}_${c.hour}`));

  const out: MoveCandidate[] = [];
  for (const c of byAirtime) {
    const key = `${c.dow}_${c.hour}`;
    if (topAirtime.has(key) && bottomRating.has(key)) {
      out.push({ dow: c.dow, dowLabel: c.dowLabel, hour: c.hour, airings: c.airings, avgRating: c.avgRating, kind: "편성 대비 성과 낮음" });
    }
    if (out.filter((o) => o.kind === "편성 대비 성과 낮음").length >= lowLimit) break;
  }
  for (const c of byRating) {
    const key = `${c.dow}_${c.hour}`;
    if (topRating.has(key) && bottomAirtime.has(key)) {
      out.push({ dow: c.dow, dowLabel: c.dowLabel, hour: c.hour, airings: c.airings, avgRating: c.avgRating, kind: "성과 대비 편성 적음" });
    }
    if (out.filter((o) => o.kind === "성과 대비 편성 적음").length >= highLimit) break;
  }
  return out;
}

// ── 오리지널 재방 확산 / 본방 효율 ───────────────────────────────────────────

export function computeOriginalRerunInsights(rows: OriginalRerunProfileRow[]): OriginalRerunInsight[] {
  return rows.map((r) => ({
    canonicalName: r.canonicalName,
    category: r.category,
    liveEpisodes: r.liveEpisodes,
    liveAvgRating: r.liveAvgRating,
    rerunChannelCode: r.rerunChannelCode,
    rerunAvgRating: r.rerunAvgRating,
    retentionPct: r.rerunRetentionPct,
    immediateRerunEpisodes: r.immediateRerunEpisodes,
    sameDayRerunEpisodes: r.sameDayRerunEpisodes,
    selfRerunEpisodes: r.selfRerunEpisodes,
    windowAirings: r.windowAirings,
    windowSumRating: r.windowSumRating,
    amplificationRatio: r.amplificationRatio,
    // 확산 배수는 "본방 1회분이 재방까지 포함해 몇 배를 벌었나"이므로 1.0이 하한이다.
    // 3배 이상이면 재방 기여가 본방의 2배를 넘는다는 뜻이라 확산이 크다고 본다(v1 기준).
    amplificationLabel:
      r.amplificationRatio === null
        ? null
        : r.amplificationRatio >= 3
          ? "확산 큼"
          : r.amplificationRatio >= 1.8
            ? "확산 보통"
            : "확산 낮음",
  }));
}

export function computeFirstRunInsights(rows: FirstRunEfficiencyRow[], limit = 8): FirstRunInsight[] {
  return rows
    .filter((r) => r.firstRunAirings > 0)
    .slice(0, limit)
    .map((r) => ({
      canonicalName: r.canonicalName,
      firstRunAirings: r.firstRunAirings,
      firstRunAvgRating: r.firstRunAvgRating,
      otherAirings: r.otherAirings,
      otherAvgRating: r.otherAvgRating,
      retentionPct: r.rerunRetentionPct,
    }));
}
