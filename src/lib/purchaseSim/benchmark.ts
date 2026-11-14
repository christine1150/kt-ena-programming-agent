// 벤치마크 채널 선정(고도화 C1, docs/upgrade-plan/C1_BENCHMARK_PURCHASE.md §1.1·§3) — 순수 함수(DB·네트워크 없음).
// "비슷한 규모의 채널은 이 작품을 어떻게 소화했나"를 근거로 보이기 위한 비교 채널 집합이다. 예측값·진입 기준·정렬은 바꾸지 않는다(백테스트에서 벤치마크 제한이 예측을 낫게 한다는 근거가 없었다).
// 규칙(사용자 결정 2026-11-13 + F-2 수정): 같은 군 · 같은 KPI 타깃 · 닐슨 연간 누적 시청률이 우리의 0.5~2배 · 허브(지상파·종편·tvN)와 프로그램 자료가 없는 채널은 제외.
//   그렇게 잡힌 채널이 2곳 미만이면 순위 거리(±15위부터 5위씩)를 넓혀 4곳이 될 때까지 늘린다(가구 채널은 아래쪽 순위 간격이 촘촘해 ±15위가 1곳뿐인 경우가 있었다).
//   관리자가 채널별로 추가·제외할 수 있다(benchmark_overrides).

export type BenchTarget = "p2049" | "household";
export type BenchGroup = "terrestrial" | "drama" | "variety" | "life" | "uhd";

/** 자사 채널별 선정 설정: 순위 파일 이름·비교할 군(복수 가능)·KPI 타깃 */
export const BENCH_OWN: Record<string, { snap: string; name: string; groups: BenchGroup[]; tk: BenchTarget }> = {
  ENA: { snap: "ENA", name: "ENA", groups: ["terrestrial", "drama"], tk: "p2049" },
  ENA_DRAMA: { snap: "ENA DRAMA", name: "ENA Drama", groups: ["drama"], tk: "p2049" },
  ENA_PLAY: { snap: "ENA PLAY", name: "ENA Play", groups: ["variety"], tk: "p2049" },
  OLIFE: { snap: "OLIFE", name: "OLIFE", groups: ["life"], tk: "household" },
  ONCE: { snap: "ONCE", name: "ONCE", groups: ["drama"], tk: "household" },
  ENA_STORY: { snap: "ENA STORY", name: "ENA Story", groups: ["variety"], tk: "household" },
};

/** market_ytd_rank_snapshot의 타깃 표기 */
export const SNAP_TARGET_LABEL: Record<BenchTarget, string> = { p2049: "수도권2049", household: "유료방송가구" };
export const GROUP_LABEL: Record<BenchGroup, string> = { terrestrial: "지상파·종편", drama: "드라마", variety: "예능·오락", life: "라이프·취미", uhd: "UHD" };

export const BENCH_RATIO_LO = 0.5;
export const BENCH_RATIO_HI = 2;
export const BENCH_MIN_CHANNELS = 2;
export const BENCH_WIDEN_TARGET = 4;
export const BENCH_RANK_BAND_START = 15;
export const BENCH_RANK_BAND_STEP = 5;
export const BENCH_RANK_BAND_MAX = 120;

export interface RankEntry {
  snap: string;
  rank: number;
  rating: number;
}

/** channel_groups 한 행 */
export interface GroupMember {
  snap: string;
  group: BenchGroup;
  /** 닐슨 경쟁 프로그램 자료의 채널 이름(없으면 null — 프로그램 자료가 없어 비교에 쓸 수 없다) */
  competitor: string | null;
  isHub: boolean;
  isOwn: boolean;
}

export interface BenchOverride {
  snap: string;
  action: "add" | "remove";
}

export interface BenchmarkChannel {
  snap: string;
  competitor: string;
  group: BenchGroup;
  rank: number;
  rating: number;
  /** 우리 시청률 대비 배수 */
  ratio: number;
  rule: "ratio" | "widen" | "manual";
  /** 화면에 쓰는 선정 이유 한 줄 */
  reason: string;
}

export interface BenchmarkSelection {
  ownCode: string;
  ownRank: number | null;
  ownRating: number | null;
  /** 자동 규칙의 결과: ratio=시청률 0.5~2배 / widen=순위 범위를 넓힘 / none=선정 못 함 */
  rule: "ratio" | "widen" | "none";
  channels: BenchmarkChannel[];
  /** 관리자가 제외해 뺀 채널 */
  removed: string[];
  /** 자동 선정 후보 중 프로그램 자료가 없어 못 쓰는 채널(참고 표시) */
  noProgramData: string[];
}

const fmt = (v: number) => (v >= 0.1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4));

export function selectBenchmark(args: { ownCode: string; ranks: readonly RankEntry[]; members: readonly GroupMember[]; overrides?: readonly BenchOverride[] }): BenchmarkSelection {
  const cfg = BENCH_OWN[args.ownCode];
  const empty: BenchmarkSelection = { ownCode: args.ownCode, ownRank: null, ownRating: null, rule: "none", channels: [], removed: [], noProgramData: [] };
  if (!cfg) return empty;
  const rankOf = new Map(args.ranks.map((r) => [r.snap, r]));
  const own = rankOf.get(cfg.snap);
  if (!own || !(own.rating > 0)) return empty;

  // 후보: 비교할 군의 채널 — 자사·허브 제외, 같은 채널이 여러 군에 있으면 한 번만
  const seen = new Set<string>();
  const candidates: { m: GroupMember; r: RankEntry }[] = [];
  const noProgramData: string[] = [];
  for (const m of args.members) {
    if (!cfg.groups.includes(m.group) || m.isOwn || m.isHub || seen.has(m.snap)) continue;
    const r = rankOf.get(m.snap);
    if (!r) continue;
    seen.add(m.snap);
    if (m.competitor === null) {
      noProgramData.push(m.snap);
      continue;
    }
    candidates.push({ m, r });
  }

  const byRatio = candidates.filter((c) => c.r.rating >= own.rating * BENCH_RATIO_LO && c.r.rating <= own.rating * BENCH_RATIO_HI);
  let picked = byRatio;
  let rule: "ratio" | "widen" | "none" = "ratio";
  if (byRatio.length < BENCH_MIN_CHANNELS) {
    rule = "widen";
    picked = candidates; // 넓혀도 4곳이 안 되면 후보 전체
    for (let band = BENCH_RANK_BAND_START; band <= BENCH_RANK_BAND_MAX; band += BENCH_RANK_BAND_STEP) {
      const s = candidates.filter((c) => Math.abs(c.r.rank - own.rank) <= band);
      if (s.length >= BENCH_WIDEN_TARGET) {
        picked = s;
        break;
      }
    }
  }
  if (picked.length === 0) rule = "none";

  const toChannel = (c: { m: GroupMember; r: RankEntry }, how: BenchmarkChannel["rule"]): BenchmarkChannel => {
    const ratio = c.r.rating / own.rating;
    const reason =
      how === "manual"
        ? "관리자가 추가한 채널"
        : how === "ratio"
          ? `${GROUP_LABEL[c.m.group]}군, ${SNAP_TARGET_LABEL[cfg.tk]} ${fmt(c.r.rating)}%로 ${cfg.name}의 ${ratio.toFixed(1)}배`
          : `${GROUP_LABEL[c.m.group]}군, 순위 ${c.r.rank}위(${cfg.name} ${own.rank}위)`;
    return { snap: c.m.snap, competitor: c.m.competitor as string, group: c.m.group, rank: c.r.rank, rating: c.r.rating, ratio, rule: how, reason };
  };
  const out = new Map<string, BenchmarkChannel>();
  for (const c of picked) out.set(c.m.snap, toChannel(c, rule === "none" ? "ratio" : rule));

  // 관리자 덮어쓰기: 제외는 자동 선정에서 뺀다, 추가는 군·허브 규칙과 무관하게 넣는다(프로그램 자료가 있는 채널만)
  const removed: string[] = [];
  for (const o of args.overrides ?? []) {
    if (o.action === "remove") {
      if (out.delete(o.snap)) removed.push(o.snap);
    } else {
      const m = args.members.find((x) => x.snap === o.snap && !x.isOwn && x.competitor !== null);
      const r = rankOf.get(o.snap);
      if (m && r && !out.has(o.snap)) out.set(o.snap, toChannel({ m, r }, "manual"));
    }
  }
  const channels = [...out.values()].sort((a, b) => a.rank - b.rank);
  return { ownCode: args.ownCode, ownRank: own.rank, ownRating: own.rating, rule: channels.length === 0 ? "none" : rule === "none" ? "ratio" : rule, channels, removed, noProgramData };
}

// ───────── 채널 군 시드(channel_groups 마이그레이션 20261114030000과 같은 내용 — 테이블이 없을 때의 대체이자 테스트 기준) ─────────

const HUBS = new Set(["KBS1", "KBS2", "MBC", "SBS", "JTBC", "TV CHOSUN", "채널A", "MBN", "tvN"]);
const OWN_SNAPS = new Set(Object.values(BENCH_OWN).map((o) => o.snap));
/** [순위 파일 이름, 닐슨 경쟁 프로그램 자료 이름 또는 null] */
const SEED_RAW: Record<BenchGroup, [string, string | null][]> = {
  terrestrial: [["KBS1", "KBS1"], ["KBS2", "KBS2"], ["MBC", "MBC"], ["SBS", "SBS"], ["EBS", null], ["JTBC", "JTBC"], ["TV CHOSUN", "TV CHOSUN"], ["tvN", "tvN"], ["MBN", "MBN"], ["채널A", "채널A"]],
  drama: [["SBS Plus", "SBS Plus"], ["KBS드라마", null], ["MBC드라마넷", "MBC드라마넷"], ["D-ONE", "D-ONE"], ["하이라이트TV", null], ["EDGETV", "EDGETV"], ["DRAMAcube", "DRAMAcube"], ["CNTV", "CNTV"], ["MBC ON", "MBC ON"], ["tvN DRAMA", null], ["Dramax", "Dramax"], ["KBS Story", "KBS Story"], ["ENA DRAMA", null], ["ONCE", null], ["ENA", null]],
  variety: [["MBC every1", "MBC every1"], ["tvN STORY", "tvN STORY"], ["KBS JOY", "KBS JOY"], ["채널S", "채널S"], ["SBS funE", "SBS funE"], ["JTBC2", "JTBC2"], ["FUN TV", "FUN TV"], ["tvN SHOW", "tvN SHOW"], ["E채널", "E채널"], ["GTV", "GTV"], ["K STAR", "K STAR"], ["theLIFE", "theLIFE"], ["CH view", "CH view"], ["코미디TV", "코미디TV"], ["Mnet", "Mnet"], ["ENA PLAY", null], ["ENA STORY", null]],
  life: [["CMCTV", "CMCTV"], ["ONT", "ONT"], ["OLIFE", null]],
  uhd: [],
};
export const CHANNEL_GROUP_SEED: GroupMember[] = (Object.keys(SEED_RAW) as BenchGroup[]).flatMap((g) => SEED_RAW[g].map(([snap, competitor]) => ({ snap, group: g, competitor, isHub: HUBS.has(snap), isOwn: OWN_SNAPS.has(snap) })));
