// 경쟁사 Benchmark Feature(설계 문서 H절). 경쟁사 raw rating은 자사와 비교하지 않고, 각 경쟁채널
// "자기 기준"으로만 정규화한다.
//   competitor_slot_strength(c, 요일, 시) = 경쟁채널 요일×시 baseline ÷ 경쟁채널 전체 평균
//   benchmark_index(프로그램)             = Σ 시청률 ÷ Σ 방영 슬롯 baseline(비율의 합)
// 타깃 선택은 competitorTarget.ts 규칙(2049/가구/둘 다 → 자사 KPI 기준)을 따른다.
import { chooseCompetitorTarget, DAILY_LABELS_BY_KIND, type CompetitorTargetChoice } from "./competitorTarget";
import type { CompetitorTargetMode } from "./config";
import { addDays, hourBucket } from "./time";
import type { CompetitorAiring, CompetitorBundle, Genre, TargetKind } from "./types";
import { UNCLASSIFIED, genreFamily } from "./types";

export interface CompetitorFeatureOptions {
  asOfDate: string;
  lookbackDays: number;
  excludeHolidays: boolean;
  holidays: Set<string>;
  shrinkageK: number;
  minN: number;
  ownKpiKind: TargetKind;
  targetMode: CompetitorTargetMode;
}

export interface CompetitorProgramFeature {
  competitor: string;
  programName: string;
  genre: Genre;
  n: number;
  avg_rating: number | null;
  benchmark_index: number | null;
  runtime_median_min: number | null;
  slots: { dow: number; hour: number; n: number }[];
}

export interface CompetitorChannelFeature {
  competitor: string;
  programTarget: CompetitorTargetChoice | null; // 프로그램 단위 기준 타깃
  dailyTarget: (CompetitorTargetChoice & { label: string }) | null; // 채널 단위 기준 타깃
  channelMean: number | null; // 프로그램 방영 평균(선택 타깃)
  dailyMean: number | null; // 채널 단위 일별 평균(선택 타깃)
  slotStrength: Map<string, { strength: number | null; n: number; dominantGenre: Genre }>; // key "dow|hour"
  programs: CompetitorProgramFeature[];
}

const key = (dow: number, hour: number) => `${dow}|${hour}`;
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildCompetitorFeatures(
  bundle: CompetitorBundle,
  opts: CompetitorFeatureOptions,
  genreOf: (competitor: string, programName: string) => Genre
): CompetitorChannelFeature[] {
  // 분석 창 이중 방어(RPC가 이미 as_of 이후를 막음) — 자사 Feature와 같은 창·같은 공휴일 규칙
  const from = addDays(opts.asOfDate, -(opts.lookbackDays - 1));
  const inWindow = (date: string) => date >= from && date <= opts.asOfDate && !(opts.excludeHolidays && opts.holidays.has(date));
  const names = [...new Set([...bundle.airings.map((a) => a.competitor), ...bundle.daily.map((d) => d.competitor)])].sort();
  const out: CompetitorChannelFeature[] = [];

  for (const competitor of names) {
    const allAirings = bundle.airings.filter((a) => a.competitor === competitor && inWindow(a.date));
    const programTarget = chooseCompetitorTarget(
      [...new Set(allAirings.map((a) => a.targetKind))],
      opts.ownKpiKind,
      opts.targetMode
    );
    const airings: CompetitorAiring[] = programTarget
      ? allAirings.filter((a) => a.targetKind === programTarget.kind && a.r !== null)
      : [];

    // 채널 단위(일별) — 보유 타깃 중 규칙으로 선택, 라벨은 종류별 우선순위 목록에서 실제 존재하는 첫 값
    const dailyRows = bundle.daily.filter((d) => d.competitor === competitor && inWindow(d.date));
    const dailyChoice = chooseCompetitorTarget([...new Set(dailyRows.map((d) => d.targetKind))], opts.ownKpiKind, opts.targetMode);
    let dailyTarget: CompetitorChannelFeature["dailyTarget"] = null;
    let dailyMean: number | null = null;
    if (dailyChoice) {
      const label = DAILY_LABELS_BY_KIND[dailyChoice.kind].find((l) => dailyRows.some((d) => d.targetLabel === l));
      if (label) {
        dailyTarget = { ...dailyChoice, label };
        dailyMean = mean(dailyRows.filter((d) => d.targetLabel === label && d.r !== null).map((d) => d.r as number));
      }
    }

    const channelMean = mean(airings.map((a) => a.r as number));
    const hourVals = new Map<number, number[]>();
    const dowHourVals = new Map<string, number[]>();
    const genreMinutes = new Map<string, Map<Genre, number>>();
    for (const a of airings) {
      const h = hourBucket(a.startMin);
      (hourVals.get(h) ?? hourVals.set(h, []).get(h)!).push(a.r as number);
      (dowHourVals.get(key(a.dow, h)) ?? dowHourVals.set(key(a.dow, h), []).get(key(a.dow, h))!).push(a.r as number);
      const g = genreFamily(genreOf(competitor, a.programName)); // 지배 장르는 상위 묶음 기준
      const gm = genreMinutes.get(key(a.dow, h)) ?? genreMinutes.set(key(a.dow, h), new Map()).get(key(a.dow, h))!;
      gm.set(g, (gm.get(g) ?? 0) + (a.durationMin ?? 0));
    }
    const k = opts.shrinkageK;
    const baseline = (dow: number, hour: number): number | null => {
      if (channelMean === null) return null;
      const hv = hourVals.get(hour);
      const hourB = hv ? (hv.length * mean(hv)! + k * channelMean) / (hv.length + k) : channelMean;
      const dv = dowHourVals.get(key(dow, hour));
      return dv ? (dv.length * mean(dv)! + k * hourB) / (dv.length + k) : hourB;
    };

    const slotStrength: CompetitorChannelFeature["slotStrength"] = new Map();
    for (const [slot, vals] of [...dowHourVals].sort(([x], [y]) => (x < y ? -1 : 1))) {
      const [dow, hour] = slot.split("|").map(Number);
      const b = baseline(dow, hour);
      const gm = genreMinutes.get(slot) ?? new Map<Genre, number>();
      // 지배 장르: 편성 분이 가장 많은 장르(동률은 장르명 순). 미분류가 지배적이면 미분류 그대로.
      const dominantGenre = [...gm].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? UNCLASSIFIED;
      slotStrength.set(slot, {
        strength: b !== null && channelMean !== null && channelMean > 0 ? b / channelMean : null,
        n: vals.length,
        dominantGenre,
      });
    }

    const byProgram = new Map<string, CompetitorAiring[]>();
    for (const a of airings) (byProgram.get(a.programName) ?? byProgram.set(a.programName, []).get(a.programName)!).push(a);
    const programs: CompetitorProgramFeature[] = [];
    for (const [programName, list] of [...byProgram].sort(([x], [y]) => (x < y ? -1 : 1))) {
      let sumR = 0;
      let sumB = 0;
      const slotN = new Map<string, number>();
      for (const a of list) {
        const h = hourBucket(a.startMin);
        const b = baseline(a.dow, h);
        if (b === null) continue;
        sumR += a.r as number;
        sumB += b;
        slotN.set(key(a.dow, h), (slotN.get(key(a.dow, h)) ?? 0) + 1);
      }
      programs.push({
        competitor,
        programName,
        genre: genreOf(competitor, programName),
        n: list.length,
        avg_rating: mean(list.map((a) => a.r as number)),
        benchmark_index: sumB > 0 ? sumR / sumB : null,
        runtime_median_min: median(list.map((a) => a.durationMin).filter((v): v is number => v !== null)),
        slots: [...slotN]
          .map(([s, n]) => {
            const [dow, hour] = s.split("|").map(Number);
            return { dow, hour, n };
          })
          .sort((a, b) => a.dow - b.dow || a.hour - b.hour),
      });
    }

    out.push({ competitor, programTarget, dailyTarget, channelMean, dailyMean, slotStrength, programs });
  }
  return out;
}

/** 선택 경쟁사 전체에서 슬롯별 대표 강도(최댓값)와 그 경쟁사·지배 장르. 동률은 경쟁사명 순. */
export function strongestCompetitorBySlot(
  channels: CompetitorChannelFeature[]
): Map<string, { competitor: string; strength: number; dominantGenre: Genre; targetMatchesOwnKpi: boolean }> {
  const out = new Map<string, { competitor: string; strength: number; dominantGenre: Genre; targetMatchesOwnKpi: boolean }>();
  for (const ch of [...channels].sort((a, b) => (a.competitor < b.competitor ? -1 : 1))) {
    for (const [slot, s] of ch.slotStrength) {
      if (s.strength === null) continue;
      const cur = out.get(slot);
      if (!cur || s.strength > cur.strength) {
        out.set(slot, {
          competitor: ch.competitor,
          strength: s.strength,
          dominantGenre: s.dominantGenre,
          targetMatchesOwnKpi: ch.programTarget?.matchesOwnKpi ?? false,
        });
      }
    }
  }
  return out;
}
