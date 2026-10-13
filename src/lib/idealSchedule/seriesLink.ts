// 시리즈 연결(사용자 지시 2026-10-13: <지구마불 세계여행4>를 <지구마불> 시리즈 기준으로) — 순수 계산.
// 제목 정규화는 시즌 번호를 보존하므로 새 시즌은 이력 없는 신규 프로그램이 되어 슬롯·장르 기준으로만 수축된 값을 받는다.
// 연결을 등록하면 새 시즌의 '아직 방영 이력이 없는' 편성 칸(필수 편성 등)이 지난 시즌 본방 회차(첫 3회 평균)에 채널 수준 보정을 곱한
// 값에서 출발한다. 이것은 한 개의 지난 시즌을 근거로 한 거친 추정이며 검증된 예측이 아니다 — 근거 등급은 가장 넓은 범위(C)로 취급한다.
// 적용 범위: 새 시즌이 첫 방송 전이라 자사 방영 이력이 없을 때만(이력이 생기면 실제 방영 값이 쓰인다). 시청률(rating)만이고 점유율·시청시간은 그대로.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { seriesForecast } from "@/lib/ops/seriesForecast";

export interface SeriesLink {
  channelCode: string;
  /** 새 시즌 제목(표기 차이는 정규화로 흡수) */
  target: string;
  /** 지난 시즌 제목(이 채널의 programs.canonical_name 정규화 형태와 같아야 한다) */
  base: string;
}

/** 등록된 시리즈 연결. 새 연결은 여기에 한 줄 추가한다(제목 하나당 한 줄, 시즌 번호 자동 추정은 하지 않는다). */
export const SERIES_LINKS: SeriesLink[] = [{ channelCode: "ENA", target: "지구마불 세계여행4", base: "지구마불 세계여행3" }];

export const normSeriesName = (name: string): string => normalizeProgramCanonicalName(name);

export function seriesLinkFor(links: SeriesLink[], channelCode: string, programName: string): SeriesLink | null {
  const n = normSeriesName(programName);
  if (!n) return null;
  return links.find((l) => l.channelCode === channelCode && normSeriesName(l.target) === n) ?? null;
}

/** 러너가 DB에서 모아 엔진에 넘기는 입력(순수 데이터). */
export interface SeriesPriorInput {
  targetName: string;
  baseName: string;
  /** 지난 시즌 본방 회차별 시청률(방송 순서, 엔진의 최적화 타깃 기준, % 단위) */
  episodes: (number | null)[];
  /** 채널 수준 보정 비율(최근 채널 평균 ÷ 지난 시즌 방영 기간 채널 평균, 같은 타깃) */
  levelRatio: number;
  /** 지난 시즌이 주로 방영된 요일(1=월~7=일)·시 — 이 슬롯의 현재 baseline으로 지수를 만든다 */
  slotDow: number;
  slotHour: number;
}

export interface SeriesPrior {
  baseName: string;
  /** 근거 회차 수(첫 3회) */
  n: number;
  /** 지난 시즌 슬롯 baseline 대비 지수(현재 baseline으로 환산한 값) */
  index: number;
  /** 지난 시즌 슬롯에서의 보정 후 기대 시청률(첫 3회 평균 × 보정 비율) */
  expectedAtBaseSlot: number;
  levelRatio: number;
  basis: string;
}

/** 새 시즌 첫 방송 주 기대 지수 = (지난 시즌 첫 3회 평균 × 보정 비율) ÷ 지난 시즌 슬롯의 현재 baseline. baseline이 없거나 0이면 만들지 않는다. */
export function buildSeriesPrior(input: SeriesPriorInput, baselineAt: (dow: number, hour: number) => number | null): SeriesPrior | null {
  const f = seriesForecast({ episodes: input.episodes, levelRatio: input.levelRatio });
  if (!f) return null;
  const base = baselineAt(input.slotDow, input.slotHour);
  if (base === null || !(base > 0)) return null;
  const expectedAtBaseSlot = f.scaled.firstThree;
  return {
    baseName: input.baseName,
    n: Math.min(3, f.n),
    index: expectedAtBaseSlot / base,
    expectedAtBaseSlot,
    levelRatio: input.levelRatio,
    basis: `〈${input.baseName}〉 본방 첫 3회 평균 ${f.firstThreeMean.toFixed(3)} × 채널 수준 보정 ${input.levelRatio.toFixed(3)}(지난 시즌 ${f.n}회 기준, 검증된 예측이 아님)`,
  };
}
