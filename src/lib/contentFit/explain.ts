// 콘텐츠 적합도 설명 문구 — 화면·보고서·질의응답이 같은 말을 쓰도록 한 곳에서 만든다(순수 함수).
// 원칙: 계산된 값만 인용한다(새 숫자를 만들지 않는다). 원인을 단정하지 않고 관찰된 사실과 검토 방향만 말한다.

import { josaEunNeun, josaIga } from "../josa";
import { CONTENT_FIT_CONFIG } from "./config";
import type { ContentFitItem, ContentFitTag, Daypart } from "./types";

/** 배수 표기: 소수 둘째 자리("1.34배"). */
export const fmtTimes = (x: number | null | undefined): string => (x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x.toFixed(2)}배`);

export const DAYPART_KO: Record<Daypart, string> = { 새벽: "새벽(02~08시)", 오전: "오전(09~13시)", 오후: "오후(14~18시)", 저녁_심야: "저녁·심야(19시~)" };

/** 최근 4주 vs 이전 8주 변화율(%) — log2 변화량을 상대 변화로 되돌린 값. */
export function trendPct(item: ContentFitItem): number | null {
  if (!item.trend) return null;
  return Math.round((2 ** item.trend.delta - 1) * 100);
}

/** 추세 상한: 소표본에서 극단값이 숫자로 튀지 않게 +300% 이상은 "300% 이상"으로 줄여 표기한다. */
export const TREND_PCT_DISPLAY_CAP = 300;

export function describeTrend(item: ContentFitItem): string | null {
  const p = trendPct(item);
  if (p === null) return null;
  if (p <= -10) return `최근 4주 성과가 이전 8주보다 ${Math.abs(p)}% 낮아졌습니다.`;
  if (p > TREND_PCT_DISPLAY_CAP) return `최근 4주 성과가 이전 8주보다 ${TREND_PCT_DISPLAY_CAP}% 이상 높아졌습니다.`;
  if (p >= 10) return `최근 4주 성과가 이전 8주보다 ${p}% 높아졌습니다.`;
  return "최근 4주 성과는 이전 8주와 비슷합니다.";
}

/** 표 칸용 짧은 추세 표기: ▲39% / ▼20% / 비슷(±10% 미만) / —(계산 불가). 방향은 direction으로도 돌려줘 화면이 색을 고른다. */
export function formatTrendCell(item: ContentFitItem): { text: string; direction: "up" | "down" | "flat" | null } {
  const p = trendPct(item);
  if (p === null) return { text: "—", direction: null };
  if (p >= 10) return { text: p > TREND_PCT_DISPLAY_CAP ? `▲${TREND_PCT_DISPLAY_CAP}%+` : `▲${p}%`, direction: "up" };
  if (p <= -10) return { text: `▼${Math.abs(p)}%`, direction: "down" };
  return { text: "비슷", direction: "flat" };
}

/** 시청자 유형(도달률·시청시간 비율을 같은 시간대 다른 프로그램과 견준 배수 기준, ±15%). */
export type AudienceRole = "MASS" | "CORE" | "ACQUISITION" | "ZAPPING_RISK";
export function audienceRoleOf(item: Pick<ContentFitItem, "reachIndex" | "timeSpentIndex">): AudienceRole | null {
  const r = item.reachIndex;
  const t = item.timeSpentIndex;
  if (r === null || t === null) return null;
  const highR = r >= 1.15;
  const lowR = r <= 0.85;
  const highT = t >= 1.15;
  const lowT = t <= 0.85;
  if (highR && highT) return "MASS";
  if (lowR && highT) return "CORE";
  if (highR && lowT) return "ACQUISITION";
  if (lowR && lowT) return "ZAPPING_RISK";
  return null;
}

/**
 * 콘텐츠 유형(표의 배지, 2026-10-15 사용자 요청으로 '균형' 등 유형 판단을 다시 제공): 슬롯 대비 성과(S)와 시청 규모(A)를 1.0배 기준선으로 나눈 모양이다 — 판정(강화·유지·관찰…)과는 별개의 설명이다.
 *  - 균형: 두 값이 모두 평균(1.0배) 근처(0.85배 초과 1.15배 미만) — 한쪽으로 쏠리지 않았다는 뜻이며 좋고 나쁨의 판단이 아니다.
 *  - 주력: S ≥ 1.0 이고 A ≥ 1.0 — 자리 기대도 넘고 규모도 큰 채널의 주축.
 *  - 효율: S ≥ 1.0 이고 A < 1.0 — 적게 틀어도 자리 기대 이상.
 *  - 총량: S < 1.0 이고 A ≥ 1.0 — 규모·좋은 자리에 기댄 성과(자리 대비로는 평균 미만).
 *  - 부진: S < 1.0 이고 A < 1.0 — 자리 대비도 규모도 평균 미만.
 * 정식 판정(FORMAL) 구간에만 붙인다 — 표본이 적은 참고·보류 구간은 값이 평균 쪽으로 보정돼 있어 유형을 말하지 않는다.
 */
export type FitType = "주력" | "효율" | "총량" | "균형" | "부진";
/** 옛 이름(규모 모양) — 호환용 별칭 */
export type FitShape = FitType;
export const FIT_TYPE_NEAR_LOW = 0.85;
export const FIT_TYPE_NEAR_HIGH = 1.15;
export function fitTypeOf(item: Pick<ContentFitItem, "tier" | "slotIndex" | "scaleIndex">): FitType | null {
  if (item.tier !== "FORMAL" || item.slotIndex === null || item.scaleIndex === null) return null;
  const s = item.slotIndex;
  const a = item.scaleIndex;
  const near = (x: number) => x > FIT_TYPE_NEAR_LOW && x < FIT_TYPE_NEAR_HIGH;
  if (near(s) && near(a)) return "균형";
  if (s >= 1) return a >= 1 ? "주력" : "효율";
  return a >= 1 ? "총량" : "부진";
}
export const FIT_TYPE_NOTE: Record<FitType, string> = {
  주력: "같은 시간대 다른 프로그램보다 잘 나오고 채널 평균보다 규모도 큽니다 — 채널의 주축입니다.",
  효율: "채널 평균보다 작은 규모지만 같은 시간대 다른 프로그램보다는 잘 나옵니다 — 적게 틀어도 자리 기대 이상입니다.",
  총량: "채널 평균 이상의 규모로 보이지만 같은 시간대 다른 프로그램보다는 못 나옵니다 — 규모와 좋은 자리에 기댄 성과입니다.",
  균형: "규모와 시간대 대비 성과가 모두 평균(1.0배) 근처입니다 — 한쪽으로 쏠리지 않았다는 뜻이며 좋고 나쁨의 판단은 아닙니다.",
  부진: "같은 시간대 다른 프로그램보다도, 채널 평균보다도 낮습니다.",
};
/** 유형별 개수 문장("주력 3개 · 균형 2개 …") — 개수가 있는 유형만, 정식 판정 구간 기준 */
export function fitTypeSummary(items: Pick<ContentFitItem, "tier" | "slotIndex" | "scaleIndex">[]): string {
  const order: FitType[] = ["주력", "효율", "총량", "균형", "부진"];
  const counts = new Map<FitType, number>();
  for (const it of items) {
    const t = fitTypeOf(it);
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const parts = order.filter((t) => (counts.get(t) ?? 0) > 0).map((t) => `${t} ${counts.get(t)}개`);
  return parts.length === 0 ? "" : `유형: ${parts.join(" · ")}.`;
}

export interface ContentFitExplanation {
  /** 한 줄 결론(판정 근거 포함). */
  headline: string;
  /** 규모·표본 설명. */
  basis: string;
  /** 추세 문장(계산됐을 때만). */
  trend: string | null;
}

/** 프로그램 한 줄 해설. 제목은 표에 이미 보이므로 문장에 되풀이하지 않는다(2026-10-15 사용자 요청) — name은 호환용으로만 받는다. */
export function explainContentFit(item: ContentFitItem, _name?: string): ContentFitExplanation {
  if (item.tier === "HOLD" || item.slotIndex === null || item.scaleIndex === null) {
    return {
      headline: `방영 ${item.sampleDays}일뿐이라 판단을 보류합니다.`,
      basis: "방영 3일 이상 쌓이면 점수를 계산합니다.",
      trend: null,
    };
  }
  const L = fmtTimes(item.slotIndex);
  const A = fmtTimes(item.scaleIndex);
  const base = `동시간대 평균 ${L}`;
  const basis = `채널 평균 ${A}, 최근 12주 중 ${item.sampleDays}일(${item.airings}회) 방영 기준입니다.`;
  const trend = describeTrend(item);

  if (item.tier === "REFERENCE") {
    const lean = item.lean === "ABOVE" ? "지금까지는 슬롯 평균보다 높은 흐름" : item.lean === "BELOW" ? "지금까지는 슬롯 평균보다 낮은 흐름" : "지금까지는 슬롯 평균 수준의 흐름";
    const why = item.sampleDays < 8 ? `방영 ${item.sampleDays}일로 표본이 적어` : "방영 시청 규모가 작아";
    return {
      headline: `${why} 참고용입니다 — ${lean}입니다(동시간대 평균 ${L} · 채널 평균 ${A}, 표본이 적어 평균 쪽으로 보정한 값).`,
      basis,
      trend,
    };
  }
  const pctOfSlot = Math.round(item.slotIndex * 100);
  switch (item.tag as ContentFitTag) {
    case "STRENGTHEN":
      return { headline: `${base}로 뚜렷하게 앞서 있어, 노출 확대나 더 좋은 시간대 편성을 검토할 만합니다.`, basis, trend };
    case "KEEP":
      return {
        headline:
          item.slotIndex >= 1
            ? `${base}로 같은 자리 기대 수준 이상이라 현재 편성을 유지해도 됩니다.`
            : `${base}로 같은 자리의 평균 수준이라 현재 편성을 유지해도 됩니다.`,
        basis,
        trend,
      };
    case "WATCH":
      return {
        headline:
          item.slotIndex >= 0.85
            ? `${base}로 아직 기대 수준이지만 최근 하락이 보여 다음 몇 주를 지켜볼 만합니다.`
            : `${base}(동시간대 평균의 ${pctOfSlot}%)로 기대에 못 미쳐 다음 몇 주를 지켜볼 만합니다.`,
        basis,
        trend,
      };
    case "MOVE":
      return {
        headline: `${base}(평균의 ${pctOfSlot}%)로 낮은 편이지만, ${item.moveTo ? DAYPART_KO[item.moveTo] : "다른 시간대"}에서는 평균 이상을 냈습니다 — 그 시간대로 옮기는 것을 검토할 만합니다.`,
        basis,
        trend,
      };
    case "REPLACE":
      return {
        headline: `${base}(동시간대 평균의 ${pctOfSlot}%)로 기대에 크게 못 미칩니다 — 교체 또는 시간대 변경을 검토할 만합니다.`,
        basis,
        trend,
      };
    default:
      return { headline: "판정 근거를 계산하지 못했습니다.", basis, trend };
  }
}

/**
 * "무엇을 편성할까요?" 표의 조치 한 줄 — 핵심 수치(동시간대 평균·채널 평균)를 앞에, 조치를 뒤에 짧게 적는다(2026-10-15 사용자 요청).
 * 예: "동시간대 평균 0.94배 · 채널 평균 1.06배 - 편성 유지" / 표본이 적어도 수치를 앞에: "채널 평균 2.59배 · 동시간대 평균 0.88배 - 표본 적음(방영 6일), 8일 이상 쌓인 뒤 재평가".
 */
export function scheduleAction(item: ContentFitItem): string {
  if (item.tier === "HOLD") return `방영 ${item.sampleDays}일 - 판단 보류(${CONTENT_FIT_CONFIG.minDays}일 이상 쌓이면 계산)`;
  const L = fmtTimes(item.slotIndex);
  const A = fmtTimes(item.scaleIndex);
  if (item.tier === "REFERENCE" || item.tag === "TEST") {
    const left = Math.max(1, CONTENT_FIT_CONFIG.fullDays - item.sampleDays);
    return `채널 평균 ${A} · 동시간대 평균 ${L} - 표본 적음(방영 ${item.sampleDays}일), ${left}일 더 쌓인 뒤 재평가`;
  }
  const nums = `동시간대 평균 ${L} · 채널 평균 ${A}`;
  switch (item.tag) {
    case "STRENGTHEN":
      return `${nums} - 노출 확대·더 좋은 시간대 편성 검토`;
    case "KEEP":
      return `${nums} - 편성 유지`;
    case "WATCH":
      return item.slotIndex !== null && item.slotIndex >= CONTENT_FIT_CONFIG.cut.keep ? `${nums} - 기대 수준이지만 최근 하락, 몇 주 더 관찰` : `${nums} - 기대에 못 미쳐 몇 주 더 관찰`;
    case "MOVE":
      return `${nums} - ${item.moveTo ? DAYPART_KO[item.moveTo] : "다른 시간대"}로 이동 검토(그곳에서는 평균 이상)`;
    case "REPLACE":
      return `${nums} - 교체 또는 시간대 변경 검토`;
    default:
      return "—";
  }
}

/** 옛 이름(호환) — scheduleAction과 같다. */
export const scheduleNote = scheduleAction;

/** 다음에 무엇을 보면 판정이 바뀌는지 — 판정 선(config.cut)을 그대로 인용한다(새 기준을 만들지 않는다). */
export function scheduleCheck(item: ContentFitItem): string {
  const { strengthen, keep, watch } = CONTENT_FIT_CONFIG.cut;
  if (item.tier === "HOLD") return `방영 ${CONTENT_FIT_CONFIG.minDays}일 이상 쌓이면 계산`;
  if (item.tier === "REFERENCE" || item.tag === "TEST") return `방영 ${CONTENT_FIT_CONFIG.fullDays}일 이상 쌓이면 정식 판정`;
  switch (item.tag) {
    case "STRENGTHEN":
      return `동시간대 평균 ${strengthen}배 아래로 내려가면 '유지'로 낮춰 봅니다`;
    case "KEEP":
      return `동시간대 평균 ${keep}배 아래로 내려가면 '관찰'로 바뀝니다`;
    case "WATCH":
      // 같은 시간대 평균 이상인데 최근 하락 때문에 한 단계 낮춰 본 경우와, 평균에 못 미쳐 관찰인 경우의 확인 기준이 다르다
      return item.slotIndex !== null && item.slotIndex >= keep ? "최근 4주 하락이 멈추면 '유지'로 돌아갑니다" : `${keep}배 이상 회복하면 '유지', ${watch}배 아래로 내려가면 '교체 검토'`;
    case "MOVE":
    case "REPLACE":
      return `옮긴(바꾼) 뒤 동시간대 평균 ${keep}배 이상이면 자리 잡은 것으로 봅니다`;
    default:
      return "—";
  }
}

/** 조치 묶음 — 결정이 필요한 것부터. 1 먼저 결정(교체·이동 검토) / 2 더 지켜볼 것(관찰·표본 적음·보류) / 3 확대할 것(강화) / 4 그대로 둘 것(유지) */
export type ScheduleGroup = 1 | 2 | 3 | 4;
export const SCHEDULE_GROUP_LABEL: Record<ScheduleGroup, string> = { 1: "먼저 결정할 것", 2: "더 지켜볼 것", 3: "확대할 것", 4: "그대로 둘 것" };
export function scheduleGroupOf(item: Pick<ContentFitItem, "tier" | "tag">): ScheduleGroup {
  if (item.tier !== "FORMAL" || item.tag === "TEST") return 2;
  if (item.tag === "REPLACE" || item.tag === "MOVE") return 1;
  if (item.tag === "WATCH") return 2;
  if (item.tag === "STRENGTHEN") return 3;
  return 4;
}

/** 어떤 기준으로 "같은 시간대 평균"을 구했는지(방영 건수 비율). 채널 전체 평균 비중이 크면 시간대 비교 표본이 적었다는 뜻이라 함께 알린다. */
export function describeBaseline(item: Pick<ContentFitItem, "tier" | "baselineShare">): string | null {
  if (item.tier === "HOLD") return null;
  const s = item.baselineShare;
  const parts: string[] = [];
  const add = (label: string, v: number) => {
    if (v >= 0.05) parts.push(`${label} ${Math.round(v * 100)}%`);
  };
  add("같은 요일·시각", s.slot);
  add("같은 요일·시간대", s.dowDaypart);
  add("같은 시간대", s.daypart);
  add("채널 전체", s.channel);
  if (parts.length === 0) return null;
  const caution = s.channel >= 0.5 ? " — 같은 시간대 비교 표본이 적어 채널 전체 평균과 견준 비중이 큽니다" : "";
  return `비교 기준(방영 건수 비율): ${parts.join(" · ")}${caution}`;
}

/** 표 아래 한 문장: 가장 도움이 되는 프로그램과 가장 부진한 프로그램(정식 판정 대상만). */
export function summarizeTable(items: ContentFitItem[], nameOf: (programId: string) => string): string {
  const formal = items.filter((i) => i.tier === "FORMAL" && i.score !== null && i.slotIndex !== null);
  const reference = items.filter((i) => i.tier === "REFERENCE").length;
  const hold = items.filter((i) => i.tier === "HOLD").length;
  const tail = [reference > 0 ? `방영 8일 미만 등 표본이 적은 ${reference}개는 참고용` : "", hold > 0 ? `방영 3일 미만 ${hold}개는 판단 보류` : ""].filter(Boolean).join(", ");
  if (formal.length < 2) return tail ? `정식 판정할 만큼 방영이 쌓인 프로그램이 2개 미만입니다. ${tail}입니다.` : "";
  const best = formal[0];
  const worst = formal[formal.length - 1];
  const bn = nameOf(best.programId);
  const wn = nameOf(worst.programId);
  const worstTail = worst.tag === "REPLACE" || worst.tag === "MOVE" ? "로 가장 낮아 교체 검토 대상입니다" : "로 가장 낮습니다";
  return `'${bn}'${josaIga(bn)} 동시간대 평균 ${fmtTimes(best.slotIndex)}로 채널에 가장 도움이 되고, '${wn}'${josaEunNeun(wn)} ${fmtTimes(worst.slotIndex)}${worstTail}.${tail ? ` ${tail}입니다.` : ""}`;
}

/** 표 위 안내문(읽는 법) — 용어를 풀어 쓴다. */
export const CONTENT_FIT_LEGEND = {
  intro:
    "최근 12주 방영을 같은 요일·시간대의 다른 프로그램과 견줍니다. 슬롯 대비 성과는 그 자리에서 다른 프로그램이 평균적으로 낸 시청률의 몇 배인지, 시청 규모는 채널 평균 방영 시청률의 몇 배인지입니다(1.0배가 기준). 두 값을 같은 비중으로 합치고, 시청 몰입도와 최근 4주 추세는 점수를 소폭(최대 +10·−15점)만 조정합니다.",
  reliability:
    "방영 일수가 적을수록 점수를 기준(1.0배) 쪽으로 보정하고, 8일 미만이면 판정 없이 참고용으로, 3일 미만이면 판단을 보류합니다.",
  verdict:
    "판정은 슬롯 대비 성과로 내립니다 — 1.5배 이상 강화 검토, 0.85~1.5배 유지, 0.55~0.85배 관찰, 0.55배 미만 교체 검토(최근 4주 하락이 크면 한 단계 낮춰 봅니다). 이 선은 판정 후 4주 안에 실제로 편성에서 빠진 비율이 달라지는 지점을 근거로 정했습니다.",
  type:
    "유형은 슬롯 대비 성과와 시청 규모를 1.0배 기준으로 나눈 설명이며 판정과는 별개입니다 — 주력은 둘 다 이상, 효율은 작은 규모로 자리 기대 이상, 총량은 규모만 크고 자리 대비는 평균 미만, 부진은 둘 다 낮음, 균형은 둘 다 평균 근처(좋고 나쁨의 뜻이 아님)입니다. 방영이 적은 참고·보류 구간에는 붙이지 않습니다.",
  affinity:
    "연령 구성(타깃 선호도)은 점수에 넣지 않습니다. 시청층이 어느 연령에 몰려 있는지는 설명 정보일 뿐 이 프로그램이 자리에 맞는지의 근거가 아니며, 검증에서 기존 방식은 시청률이 낮은 프로그램을 오히려 높게 평가했습니다.",
} as const;
