// "시청률 표" 읽기 전용 화면(/ratings)의 서버 조회 — 이미 저장된 닐슨 값을 모아 보여 줄 뿐 새로 계산·저장하지 않는다(2026-10-19 사용자 요청: ktena 같은 가독성 높은 표, 로컬 시안).
//  · daily  : 한 채널의 하루 프로그램별 시청률(타깃 열은 데이터가 있는 것만)
//  · ranks  : 그날 전 채널 시청률 순위 TOP40 — 타깃 5종 비교(닐슨이 매긴 순위 그대로)
//  · trend  : 최근 4주 채널 순위 추이 — 자사 채널은 닐슨 주간 순위, 타사는 일별 평균으로 순위를 맞춘다
import { supabase } from "@/lib/supabase";
import { findPlanFill, loadPlanDay } from "@/lib/planDayFill";
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";

const offsetDate = (d: string, days: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const dow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 월=0 … 일=6

export async function latestRatingsDate(): Promise<string | null> {
  const { data } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: false }).limit(1);
  return (data?.[0]?.broadcast_date as string | undefined) ?? null;
}

// ───────────────────────── 일일 시청률(채널별) ─────────────────────────
/** 프로그램 단위 행에서 보여 줄 수 있는 타깃(앞일수록 우선) → 화면 머리글 */
const DAILY_TARGETS: { label: string; head: string }[] = [
  { label: "수도권 2049", head: "수도권 2049" },
  { label: "전국 유료가구", head: "전국 가구" },
  { label: "수도권 유료방송가입가구", head: "수도권 가구" },
  { label: "수도권 2039", head: "수도권 2039" },
  { label: "전국 5064", head: "전국 5064" },
];

export interface DailyRow {
  start: string;
  end: string | null;
  name: string;
  episode: string | null;
  firstRun: boolean;
  values: (number | null)[];
  /** 첫 열(KPI) 타깃의 점유율(%) · 1인당 시청시간(초) — 저장된 닐슨 값 그대로 */
  share: number | null;
  timeSpentSec: number | null;
}
export interface DailyView {
  date: string;
  channelCode: string;
  channelName: string;
  themeColor: string | null;
  columns: string[];
  /** 첫 열 강조 기준(직전 30일 채널 평균) */
  baseline: number | null;
  rows: DailyRow[];
}

const orderKey = (t: string) => {
  const [h, m, s] = t.split(":").map(Number);
  const sec = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  return h < 2 ? sec + 86400 : sec;
};

export async function loadDaily(channelCode: string, date: string): Promise<DailyView | null> {
  const { data: ch } = await supabase.from("channels").select("id, code, name, primary_target, theme_color").eq("code", channelCode).maybeSingle();
  if (!ch) return null;
  const primaryLabel = ch.primary_target ? resolveProgramLevelTargetLabel(ch.primary_target as string) : null;
  const { data: targets } = await supabase.from("targets").select("id,label");
  const idOf = (l: string) => (targets ?? []).find((t) => t.label === l)?.id as string | undefined;
  const candidates = DAILY_TARGETS.filter((t) => idOf(t.label));
  // 채널 KPI 타깃을 맨 앞으로
  candidates.sort((a, b) => Number(b.label === primaryLabel) - Number(a.label === primaryLabel));
  const isSky = channelCode === "SKYUHD";

  let q = supabase
    .from("ratings")
    .select("start_time,end_time,rating,share,time_spent_seconds,target_id,program_id,episode_number,episode_subtitle,is_first_run,programs(canonical_name)")
    .eq("channel_id", ch.id)
    .in("source_type", ["nielsen_daily", "skyuhd"])
    .eq("broadcast_date", date)
    .not("program_id", "is", null);
  if (!isSky) q = q.in("target_id", candidates.map((c) => idOf(c.label)!));
  const { data: raw } = await q;
  type Raw = { start_time: string; end_time: string | null; rating: number | null; share: number | null; time_spent_seconds: number | null; target_id: string | null; program_id: string; episode_number: number | null; episode_subtitle: string | null; is_first_run: boolean | null; programs: { canonical_name: string } | { canonical_name: string }[] | null };
  const rowsRaw = (raw ?? []) as unknown as Raw[];

  // skyUHD 수기 시트는 타깃 구분이 없다(target_id 비움) → 한 열로
  const usedTargets = isSky ? [{ label: "", head: "유료방송가구" }] : candidates.filter((c) => rowsRaw.some((r) => r.target_id === idOf(c.label) && r.rating !== null)).slice(0, 4);
  const plan = await loadPlanDay(ch.id as string, date);

  const byKey = new Map<string, DailyRow>();
  for (const r of rowsRaw) {
    const name = Array.isArray(r.programs) ? (r.programs[0]?.canonical_name ?? "") : (r.programs?.canonical_name ?? "");
    const key = `${r.start_time}__${r.program_id}`;
    let row = byKey.get(key);
    if (!row) {
      const fill = findPlanFill(plan, { programId: r.program_id, name, startTime: r.start_time });
      const noEp = r.episode_number === null && r.episode_subtitle === null;
      const ep = noEp ? fill?.episodeNumber ?? null : r.episode_number;
      const sub = noEp ? fill?.subtitle ?? null : r.episode_subtitle;
      row = {
        start: r.start_time,
        end: r.end_time,
        name,
        episode: ep !== null || sub ? `${ep !== null ? `${ep}회` : ""}${ep !== null && sub ? " " : ""}${sub ?? ""}` : null,
        firstRun: (r.is_first_run ?? fill?.isFirstRun ?? false) === true,
        values: usedTargets.map(() => null),
        share: null,
        timeSpentSec: null,
      };
      byKey.set(key, row);
    }
    const idx = isSky ? 0 : usedTargets.findIndex((c) => idOf(c.label) === r.target_id);
    if (idx >= 0) row.values[idx] = r.rating;
    if (idx === 0) {
      row.share = r.share;
      row.timeSpentSec = r.time_spent_seconds;
    }
  }
  const rows = [...byKey.values()].sort((a, b) => orderKey(a.start) - orderKey(b.start));

  // 강조 기준: 직전 30일 채널 평균(첫 열 타깃)
  let baseline: number | null = null;
  const firstId = usedTargets[0] && !isSky ? idOf(usedTargets[0].label) : undefined;
  if (firstId) {
    const rankLabel = primaryLabel === "수도권 2049" ? "개인2049" : usedTargets[0].label;
    const rankTarget = idOf(rankLabel) ?? firstId;
    const { data: month } = await supabase.from("ratings").select("rating").eq("channel_id", ch.id).eq("target_id", rankTarget).in("source_type", ["nielsen_daily"]).is("program_id", null).gte("broadcast_date", offsetDate(date, -30)).lte("broadcast_date", offsetDate(date, -1));
    const nums = (month ?? []).map((x) => x.rating as number | null).filter((v): v is number => v !== null);
    baseline = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  }
  return {
    date,
    channelCode,
    channelName: ch.name as string,
    themeColor: (ch.theme_color as string | null) ?? null,
    columns: usedTargets.map((c) => c.head),
    baseline,
    rows,
  };
}

// ───────────────────────── 전 채널 순위 TOP40(타깃 비교) ─────────────────────────
const RANK_BOARDS: { key: string; title: string; region: string; label: string }[] = [
  // 보여 주는 순서(사용자 지시 2026-10-19): 핵심 두 보드 — P2049(수도권)·유료방송가구(전국) — 를 먼저, 나머지는 P2039 → 3049 여성 → 유료방송가구(수도권)
  { key: "p2049", title: "P2049", region: "수도권", label: "개인2049" },
  { key: "hh-nat", title: "유료방송가구", region: "전국", label: "National 유료방송가입가구" },
  { key: "p2039", title: "P2039", region: "수도권", label: "개인2039" },
  { key: "w3049", title: "3049 여성", region: "수도권", label: "수도권 여자3049" },
  { key: "hh-metro", title: "유료방송가구", region: "수도권", label: "수도권 유료방송가입가구" },
];

/** 자사 채널 판정용 정규화 이름 → 화면 이름 */
export const OWN_CHANNEL_NAMES: Record<string, string> = { ena: "ENA", enaplay: "ENA PLAY", enadrama: "ENA DRAMA", enastory: "ENA STORY", once: "ONCE", olife: "OLIFE" };
const normName = (s: string) => s.replace(/\s+/g, "").toLowerCase();
export const isOwnChannelName = (s: string) => normName(s) in OWN_CHANNEL_NAMES;

export interface RankRow {
  rank: number;
  name: string;
  rating: number | null;
  reach: number | null;
  share: number | null;
  own: boolean;
}
export interface RankBoard {
  key: string;
  title: string;
  region: string;
  rows: RankRow[];
}

export async function loadRanks(date: string, limit = 40): Promise<RankBoard[]> {
  const { data: targets } = await supabase.from("targets").select("id,label");
  const boards: RankBoard[] = [];
  for (const b of RANK_BOARDS) {
    const id = (targets ?? []).find((t) => t.label === b.label)?.id as string | undefined;
    if (!id) {
      boards.push({ key: b.key, title: b.title, region: b.region, rows: [] });
      continue;
    }
    const { data } = await supabase.from("competitor_ratings").select("competitor_name,rank,rating,reach,share").eq("broadcast_date", date).eq("target_id", id).not("rank", "is", null).lte("rank", limit).order("rank");
    const rows: RankRow[] = ((data ?? []) as { competitor_name: string; rank: number; rating: number | null; reach: number | null; share: number | null }[]).map((x) => ({
      rank: x.rank,
      name: OWN_CHANNEL_NAMES[normName(x.competitor_name)] ?? x.competitor_name,
      rating: x.rating,
      reach: x.reach,
      share: x.share,
      own: isOwnChannelName(x.competitor_name),
    }));
    boards.push({ key: b.key, title: b.title, region: b.region, rows });
  }
  return boards;
}

// ───────────────────────── 채널 순위 추이(최근 4주) ─────────────────────────
export interface TrendWeek {
  label: string; // 10월3주차
  range: string; // 10/12~10/18
  from: string;
  to: string;
  rows: { rank: number; name: string; rating: number; own: boolean; est: boolean }[];
}

/** 목요일이 속한 달의 N째 목요일 → "N월M주차"(닐슨 주간 표기 관례: 9/28~10/4 = 10월1주차) */
export function weekLabel(from: string): string {
  const thu = offsetDate(from, 3);
  const m = Number(thu.slice(5, 7));
  const nth = Math.ceil(Number(thu.slice(8, 10)) / 7);
  return `${m}월${nth}주차`;
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export async function loadTrend(date: string, weeks = 4, showTop = 35): Promise<TrendWeek[]> {
  // 7일이 모두 끝난 마지막 주(일요일 끝)를 기준으로 거슬러 올라간다
  const lastSunday = offsetDate(date, -(dow(date) === 6 ? 0 : dow(date) + 1));
  const { data: targets } = await supabase.from("targets").select("id,label");
  const t2049 = (targets ?? []).find((t) => t.label === "개인2049")?.id as string | undefined;
  if (!t2049) return [];
  const { data: chs } = await supabase.from("channels").select("id,code,name");
  const result: TrendWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const to = offsetDate(lastSunday, -7 * w);
    const from = offsetDate(to, -6);
    const { data: daily } = await supabase.from("competitor_ratings").select("competitor_name,rating,rank,broadcast_date").eq("target_id", t2049).gte("broadcast_date", from).lte("broadcast_date", to).not("rank", "is", null).limit(5000);
    const dailyRows = (daily ?? []) as { competitor_name: string; rating: number | null; rank: number; broadcast_date: string }[];
    // 저장된 일별 목록에는 뉴스·교육 채널(YTN·연합뉴스TV·EBS 등)이 빠져 있다. 그날 닐슨 순위와 목록 안 순서의 차이 = 그 채널 위에 있는 빠진 채널 수 → 주간 순위 보정에 쓴다.
    const offsetByChannel = new Map<string, number[]>();
    const byDay = new Map<string, typeof dailyRows>();
    for (const x of dailyRows) {
      const arr = byDay.get(x.broadcast_date) ?? [];
      arr.push(x);
      byDay.set(x.broadcast_date, arr);
    }
    for (const arr of byDay.values()) {
      arr.sort((a, b) => a.rank - b.rank);
      arr.forEach((x, i) => {
        const k = normName(x.competitor_name);
        offsetByChannel.set(k, [...(offsetByChannel.get(k) ?? []), x.rank - (i + 1)]);
      });
    }
    const sum = new Map<string, { n: number; total: number; name: string }>();
    for (const x of dailyRows) {
      if (x.rating === null) continue;
      const k = normName(x.competitor_name);
      const e = sum.get(k) ?? { n: 0, total: 0, name: x.competitor_name };
      e.n++;
      e.total += x.rating;
      sum.set(k, e);
    }
    // 7일이 모두 있는 채널만(일부 날짜에 40위 밖이면 평균이 부풀려진다)
    const list: { name: string; rating: number; own: boolean; nielsenRank: number | null; offset: number; inDaily?: boolean }[] = [];
    for (const [k, e] of sum) {
      if (e.n !== 7 || isOwnChannelName(k)) continue;
      const offs = offsetByChannel.get(k) ?? [0];
      // 평균은 하루의 이상치(특보 날 뉴스 채널 급등 등)에 끌려가므로 중앙값을 쓴다
      const sorted = [...offs].sort((a, b) => a - b);
      list.push({ name: e.name, rating: e.total / 7, own: false, nielsenRank: null, offset: sorted[Math.floor(sorted.length / 2)] });
    }
    // 자사 채널은 닐슨 주간 순위·시청률을 그대로 쓴다
    const { data: pr } = await supabase.from("nielsen_period_rank").select("channel_id,rank,rating").eq("period_type", "weekly").eq("date_from", from).eq("date_to", to).eq("target_id", t2049);
    for (const p of (pr ?? []) as { channel_id: string; rank: number | null; rating: number | null }[]) {
      const c = (chs ?? []).find((x) => x.id === p.channel_id);
      if (!c || p.rating === null || !isOwnChannelName(c.name as string)) continue;
      list.push({ name: OWN_CHANNEL_NAMES[normName(c.name as string)], rating: p.rating, own: true, nielsenRank: p.rank, offset: 0, inDaily: sum.has(normName(c.name as string)) });
    }
    list.sort((a, b) => b.rating - a.rating);
    // 순위 보정은 일별 목록에 들어 있던 채널만 센다(일별 40위 밖인 자사 채널은 목록 순서에 포함되지 않았다)
    // 타사 순위는 추정치라 순서가 뒤집히지 않게 앞 순위 이상으로 맞추고, 보정이 들어간 뒤부터는 est(추정)로 표시한다. 자사 순위는 닐슨 값 그대로다.
    let pos = 0;
    let prev = 0;
    let est = false;
    const rows = list
      .map((x) => {
        if (x.inDaily !== false) pos++;
        if (x.nielsenRank !== null) {
          prev = Math.max(prev, x.nielsenRank);
          return { rank: x.nielsenRank, name: x.name, rating: x.rating, own: x.own, est: false };
        }
        if (x.offset !== 0) est = true;
        const rank = Math.max(pos + x.offset, prev);
        prev = rank;
        return { rank, name: x.name, rating: x.rating, own: x.own, est };
      })
      .filter((x) => x.own || x.rank <= showTop);
    result.push({ label: weekLabel(from), range: `${md(from)}~${md(to)}`, from, to, rows });
  }
  return result;
}
