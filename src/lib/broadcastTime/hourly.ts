// 시간대 지표(단계 03) — 두 가지를 별도 metric으로 만든다.
//  ① 시간대 추정 시청률: 프로그램 평균 시청률을 방송 구간이 시간대와 실제로 겹친 초만큼 배분한 시간가중 평균. 분 단위 실측이 아니다.
//  ② 시작 시각별 프로그램 평균: 그 시간대에 "시작한" 방송의 평균(기존 get_hourly_rating_pattern과 같은 정의, 편성 횟수 검산용).
// 방송이 진행 중인데 그 시간에 시작한 방송이 없다는 이유로 0을 만들지 않는다. 겹친 방송이 없는 시간대는 결측(null)이며 coverage로 설명한다.
import { airingInterval, allocateByHour } from "./interval";

export interface HourlyAiring {
  date: string;
  startClock: string | null;
  endClock: string | null;
  rating: number | null;
  share?: number | null;
  reach?: number | null;
  timeSpentSeconds?: number | null;
}

export interface HourlyRow {
  broadcastHour: number;
  /** ① 시간대 추정 시청률(시간 가중). 겹친 방송이 없으면 null(0 아님) */
  estimatedRating: number | null;
  estimatedShare: number | null;
  /** ② 이 시간대에 시작한 방송의 단순 평균 시청률 */
  startAvgRating: number | null;
  startAvgShare: number | null;
  avgReach: number | null;
  avgTimeSpentSeconds: number | null;
  /** 이 시간대에 시작한 방송 수(시청률 결측 포함) — 기존 집계와 같은 정의 */
  programCount: number;
  /** 이 시간대와 1초라도 겹친 방송 수 */
  overlappingCount: number;
  /** 시청률이 있는 방송이 이 시간대에 겹친 총 초 */
  observedSeconds: number;
  /** observedSeconds ÷ (3600 × 상세가 수신된 날짜 수) — 1이면 모든 날 그 시간 전체가 관측됨 */
  coverageRatio: number;
}

export interface HourlyEstimate {
  rows: HourlyRow[];
  /** 방영 상세가 있는 날짜 수(coverage 분모) */
  daysWithDetail: number;
  /** 구간을 만들지 못해 제외한 방송과 이유 */
  skipped: { date: string; reason: string }[];
  method: "overlap_weighted_program_average";
  note: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i + 2); // 2~25

export const HOURLY_ESTIMATE_NOTE = "프로그램 평균 시청률을 방송 구간이 시간대와 겹친 시간만큼 배분한 추정치입니다(분 단위 실측 아님). 겹친 방송이 없는 시간은 0이 아니라 결측입니다.";

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export function estimateHourlyPattern(airings: HourlyAiring[]): HourlyEstimate {
  const skipped: HourlyEstimate["skipped"] = [];
  const dates = new Set<string>();
  const acc = new Map<number, { rSum: number; rSec: number; sSum: number; sSec: number; overlapping: number; started: HourlyAiring[] }>();
  for (const h of HOURS) acc.set(h, { rSum: 0, rSec: 0, sSum: 0, sSec: 0, overlapping: 0, started: [] });

  for (const a of airings) {
    const { interval, issue } = airingInterval(a.date, a.startClock, a.endClock);
    dates.add(a.date);
    if (!interval) {
      skipped.push({ date: a.date, reason: issue ?? "구간 없음" });
      // 시작 시각만 있으면 시작 시각별 평균(②)에는 포함한다(기존 정의와 동일)
      const sc = a.startClock ? Number(a.startClock.split(":")[0]) : NaN;
      if (!Number.isNaN(sc)) acc.get(sc < 2 ? sc + 24 : sc)?.started.push(a);
      continue;
    }
    const startHour = Math.floor(interval.startSec / 3600);
    acc.get(startHour >= 26 ? startHour - 24 : startHour)?.started.push(a);
    for (const [hour, sec] of allocateByHour(interval)) {
      const b = acc.get(hour);
      if (!b) continue;
      b.overlapping++;
      if (a.rating !== null) {
        b.rSum += a.rating * sec;
        b.rSec += sec;
      }
      if (a.share !== null && a.share !== undefined) {
        b.sSum += a.share * sec;
        b.sSec += sec;
      }
    }
  }

  const days = dates.size;
  const rows: HourlyRow[] = HOURS.map((h) => {
    const b = acc.get(h)!;
    const started = b.started;
    return {
      broadcastHour: h,
      estimatedRating: b.rSec > 0 ? b.rSum / b.rSec : null,
      estimatedShare: b.sSec > 0 ? b.sSum / b.sSec : null,
      startAvgRating: mean(started.map((x) => x.rating).filter((v): v is number => v !== null)),
      startAvgShare: mean(started.map((x) => x.share).filter((v): v is number => v !== null && v !== undefined)),
      avgReach: mean(started.map((x) => x.reach).filter((v): v is number => v !== null && v !== undefined)),
      avgTimeSpentSeconds: mean(started.map((x) => x.timeSpentSeconds).filter((v): v is number => v !== null && v !== undefined)),
      programCount: started.length,
      overlappingCount: b.overlapping,
      observedSeconds: b.rSec,
      coverageRatio: days > 0 ? b.rSec / (3600 * days) : 0,
    };
  });
  return { rows, daysWithDetail: days, skipped, method: "overlap_weighted_program_average", note: HOURLY_ESTIMATE_NOTE };
}
