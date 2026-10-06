// 경쟁 프로그램 대표성(단계 03) — 같은 시간대 경쟁작은 "조금이라도 겹친 것 중 평균 시청률이 높은 것"이 아니라 양쪽 구간이 실제로 크게
// 겹치는 것이어야 한다(예: 14:10:50~15:16:59와 15:16:21~16:44:00은 38초만 겹쳐 대표 경쟁작이 아니다). 임계값은 설정으로 둔다.
// 프로그램 평균 시청률 비교는 정확한 공통 구간 분 시청률 비교가 아니며, 그 사실을 결과에 함께 싣는다.
import { airingInterval, overlapSeconds } from "./interval";
import { parseTargetLabel } from "@/lib/metrics/context";

export interface OverlapConfig {
  /** 이 길이(초) 미만의 겹침은 대표 경쟁작이 될 수 없다 */
  minOverlapSec: number;
  /** 겹침이 우리 방송 또는 경쟁 방송 길이의 이 비율 이상이어야 한다(둘 중 하나) */
  minRatio: number;
}

export const DEFAULT_OVERLAP_CONFIG: OverlapConfig = { minOverlapSec: 600, minRatio: 0.3 };

export const OVERLAP_BASIS_NOTE = "프로그램 평균 시청률끼리의 비교이며, 겹친 구간만의 분 단위 시청률 비교가 아닙니다.";

export interface OverlapAnnotation {
  overlapSeconds: number;
  /** 겹침 ÷ 우리 방송 길이 */
  oursRatio: number;
  /** 겹침 ÷ 경쟁 방송 길이 */
  theirsRatio: number;
  representative: boolean;
  /** 한쪽 방송의 시작·종료 시각이 없어 겹침을 확인할 수 없음(종료 시각을 추정하지 않는다). 대표성은 false이지만 목록에서 지우지는 않고 표시한다 */
  unverifiable: boolean;
  /** 대표성 판단 근거(사람이 읽는 말) */
  reason: string;
  /** 타깃·지역·중계 특성 등 직접 비교를 약하게 만드는 사유 */
  caveats: string[];
  basisNote: string;
}

const LIVE_OR_SPORTS = /중계|생중계|LIVE|라이브|올림픽|월드컵|프로야구|KBO|EPL|챔피언스리그|WBC|결승|개막식|시상식/i;

export interface OverlapCandidate {
  ourStart: string | null;
  ourEnd: string | null;
  theirStart: string | null;
  theirEnd: string | null;
  /** 같은 방송일의 값이라고 가정(경쟁 겹침 RPC는 하루 단위) */
  date?: string;
  ourTargetLabel?: string | null;
  theirTargetLabel?: string | null;
  theirName?: string | null;
  ourName?: string | null;
}

export function scoreOverlap(c: OverlapCandidate, cfg: OverlapConfig = DEFAULT_OVERLAP_CONFIG): OverlapAnnotation {
  const date = c.date ?? "2000-01-01";
  const ours = airingInterval(date, c.ourStart, c.ourEnd).interval;
  const theirs = airingInterval(date, c.theirStart, c.theirEnd).interval;
  const caveats: string[] = [];
  if (!ours || !theirs) {
    return { overlapSeconds: 0, oursRatio: 0, theirsRatio: 0, representative: false, unverifiable: true, reason: "한쪽 방송 구간(시작·종료 시각)이 없어 겹침을 계산할 수 없습니다", caveats, basisNote: OVERLAP_BASIS_NOTE };
  }
  const sec = overlapSeconds(ours, theirs);
  const oursRatio = sec / ours.durationSec;
  const theirsRatio = sec / theirs.durationSec;
  const longEnough = sec >= cfg.minOverlapSec;
  const bigEnough = Math.max(oursRatio, theirsRatio) >= cfg.minRatio;
  const representative = longEnough && bigEnough;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const reason = representative
    ? `겹침 ${sec}초(우리 방송의 ${pct(oursRatio)}, 경쟁 방송의 ${pct(theirsRatio)})`
    : !longEnough
      ? `겹침이 ${sec}초로 기준(${cfg.minOverlapSec}초) 미만이라 대표 경쟁작이 아닙니다`
      : `겹침이 양쪽 방송 길이의 ${pct(Math.max(oursRatio, theirsRatio))}에 그쳐 기준(${pct(cfg.minRatio)}) 미만입니다`;
  if (c.ourTargetLabel && c.theirTargetLabel) {
    const a = parseTargetLabel(c.ourTargetLabel);
    const b = parseTargetLabel(c.theirTargetLabel);
    if (a.audience !== b.audience) caveats.push(`시청 대상이 다릅니다(${c.ourTargetLabel} ≠ ${c.theirTargetLabel})`);
    if (a.geography !== b.geography) caveats.push(`지역이 다릅니다(${a.geography} ≠ ${b.geography}) — 시청률을 직접 비교할 수 없습니다`);
  }
  if (LIVE_OR_SPORTS.test(c.theirName ?? "") || LIVE_OR_SPORTS.test(c.ourName ?? "")) caveats.push("중계·특집 편성은 평소 편성과 시청 패턴이 달라 단순 비교가 어렵습니다");
  return { overlapSeconds: sec, oursRatio, theirsRatio, representative, unverifiable: false, reason, caveats, basisNote: OVERLAP_BASIS_NOTE };
}

export interface OverlapRowLike {
  our_start_time: string;
  our_end_time?: string | null;
  our_program_name?: string;
  competitor_start_time?: string | null;
  competitor_end_time?: string | null;
  competitor_program_name?: string | null;
  competitor_rating?: number | null;
}

/** 겹침 RPC 행에 대표성 주석을 붙이고, 대표 경쟁작만 남긴다. 우리 방송별로 겹친 초가 큰 순 → 시청률 높은 순으로 상위 topN. */
export function selectRepresentativeCompetitors<T extends OverlapRowLike>(
  rows: T[],
  cfg: OverlapConfig = DEFAULT_OVERLAP_CONFIG,
  opts: { topN?: number; ourTargetLabel?: string | null; theirTargetLabel?: string | null } = {}
): (T & OverlapAnnotation)[] {
  const annotated = rows.map((r) => ({
    ...r,
    ...scoreOverlap(
      { ourStart: r.our_start_time, ourEnd: r.our_end_time ?? null, theirStart: r.competitor_start_time ?? null, theirEnd: r.competitor_end_time ?? null, ourTargetLabel: opts.ourTargetLabel, theirTargetLabel: opts.theirTargetLabel, theirName: r.competitor_program_name, ourName: r.our_program_name },
      cfg
    ),
  }));
  // 겹침을 확인할 수 없는 행(종료 시각 없음 등)은 대표성 미확인으로 표시만 하고 남긴다 — 확인된 짧은 겹침만 제외한다.
  const kept = annotated.filter((r) => r.representative || r.unverifiable);
  if (opts.topN === undefined) return kept;
  const byOur = new Map<string, typeof kept>();
  for (const r of kept) {
    const k = `${r.our_start_time}__${r.our_program_name ?? ""}`;
    (byOur.get(k) ?? byOur.set(k, []).get(k)!).push(r);
  }
  const out: typeof kept = [];
  for (const list of byOur.values()) {
    list.sort((a, b) => (b.competitor_rating ?? -1) - (a.competitor_rating ?? -1) || b.overlapSeconds - a.overlapSeconds);
    out.push(...list.slice(0, opts.topN));
  }
  return out;
}
