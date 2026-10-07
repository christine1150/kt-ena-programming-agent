// 콘텐츠 구매 검토(단계 13, 서버 전용) — 선택한 작품의 Avail 단계·칸별 권리·제작년도·방영권 종료, 그리고 보유작 최선 대안 비교용 예측.
// 조회·계산만 한다: 권리 예약·사용 원장 기록·편성 저장·구매 요청을 일으키지 않는다(avail 쓰기 함수를 import하지 않는다 — 테스트가 확인).
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEvalContext } from "@/lib/avail/context";
import { evaluateEligibility, matchGrants, type EvalContext } from "@/lib/avail/evaluate";
import { loadAvailState } from "@/lib/avail/store";
import { slotRightsOf, type SlotRights } from "@/lib/idealSchedule/slotRights";
import { fetchSimInputsMulti, latestCompetitorDate, loadCalibration } from "@/lib/purchaseSim/dataSource";
import { MODEL_VERSION, broadcastMinutes, monthlyAverage, predictSlot, slotLabel, slotOf, type SimInputs } from "@/lib/purchaseSim/engine";
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import { classifyAcquisition, type AcquisitionView } from "./acquisition";
import { purchaseRightsView, type PurchaseRightsView } from "./rightsDisplay";
import { productionYearOf, type ProductionYearView } from "./productionYear";
import { judgeFromDate, kstNow, nextAirDate } from "./slotDate";
import { evidenceOf, type EvidenceView } from "./transfer";

export interface ReviewSlotInput {
  isoDow: number; // 0 = 슬롯 미지정(월 평균)
  startTime: string;
}

export interface ReviewRequest {
  displayName: string;
  memberKeys: string[];
  channel: string;
  targets: ("A2049" | "HH")[];
  slots: ReviewSlotInput[];
  desiredStartDate?: string | null;
  includeAlternatives?: boolean;
}

export interface SlotRightsRow {
  isoDow: number;
  startTime: string;
  /** 판정에 쓴 방송일(희망 시작일 이후 첫 해당 요일) */
  airDate: string | null;
  verdict: SlotRights | null;
  view: PurchaseRightsView;
}

export interface AlternativeItem {
  groupKey: string;
  displayName: string;
  genre: string;
  prediction: number | null;
  low: number | null;
  high: number | null;
  confidence: string;
  evidence: EvidenceView;
  rights: { status: SlotRights["status"]; label: string; reasons: string[]; remaining: number | null; expiresOn: string | null; eligibleEpisodes: number[] | null } | null;
  /** 최근 3개월 이 시간대 묶음에 편성된 횟수 — 가장 많으면 '현재 주력 편성'으로 본다(확정 편성표가 아니다) */
  slotAirings: number;
  isIncumbent: boolean;
}

export interface AlternativeBlock {
  target: "A2049" | "HH";
  slotLabel: string;
  isoDow: number;
  startTime: string;
  items: AlternativeItem[];
  best: AlternativeItem | null;
  /** 권리가 확인된(available) 최선 대안 — 없으면 null(권리 미확인 보유작은 실행 가능으로 보지 않는다) */
  bestConfirmed: AlternativeItem | null;
  incumbent: AlternativeItem | null;
  excludedUnavailable: number;
  considered: number;
}

export interface ReviewResponse {
  modelVersion: string;
  asOf: string;
  today: string;
  availConfigured: boolean;
  inventoryVersion: string | null;
  acquisition: AcquisitionView;
  productionYear: ProductionYearView;
  featured: { category: string | null; startDate: string | null; endDate: string | null; expectedEpisodes: number | null } | null;
  slotRights: SlotRightsRow[];
  /** 대표 권리 요약(종료·방수·회차) — 이 채널 권리 행 기준 */
  rightsSummary: { endText: string | null; countLimit: string | null; episodeCount: number | null }[];
  alternatives: AlternativeBlock[] | null;
  notes: string[];
}

type FeaturedRow = { category: string | null; broadcast_start_date: string | null; broadcast_end_date: string | null; expected_episode_count: number | null; programs: { canonical_name: string } | { canonical_name: string }[] | null };

async function loadFeatured(client: SupabaseClient, memberKeys: string[]): Promise<ReviewResponse["featured"]> {
  const { data } = await client.from("featured_content").select("category, broadcast_start_date, broadcast_end_date, expected_episode_count, programs(canonical_name)");
  const want = new Set(memberKeys.map((k) => k.toUpperCase()));
  for (const r of (data ?? []) as unknown as FeaturedRow[]) {
    const p = Array.isArray(r.programs) ? r.programs[0] : r.programs;
    if (p && want.has(normalizeProgramKey(p.canonical_name))) return { category: r.category, startDate: r.broadcast_start_date, endDate: r.broadcast_end_date, expectedEpisodes: r.expected_episode_count };
  }
  return null;
}

/** 이 채널에서 최근 91일 안에 방영된 적이 있는가(program_identity). 보유의 증거로만 쓴다. */
async function hasRecentOwnAiring(client: SupabaseClient, memberKeys: string[], channel: string, asOf: string): Promise<boolean> {
  if (memberKeys.length === 0) return false;
  const from = new Date(Date.parse(asOf) - 91 * 86400000).toISOString().slice(0, 10);
  const { data } = await client.from("program_identity").select("key,own_channels,last_date").in("key", memberKeys.map((k) => k.toUpperCase())).gte("last_date", from);
  return (data ?? []).some((r) => ((r.own_channels as string[] | null) ?? []).includes(channel));
}

async function loadCtx(): Promise<{ ctx: EvalContext | null; error: string | null }> {
  try {
    const loaded = await loadAvailState();
    if (!loaded.available || loaded.state.revisions.length === 0) return { ctx: null, error: loaded.error };
    const built = buildEvalContext(loaded.state, { now: new Date().toISOString() });
    return built.ctx.grants.length === 0 ? { ctx: null, error: null } : { ctx: built.ctx, error: null };
  } catch (e) {
    return { ctx: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function reviewTitle(client: SupabaseClient, req: ReviewRequest): Promise<ReviewResponse> {
  const asOf = await latestCompetitorDate(client);
  const { date: today, min: nowMin } = kstNow();
  const notes: string[] = [];
  const { ctx, error } = await loadCtx();
  if (error) notes.push(`Avail(권리) 확인 실패: ${error}`);
  const match = ctx ? matchGrants({ programId: null, programName: req.displayName }, ctx) : null;
  const ownRecentAiring = await hasRecentOwnAiring(client, req.memberKeys, req.channel, asOf);
  const acquisition = classifyAcquisition({ availConfigured: !!ctx, match, channelCode: req.channel, today, nowMinKst: nowMin, ownRecentAiring });
  const featured = await loadFeatured(client, req.memberKeys).catch(() => null);
  const years = (match?.grants ?? []).map((g) => (g.content.productionYear.state === "value" ? g.content.productionYear.value : "")).filter(Boolean);
  const productionYear = productionYearOf({ availYears: years, featured: featured ? { startDate: featured.startDate, endDate: featured.endDate, expectedEpisodes: featured.expectedEpisodes } : null, title: req.displayName });

  const fromDate = judgeFromDate(req.desiredStartDate, today, acquisition);
  const runtime = acquisition.grants.map((g) => g.runtimeMin).find((m): m is number => m !== null) ?? 60;
  const slotInputs = req.slots.length ? req.slots : [{ isoDow: 0, startTime: "" }];
  const slotRights: SlotRightsRow[] = slotInputs.map((s) => {
    if (s.isoDow === 0 || !ctx || (acquisition.stage === "PLANNED" && acquisition.plannedBasis === "assumed") || acquisition.stage === "NEEDS_LINK") {
      return { isoDow: s.isoDow, startTime: s.startTime, airDate: null, verdict: null, view: purchaseRightsView(acquisition.stage, acquisition.plannedBasis, null) };
    }
    const airDate = nextAirDate(fromDate, s.isoDow);
    const startMin = broadcastMinutes(s.startTime);
    const verdict = slotRightsOf(evaluateEligibility({ programId: null, programName: req.displayName }, { broadcastDate: airDate, startMin, endMin: startMin + runtime, channelId: req.channel }, ctx));
    return { isoDow: s.isoDow, startTime: s.startTime, airDate, verdict, view: purchaseRightsView(acquisition.stage, acquisition.plannedBasis, verdict) };
  });

  const rightsSummary = acquisition.grants.filter((g) => g.coversChannel).map((g) => ({ endText: g.endLabel, countLimit: g.countLabel, episodeCount: g.episodeCount }));
  if (acquisition.stage === "PLANNED" && acquisition.plannedBasis === "assumed") notes.push("권리 조건(방영 기간·방수·회차)은 Avail에 없어 알 수 없습니다. 구매 검토 시 계약 조건을 따로 확인해야 합니다.");

  const alternatives = req.includeAlternatives ? await ownAlternatives(client, { req, ctx, asOf, today, fromDate }) : null;
  return { modelVersion: MODEL_VERSION, asOf, today, availConfigured: !!ctx, inventoryVersion: ctx?.inventoryVersion ?? null, acquisition, productionYear, featured, slotRights, rightsSummary, alternatives, notes };
}

type IdRow = { key: string; group_key: string; display_name: string; own_channels: string[]; airings_91d: number; last_date: string | null };

/** 보유작 최선 대안: 이 채널에서 최근 방영 중인 프로그램을 같은 슬롯·같은 기준일·같은 모델로 예측하고 권리를 판정해 비교용 목록을 만든다. 같은 작품은 제외한다. */
async function ownAlternatives(client: SupabaseClient, a: { req: ReviewRequest; ctx: EvalContext | null; asOf: string; today: string; fromDate: string }): Promise<AlternativeBlock[]> {
  const { req, ctx, asOf } = a;
  const subject = new Set(req.memberKeys.map((k) => k.toUpperCase()));
  const from = new Date(Date.parse(asOf) - 28 * 86400000).toISOString().slice(0, 10);
  const { data: ids } = await client.from("program_identity").select("key,group_key,display_name,own_channels,airings_91d,last_date").contains("own_channels", [req.channel]).eq("is_special", false).gte("last_date", from).gte("airings_91d", 4).order("airings_91d", { ascending: false }).limit(80);
  const rows = ((ids ?? []) as IdRow[]).filter((r) => !subject.has(r.key.toUpperCase()));
  const groups = new Map<string, { display: string; keys: string[]; airings: number }>();
  for (const r of rows) {
    const g = groups.get(r.group_key) ?? { display: r.display_name, keys: [], airings: 0 };
    g.keys.push(r.key.toUpperCase());
    g.airings += r.airings_91d;
    groups.set(r.group_key, g);
  }
  const list = [...groups.entries()].filter(([, g]) => !g.keys.some((k) => subject.has(k))).slice(0, 40);

  // 권리 판정용 프로그램 ID·장르(엔진 게이트와 같은 입력)
  const programIdOf = new Map<string, string>();
  const genreOf = new Map<string, string>();
  if (ctx) {
    const { data: ch } = await client.from("channels").select("id").eq("code", req.channel).maybeSingle();
    if (ch?.id) {
      const { data: progs } = await client.from("programs").select("id, canonical_name").eq("channel_id", ch.id);
      for (const p of progs ?? []) programIdOf.set(normalizeProgramKey(p.canonical_name as string), p.id as string);
    }
    const { data: gm } = await client.from("program_genre_map").select("canonical_name, genre");
    const cnt = new Map<string, Map<string, number>>();
    for (const r of gm ?? []) {
      const k = normalizeProgramKey(r.canonical_name as string);
      const m = cnt.get(k) ?? new Map<string, number>();
      m.set(r.genre as string, (m.get(r.genre as string) ?? 0) + 1);
      cnt.set(k, m);
    }
    for (const [k, m] of cnt) genreOf.set(k, [...m.entries()].sort((x, y) => y[1] - x[1])[0][0]);
  }

  const out: AlternativeBlock[] = [];
  const slotReqs = req.slots.length ? req.slots : [{ isoDow: 0, startTime: "" }];
  for (const target of req.targets) {
    const calibration = await loadCalibration(client, MODEL_VERSION, target);
    const inputs: Record<string, SimInputs> = {};
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25);
      Object.assign(inputs, await fetchSimInputsMulti(client, { groups: chunk.map(([gk, g]) => ({ group_key: gk, members: g.keys })), ownChannel: req.channel, target, asOf, window: 91 }));
    }
    for (const s of slotReqs) {
      const slotKey = s.isoDow > 0 ? slotOf(s.isoDow, broadcastMinutes(s.startTime)) : null;
      const airDate = s.isoDow > 0 ? nextAirDate(a.fromDate, s.isoDow) : null;
      const items: AlternativeItem[] = [];
      let excluded = 0;
      for (const [gk, g] of list) {
        const inp = inputs[gk];
        if (!inp) continue;
        const pred = slotKey ? predictSlot(inp, target, slotKey, calibration, { windowDays: 91 }) : monthlyAverage(inp, target, calibration, { windowDays: 91 });
        if (pred.prediction === null) continue;
        let rights: AlternativeItem["rights"] = null;
        if (ctx && airDate) {
          const startMin = broadcastMinutes(s.startTime);
          const key = g.keys[0];
          const r = slotRightsOf(evaluateEligibility({ programId: programIdOf.get(key) ?? null, programName: g.display, genre: genreOf.get(key) ?? null }, { broadcastDate: airDate, startMin, endMin: startMin + 60, channelId: req.channel }, ctx));
          rights = { status: r.status, label: r.label, reasons: r.reasons, remaining: r.remaining, expiresOn: r.expiresOn, eligibleEpisodes: r.eligibleEpisodes };
        }
        if (rights?.status === "unavailable") {
          excluded++;
          continue;
        }
        const slotAirings = slotKey ? inp.own_prog_slots.filter((r) => r.w === 91 && r.slot === slotKey).reduce((n, r) => n + Number(r.n), 0) : 0;
        items.push({ groupKey: gk, displayName: g.display, genre: genreOf.get(g.keys[0]) ?? "미분류", prediction: pred.prediction, low: pred.low, high: pred.high, confidence: pred.confidence, evidence: evidenceOf(pred), rights, slotAirings, isIncumbent: false });
      }
      items.sort((x, y) => (y.prediction ?? 0) - (x.prediction ?? 0));
      const maxAir = Math.max(0, ...items.map((i) => i.slotAirings));
      const incumbent = slotKey && maxAir >= 4 ? items.find((i) => i.slotAirings === maxAir) ?? null : null;
      if (incumbent) incumbent.isIncumbent = true;
      out.push({ target, slotLabel: slotKey ? slotLabel(slotKey) : "월 평균(최근 편성 구성 기준)", isoDow: s.isoDow, startTime: s.startTime, items: items.slice(0, 5), best: items[0] ?? null, bestConfirmed: items.find((i) => i.rights?.status === "available") ?? null, incumbent, excludedUnavailable: excluded, considered: items.length + excluded });
    }
  }
  return out;
}
