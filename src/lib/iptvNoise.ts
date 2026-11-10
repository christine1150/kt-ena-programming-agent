// 닐슨 회차 간 "잡음 폭" — IPTV 활용 계획 3단계 2순위(2026-11-11 사용자 승인).
// 근거: iptv_noise_by_level(DB 함수 compute_iptv_noise_by_level 이 계산·저장, docs/iptv/IPTV_RESEARCH_RESULTS.md A1).
//  잡음 폭 = IPTV 로는 회차 간 변화가 거의 없던(±10% 이내) 같은 프로그램·같은 자리 연속 방영에서
//            닐슨 변화 폭(|이번−직전| ÷ 둘의 평균, 0~2)의 80% 분위 — "실제로는 그대로인데 닐슨이 이만큼까지는 흔들린다".
//  잡음은 시청률 수준에 크게 좌우된다(가구 0.05% 미만 1.54 vs 1% 이상 0.17) — 그래서 타깃 × 두 회 평균 시청률 구간으로 고른다.
// 쓰임: "전회 대비 ▲▼%"가 이 폭 안이면 "회차 변동 범위 안"으로 표시해, 한 회의 등락을 성과 변화로 단정하지 않게 한다.
// 닐슨 값·판정은 바꾸지 않는다(IPTV 는 보조 자료 — 청약·공식 KPI 기준은 닐슨). 계산은 DB 가 하고 여기서는 구간을 골라 비교만 한다.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };
export type NoiseTargetKind = "household" | "p2049";

export interface NoiseBand {
  /** 두 회 닐슨 평균 시청률(%) 구간 [lo, hi) — hi 가 null 이면 상한 없음 */
  lo: number;
  hi: number | null;
  /** 변화 폭 기준(0~2). 2 면 회차 단위 비교로는 변화를 판단할 수 없는 수준 */
  noiseStep: number;
  nPairs: number;
}
export interface NoiseTable {
  version: string;
  periodFrom: string;
  periodTo: string;
  bands: Record<NoiseTargetKind, NoiseBand[]>;
}
export interface EpisodeChangeNoise {
  withinNoise: boolean;
  /** 잡음 폭을 "전회 대비 %"로 옮긴 범위(하락 쪽 음수, 상승 쪽 양수). 상승 쪽 한계가 없으면(폭 2) null */
  downPct: number;
  upPct: number | null;
  noiseStep: number;
  version: string;
}

/** 전회 대비 변화율(%) → 변화 폭(|이번−직전| ÷ 둘의 평균). */
export function symmetricChangeFromPct(pct: number): number {
  const c = pct / 100;
  if (c <= -1) return 2;
  return Math.abs((2 * c) / (2 + c));
}

/** 변화 폭 기준 → 전회 대비 %로 옮긴 범위(내림 쪽: −2s/(2+s), 오름 쪽: 2s/(2−s)). */
export function noiseRangePct(noiseStep: number): { downPct: number; upPct: number | null } {
  const s = Math.max(0, noiseStep);
  return { downPct: ((-2 * s) / (2 + s)) * 100, upPct: s >= 2 ? null : ((2 * s) / (2 - s)) * 100 };
}

/** 전회 대비 %와 이번 값으로 두 회 평균 시청률을 구한다(직전 = 이번 ÷ (1+pct/100)). */
export function twoEpisodeLevel(current: number | null | undefined, pct: number | null | undefined): number | null {
  if (current === null || current === undefined || pct === null || pct === undefined || !Number.isFinite(current) || !Number.isFinite(pct)) return null;
  if (pct <= -100) return null;
  const prior = current / (1 + pct / 100);
  return (current + prior) / 2;
}

/** 전회 대비 변화율이 그 시청률 수준의 잡음 폭 안인가(순수 함수). 값·구간이 없으면 null. */
export function episodeChangeNoise(
  pct: number | null | undefined,
  level: number | null | undefined,
  table: NoiseTable | null | undefined,
  kind: NoiseTargetKind | null | undefined
): EpisodeChangeNoise | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct) || level === null || level === undefined || !table || !kind) return null;
  const band = table.bands[kind]?.find((b) => level >= b.lo && (b.hi === null || level < b.hi));
  if (!band) return null;
  const r = noiseRangePct(band.noiseStep);
  return { withinNoise: symmetricChangeFromPct(pct) <= band.noiseStep, downPct: r.downPct, upPct: r.upPct, noiseStep: band.noiseStep, version: table.version };
}

/** 최신 버전의 타깃 × 구간 잡음 폭. 없으면 null. */
export async function loadEpisodeNoise(db: Db): Promise<NoiseTable | null> {
  const { data: latest } = await db.from("iptv_noise_by_level").select("version").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const version = (latest?.version as string | undefined) ?? null;
  if (!version) return null;
  const { data } = await db.from("iptv_noise_by_level").select("target_kind, level_lo, level_hi, n_pairs, noise_step, period_from, period_to").eq("version", version);
  const rows = (data ?? []) as { target_kind: NoiseTargetKind; level_lo: number; level_hi: number | null; n_pairs: number; noise_step: number; period_from: string; period_to: string }[];
  if (rows.length === 0) return null;
  const bands: Record<NoiseTargetKind, NoiseBand[]> = { household: [], p2049: [] };
  for (const r of rows) {
    bands[r.target_kind]?.push({ lo: Number(r.level_lo), hi: r.level_hi === null || r.level_hi === undefined ? null : Number(r.level_hi), noiseStep: Number(r.noise_step), nPairs: r.n_pairs });
  }
  for (const k of Object.keys(bands) as NoiseTargetKind[]) bands[k].sort((a, b) => a.lo - b.lo);
  return { version, periodFrom: rows[0].period_from, periodTo: rows[0].period_to, bands };
}

/** 화면 문구(순수): 잡음 폭 안일 때 붙이는 짧은 표시와 설명. */
export function describeEpisodeNoise(n: EpisodeChangeNoise | null | undefined): { badge: string; title: string } | null {
  if (!n || !n.withinNoise) return null;
  const range = n.upPct === null ? "이 시청률 수준에서는 회차 단위로 판단하기 어려운 정도" : `이 시청률 수준에서 대략 ▼${Math.abs(n.downPct).toFixed(0)}% ~ ▲${n.upPct.toFixed(0)}%`;
  return {
    badge: "회차 변동 범위 안",
    title: `닐슨 회차 간 흔들림(${range}) 안입니다. IPTV 셋톱 대조(보조 자료, ${n.version})로 실제 시청이 거의 그대로였던 연속 방영에서도 이만큼은 움직였습니다. 이 한 회의 등락만으로 성과 변화를 단정하지 말고 여러 회 평균을 함께 보세요.`,
  };
}
