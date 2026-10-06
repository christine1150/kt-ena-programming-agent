// 일간 값에서 기간 값을 만들 때의 규칙(단계 02). 공급자(닐슨) 기간 값이 있으면 그것이 공식값이고, 없을 때만 일간 기반 잠정값을 만든다.
// 누락일을 0으로 채워 평균내지 않으며, 점유율·Reach·시청시간은 임의로 평균·합산하지 않는다.
import { datesIn } from "./period";

export type MetricKey = "rating" | "share" | "reach" | "time_spent";
export type Aggregation = "provider_official" | "daily_mean_provisional" | "single_day" | "not_derivable";

export interface DailyValue {
  date: string;
  /** null = 결측(미수신/빈 셀). 0은 관측값 0 */
  value: number | null;
}

export interface MeanResult {
  value: number | null;
  presentDays: number;
  expectedDays: number;
  missingDates: string[];
  complete: boolean;
}

/** 기간 안의 일간 값 단순 평균. 결측일은 평균에서 빼고(0으로 채우지 않음) 수신 일수를 함께 돌려준다. */
export function meanOverDays(daily: DailyValue[], range: { from: string; to: string }): MeanResult {
  const byDate = new Map(daily.map((d) => [d.date, d.value]));
  const dates = datesIn(range);
  const present = dates.filter((d) => byDate.get(d) !== null && byDate.get(d) !== undefined);
  const missingDates = dates.filter((d) => !present.includes(d));
  const sum = present.reduce((a, d) => a + (byDate.get(d) as number), 0);
  return { value: present.length > 0 ? sum / present.length : null, presentDays: present.length, expectedDays: dates.length, missingDates, complete: missingDates.length === 0 };
}

export interface DerivationPolicy {
  derivable: boolean;
  aggregation: Aggregation;
  note: string;
}

/** 지표별로 일간 값에서 기간 값을 만들어도 되는지. 시청률만 "일간 기반 잠정 평균"을 허용하고 나머지는 공급자 기간 값만 쓴다. */
export function derivationPolicy(metric: MetricKey, days: number): DerivationPolicy {
  if (days <= 1) return { derivable: true, aggregation: "single_day", note: "하루 값은 그대로 사용" };
  if (metric === "rating") {
    return { derivable: true, aggregation: "daily_mean_provisional", note: "공식 기간 시청률이 없을 때만 쓰는 일간 시청률 단순 평균(잠정). 공식 값이 수신되면 대조해 교체한다." };
  }
  const name = metric === "share" ? "점유율" : metric === "reach" ? "Reach" : "시청시간";
  return {
    derivable: false,
    aggregation: "not_derivable",
    note: `${name}는 일간 값을 평균·합산해 기간 값으로 만들 수 없습니다(공급자 기간 값만 사용). Reach의 기간 내 중복 제거 방식은 공급자 정의 확인 전까지 '누적 순도달률'로 부르지 않습니다.`,
  };
}

export interface Derived {
  value: number | null;
  aggregation: Aggregation;
  coverage: MeanResult | null;
  note: string;
}

/** 일간 값으로 기간 값을 만든다(허용되는 지표만). 허용되지 않으면 value=null, aggregation=not_derivable. */
export function deriveFromDaily(metric: MetricKey, daily: DailyValue[], range: { from: string; to: string }): Derived {
  const days = datesIn(range).length;
  const policy = derivationPolicy(metric, days);
  if (!policy.derivable) return { value: null, aggregation: "not_derivable", coverage: null, note: policy.note };
  const m = meanOverDays(daily, range);
  return { value: m.value, aggregation: policy.aggregation, coverage: m, note: m.complete ? policy.note : `${policy.note} 수신 ${m.presentDays}/${m.expectedDays}일(누락일은 평균에서 제외, 0으로 채우지 않음).` };
}

export interface Reconciliation {
  status: "match" | "differs" | "no_official" | "no_provisional";
  difference: number | null;
}

/** 공식 기간 값과 일간 기반 잠정값의 대조 — 공식 값이 수신되면 잠정값을 교체하기 전에 차이를 기록한다. */
export function reconcileWithOfficial(provisional: number | null, official: number | null, tolerance = 5e-4): Reconciliation {
  if (official === null) return { status: "no_official", difference: null };
  if (provisional === null) return { status: "no_provisional", difference: null };
  const difference = provisional - official;
  return { status: Math.abs(difference) <= tolerance ? "match" : "differs", difference };
}
