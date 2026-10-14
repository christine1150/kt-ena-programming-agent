// 앞 프로그램에서 이어지는 시청 유지율(2026-10-15, 격차 해소 플레이북 3단계 구조 레버) — 순수 함수(DB·네트워크 없음).
// 약한 자리의 원인이 "앞 프로그램 자체가 낮아서"가 아니라 "앞 프로그램은 보통인데 그 시청자가 이 프로그램으로 이어지지 않아서"인지를 가른다.
// 유지율 = 이 프로그램 시청률 ÷ 바로 앞 프로그램 시청률(같은 날, 직전 방영). 같은 자리 최근 방영들의 유지율 중앙값과 비교한다.
// 새 수치를 만들지 않는다 — 이미 있는 방영 기록의 비율만 쓰며, 원인 확정이 아니라 점검 방향을 정하는 근거다.

export interface LeadAiring {
  date: string;
  dow: number;
  startMin: number;
  key: string;
  rating: number;
}

export interface RetentionLeak {
  /** 오늘 유지율(이 프로그램 ÷ 앞 프로그램) */
  retention: number;
  /** 같은 자리 최근 방영들의 유지율 중앙값 */
  typical: number;
  /** 비교한 지난 방영 수 */
  n: number;
}

/** 오늘 유지율이 같은 자리 중앙값의 이 비율 이하이면 '이어지지 않는다'고 본다 */
export const LEAK_RATIO = 0.75;
/** 비교에 필요한 지난 방영 수 */
export const LEAK_MIN_PRIOR = 3;
/** 앞 프로그램으로 보는 최대 간격(분) */
const MAX_LEAD_GAP_MIN = 180;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** 같은 날 x 바로 앞에 시작한(180분 이내) 다른 프로그램 */
function leadOf(all: LeadAiring[], x: LeadAiring): LeadAiring | null {
  return (
    all
      .filter((p) => p.date === x.date && p.startMin < x.startMin && x.startMin - p.startMin <= MAX_LEAD_GAP_MIN && p.key !== x.key)
      .sort((p, q) => q.startMin - p.startMin)[0] ?? null
  );
}

/**
 * target(약한 방영)의 앞 프로그램 lead가 있고, 같은 자리(요일·시) 지난 방영 3회 이상의 유지율이 있을 때
 * 오늘 유지율이 중앙값의 LEAK_RATIO 이하이면 결과를, 아니면 null을 돌려준다.
 */
export function retentionLeak(all: LeadAiring[], target: LeadAiring, lead: LeadAiring | null, day: string): RetentionLeak | null {
  if (!lead || lead.rating <= 0 || target.rating < 0) return null;
  const hour = Math.floor(target.startMin / 60);
  const priors = all
    .filter((x) => x.date < day && x.key === target.key && x.dow === target.dow && Math.floor(x.startMin / 60) === hour)
    .sort((p, q) => (p.date < q.date ? 1 : -1))
    .slice(0, 8);
  const rates: number[] = [];
  for (const x of priors) {
    const p = leadOf(all, x);
    if (p && p.rating > 0) rates.push(x.rating / p.rating);
  }
  if (rates.length < LEAK_MIN_PRIOR) return null;
  const typical = median(rates) as number;
  const retention = target.rating / lead.rating;
  // 유지율이 100%를 넘는 자리(앞 프로그램이 이 프로그램보다 훨씬 작은 경우)는 '앞 시청자가 이어진 비율'로 말할 수 없어 제외한다
  if (typical <= 0 || typical > 1 || retention > typical * LEAK_RATIO) return null;
  return { retention, typical, n: rates.length };
}
