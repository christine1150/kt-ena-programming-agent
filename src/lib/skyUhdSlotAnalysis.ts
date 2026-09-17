// skyUHD 전용 "편성 시간대 × 프로그램" 분석 계산기 (2026-09-17, 사용자 지시).
//
// 배경: skyUHD는 다른 6개 채널과 달리 닐슨 일별 파일이 아니라 수기 누적 엑셀
// (`26 skyUHD 시청률 (MMDD).xlsx`)로만 자료가 들어온다. 타깃 구분도 경쟁 프로그램 자료도 없어
// 2페이지의 여러 섹션이 빈 껍데기가 되는 대신, "각 월의 편성 시간과 편성 프로그램은 알 수 있다"는
// 사실 하나에 집중해 — 무엇을 늘리고 무엇을 시간대 이동할지까지 — 실제 수치로 판단한다.
//
// ★ 가장 중요한 도메인 규칙(사용자 확인, 2026-09-17): 이 파일의 시청률 빈 칸은 "자료 없음"이
//   아니라 "그 방영분의 시청률이 실제로 0이었다"는 뜻이다. 업로드 파서(src/lib/skyUhd.ts)가 빈
//   셀을 rating=null로 저장하므로, 여기서는 null을 0으로 환산해 **분모에서 빼지 않는다**.
//   (기존 SQL 함수들의 avg(rating)은 NULL을 건너뛰므로 이 파일의 평균과 값이 다를 수 있다 —
//   의도된 차이이며, 화면에서도 "빈 칸=0 포함"임을 명시한다.)
//
// 계산 자체는 이 파일(서버에서만 실행, API route가 호출)에서 하고 화면은 결과만 그린다
// (CLAUDE.md 원칙: 프론트엔드가 수치를 직접 계산하지 않는다).

// 이 앱 공통의 방송일 시간대 표기 — 00시·01시는 전날 방송의 연장으로 보아 24·25시로 센다
// (get_hourly_rating_pattern 등 기존 SQL 함수와 동일한 규칙, 새 정의를 만들지 않음).
export const SKYUHD_SLOT_HOURS = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
] as const;

export function toBroadcastHour(startTime: string): number | null {
  const m = startTime.match(/^(\d{1,2}):/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  if (Number.isNaN(h)) return null;
  return h < 2 ? h + 24 : h;
}

// ── 판정 임계값 ──────────────────────────────────────────────────────────
// 표본이 적은 구간을 근거처럼 보이게 만들지 않기 위한 최소 편성 횟수. 전부 코드 상수로 두어
// 추후 자료가 쌓였을 때 무엇을 얼마나 확보해야 판단이 바뀌는지 개발자가 바로 알 수 있게 한다.
export const SKYUHD_SLOT_THRESHOLDS = {
  /** 프로그램 단위 제언(확대/이동)에 쓸 최소 편성 횟수 */
  MIN_AIR_COUNT_FOR_PROGRAM: 5,
  /** 시간대 단위 제언(축소/재검토)에 쓸 최소 편성 횟수 */
  MIN_AIR_COUNT_FOR_SLOT: 5,
  /** 같은 프로그램의 "시간대별" 비교에 쓸, 한 시간대당 최소 편성 횟수 */
  MIN_AIR_COUNT_PER_SLOT_CELL: 3,
  /** 시간대 이동을 제언할 성과 배수 — 최고 성과 시간대 평균이 현재 주력 시간대 평균의 이 배 이상일 때만 */
  MOVE_RATING_RATIO: 1.3,
  /** 편성 확대를 제언할 성과 배수 — 채널 편성 평균의 이 배 이상일 때만 */
  EXPAND_RATING_RATIO: 1.2,
  /** "성과가 거의 없는 시간대"로 볼 적중률 상한(이 값 이하) */
  DEAD_SLOT_HIT_RATE: 0.2,
} as const;

// ── 입력/출력 타입 ───────────────────────────────────────────────────────
export interface SkyUhdAiringRow {
  broadcastDate: string; // "YYYY-MM-DD"
  startTime: string; // "HH:MM:SS"
  rating: number | null; // null = 실제 0 (위 도메인 규칙 참고)
  programName: string;
}

export interface SkyUhdSlotRow {
  hour: number; // 2~25
  airCount: number;
  hitCount: number; // rating > 0 인 방영 횟수
  hitRate: number; // hitCount / airCount (0~1)
  avgRating: number; // 빈 칸=0 포함 평균
  avgRatingWhenHit: number | null; // 시청률이 나온 방영분만의 평균(없으면 null)
  maxRating: number | null;
  topProgramName: string | null; // 그 시간대에서 평균이 가장 높았던 프로그램
  programCount: number;
}

export interface SkyUhdProgramSlotCell {
  hour: number;
  airCount: number;
  hitCount: number;
  avgRating: number;
}

export interface SkyUhdProgramRow {
  programName: string;
  airCount: number;
  hitCount: number;
  hitRate: number;
  avgRating: number;
  maxRating: number | null;
  mainHour: number | null; // 가장 많이 편성된 시간대
  mainHourAirCount: number;
  bestHour: number | null; // 표본을 충족한 시간대 중 평균이 가장 높은 시간대
  bestHourAvgRating: number | null;
  slots: SkyUhdProgramSlotCell[];
}

export interface SkyUhdExpandCandidate {
  programName: string;
  airCount: number;
  avgRating: number;
  hitRate: number;
  channelAvgRating: number;
  mainHour: number | null;
}

export interface SkyUhdMoveCandidate {
  programName: string;
  mainHour: number;
  mainHourAvgRating: number;
  mainHourAirCount: number;
  bestHour: number;
  bestHourAvgRating: number;
  bestHourAirCount: number;
  ratio: number; // bestHourAvgRating / mainHourAvgRating
}

export interface SkyUhdDeadSlotRow {
  hour: number;
  airCount: number;
  hitCount: number;
  hitRate: number;
  programNames: string[];
}

export interface SkyUhdTrendPoint {
  label: string;
  value: number | null; // 그 구간의 편성 평균 시청률(빈 칸=0 포함), 표본이 없으면 null
  airCount: number;
}

export interface SkyUhdSlotAnalysis {
  window: { from: string; to: string };
  totals: {
    airCount: number;
    hitCount: number;
    hitRate: number;
    avgRating: number;
    programCount: number;
    daysWithSchedule: number;
  };
  slots: SkyUhdSlotRow[];
  programs: SkyUhdProgramRow[];
  expandCandidates: SkyUhdExpandCandidate[];
  moveCandidates: SkyUhdMoveCandidate[];
  deadSlots: SkyUhdDeadSlotRow[];
}

// ── 집계 ─────────────────────────────────────────────────────────────────
function avg(sum: number, n: number): number {
  return n === 0 ? 0 : sum / n;
}

/** rating null(빈 칸) = 실제 0. 이 함수 하나로만 환산해 규칙이 흩어지지 않게 한다. */
function ratingAsZero(rating: number | null): number {
  return rating === null || rating === undefined || Number.isNaN(rating) ? 0 : rating;
}

export function aggregateSkyUhdSlots(
  rows: SkyUhdAiringRow[],
  window: { from: string; to: string }
): SkyUhdSlotAnalysis {
  interface Bucket {
    airCount: number;
    hitCount: number;
    sum: number;
    hitSum: number;
    max: number | null;
  }
  const newBucket = (): Bucket => ({ airCount: 0, hitCount: 0, sum: 0, hitSum: 0, max: null });
  const push = (b: Bucket, rating: number | null) => {
    const v = ratingAsZero(rating);
    b.airCount += 1;
    b.sum += v;
    if (v > 0) {
      b.hitCount += 1;
      b.hitSum += v;
      if (b.max === null || v > b.max) b.max = v;
    }
  };

  const slotBuckets = new Map<number, Bucket>();
  const slotPrograms = new Map<number, Map<string, Bucket>>();
  const programBuckets = new Map<string, Bucket>();
  const programSlots = new Map<string, Map<number, Bucket>>();
  const days = new Set<string>();
  const total = newBucket();

  for (const row of rows) {
    const hour = toBroadcastHour(row.startTime);
    if (hour === null) continue;
    days.add(row.broadcastDate);
    push(total, row.rating);

    let sb = slotBuckets.get(hour);
    if (!sb) slotBuckets.set(hour, (sb = newBucket()));
    push(sb, row.rating);

    let sp = slotPrograms.get(hour);
    if (!sp) slotPrograms.set(hour, (sp = new Map()));
    let spb = sp.get(row.programName);
    if (!spb) sp.set(row.programName, (spb = newBucket()));
    push(spb, row.rating);

    let pb = programBuckets.get(row.programName);
    if (!pb) programBuckets.set(row.programName, (pb = newBucket()));
    push(pb, row.rating);

    let ps = programSlots.get(row.programName);
    if (!ps) programSlots.set(row.programName, (ps = new Map()));
    let psb = ps.get(hour);
    if (!psb) ps.set(hour, (psb = newBucket()));
    push(psb, row.rating);
  }

  // 시간대 표 — 편성이 한 번이라도 있었던 시간대만 행으로 만든다(막대 그래프 축은 화면에서 02~25시
  // 전 구간으로 채우므로, 여기서 빈 시간대를 억지로 0행으로 만들 필요는 없다).
  const slots: SkyUhdSlotRow[] = [];
  for (const hour of SKYUHD_SLOT_HOURS) {
    const b = slotBuckets.get(hour);
    if (!b || b.airCount === 0) continue;
    const progs = slotPrograms.get(hour) ?? new Map<string, Bucket>();
    let topName: string | null = null;
    let topAvg = -1;
    for (const [name, pb] of progs) {
      const a = avg(pb.sum, pb.airCount);
      if (a > topAvg) {
        topAvg = a;
        topName = name;
      }
    }
    slots.push({
      hour,
      airCount: b.airCount,
      hitCount: b.hitCount,
      hitRate: b.airCount === 0 ? 0 : b.hitCount / b.airCount,
      avgRating: avg(b.sum, b.airCount),
      avgRatingWhenHit: b.hitCount === 0 ? null : b.hitSum / b.hitCount,
      maxRating: b.max,
      topProgramName: topAvg > 0 ? topName : null,
      programCount: progs.size,
    });
  }

  // 프로그램 표
  const programs: SkyUhdProgramRow[] = [];
  for (const [name, b] of programBuckets) {
    const cellMap = programSlots.get(name) ?? new Map<number, Bucket>();
    const cells: SkyUhdProgramSlotCell[] = [...cellMap.entries()]
      .map(([hour, cb]) => ({
        hour,
        airCount: cb.airCount,
        hitCount: cb.hitCount,
        avgRating: avg(cb.sum, cb.airCount),
      }))
      .sort((a, c) => c.airCount - a.airCount || a.hour - c.hour);

    const mainCell = cells[0] ?? null;
    // 최고 성과 시간대는 표본(MIN_AIR_COUNT_PER_SLOT_CELL)을 충족한 칸 중에서만 고른다 —
    // 한두 번 방영해 우연히 높게 나온 칸을 "옮기면 좋아진다"는 근거로 쓰지 않기 위함.
    const eligible = cells.filter((c) => c.airCount >= SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_PER_SLOT_CELL);
    const bestCell = eligible.length > 0 ? eligible.reduce((a, c) => (c.avgRating > a.avgRating ? c : a)) : null;

    programs.push({
      programName: name,
      airCount: b.airCount,
      hitCount: b.hitCount,
      hitRate: b.airCount === 0 ? 0 : b.hitCount / b.airCount,
      avgRating: avg(b.sum, b.airCount),
      maxRating: b.max,
      mainHour: mainCell?.hour ?? null,
      mainHourAirCount: mainCell?.airCount ?? 0,
      bestHour: bestCell?.hour ?? null,
      bestHourAvgRating: bestCell?.avgRating ?? null,
      slots: cells,
    });
  }
  programs.sort((a, b) => b.avgRating - a.avgRating || b.airCount - a.airCount);

  const channelAvgRating = avg(total.sum, total.airCount);
  const channelHitRate = total.airCount === 0 ? 0 : total.hitCount / total.airCount;

  // ① 늘릴 것 — 표본을 충족하면서 채널 편성 평균을 뚜렷하게(EXPAND_RATING_RATIO배) 웃돌고,
  //    적중률도 채널 평균 이상인 프로그램.
  const expandCandidates: SkyUhdExpandCandidate[] = programs
    .filter(
      (p) =>
        p.airCount >= SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_PROGRAM &&
        channelAvgRating > 0 &&
        p.avgRating >= channelAvgRating * SKYUHD_SLOT_THRESHOLDS.EXPAND_RATING_RATIO &&
        p.hitRate >= channelHitRate
    )
    .slice(0, 6)
    .map((p) => ({
      programName: p.programName,
      airCount: p.airCount,
      avgRating: p.avgRating,
      hitRate: p.hitRate,
      channelAvgRating,
      mainHour: p.mainHour,
    }));

  // ② 시간대를 옮길 것 — 같은 프로그램 안에서 "가장 많이 편성된 시간대"보다 "표본을 충족한 다른
  //    시간대"의 평균이 뚜렷하게 높을 때만. 프로그램을 바꾸자는 얘기가 아니라 같은 프로그램의
  //    편성 시각을 옮기자는 제언이므로 비교 대상이 자기 자신이라 교란 요인이 적다.
  const moveCandidates: SkyUhdMoveCandidate[] = [];
  for (const p of programs) {
    if (p.airCount < SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_PROGRAM) continue;
    if (p.mainHour === null || p.bestHour === null || p.bestHourAvgRating === null) continue;
    if (p.bestHour === p.mainHour) continue;
    const mainCell = p.slots.find((c) => c.hour === p.mainHour);
    if (!mainCell || mainCell.airCount < SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_PER_SLOT_CELL) continue;
    if (mainCell.avgRating <= 0) {
      // 주력 시간대가 전부 0인데 다른 시간대에서는 성과가 났다면 배수 계산이 불가능하므로,
      // 최고 성과 시간대에 실제 값이 있을 때만 제언한다(0으로 나누기 회피).
      if (p.bestHourAvgRating <= 0) continue;
    } else if (p.bestHourAvgRating < mainCell.avgRating * SKYUHD_SLOT_THRESHOLDS.MOVE_RATING_RATIO) {
      continue;
    }
    const bestCell = p.slots.find((c) => c.hour === p.bestHour)!;
    moveCandidates.push({
      programName: p.programName,
      mainHour: p.mainHour,
      mainHourAvgRating: mainCell.avgRating,
      mainHourAirCount: mainCell.airCount,
      bestHour: p.bestHour,
      bestHourAvgRating: p.bestHourAvgRating,
      bestHourAirCount: bestCell.airCount,
      ratio: mainCell.avgRating > 0 ? p.bestHourAvgRating / mainCell.avgRating : Infinity,
    });
  }
  moveCandidates.sort((a, b) => b.ratio - a.ratio);

  // ③ 줄이거나 성격을 바꿀 것 — 충분히 편성했는데도 시청률이 거의 안 나온 시간대.
  const deadSlots: SkyUhdDeadSlotRow[] = slots
    .filter(
      (s) =>
        s.airCount >= SKYUHD_SLOT_THRESHOLDS.MIN_AIR_COUNT_FOR_SLOT &&
        s.hitRate <= SKYUHD_SLOT_THRESHOLDS.DEAD_SLOT_HIT_RATE
    )
    .map((s) => {
      const progs = slotPrograms.get(s.hour) ?? new Map<string, Bucket>();
      const names = [...progs.entries()]
        .sort((a, b) => b[1].airCount - a[1].airCount)
        .slice(0, 3)
        .map(([name]) => name);
      return {
        hour: s.hour,
        airCount: s.airCount,
        hitCount: s.hitCount,
        hitRate: s.hitRate,
        programNames: names,
      };
    })
    .sort((a, b) => b.airCount - a.airCount);

  return {
    window,
    totals: {
      airCount: total.airCount,
      hitCount: total.hitCount,
      hitRate: channelHitRate,
      avgRating: channelAvgRating,
      programCount: programBuckets.size,
      daysWithSchedule: days.size,
    },
    slots,
    programs,
    expandCandidates,
    moveCandidates,
    deadSlots,
  };
}

// ── 연간/월간/주간 흐름(미니 시각화용) ───────────────────────────────────
// 셋 다 "그 구간에 편성된 모든 방영분의 평균 시청률(빈 칸=0 포함)"이라는 동일한 정의를 쓴다 —
// 서로 다른 소스를 섞지 않아 세 줄을 나란히 읽어도 의미가 어긋나지 않는다.
export interface SkyUhdTrendSeries {
  yearly: SkyUhdTrendPoint[]; // 올해 1월~기준월, 월별
  monthly: SkyUhdTrendPoint[]; // 기준일 직전 30일, 일별
  weekly: SkyUhdTrendPoint[]; // 최근 12주, 주별(월~금만)
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay(); // 0=일
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildSkyUhdTrendSeries(rows: SkyUhdAiringRow[], asOfDate: string): SkyUhdTrendSeries {
  const monthlyAcc = new Map<string, { sum: number; n: number }>();
  const dailyAcc = new Map<string, { sum: number; n: number }>();
  const weeklyAcc = new Map<string, { sum: number; n: number }>();

  const asOfYear = asOfDate.slice(0, 4);
  const dailyFrom = (() => {
    const d = new Date(`${asOfDate}T00:00:00`);
    d.setDate(d.getDate() - 29);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const weeklyFrom = mondayOf(
    (() => {
      const d = new Date(`${asOfDate}T00:00:00`);
      d.setDate(d.getDate() - 7 * 11);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })()
  );

  for (const row of rows) {
    if (row.broadcastDate > asOfDate) continue;
    if (row.broadcastDate.slice(0, 4) === asOfYear) {
      const k = row.broadcastDate.slice(0, 7);
      let a = monthlyAcc.get(k);
      if (!a) monthlyAcc.set(k, (a = { sum: 0, n: 0 }));
      a.sum += ratingAsZero(row.rating);
      a.n += 1;
    }
    if (row.broadcastDate >= dailyFrom) {
      let a = dailyAcc.get(row.broadcastDate);
      if (!a) dailyAcc.set(row.broadcastDate, (a = { sum: 0, n: 0 }));
      a.sum += ratingAsZero(row.rating);
      a.n += 1;
    }
    if (row.broadcastDate >= weeklyFrom) {
      const dow = new Date(`${row.broadcastDate}T00:00:00`).getDay();
      if (dow >= 1 && dow <= 5) {
        const k = mondayOf(row.broadcastDate);
        let a = weeklyAcc.get(k);
        if (!a) weeklyAcc.set(k, (a = { sum: 0, n: 0 }));
        a.sum += ratingAsZero(row.rating);
        a.n += 1;
      }
    }
  }

  const asOfMonth = parseInt(asOfDate.slice(5, 7), 10);
  const yearly: SkyUhdTrendPoint[] = [];
  for (let m = 1; m <= asOfMonth; m += 1) {
    const key = `${asOfYear}-${String(m).padStart(2, "0")}`;
    const a = monthlyAcc.get(key);
    yearly.push({ label: `${m}월`, value: a && a.n > 0 ? a.sum / a.n : null, airCount: a?.n ?? 0 });
  }

  const monthly: SkyUhdTrendPoint[] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(`${asOfDate}T00:00:00`);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const a = dailyAcc.get(key);
    monthly.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      value: a && a.n > 0 ? a.sum / a.n : null,
      airCount: a?.n ?? 0,
    });
  }

  const weekly: SkyUhdTrendPoint[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(`${asOfDate}T00:00:00`);
    d.setDate(d.getDate() - 7 * i);
    const key = mondayOf(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
    const a = weeklyAcc.get(key);
    weekly.push({
      label: `${parseInt(key.slice(5, 7), 10)}/${parseInt(key.slice(8, 10), 10)}`,
      value: a && a.n > 0 ? a.sum / a.n : null,
      airCount: a?.n ?? 0,
    });
  }

  return { yearly, monthly, weekly };
}
