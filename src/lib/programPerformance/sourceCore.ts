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
import { channelDailyMean, classifyWork, directionOfRatio, dedupeAirings, describeRow, headlineFor, matchesAiringFilter, monthlySeries, ratioOf, sampleStateOf, splitStat, type ChannelDayRow, type WorkAiring } from "./metrics";
import {
  PROGRAM_PERFORMANCE_VERSION,
  type AiringEvidence,
  type ChannelRow,
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

/** 화면 순서(기존 채널 목록 순서와 같다) */
export const CHANNEL_ORDER = ["ENA", "ENA_DRAMA", "ENA_PLAY", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"];

/** 공통 타깃 모드의 타깃 표기: [프로그램 행(타깃상세 시트), 채널 하루 행(랭킹 시트)] — targetResolution.ts와 같은 규칙 */
const COMMON_TARGETS: Record<Exclude<TargetMode, "kpi">, { program: string; channel: string; group: "2049" | "HH" }> = {
  common2049: { program: "수도권 2049", channel: "개인2049", group: "2049" },
  commonHH: { program: "전국 유료가구", channel: "National 유료방송가입가구", group: "HH" },
};

export interface FitLookup {
  (channelCode: string): Promise<{ asOf: string; windowFrom: string; items: { programId: string; tag: string | null; tier: string; sampleDays: number; airings: number }[] } | null>;
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

function hourBlockOf(t: string | null): number | null {
  if (!t || t.length < 2) return null;
  const h = Number(t.slice(0, 2));
  if (!Number.isFinite(h)) return null;
  return h < 2 ? h + 24 : h;
}
const dowOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const NA_RATIO: RatioValue = { value: null, base: null, ratio: null, pct: null, diff: null, direction: "NA", naReason: "실적 없음" };

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

  // 날짜 범위 — DB 첫 관측일 / 작품 첫 관측일 / 확인된 첫 본방일 / 최신 자료일을 구분한다
  const [latest, dbFirst] = await Promise.all([latestDataDate(db), earliestDataDate(db)]);
  let workFirst: string | null = null;
  let workFirstFirstRun: string | null = null;
  for (let i = 0; i < workIds.length; i += IN_CHUNK) {
    const chunk = workIds.slice(i, i + IN_CHUNK);
    const [{ data: a }, { data: b }] = await Promise.all([
      db.from("ratings").select("broadcast_date").in("program_id", chunk).eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: true }).limit(1).maybeSingle(),
      db.from("ratings").select("broadcast_date").in("program_id", chunk).eq("source_type", "nielsen_daily").eq("is_first_run", true).order("broadcast_date", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const da = (a?.broadcast_date as string | undefined) ?? null;
    const dbb = (b?.broadcast_date as string | undefined) ?? null;
    if (da && (!workFirst || da < workFirst)) workFirst = da;
    if (dbb && (!workFirstFirstRun || dbb < workFirstFirstRun)) workFirstFirstRun = dbb;
  }
  const to = latest ? (query.to && query.to < latest ? query.to : latest) : query.to ?? "";
  const from = query.from ?? workFirst ?? to;
  const notes: string[] = [];
  if (query.to && latest && query.to > latest) notes.push(`조회 종료일이 최신 자료일(${latest})보다 늦어 ${latest}까지만 봅니다(미래·미수신일은 0으로 넣지 않음).`);
  if (work.candidateKeys.length) notes.push(`이름이 비슷한 '연결 확인 필요' 후보 ${work.candidateKeys.length}건은 합치지 않았습니다(관리자 승인 전).`);
  if (classification.note) notes.push(classification.note);

  const selected = query.channels && query.channels.length ? new Set(query.channels) : null;
  const evidence: AiringEvidence[] = [];
  const slotCells: SlotCell[] = [];
  const rows: ChannelRow[] = [];
  const allDays = new Set<string>();
  const allEpisodes = new Set<number>();

  for (const ch of channels) {
    if (selected && !selected.has(ch.code)) continue;
    const ids = idsByChannel.get(ch.id) ?? [];
    const primary = ch.primary_target ?? "";
    const mode = query.targetMode;
    const programLabel = mode === "kpi" ? resolveProgramLevelTargetLabel(primary) : COMMON_TARGETS[mode].program;
    const channelLabel = mode === "kpi" ? resolveRankSheetTargetLabel(primary) : COMMON_TARGETS[mode].channel;
    const kpiGroup: "2049" | "HH" = mode === "kpi" ? (primary.includes("유료방송가입가구") ? "HH" : "2049") : COMMON_TARGETS[mode].group;
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
    };
    if (ch.code === "SKYUHD") {
      rows.push({ ...base, status: "UNSUPPORTED", statusNote: "skyUHD는 프로그램 시청률이 별도 수기 파일(타깃 없음·초 단위)이라 이번 비교에서 계산하지 않습니다." });
      continue;
    }
    if (!primary) {
      rows.push({ ...base, status: "UNSUPPORTED", statusNote: "채널 핵심 타깃이 등록되지 않았습니다." });
      continue;
    }
    const [progTargetId, chTargetId] = await Promise.all([targetIdOf(db, programLabel), targetIdOf(db, channelLabel)]);
    if (!progTargetId) {
      rows.push({ ...base, status: "NO_TARGET", statusNote: `'${programLabel}' 타깃이 없습니다.` });
      continue;
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
            .select("program_id, broadcast_date, start_time, end_time, rating, is_first_run, episode_number, created_at")
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
        }))
      );
    }
    workRows = dedupeAirings(workRows);

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
      continue;
    }

    const filtered = workRows.filter((r) => matchesAiringFilter(r.firstRun, query.airing));
    const first = splitStat(workRows.filter((r) => r.firstRun === true));
    const rerun = splitStat(workRows.filter((r) => r.firstRun === false));
    const unknown = splitStat(workRows.filter((r) => r.firstRun === null));
    const fStat = splitStat(filtered);
    const observedFrom = workRows[0].date;
    const observedTo = workRows[workRows.length - 1].date;
    const episodes = new Set(filtered.flatMap((r) => (r.episode === null ? [] : [r.episode])));
    for (const r of filtered) {
      allDays.add(r.date);
      if (r.episode !== null) allEpisodes.add(r.episode);
    }
    const vsChannel = ratioOf(fStat.avg, channelDaily.mean, chTargetId ? "채널 하루 시청률 자료 없음" : `채널 하루 시청률 타깃('${channelLabel}') 없음`);

    // 동슬롯 대비 — 비교 창 = 이 채널에서 작품이 관측된 첫~마지막 방송일(본재 전환에도 같은 창)
    const chAirRows = await fetchAll<Record<string, unknown>>(
      (a, b) =>
        db
          .from("ratings")
          .select("program_id, broadcast_date, start_time, rating, is_first_run")
          .eq("channel_id", ch.id)
          .eq("target_id", progTargetId)
          .eq("source_type", "nielsen_daily")
          .not("program_id", "is", null)
          .gte("broadcast_date", observedFrom)
          .lte("broadcast_date", observedTo)
          .order("broadcast_date", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      "슬롯 비교 방영"
    );
    const seen = new Set<string>();
    const chAirings: ContentFitAiring[] = [];
    for (const r of chAirRows) {
      if (r.rating === null || r.rating === undefined) continue;
      const k = `${r.program_id}|${r.broadcast_date}|${r.start_time ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      chAirings.push({ programId: r.program_id as string, date: r.broadcast_date as string, startTime: (r.start_time as string | null) ?? null, rating: Number(r.rating), reach: null, timeSpentShare: null, firstRun: (r.is_first_run as boolean | null) ?? null });
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

    // 현재 판정(콘텐츠 적합도, 최근 12주) — KPI 타깃 모드에서만(엔진이 KPI 타깃 기준)
    let fit: FitTagInfo | null = null;
    if (opts.fitLookup && mode === "kpi") {
      const fr = await opts.fitLookup(ch.code).catch(() => null);
      if (fr) {
        const mine = fr.items.filter((i) => ids.includes(i.programId)).sort((a, b) => b.airings - a.airings);
        fit = mine.length
          ? { tag: mine[0].tag, tier: mine[0].tier, asOf: fr.asOf, windowFrom: fr.windowFrom, sampleDays: mine[0].sampleDays, note: mine.length > 1 ? `이 채널에 표기가 다른 같은 작품 ${mine.length}개 중 방영이 가장 많은 것 기준` : "" }
          : { tag: null, tier: "NONE", asOf: fr.asOf, windowFrom: fr.windowFrom, sampleDays: 0, note: "최근 12주 방영 없음" };
      }
    }

    const sampleState = sampleStateOf(fStat.days);
    for (const r of filtered.slice(0, EVIDENCE_CAP)) {
      evidence.push({ channelCode: ch.code, date: r.date, startTime: r.startTime, endTime: r.endTime, programId: r.programId, name: nameById.get(r.programId) ?? "", firstRun: r.firstRun, episode: r.episode, rating: r.rating });
    }
    const cells = new Map<string, { n: number; s: number; v: number; dow: number; hb: number }>();
    for (const r of filtered) {
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
      monthly: monthlySeries(filtered, dayList, from, to, channelLabel),
    });
  }

  evidence.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.channelCode.localeCompare(b.channelCode));
  const groups: PerformanceResult["groups"] = (["2049", "HH"] as const).map((g) => ({ kpiGroup: g, rows: rows.filter((r) => r.kpiGroup === g) })).filter((g) => g.rows.length > 0);
  const observed = rows.filter((r) => r.status === "OBSERVED");
  return {
    version: PROGRAM_PERFORMANCE_VERSION,
    query: { ...query, from, to },
    work: { groupKey: query.groupKey, displayName: work.displayName, memberKeys: work.memberKeys, candidateKeys: work.candidateKeys },
    classification,
    period: { from, to, dbFirstDate: dbFirst, latestDataDate: latest, workFirstObserved: workFirst, workFirstFirstRun },
    totals: { channels: observed.filter((r) => r.airings > 0).length, airings: observed.reduce((a, r) => a + r.airings, 0), days: allDays.size, episodes: allEpisodes.size },
    groups,
    headlines: groups.map((g) => headlineFor(g.kpiGroup, g.rows.find((r) => r.status !== "UNSUPPORTED")?.targetLabel ?? (g.kpiGroup === "2049" ? "수도권 2049" : "전국 유료가구"), g.rows)),
    airings: evidence.slice(0, EVIDENCE_CAP),
    airingsTruncated: evidence.length > EVIDENCE_CAP,
    slotCells,
    notes,
  };
}
