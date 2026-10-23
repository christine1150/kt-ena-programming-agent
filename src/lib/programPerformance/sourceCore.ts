// 프로그램 성과 — 조회 핵심(DB 주입). "무엇을 어떻게 읽는가"만 맡고 계산은 metrics.ts·콘텐츠 적합도 엔진(computeSlotComparison)이 한다.
// supabase를 직접 import하지 않는다(테스트에서 가짜 DB로 바꾼다 — 운영 클라이언트 연결은 source.ts).
//
// 읽는 것(모두 읽기 전용):
//  - program_identity / program_alias: 같은 작품의 채널별 이름 묶음(구매 시뮬레이터가 만든 식별 계층 재사용). 후보(candidate) 별칭은 합치지 않는다.
//  - programs: 채널별 program_id(정규화 키가 작품 묶음에 속하는 것)
//  - featured_content: 오리지널 드라마·예능 분류(관리자 업로드 원본)
//  - ratings: 작품 방영 행(프로그램 단위 타깃 표기) / 채널 하루 행(랭킹 시트 타깃 표기, program_id 없음) / 슬롯 비교용 채널 방영 행
import { resolveProgramLevelTargetLabel, resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import { computeSlotComparison } from "@/lib/contentFit/engine";
import type { ContentFitAiring } from "@/lib/contentFit/types";
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import { matchPlanRow, normalizePlanRows, type PlanRow, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { addDays } from "@/lib/idealSchedule/time";
import { describeLearned, hhmm, inferRuns, type LearnedSlot } from "@/lib/broadcastPattern/inferRuns";
import { loadRunPatterns } from "@/lib/broadcastPattern/load";
import { CONTENT_FIT_CONFIG } from "@/lib/contentFit/config";
import { loadOriginalCompare } from "./originalCompare";
import {
  channelDailyMean,
  classifyWork,
  directionOfRatio,
  dedupeAirings,
  channelLineOf,
  describeRow,
  episodeSeries,
  extremesOf,
  extremesTextOf,
  matchesAiringFilter,
  dailySeries,
  daysBetween,
  whereLineOf,
  shareLineOf,
  monthlySeries,
  ratioOf,
  sampleStateOf,
  shareStat,
  slotLinesOf,
  slotPartsOf,
  slotTextOf,
  splitStat,
  trendTextOf,
  verdictOf,
  insightsOf,
  assessmentOf,
  pickExtremes,
  seriesTrendText,
  slotLeadOf,
  overallReviewOf,
  type ChannelDayRow,
  type CompAiring,
  type WorkAiring,
} from "./metrics";
import {
  PROGRAM_PERFORMANCE_VERSION,
  type AiringEvidence,
  type AiringFilter,
  type BroadcastPatternSlot,
  type ChannelRow,
  type CompetitorRow,
  type FitTagInfo,
  type PerformanceQuery,
  type PerformanceResult,
  type RatioValue,
  type SlotCell,
  type TargetMode,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PerfDb = { from: (table: string) => any };

const PAGE = 1000;
const IN_CHUNK = 100;
const EVIDENCE_CAP = 1500;

/**
 * 업로드 편성표(program_schedule_grid — 관리자 업로드·메일 EPG 자동 인식)의 [본]·[초]·[재] 표시와 회차를 기간 단위로 읽는다.
 * 닐슨 방영 행의 본방 여부(is_first_run)는 비어 있는 방영이 많아(<본>·<재> 표시가 이름에 없는 채널) 이 편성표 표시로만 보완한다. 읽기 실패는 빈 목록(보완 없음).
 */
async function loadPlanRange(db: PerfDb, channelId: string, from: string, to: string): Promise<PlanRow[]> {
  try {
    const raw = await fetchAll<PlanRowRaw>(
      (a, b) =>
        db
          .from("program_schedule_grid")
          .select("week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, episode_subtitle, matched_program_id, tags")
          .eq("channel_id", channelId)
          .gte("broadcast_date", addDays(from, -1))
          .lte("broadcast_date", addDays(to, 1))
          .order("broadcast_date", { ascending: true })
          .order("start_time", { ascending: true })
          .range(a, b),
      "편성표"
    );
    return normalizePlanRows(raw).filter((p) => p.date >= from && p.date <= to);
  } catch {
    return [];
  }
}

/** 화면 순서(기존 채널 목록 순서와 같다) */
export const CHANNEL_ORDER = ["ENA", "ENA_DRAMA", "ENA_PLAY", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"];

/** 공통 타깃 모드의 타깃 표기: [프로그램 행(타깃상세 시트), 채널 하루 행(랭킹 시트)] — targetResolution.ts와 같은 규칙 */
const COMMON_TARGETS: Record<Exclude<TargetMode, "kpi" | "both">, { program: string; channel: string; group: "2049" | "HH" }> = {
  common2049: { program: "수도권 2049", channel: "개인2049", group: "2049" },
  commonHH: { program: "전국 유료가구", channel: "National 유료방송가입가구", group: "HH" },
};

export interface FitLookup {
  (channelCode: string): Promise<{ asOf: string; windowFrom: string; items: { programId: string; tag: string | null; tier: string; sampleDays: number; airings: number; slotIndex?: number | null; scaleIndex?: number | null; trendDelta?: number | null }[] } | null>;
}

export interface LoadOptions {
  /** 콘텐츠 적합도(최근 12주) 조회 — 운영은 loadContentFit, 테스트는 가짜 */
  fitLookup?: FitLookup;
  /** programs 전체 목록 캐시(운영에서 요청마다 다시 읽지 않도록) */
  programsLoader?: () => Promise<{ id: string; channel_id: string; canonical_name: string }[]>;
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw new Error(`${label} 조회 실패: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadAllPrograms(db: PerfDb): Promise<{ id: string; channel_id: string; canonical_name: string }[]> {
  return fetchAll((a, b) => db.from("programs").select("id, channel_id, canonical_name").order("id", { ascending: true }).range(a, b), "프로그램");
}

async function targetIdOf(db: PerfDb, label: string): Promise<string | null> {
  const { data } = await db.from("targets").select("id").eq("label", label).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function latestDataDate(db: PerfDb): Promise<string | null> {
  const { data } = await db.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: false }).limit(1).maybeSingle();
  return (data?.broadcast_date as string | undefined) ?? null;
}

async function earliestDataDate(db: PerfDb): Promise<string | null> {
  const { data } = await db.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: true }).limit(1).maybeSingle();
  return (data?.broadcast_date as string | undefined) ?? null;
}

/** 작품 묶음: group_key가 같은 정규화 키 전부(확정 별칭 반영) + 사람 승인 대기 후보(합치지 않음, 안내만) */
export async function resolveWork(db: PerfDb, groupKey: string): Promise<{ displayName: string; memberKeys: string[]; candidateKeys: string[] } | null> {
  const { data: members, error } = await db.from("program_identity").select("key, display_name, own_channels, airings_total").eq("group_key", groupKey);
  if (error) throw new Error(`작품 식별 조회 실패: ${error.message}`);
  const rows = (members ?? []) as { key: string; display_name: string; own_channels: string[] | null; airings_total: number | null }[];
  if (rows.length === 0) return null;
  const rep = rows.find((r) => r.key === groupKey) ?? [...rows].sort((a, b) => (b.airings_total ?? 0) - (a.airings_total ?? 0))[0];
  const { data: cands } = await db.from("program_alias").select("alias_key, status").eq("group_key", groupKey).eq("status", "candidate");
  return {
    displayName: rep.display_name,
    memberKeys: [...new Set(rows.map((r) => r.key))].sort(),
    candidateKeys: [...new Set(((cands ?? []) as { alias_key: string }[]).map((c) => c.alias_key))].sort(),
  };
}

/** 경쟁채널 시트 타깃 → (화면 타깃명, 랭킹 시트 채널 하루 타깃). 자사 블록 실측으로 같은 지표 확인(nielsenDaily.ts SELF_BLOCK_EXTRA_TARGETS 주석). */
const COMPETITOR_TARGETS: { sheet: string; label: string; channel: string }[] = [
  { sheet: "개인2049", label: "수도권 2049", channel: "개인2049" },
  { sheet: "유료방송가구", label: "전국 유료가구", channel: "National 유료방송가입가구" },
];

/**
 * 경쟁 채널에서의 같은 작품 성과 — competitor_program_target_ratings(등록 경쟁채널의 프로그램 단위 방영) 중 이름 정규화 키가 작품 묶음에 속하는 행.
 * <본>/<재> 태그로 방송 구분을 나누고(태그 없음은 본방 여부 미확인), 같은 방영(채널·타깃·방송일·시작 시각)은 한 번만 센다.
 * 자사 채널과 이름이 같은 경쟁채널 항목은 뺀다(자사 표에 이미 있음). 방영이 없으면 행을 만들지 않는다.
 */
export async function loadCompetitorRows(db: PerfDb, memberKeys: string[], ownNames: Set<string>, from: string, to: string, airing: AiringFilter, nameVariants: string[] = []): Promise<CompetitorRow[]> {
  const keys = memberKeys.filter((k) => /^[가-힣A-Z0-9]+$/.test(k));
  if (!keys.length || !from || !to) return [];
  const memberSet = new Set(keys);
  // norm_program_name(DB 생성 열, 대소문자 유지) 완전 일치로 찾는다 — 색인을 타서 빠르다(ilike는 색인을 못 타 수 초 걸림). 대소문자 변형은 자사 프로그램 표기에서 모은다.
  const exact = [...new Set([...keys, ...keys.map((k) => k.toLowerCase()), ...nameVariants.map((n) => n.replace(/<본>|<재>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, ""))])].filter(Boolean);
  const raw = await fetchAll<Record<string, unknown>>(
    (a, b) =>
      db
        .from("competitor_program_target_ratings")
        .select("competitor_name, target_label, broadcast_date, start_time, program_name, rating, share")
        .in("norm_program_name", exact)
        .in("target_label", COMPETITOR_TARGETS.map((t) => t.sheet))
        .gte("broadcast_date", from)
        .lte("broadcast_date", to)
        .order("broadcast_date", { ascending: true })
        .order("start_time", { ascending: true })
        .range(a, b),
    "경쟁 채널 방영"
  );
  const seen = new Set<string>();
  const by = new Map<string, WorkAiring[]>();
  for (const r of raw) {
    const name = String(r.competitor_name ?? "");
    const pname = String(r.program_name ?? "");
    if (!name || ownNames.has(normalizeProgramKey(name)) || !memberSet.has(normalizeProgramKey(pname))) continue;
    const k = `${name}|${r.target_label}|${r.broadcast_date}|${r.start_time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const firstRun = /<본>/.test(pname) ? true : /<재>/.test(pname) ? false : null;
    if (!matchesAiringFilter(firstRun, airing)) continue;
    const gk = `${name}|${r.target_label}`;
    by.set(gk, [
      ...(by.get(gk) ?? []),
      { programId: name, date: String(r.broadcast_date), startTime: (r.start_time as string | null) ?? null, endTime: null, rating: r.rating === null || r.rating === undefined ? null : Number(r.rating), share: r.share === null || r.share === undefined ? null : Number(r.share), firstRun, episode: null },
    ]);
  }
  if (by.size === 0) return [];
  const names = [...new Set([...by.keys()].map((k) => k.split("|")[0]))];
  const out: CompetitorRow[] = [];
  for (const t of COMPETITOR_TARGETS) {
    const tid = await targetIdOf(db, t.channel);
    const dayRows = tid
      ? await fetchAll<Record<string, unknown>>(
          (a, b) =>
            db
              .from("competitor_ratings")
              .select("competitor_name, broadcast_date, rating, created_at")
              .in("competitor_name", names)
              .eq("target_id", tid)
              .not("rank", "is", null)
              .gte("broadcast_date", from)
              .lte("broadcast_date", to)
              .order("broadcast_date", { ascending: true })
              .order("id", { ascending: true })
              .range(a, b),
          "경쟁 채널 하루 시청률"
        )
      : [];
    for (const name of names) {
      const list = by.get(`${name}|${t.sheet}`);
      if (!list?.length) continue;
      const days: ChannelDayRow[] = dayRows.filter((d) => d.competitor_name === name).map((d) => ({ date: String(d.broadcast_date), rating: d.rating === null || d.rating === undefined ? null : Number(d.rating), createdAt: (d.created_at as string | null) ?? null }));
      const cd = channelDailyMean(days, from, to, t.channel);
      const st = splitStat(list);
      const sh = shareStat(list);
      out.push({
        competitorName: name,
        targetLabel: t.label,
        airings: st.airings,
        days: st.days,
        firstRunAirings: list.filter((x) => x.firstRun === true).length,
        rerunAirings: list.filter((x) => x.firstRun === false).length,
        programAvg: st.avg,
        shareAvg: sh.avg,
        channelDaily: cd,
        vsChannel: ratioOf(st.avg, cd.mean, tid ? "경쟁 채널 하루 시청률 자료 없음" : `채널 하루 시청률 타깃('${t.channel}') 없음`),
        sampleState: sampleStateOf(st.days),
      });
    }
  }
  // 방영 많은 경쟁채널 먼저, 같은 채널의 두 타깃은 붙여 둔다
  const total = new Map<string, number>();
  for (const r of out) total.set(r.competitorName, Math.max(total.get(r.competitorName) ?? 0, r.airings));
  return out.sort((a, b) => (total.get(b.competitorName) ?? 0) - (total.get(a.competitorName) ?? 0) || a.competitorName.localeCompare(b.competitorName) || a.targetLabel.localeCompare(b.targetLabel));
}

function hourBlockOf(t: string | null): number | null {
  if (!t || t.length < 2) return null;
  const h = Number(t.slice(0, 2));
  if (!Number.isFinite(h)) return null;
  return h < 2 ? h + 24 : h;
}
const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const NA_RATIO: RatioValue = { value: null, base: null, ratio: null, pct: null, diff: null, direction: "NA", naReason: "실적 없음" };

/** 같은 채널·요일·실측 시각의 슬롯은 근거(관리자 등록·네이버)를 합쳐 한 줄로 */
function mergeLearned(list: LearnedSlot[]): BroadcastPatternSlot[] {
  const by = new Map<string, BroadcastPatternSlot>();
  for (const l of list.sort((a, b) => a.source.localeCompare(b.source))) {
    const days = describeLearned({ days: l.days, actualMinute: l.actualMinute }).split(" ")[0];
    const key = `${l.channelCode}|${days}|${l.actualMinute}`;
    const cur = by.get(key);
    if (cur) {
      if (!cur.sources.includes(l.source)) cur.sources.push(l.source);
      cur.observed = Math.max(cur.observed, l.observed);
      if (l.source === "naver") cur.label = l.label;
    } else by.set(key, { sources: [l.source], channelCode: l.channelCode, days, nominal: hhmm(l.nominalMinute), actual: hhmm(l.actualMinute), observed: l.observed, label: l.label });
  }
  const ord = (c: string) => (CHANNEL_ORDER.includes(c) ? CHANNEL_ORDER.indexOf(c) : 99);
  return [...by.values()].sort((a, b) => ord(a.channelCode) - ord(b.channelCode) || a.actual.localeCompare(b.actual));
}

export async function loadProgramPerformanceWith(db: PerfDb, query: PerformanceQuery, opts: LoadOptions = {}): Promise<PerformanceResult | null> {
  const work = await resolveWork(db, query.groupKey);
  if (!work) return null;
  const memberSet = new Set(work.memberKeys);

  const { data: chData, error: chErr } = await db.from("channels").select("id, code, name, primary_target");
  if (chErr) throw new Error(`채널 조회 실패: ${chErr.message}`);
  const orderOf = (code: string) => (CHANNEL_ORDER.includes(code) ? CHANNEL_ORDER.indexOf(code) : 99);
  const channels = ((chData ?? []) as { id: string; code: string; name: string; primary_target: string | null }[]).sort((a, b) => orderOf(a.code) - orderOf(b.code) || a.code.localeCompare(b.code));
  const allPrograms = await (opts.programsLoader ? opts.programsLoader() : loadAllPrograms(db));
  const workPrograms = allPrograms.filter((p) => memberSet.has(normalizeProgramKey(p.canonical_name ?? "")));
  const workIds = workPrograms.map((p) => p.id);
  const idsByChannel = new Map<string, string[]>();
  for (const p of workPrograms) idsByChannel.set(p.channel_id, [...(idsByChannel.get(p.channel_id) ?? []), p.id].sort());
  const nameById = new Map(workPrograms.map((p) => [p.id, p.canonical_name]));

  // 분류(승인 메타데이터만)
  const categories: string[] = [];
  for (let i = 0; i < workIds.length; i += IN_CHUNK) {
    const { data } = await db.from("featured_content").select("category").in("program_id", workIds.slice(i, i + IN_CHUNK));
    for (const r of (data ?? []) as { category: string | null }[]) if (r.category) categories.push(r.category);
  }
  const classification = classifyWork(categories);

  // 본방 편성 패턴 — 관리자 등록(주요 콘텐츠 관리)·네이버 방송 정보. 닐슨·업로드 편성표로도 본방 여부를 못 정한 방영만 이 패턴으로 보완한다.
  const runPatterns = await loadRunPatterns(db, { memberKeys: work.memberKeys, workPrograms, channelCodeById: new Map(channels.map((c) => [c.id, c.code])) });
  const learnedSlots = new Map<string, LearnedSlot>();
  // 채널별 보완 건수 — 타깃(2049·가구)마다 같은 방영을 읽으므로 합산하지 않고 값을 덮어써, 끝에 안내 한 줄로 합친다
  const fillStats = new Map<string, { channelName: string; order: number; plan: number; registered: number; naver: number; episode: number }>();
  const fillOf = (code: string, channelName: string) => {
    const cur = fillStats.get(code) ?? { channelName, order: CHANNEL_ORDER.includes(code) ? CHANNEL_ORDER.indexOf(code) : 99, plan: 0, registered: 0, naver: 0, episode: 0 };
    fillStats.set(code, cur);
    return cur;
  };

  // 날짜 범위 — DB 첫 관측일 / 작품 첫 관측일 / 확인된 첫 본방일 / 최신 자료일을 구분한다
  const [latest, dbFirst] = await Promise.all([latestDataDate(db), earliestDataDate(db)]);
  let workFirst: string | null = null;
  let workFirstFirstRun: string | null = null;
  // 프로그램마다 따로(program_id, broadcast_date 색인) 동시에 묻는다 — 여러 id를 in()으로 묶어 날짜 정렬하면 색인을 못 타 수 초 걸렸다(2026-10-22 실측 4.9초)
  const firsts = await Promise.all(
    workIds.map((pid) =>
      Promise.all([
        db.from("ratings").select("broadcast_date").eq("program_id", pid).eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: true }).limit(1).maybeSingle(),
        db.from("ratings").select("broadcast_date").eq("program_id", pid).eq("source_type", "nielsen_daily").eq("is_first_run", true).order("broadcast_date", { ascending: true }).limit(1).maybeSingle(),
      ])
    )
  );
  for (const [{ data: a }, { data: b }] of firsts) {
    const da = (a?.broadcast_date as string | undefined) ?? null;
    const dbb = (b?.broadcast_date as string | undefined) ?? null;
    if (da && (!workFirst || da < workFirst)) workFirst = da;
    if (dbb && (!workFirstFirstRun || dbb < workFirstFirstRun)) workFirstFirstRun = dbb;
  }
  const to = latest ? (query.to && query.to < latest ? query.to : latest) : query.to ?? "";
  const presetDays = query.preset === "4w" ? 27 : query.preset === "12w" ? 83 : null;
  const from = query.from ?? (presetDays !== null && to ? new Date(Date.parse(`${to}T00:00:00Z`) - presetDays * 86_400_000).toISOString().slice(0, 10) : null) ?? workFirst ?? to;
  const notes: string[] = [];
  if (query.to && latest && query.to > latest) notes.push(`조회 종료일이 최신 자료일(${latest})보다 늦어 ${latest}까지만 봅니다(미래·미수신일은 0으로 넣지 않음).`);
  if (work.candidateKeys.length) notes.push(`이름이 비슷한 '연결 확인 필요' 후보 ${work.candidateKeys.length}건은 합치지 않았습니다(관리자 승인 전).`);
  if (classification.note) notes.push(classification.note);

  const selected = query.channels && query.channels.length ? new Set(query.channels) : null;
  // 채널 × 타깃 조회는 서로 독립이라 동시에 실행하고(조회 수십 건을 차례로 기다리던 것이 계산 시간의 대부분), 결과는 원래 순서대로 합친다.
  type Bucket = { rows: ChannelRow[]; evidence: AiringEvidence[]; slotCells: SlotCell[]; allDays: Set<string>; allEpisodes: Set<number> };
  const jobs: (() => Promise<Bucket>)[] = [];

  for (const ch of channels) {
    if (selected && !selected.has(ch.code)) continue;
    const ids = idsByChannel.get(ch.id) ?? [];
    const primary = ch.primary_target ?? "";
    const mode = query.targetMode;
    const primaryGroup: "2049" | "HH" = primary.includes("유료방송가입가구") ? "HH" : "2049";
    // 채널 KPI 타깃(isPrimary) / 공통 타깃. 'both'는 채널마다 KPI 타깃과 다른 그룹 타깃 둘 다(KPI 먼저).
    const kpiTarget = { program: resolveProgramLevelTargetLabel(primary), channel: resolveRankSheetTargetLabel(primary), group: primaryGroup, isPrimary: true };
    const otherTarget = { ...COMMON_TARGETS[primaryGroup === "2049" ? "commonHH" : "common2049"], isPrimary: false };
    const targets = mode === "kpi" ? [kpiTarget] : mode === "both" ? [kpiTarget, otherTarget] : [{ ...COMMON_TARGETS[mode], isPrimary: COMMON_TARGETS[mode].group === primaryGroup }];
    for (const [ti, tgt] of targets.entries()) jobs.push(async (): Promise<Bucket> => {
    const rows: ChannelRow[] = [];
    const evidence: AiringEvidence[] = [];
    const slotCells: SlotCell[] = [];
    const allDays = new Set<string>();
    const allEpisodes = new Set<number>();
    const done = (): Bucket => ({ rows, evidence, slotCells, allDays, allEpisodes });
    const programLabel = tgt.program;
    const channelLabel = tgt.channel;
    const kpiGroup = tgt.group;
    // 근거 방송·시간대 칸·총계는 채널당 한 타깃만(두 타깃이면 같은 방영이 두 번 세어지므로 KPI 타깃만)
    const collect = targets.length === 1 || tgt.isPrimary;
    const base: ChannelRow = {
      channelCode: ch.code,
      channelName: ch.name,
      kpiGroup,
      targetLabel: programLabel,
      status: "NO_OBSERVATION",
      statusNote: "",
      programIds: ids,
      airings: 0,
      days: 0,
      episodes: 0,
      firstRun: { airings: 0, days: 0, avg: null },
      rerun: { airings: 0, days: 0, avg: null },
      unknownRun: { airings: 0, days: 0, avg: null },
      programAvg: null,
      observedFrom: null,
      observedTo: null,
      channelDaily: null,
      vsChannel: NA_RATIO,
      slot: null,
      fit: null,
      sampleState: "NONE",
      summary: "",
      monthly: [],
      daily: [],
      primary: tgt.isPrimary,
      shareAvg: null,
      shareAirings: 0,
      analysis: null,
    };
    if (ch.code === "SKYUHD") {
      if (ti === 0) rows.push({ ...base, status: "UNSUPPORTED", statusNote: "skyUHD는 프로그램 시청률이 별도 수기 파일(타깃 없음·초 단위)이라 이번 비교에서 계산하지 않습니다." });
      return done();
    }
    if (!primary) {
      if (ti === 0) rows.push({ ...base, status: "UNSUPPORTED", statusNote: "채널 핵심 타깃이 등록되지 않았습니다." });
      return done();
    }
    const [progTargetId, chTargetId] = await Promise.all([targetIdOf(db, programLabel), targetIdOf(db, channelLabel)]);
    if (!progTargetId) {
      rows.push({ ...base, status: "NO_TARGET", statusNote: `'${programLabel}' 타깃이 없습니다.` });
      return done();
    }

    // 채널 하루 시청률(랭킹 시트 행, 공식 순위가 붙은 채널 단위 행) — 작품 방영 여부와 무관하게 조회 기간 전체
    const dayRows = chTargetId
      ? await fetchAll<Record<string, unknown>>(
          (a, b) =>
            db
              .from("ratings")
              .select("broadcast_date, rating, created_at")
              .eq("channel_id", ch.id)
              .eq("target_id", chTargetId)
              .eq("source_type", "nielsen_daily")
              .is("program_id", null)
              .not("rank", "is", null)
              .gte("broadcast_date", from)
              .lte("broadcast_date", to)
              .order("broadcast_date", { ascending: true })
              .order("id", { ascending: true })
              .range(a, b),
          "채널 하루 시청률"
        )
      : [];
    const dayList = dayRows.map((r): ChannelDayRow => ({ date: r.broadcast_date as string, rating: r.rating === null || r.rating === undefined ? null : Number(r.rating), createdAt: (r.created_at as string | null) ?? null }));
    const channelDaily = channelDailyMean(dayList, from, to, channelLabel);

    // 작품 방영 행
    let workRows: WorkAiring[] = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      const got = await fetchAll<Record<string, unknown>>(
        (a, b) =>
          db
            .from("ratings")
            .select("program_id, broadcast_date, start_time, end_time, rating, share, is_first_run, episode_number, created_at")
            .in("program_id", chunk)
            .eq("target_id", progTargetId)
            .eq("source_type", "nielsen_daily")
            .gte("broadcast_date", from)
            .lte("broadcast_date", to)
            .order("broadcast_date", { ascending: true })
            .order("id", { ascending: true })
            .range(a, b),
        "작품 방영"
      );
      workRows.push(
        ...got.map((r) => ({
          programId: r.program_id as string,
          date: r.broadcast_date as string,
          startTime: (r.start_time as string | null) ?? null,
          endTime: (r.end_time as string | null) ?? null,
          rating: r.rating === null || r.rating === undefined ? null : Number(r.rating),
          firstRun: (r.is_first_run as boolean | null) ?? null,
          episode: (r.episode_number as number | null) ?? null,
          createdAt: (r.created_at as string | null) ?? null,
          share: r.share === null || r.share === undefined ? null : Number(r.share),
        }))
      );
    }
    workRows = dedupeAirings(workRows);
    // 본방 여부·회차가 비어 있는 방영은 업로드 편성표의 표시로 보완한다(닐슨 값이 있으면 그대로 둔다). 편성표가 없는 기간은 그대로 '미확인'이다.
    if (workRows.some((r) => r.firstRun === null || r.episode === null)) {
      const plan = await loadPlanRange(db, ch.id, from, to);
      if (plan.length > 0) {
        const byDate = new Map<string, PlanRow[]>();
        for (const p of plan) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
        let filledRun = 0;
        workRows = workRows.map((r) => {
          if ((r.firstRun !== null && r.episode !== null) || !r.startTime) return r;
          const hit = matchPlanRow(byDate.get(r.date) ?? [], { programId: r.programId, name: nameById.get(r.programId) ?? "", startTime: r.startTime });
          if (!hit) return r;
          const run = r.firstRun ?? (hit.isNew ? true : hit.isRerun ? false : null);
          if (r.firstRun === null && run !== null) filledRun++;
          return { ...r, firstRun: run, episode: r.episode ?? hit.episodeNumber };
        });
        if (filledRun > 0) fillOf(ch.code, base.channelName).plan = filledRun;
      }
    }
    // 그래도 비어 있는 방영은 본방 편성 패턴(요일·시각·채널)으로 보완한다. 정확한 본방 시각은 이 방영 자료(닐슨)로 맞추고, 회차는 네이버가 알려 준 방송일과 일치할 때만 붙인다.
    if (runPatterns.patterns.length > 0 && workRows.some((r) => r.firstRun === null || r.episode === null)) {
      const inf = inferRuns(
        workRows.map((r) => ({ channelCode: ch.code, date: r.date, startTime: r.startTime })),
        runPatterns.patterns
      );
      let byRegistered = 0;
      let byNaver = 0;
      let epFilled = 0;
      workRows = workRows.map((r, i) => {
        const x = inf.results[i];
        const run = r.firstRun ?? x.firstRun;
        const episode = r.episode ?? (run === true && x.firstRun === true ? x.episode : null);
        if (r.firstRun === null && run !== null) {
          if (x.source === "registered") byRegistered++;
          else byNaver++;
        }
        if (r.episode === null && episode !== null) epFilled++;
        return run === r.firstRun && episode === r.episode ? r : { ...r, firstRun: run, episode };
      });
      for (const l of inf.learned) learnedSlots.set(`${l.source}|${l.channelCode}|${l.nominalMinute}|${l.days.join("")}`, l);
      if (byRegistered || byNaver || epFilled) {
        const f = fillOf(ch.code, base.channelName);
        f.registered = byRegistered;
        f.naver = byNaver;
        f.episode = epFilled;
      }
    }

    if (workRows.length === 0) {
      // 기록 없음 ≠ 미방영. 그 채널 프로그램 단위 자료가 아예 없는 기간이면 그렇게 표시한다(ENA Story 일부 기간 등).
      const { data: any1 } = await db
        .from("ratings")
        .select("id")
        .eq("channel_id", ch.id)
        .eq("target_id", progTargetId)
        .eq("source_type", "nielsen_daily")
        .not("program_id", "is", null)
        .gte("broadcast_date", from)
        .lte("broadcast_date", to)
        .limit(1)
        .maybeSingle();
      const noProgramData = !any1;
      rows.push({
        ...base,
        channelDaily,
        status: noProgramData ? "NO_PROGRAM_DATA" : "NO_OBSERVATION",
        statusNote: noProgramData ? "이 기간 이 채널의 프로그램 단위 닐슨 자료가 없습니다(채널 하루 값만 있음)." : ids.length ? "이 기간에 이 작품의 방영 기록이 없습니다." : "이 채널에서 이 작품의 방영 기록을 찾지 못했습니다.",
      });
      return done();
    }

    const filtered = workRows.filter((r) => matchesAiringFilter(r.firstRun, query.airing));
    const first = splitStat(workRows.filter((r) => r.firstRun === true));
    const rerun = splitStat(workRows.filter((r) => r.firstRun === false));
    const unknown = splitStat(workRows.filter((r) => r.firstRun === null));
    const fStat = splitStat(filtered);
    const observedFrom = workRows[0].date;
    const observedTo = workRows[workRows.length - 1].date;
    const episodes = new Set(filtered.flatMap((r) => (r.episode === null ? [] : [r.episode])));
    if (collect)
      for (const r of filtered) {
        allDays.add(r.date);
        if (r.episode !== null) allEpisodes.add(r.episode);
      }
    const vsChannel = ratioOf(fStat.avg, channelDaily.mean, chTargetId ? "채널 하루 시청률 자료 없음" : `채널 하루 시청률 타깃('${channelLabel}') 없음`);

    // 동슬롯 대비 — 비교 창 = 이 채널에서 작품이 관측된 첫~마지막 방송일(본재 전환에도 같은 창, 수축 배율·기존 값 그대로)
    // 편성 비교(시간대별 단순 평균)의 비교군은 조회 기간과 무관하게 "올해 1월 1일 ~ 최신 자료일"(최소 12주)의 같은 채널·타깃 다른 프로그램 — 4주 조회에서 비교 방송이 모자라 —만 나오던 문제(사용자 지시 2026-10-23)
    const yearStart = `${to.slice(0, 4)}-01-01`;
    const cmpFrom = daysBetween(yearStart, to) >= 84 ? yearStart : addDays(to, -83);
    const fetchFrom = cmpFrom < observedFrom ? cmpFrom : observedFrom;
    const chAirRows = await fetchAll<Record<string, unknown>>(
      (a, b) =>
        db
          .from("ratings")
          .select("program_id, broadcast_date, start_time, rating, share, is_first_run")
          .eq("channel_id", ch.id)
          .eq("target_id", progTargetId)
          .eq("source_type", "nielsen_daily")
          .not("program_id", "is", null)
          .gte("broadcast_date", fetchFrom)
          .lte("broadcast_date", to)
          .order("broadcast_date", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      "슬롯 비교 방영"
    );
    const seen = new Set<string>();
    const chAirings: ContentFitAiring[] = [];
    const others: CompAiring[] = [];
    // 이 작품 방영은 위에서 보완한 본방 여부를 쓴다(본방 조건 비교가 보완 전 값으로 어긋나지 않게)
    const workRun = new Map(workRows.map((w) => [`${w.programId}|${w.date}|${w.startTime ?? ""}`, w.firstRun]));
    for (const r of chAirRows) {
      if (r.rating === null || r.rating === undefined) continue;
      const k = `${r.program_id}|${r.broadcast_date}|${r.start_time ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const d = r.broadcast_date as string;
      const dbRun = (r.is_first_run as boolean | null) ?? null;
      if (!ids.includes(r.program_id as string) && d >= cmpFrom) others.push({ date: d, startTime: (r.start_time as string | null) ?? null, rating: Number(r.rating), share: r.share === null || r.share === undefined ? null : Number(r.share) });
      if (d < observedFrom || d > observedTo) continue;
      chAirings.push({ programId: r.program_id as string, date: r.broadcast_date as string, startTime: (r.start_time as string | null) ?? null, rating: Number(r.rating), reach: null, timeSpentShare: null, firstRun: dbRun ?? workRun.get(k) ?? null });
    }
    const sc = computeSlotComparison(chAirings, ids, (a) => matchesAiringFilter(a.firstRun, query.airing));
    const slotRatio = sc.airings > 0 ? ratioOf(sc.shrunkIndex === null ? null : sc.sumActual / sc.airings, sc.shrunkIndex === null ? null : sc.sumExpected / sc.airings) : { ...NA_RATIO, naReason: "비교할 방영 없음" };
    // 표시 배율은 콘텐츠 적합도와 같은 수축 배율을 쓴다(작은 표본은 1배 쪽으로 당겨짐). 원값·기준값은 방영당 평균으로 보조 표시.
    if (sc.shrunkIndex !== null) {
      slotRatio.ratio = sc.shrunkIndex;
      slotRatio.pct = (sc.shrunkIndex - 1) * 100;
      slotRatio.direction = directionOfRatio(sc.shrunkIndex);
      slotRatio.naReason = null;
    }
    const slot = {
      ratio: slotRatio,
      rawIndex: sc.rawIndex,
      reliability: sc.reliability,
      airingsUsed: sc.airings,
      comparisonAirings: sc.comparisonAirings,
      levels: sc.levels,
      windowFrom: observedFrom,
      windowTo: observedTo,
      note: "같은 채널·타깃·기간에서 같은 요일·시(부족하면 요일·시간대 → 시간대 → 채널)의 다른 프로그램 방영 평균 대비, 콘텐츠 적합도와 같은 수축(κ=2) 적용. 비교군은 본재 구분 없음.",
    };

    // 현재 판정(콘텐츠 적합도, 최근 12주) — 채널 KPI 타깃 행에서만(엔진이 KPI 타깃 기준, 공통 타깃 모드 제외)
    let fit: FitTagInfo | null = null;
    if (opts.fitLookup && (mode === "kpi" || mode === "both") && tgt.isPrimary) {
      const fr = await opts.fitLookup(ch.code).catch(() => null);
      if (fr) {
        const mine = fr.items.filter((i) => ids.includes(i.programId)).sort((a, b) => b.airings - a.airings);
        fit = mine.length
          ? {
              tag: mine[0].tag,
              tier: mine[0].tier,
              asOf: fr.asOf,
              windowFrom: fr.windowFrom,
              sampleDays: mine[0].sampleDays,
              note: mine.length > 1 ? `이 채널에 표기가 다른 같은 작품 ${mine.length}개 중 방영이 가장 많은 것 기준` : "",
              slotIndex: mine[0].slotIndex ?? null,
              scaleIndex: mine[0].scaleIndex ?? null,
              trendFalling: mine[0].trendDelta !== null && mine[0].trendDelta !== undefined && mine[0].trendDelta <= CONTENT_FIT_CONFIG.trendDownDelta,
            }
          : { tag: null, tier: "NONE", asOf: fr.asOf, windowFrom: fr.windowFrom, sampleDays: 0, note: "최근 12주 방영 없음" };
      }
    }

    const sampleState = sampleStateOf(fStat.days);
    for (const r of collect ? filtered.slice(0, EVIDENCE_CAP) : []) {
      evidence.push({ channelCode: ch.code, date: r.date, startTime: r.startTime, endTime: r.endTime, programId: r.programId, name: nameById.get(r.programId) ?? "", firstRun: r.firstRun, episode: r.episode, rating: r.rating });
    }
    const cells = new Map<string, { n: number; s: number; v: number; dow: number; hb: number }>();
    for (const r of collect ? filtered : []) {
      const hb = hourBlockOf(r.startTime);
      if (hb === null) continue;
      const dow = dowOf(r.date);
      const k = `${dow}|${hb}`;
      const c = cells.get(k) ?? { n: 0, s: 0, v: 0, dow, hb };
      c.n++;
      if (r.rating !== null) {
        c.s += r.rating;
        c.v++;
      }
      cells.set(k, c);
    }
    for (const c of cells.values()) slotCells.push({ channelCode: ch.code, dow: c.dow, hourBlock: c.hb, airings: c.n, avg: c.v ? c.s / c.v : null });

    // 선택 채널 분석(2×2) — 이 행의 타깃·기간·본재 조건 그대로
    const monthly = monthlySeries(filtered, dayList, from, to, channelLabel);
    const daily = dailySeries(filtered, dayList, channelLabel);
    const sh = shareStat(filtered);
    let analysis: ChannelRow["analysis"] = null;
    if (filtered.length > 0) {
      const eps = episodeSeries(filtered);
      const ext = extremesOf(filtered);
      const slots = slotLinesOf(filtered, others, CONTENT_FIT_CONFIG.minOtherAirings);
      // 본방 외(확인된 재방 + 본방 여부 미확인) 성과 — 전체 방송 조회이고 본방이 섞여 있을 때만 근거로 쓴다
      const nonFirstRows = workRows.filter((r) => r.firstRun !== true);
      const nonFirst = query.airing === "all" && first.airings > 0 && nonFirstRows.length > 0 ? { vs: ratioOf(splitStat(nonFirstRows).avg, channelDaily.mean), days: splitStat(nonFirstRows).days } : null;
      const v = verdictOf({ vsChannel: vsChannel.direction, vsSlot: slot.ratio.direction, sampleState, days: fStat.days, slots, nonFirst });
      const firstRuns = filtered.filter((a) => a.firstRun === true && a.rating !== null).map((a) => ({ date: a.date, startTime: a.startTime, episode: a.episode, firstRun: true, rating: a.rating as number }));
      analysis = { episodes: eps.length >= 2 ? eps : [], firstRuns, channelAvg: channelDaily.mean, trendText: trendTextOf(eps, monthly, ch.code, firstRuns), extremes: ext, extremesText: extremesTextOf(ext), slots, slotText: slotTextOf(slots), slotParts: slotPartsOf(slots, nonFirst ? { ...nonFirst, rerunMajor: rerun.airings >= unknown.airings } : null), verdict: v.verdict, reasons: v.reasons, insights: insightsOf({ all: query.airing === "all", first, rerun, unknown, channelAvg: channelDaily.mean, overallRatio: vsChannel.ratio, firstRuns }) };
      // 개편(2026-10-23): 흐름 문구·최고최저는 그래프 단위(본방별·일별)마다 그 그래프와 같은 자료로, 편성 비교 결론은 표본 경고 없이
      const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
      analysis.trendFirst = firstRuns.length >= 2 ? trendTextOf(eps, [], ch.code, firstRuns) : null;
      analysis.trendDaily = seriesTrendText(daily.flatMap((d) => (d.programAvg === null ? [] : [{ avg: d.programAvg, label: md(d.date) }])), "방송일", ch.code);
      analysis.firstExtremes = firstRuns.length >= 2 ? pickExtremes(firstRuns, (x) => x.rating) : null;
      analysis.dayExtremes = pickExtremes(daily, (x) => x.programAvg);
      analysis.slotLead = slotLeadOf(slots);
      analysis.slotBaseFrom = cmpFrom;
      analysis.slotBaseTo = to;
      analysis.runSplit = nonFirst && first.days > 0 ? { first: ratioOf(first.avg, channelDaily.mean), firstDays: first.days, rest: nonFirst.vs, restDays: nonFirst.days } : null;
    }

    // 종합평가 — 채널 KPI 타깃 행에서만. 최근 12주 편성진단(콘텐츠 적합도) 지수가 있으면 그것을, 없으면(12주 방영 없음·3일 미만·공통 타깃 모드) 조회 기간의 같은 두 지표를 쓴다.
    // 두 범위의 분모(채널 방영 평균 vs 채널 하루 평균)가 달라 섞지 않고 scope로 구분한다.
    let assessment: ChannelRow["assessment"] = null;
    if (tgt.isPrimary && filtered.length > 0) {
      // 조회 기간이 12주 편성진단 창과 같을 때만 진단 지수를 쓴다 — 다르면(최근 4주·전체 기간 등) 결론은 12주, 세부 줄은 조회 기간이 되어
      // 한 블록에 기간이 다른 두 결론이 섞였다(2026-10-23 쯔양몇끼 전체 기간: 표 100%인데 결론 '채널 평균보다 낮고'). 이때는 조회 기간 값으로 판단한다.
      const fromFit = fit !== null && fit.slotIndex !== null && fit.slotIndex !== undefined && fit.windowFrom === from && fit.asOf === to;
      const a = fromFit
        ? assessmentOf({ scale: fit!.scaleIndex ?? null, slot: fit!.slotIndex ?? null, trendFalling: fit!.trendFalling === true, scope: "12w" })
        : assessmentOf({ scale: vsChannel.ratio, slot: slot.ratio.ratio, trendFalling: false, scope: "period" });
      assessment = {
        scope: fromFit ? "12w" : "period",
        from: fromFit ? fit!.windowFrom : from,
        to: fromFit ? fit!.asOf : to,
        targetLabel: programLabel,
        allAiringsBasis: fromFit && query.airing !== "all",
        ...a,
        slotIndex: fromFit ? (fit!.slotIndex ?? null) : slot.ratio.ratio,
        // 어디서 강하고 약한지·점유율 효율은 조회 기간 방영 vs 올해 비교군(편성 비교와 같은 자료)
        where: analysis ? whereLineOf(analysis.slots) : null,
        shareNote: analysis ? shareLineOf(vsChannel, analysis.slots) : null,
      };
    }

    rows.push({
      ...base,
      status: "OBSERVED",
      statusNote: filtered.length === 0 ? "선택한 본재 조건의 방영이 없습니다." : "",
      airings: fStat.airings,
      days: fStat.days,
      episodes: episodes.size,
      firstRun: first,
      rerun,
      unknownRun: unknown,
      programAvg: fStat.avg,
      observedFrom,
      observedTo,
      channelDaily,
      vsChannel,
      slot,
      fit,
      sampleState,
      summary: filtered.length === 0 ? "선택한 본재 조건의 방영 없음." : describeRow(vsChannel.direction, slot.ratio.direction, sampleState),
      monthly,
      daily,
      shareAvg: sh.avg,
      shareAirings: sh.airings,
      analysis,
      assessment,
    });
    return done();
    });
  }
  // 경쟁 채널 조회도 자사 채널 조회와 함께 시작한다
  // 오리지널 비교(방영 시작 이후 본방, 조회 기간과 무관) — 실패해도 화면 전체를 막지 않는다
  const originalP = loadOriginalCompare(db, { cls: classification.cls, workIds, dataFrom: dbFirst, channels }).catch(() => null);
  const competitorsP = loadCompetitorRows(db, work.memberKeys, new Set(channels.map((c) => normalizeProgramKey(c.name))), from, to, query.airing, workPrograms.map((p) => p.canonical_name ?? ""));
  const buckets = await Promise.all(jobs.map((j) => j()));
  // 본방 여부·회차 보완 건수 — 기본 화면 배너(notes)가 아니라 별도 필드로 남겨 방송 기록 접힘 안에서만 보여 준다(개편 2026-10-23, 이력은 그대로)
  const supplement = [...fillStats.entries()].sort((a, b) => a[1].order - b[1].order).map(([channelCode, f]) => ({ channelCode, channelName: f.channelName, plan: f.plan, registered: f.registered, naver: f.naver, episode: f.episode }));
  const rows = buckets.flatMap((b) => b.rows);
  const evidence = buckets.flatMap((b) => b.evidence);
  const slotCells = buckets.flatMap((b) => b.slotCells);
  const allDays = new Set(buckets.flatMap((b) => [...b.allDays]));
  const allEpisodes = new Set(buckets.flatMap((b) => [...b.allEpisodes]));

  // 첫 줄 —방영 기록이 있는 채널마다 한 줄(그 채널의 타깃 행을 KPI 타깃 먼저 묶어 2049·가구를 함께)
  const airedRows = rows.filter((r) => r.status === "OBSERVED" && r.airings > 0);
  const lineCodes = [...new Set(airedRows.map((r) => r.channelCode))];
  const lines = lineCodes.map((code) => {
    const parts = airedRows.filter((r) => r.channelCode === code).sort((a, b) => Number(b.primary) - Number(a.primary));
    return channelLineOf(code, parts[0].channelName, parts);
  });
  // 경쟁 채널은 자사 작품이 가장 많이 방영된 채널의 KPI 그룹 타깃을 먼저 보인다
  const mainRow = airedRows.filter((r) => r.primary).sort((a, b) => b.airings - a.airings)[0];
  const competitors = await competitorsP;
  const firstGroup = mainRow?.kpiGroup === "HH" ? "전국 유료가구" : "수도권 2049";
  const competitorLines = [...new Set(competitors.filter((c) => c.airings > 0).map((c) => c.competitorName))].map((name) => {
    const parts = competitors.filter((c) => c.competitorName === name && c.airings > 0).sort((a, b) => Number(b.targetLabel === firstGroup) - Number(a.targetLabel === firstGroup));
    return channelLineOf(name, name, parts);
  });

  evidence.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.channelCode.localeCompare(b.channelCode));
  const groups: PerformanceResult["groups"] = (["2049", "HH"] as const).map((g) => ({ kpiGroup: g, rows: rows.filter((r) => r.kpiGroup === g) })).filter((g) => g.rows.length > 0);
  // 총계·첫 줄은 채널당 한 타깃(두 타깃 모드에서는 KPI 타깃)만 — 같은 방영을 두 번 세지 않는다
  const observed = rows.filter((r) => r.status === "OBSERVED" && (query.targetMode !== "both" || r.primary));
  const originalCompare = await originalP;
  return {
    version: PROGRAM_PERFORMANCE_VERSION,
    query: { ...query, from, to },
    work: { groupKey: query.groupKey, displayName: work.displayName, memberKeys: work.memberKeys, candidateKeys: work.candidateKeys },
    classification,
    period: { from, to, dbFirstDate: dbFirst, latestDataDate: latest, workFirstObserved: workFirst, workFirstFirstRun },
    totals: { channels: observed.filter((r) => r.airings > 0).length, airings: observed.reduce((a, r) => a + r.airings, 0), days: allDays.size, episodes: allEpisodes.size },
    groups,
    lines,
    competitors,
    competitorLines,
    airings: evidence.slice(0, EVIDENCE_CAP),
    airingsTruncated: evidence.length > EVIDENCE_CAP,
    slotCells,
    notes,
    supplement,
    originalCompare,
    review: overallReviewOf({ rows, oc: originalCompare }),
    pattern:
      runPatterns.patterns.length > 0 || runPatterns.info.naverSkipped.length > 0
        ? {
            slots: mergeLearned([...learnedSlots.values()]),
            naverFetchedAt: runPatterns.info.naverFetchedAt,
            naverSkipped: [...new Set(runPatterns.info.naverSkipped)],
            naverTableMissing: runPatterns.info.naverTableMissing,
          }
        : null,
  };
}
