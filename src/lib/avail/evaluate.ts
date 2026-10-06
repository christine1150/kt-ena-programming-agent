// 권리 판정(단계 06) — 후보 1건 × 슬롯 1개 → available / unavailable / conditional / unknown + 사유 코드 + 원본 행.
// 순수 함수(DB·시계 접근 없음). 같은 입력이면 같은 결과다.
//
// 원칙
//  - 빈칸·읽지 못한 값은 무제한이 아니라 unknown이다(명세 A14).
//  - 확인되지 않은 계약 해석은 가능한 해석을 모두 적용해 보고, 결과가 모두 같을 때만 단정한다. 갈리면 conditional이다.
//  - 확인 증빙(Confirmation)이 있어야 풀리는 조건(메모·홀드백·승인·기소진·중복)은 증빙 없이 available이 되지 않는다.
//  - Avail 행이 있으면 항상 그 행이 우선이다. 행이 없을 때만 오리지널 설정이 쓰인다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { LINEAR_PLATFORMS, channelKey, parsePlatforms } from "./adapters/common";
import { addDaysIso, addMonthsIso, calendarDateOf, dayNumber, parseTerm, positionInWindow, type BoundaryConvention, type WindowPosition } from "./dates";
import { episodeAllowed, listEpisodes } from "./episodes";
import { identityMarkers, titleVariants } from "./identity";
import { optionsFor, type Interpretation } from "./interpretation";
import { countedUsages, latestByUsage, usedUnits } from "./ledger";
import type { Condition, ContentQuery, EligibilityResult, EligibilityStatus, Grant, SlotRef, UsageEntry } from "./types";

export interface Confirmation {
  grantId: string;
  /** 확인한 시점의 원본 행 해시 — 행이 바뀌면(새 revision) 이전 확인은 인정하지 않는다 */
  rowHash: string;
  topic: string;
  value?: string | null;
  /** 승인 증빙(승인자·일시·문서 등). 승인 확인은 비어 있으면 무효 */
  evidence: string | null;
  by: string | null;
  at: string | null;
}

export interface ContentLink {
  programId: string;
  canonicalKey: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface OriginalPolicy {
  /** Avail 행이 없는 오리지널의 장르 계열별 처리 */
  unboundedFamilies: string[];
  needsAvailFamilies: string[];
  note: string;
}

/** 운영자 진술(2026-10-06): 자체 예능은 무제한인 편이고 드라마는 판권 기간이 있다. Avail 행이 있으면 항상 행이 우선. */
export const DEFAULT_ORIGINAL_POLICY: OriginalPolicy = {
  unboundedFamilies: ["예능"],
  needsAvailFamilies: ["드라마"],
  note: "자체 오리지널: Avail 행이 없을 때만 적용. 예능은 권리 제한 없음으로 보고, 드라마는 판권 기간이 있어 Avail 확인이 필요합니다(운영자 진술, 확정 전).",
};

export interface EvalContext {
  grants: Grant[];
  ledger: UsageEntry[];
  links: ContentLink[];
  confirmations: Confirmation[];
  interpretation: Interpretation;
  originalPolicy: OriginalPolicy;
  /** 평가 시각(ISO). 시계를 읽지 않고 호출부가 넣는다 */
  now: string;
  inventoryVersion: string;
  scheduleRevisionId?: string | null;
  /** 운영자가 '오리지널'로 표시한 프로그램 ID(장르 표시와 별개) */
  originalProgramIds?: string[];
}

export interface Reason {
  code: string;
  text: string;
  severity: "unavailable" | "unknown" | "conditional";
}

interface GrantEval {
  grant: Grant;
  status: EligibilityStatus;
  reasons: Reason[];
  satisfied: string[];
  missing: string[];
  assumptions: string[];
  eligibleEpisodes: number[] | null;
  expiresOn: string | null;
  remaining: number | null;
}

const RANK: Record<EligibilityStatus, number> = { available: 3, conditional: 2, unknown: 1, unavailable: 0 };

function statusOf(reasons: Reason[]): EligibilityStatus {
  if (reasons.some((r) => r.severity === "unavailable")) return "unavailable";
  if (reasons.some((r) => r.severity === "unknown")) return "unknown";
  if (reasons.some((r) => r.severity === "conditional")) return "conditional";
  return "available";
}

const CONDITION_TOPIC: Record<string, string> = { MEMO_REVIEW: "memo", HOLDBACK_REVIEW: "holdback", APPROVAL_REQUIRED: "approval", DUPLICATE_GRANT_UNCONFIRMED: "duplicate" };
const topicOf = (c: Condition) => CONDITION_TOPIC[c.code] ?? c.code.toLowerCase();

export function conditionConfirmed(grant: Grant, c: Condition, confirmations: Confirmation[]): boolean {
  const topic = topicOf(c);
  return confirmations.some((x) => x.grantId === grant.grantId && x.rowHash === grant.rowHash && x.topic === topic && (topic !== "approval" || !!x.evidence?.trim()));
}

// ── 콘텐츠 → 권리 행 연결 ────────────────────────────────

export interface GrantMatch {
  grants: Grant[];
  basis: "confirmed_link" | "exact_key" | "none";
  /** 자동 연결하지 못했지만 후보가 있는 경우 */
  needsConfirmation: boolean;
  candidateKeys: string[];
  markerConflicts: string[];
}

/** 같은 평가 맥락에서 같은 후보를 거듭 연결하지 않도록 기억한다(편성표 뽑기가 슬롯마다 같은 후보를 평가한다). */
const matchCache = new WeakMap<EvalContext, Map<string, GrantMatch>>();
function matchGrantsCached(q: ContentQuery, ctx: EvalContext): GrantMatch {
  let m = matchCache.get(ctx);
  if (!m) matchCache.set(ctx, (m = new Map()));
  const k = JSON.stringify([q.programId, q.programName, q.season ?? null, q.version ?? null]);
  let hit = m.get(k);
  if (!hit) m.set(k, (hit = matchGrants(q, ctx)));
  return hit;
}

export function matchGrants(q: ContentQuery, ctx: EvalContext): GrantMatch {
  const active = ctx.grants.filter((g) => g.mergedInto === null);
  const linked = q.programId ? ctx.links.filter((l) => l.programId === q.programId).map((l) => l.canonicalKey) : [];
  if (linked.length) {
    const gs = active.filter((g) => linked.includes(g.content.canonicalKey));
    if (gs.length) return { grants: gs, basis: "confirmed_link", needsConfirmation: false, candidateKeys: linked, markerConflicts: [] };
  }
  // 괄호 안 별칭은 본 제목과 분리해 비교한다("서바이빙 어스(대멸종…)"의 본 제목은 "서바이빙 어스")
  const qv = titleVariants(q.programName);
  const key = qv.mainKey || normalizeProgramCanonicalName(q.programName);
  const cm = identityMarkers(q.programName);
  const exact = active.filter((g) => g.content.canonicalKey === key);
  if (exact.length) {
    const conflicts: string[] = [];
    const season = q.season ?? cm.season;
    for (const g of exact) {
      if (season && g.scope.season.state === "value" && g.scope.season.value !== season) conflicts.push(`시즌 ${season} ↔ ${g.scope.season.value}`);
      const ver = q.version ?? (cm.versions.length ? cm.versions.join("/") : null);
      if (ver && g.scope.version.state === "value" && g.scope.version.value !== ver) conflicts.push(`편집판 ${ver} ↔ ${g.scope.version.value}`);
      if (cm.year && g.content.productionYear.state === "value" && !g.content.productionYear.value.includes(cm.year)) conflicts.push(`제작년도 ${cm.year} ↔ ${g.content.productionYear.value}`);
    }
    if (conflicts.length) return { grants: [], basis: "none", needsConfirmation: true, candidateKeys: [key], markerConflicts: [...new Set(conflicts)] };
    return { grants: exact, basis: "exact_key", needsConfirmation: false, candidateKeys: [key], markerConflicts: [] };
  }
  // 별칭·부분 일치는 후보로만 알린다(자동 연결 금지)
  const cands = active.filter((g) => g.content.aliases.some((a) => normalizeProgramCanonicalName(a) === key) || qv.aliasKeys.includes(g.content.canonicalKey) || (key.length >= 3 && g.content.canonicalKey.length >= 3 && (g.content.canonicalKey.includes(key) || key.includes(g.content.canonicalKey))));
  return { grants: [], basis: "none", needsConfirmation: cands.length > 0, candidateKeys: [...new Set(cands.map((g) => g.content.canonicalKey))], markerConflicts: [] };
}

// ── 한 권리 행 평가 ─────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function combos<T extends Record<string, unknown[]>>(opts: T): { [K in keyof T]: T[K][number] }[] {
  let acc: Record<string, unknown>[] = [{}];
  for (const [k, vals] of Object.entries(opts)) acc = acc.flatMap((a) => vals.map((v) => ({ ...a, [k]: v })));
  return acc as { [K in keyof T]: T[K][number] }[];
}

/** 해석 조합별 결과가 갈릴 때, 어떤 해석 때문인지 키를 찾는다 */
function splitKeys<C extends Record<string, unknown>>(cs: C[], outcome: (c: C) => string): string[] {
  const keys = Object.keys(cs[0] ?? {});
  return keys.filter((k) => {
    for (const a of cs) for (const b of cs) {
      if (Object.keys(a).every((x) => x === k || a[x] === b[x]) && a[k] !== b[k] && outcome(a) !== outcome(b)) return true;
    }
    return false;
  });
}

function evalGrant(g: Grant, q: ContentQuery, episode: number | null, slot: SlotRef, ctx: EvalContext): GrantEval {
  const reasons: Reason[] = [];
  const satisfied: string[] = [];
  const missing: string[] = [];
  const assumptions: string[] = [];
  const add = (r: Reason) => reasons.push(r);
  const I = ctx.interpretation;
  const pool = g.grantId;

  // 0) 권리 상태
  if (g.status === "revoked") add({ code: "GRANT_REVOKED", text: "철회된 권리입니다", severity: "unavailable" });
  else if (g.status === "expired") add({ code: "GRANT_EXPIRED", text: "만료로 처리된 권리입니다", severity: "unavailable" });
  else if (g.status === "proposed_revoke") add({ code: "REVOCATION_PENDING_CONFIRM", text: "전체 스냅샷에서 빠져 철회 후보입니다 — 운영 확인 전", severity: "conditional" });

  // 1) 채널
  const ch = g.scope.channels;
  if (ch.kind === "unknown") {
    add({ code: "CHANNEL_UNKNOWN", text: "허용 채널을 알 수 없습니다(원본 빈칸)", severity: "unknown" });
    missing.push("channels");
  } else if (ch.kind === "list") {
    if (ch.ids.some((id) => channelKey(id) === channelKey(slot.channelId))) satisfied.push("channel");
    else add({ code: "CHANNEL_NOT_ALLOWED", text: `허용 채널(${ch.ids.join(", ")})에 ${slot.channelId}이(가) 없습니다`, severity: "unavailable" });
  } else satisfied.push("channel");

  // 2) 시즌·편집판 표지(후보가 명시한 경우)
  if (q.season && g.scope.season.state === "value" && g.scope.season.value !== q.season) add({ code: "SEASON_VERSION_UNCONFIRMED", text: `시즌이 다릅니다(후보 ${q.season} / 권리 ${g.scope.season.value}) — 같은 콘텐츠인지 확인 전`, severity: "unknown" });
  if (q.version && g.scope.version.state === "value" && g.scope.version.value !== q.version) add({ code: "SEASON_VERSION_UNCONFIRMED", text: `편집판이 다릅니다(후보 ${q.version} / 권리 ${g.scope.version.value}) — 확인 전`, severity: "unknown" });

  // 3) 회차
  let epSet: number[] | null = null;
  if (g.scope.episodes.kind === "unknown") {
    add({ code: "EPISODE_SCOPE_UNKNOWN", text: `허용 회차를 알 수 없습니다(${g.scope.episodes.reason})`, severity: "unknown" });
    missing.push("episodes");
  } else if (episode !== null) {
    const ok = episodeAllowed(g.scope.episodes, episode);
    if (ok === false) add({ code: "EPISODE_NOT_GRANTED", text: `${episode}회는 허용 회차(${g.scope.episodes.kind === "ranges" ? g.scope.episodes.raw : "-"}) 밖입니다`, severity: "unavailable" });
    else satisfied.push("episode");
    epSet = [episode];
  } else if (g.scope.episodes.kind === "ranges") {
    epSet = listEpisodes(g.scope.episodes);
    satisfied.push("episode_to_be_assigned");
  }

  // 4) 방영범위(플랫폼)
  const plat = parsePlatforms(g.rules.platformsRaw.join("/"));
  if (plat.raw.length === 0) add({ code: "PLATFORM_NOT_SPECIFIED", text: "방영범위가 비어 있어 확인이 필요합니다", severity: "conditional" });
  else {
    const need = slot.platform ? [slot.platform] : [...LINEAR_PLATFORMS];
    const covered = need.every((n) => plat.mapped.includes(n));
    if (covered) satisfied.push("platform");
    else add({ code: "PLATFORM_COVERAGE_UNCONFIRMED", text: `방영범위(${plat.raw.join("/")})가 케이블·위성·IPTV 편성을 모두 포함하는지 확인이 필요합니다`, severity: "conditional" });
  }

  // 5) 요일·시간대·금지 기간
  const bases = optionsFor(I.dayBasis);
  if (g.rules.daysOfWeek.state === "unknown") {
    add({ code: "DAYS_UNKNOWN", text: "허용 요일을 읽을 수 없습니다", severity: "unknown" });
    missing.push("days_of_week");
  } else if (g.rules.daysOfWeek.state === "value") {
    const dows = g.rules.daysOfWeek.value;
    const dowOf = (date: string) => ((dayNumber(date) + 3) % 7) + 1; // 1970-01-01은 목요일(=4)
    const outs = new Set(bases.map((b) => dows.includes(dowOf(b === "calendar" ? calendarDateOf(slot.broadcastDate, slot.startMin) : slot.broadcastDate))));
    if (outs.size === 1 && outs.has(true)) satisfied.push("days_of_week");
    else if (outs.size === 1) add({ code: "DAY_NOT_ALLOWED", text: "허용 요일이 아닙니다", severity: "unavailable" });
    else add({ code: "DAY_BASIS_UNCONFIRMED", text: "달력/방송일 기준에 따라 허용 요일 판정이 갈립니다 — 기준 확인 필요", severity: "conditional" });
  }
  if (g.rules.timeOfDay.state === "unknown") {
    add({ code: "TIME_UNKNOWN", text: "허용 시간대를 읽을 수 없습니다", severity: "unknown" });
    missing.push("time_of_day");
  } else if (g.rules.timeOfDay.state === "value") {
    const { fromMin, toMin } = g.rules.timeOfDay.value;
    if (slot.startMin >= fromMin && slot.endMin <= toMin) satisfied.push("time_of_day");
    else add({ code: "TIME_NOT_ALLOWED", text: `허용 시간대(${clock(fromMin)}~${clock(toMin)}) 밖입니다`, severity: "unavailable" });
  }
  for (const b of g.rules.blackouts) {
    const dates = new Set(bases.map((x) => (x === "calendar" ? calendarDateOf(slot.broadcastDate, slot.startMin) : slot.broadcastDate)));
    dates.add(calendarDateOf(slot.broadcastDate, Math.max(slot.startMin, slot.endMin - 1)));
    const hits = [...dates].filter((d) => d >= b.from && d <= b.to);
    if (hits.length === dates.size) add({ code: "BLACKOUT", text: `금지 기간(${b.from}~${b.to})입니다`, severity: "unavailable" });
    else if (hits.length > 0) add({ code: "BLACKOUT_BOUNDARY_UNCONFIRMED", text: `금지 기간(${b.from}~${b.to}) 경계라 기준에 따라 갈립니다`, severity: "conditional" });
  }

  // 6) 조건(증빙이 있어야 풀림)
  for (const c of g.conditions) {
    if (conditionConfirmed(g, c, ctx.confirmations)) satisfied.push(`condition:${c.code}`);
    else add({ code: c.code, text: `${c.needs}${c.raw ? ` — 원문: ${c.raw}` : ""}`, severity: "conditional" });
  }

  // 7) 유효 기간 · 회차별 판정(횟수·1st window·순서·재방 간격)
  const startV = g.window.start;
  const endV = g.window.end;
  if (startV.state !== "value" || !(endV.state === "value" || endV.state === "unbounded")) {
    add({ code: "WINDOW_UNKNOWN", text: "방영 시작일 또는 종료일이 비어 있어 기간을 알 수 없습니다(무기한으로 보지 않음)", severity: "unknown" });
    missing.push(...(startV.state !== "value" ? ["window_start"] : []), ...(!(endV.state === "value" || endV.state === "unbounded") ? ["window_end"] : []));
  }
  const term = parseTerm(g.window.termRaw);
  const slotStartIso = `${slot.broadcastDate}`;

  const perEpisode = (ep: number | null): { reasons: Reason[]; remaining: number | null; assumptions: string[]; expiresOn: string | null; ok: string[] } => {
    const rs: Reason[] = [];
    const asm: string[] = [];
    const ok: string[] = [];
    let remaining: number | null = null;
    let expiresOn: string | null = null;

    // 유효 기간: (달력/방송일) × (종료일 포함 여부) × (걸친 방송 정책) × (회차별 기간 기준 적용 여부)
    if (startV.state === "value" && (endV.state === "value" || endV.state === "unbounded")) {
      const outerEnd: string | "unbounded" = endV.state === "unbounded" ? "unbounded" : endV.value;
      expiresOn = outerEnd === "unbounded" ? null : outerEnd;
      const ends: (string | "unbounded")[] = [outerEnd];
      if (g.window.anchor === "schedule_date" && term.kind === "months" && ep !== null) {
        const firstUse = countedUsages(ctx.ledger)
          .filter((e) => e.poolId === pool && e.episode === ep && e.event === "consume" && e.actualAt)
          .map((e) => e.actualAt!.slice(0, 10))
          .sort()[0];
        if (firstUse) {
          const perEp = addDaysIso(addMonthsIso(firstUse, term.months), -1);
          if (outerEnd === "unbounded" || perEp < outerEnd) {
            ends.push(perEp);
            asm.push("편성일기준: 회차별 최초 방영일부터 기간을 센다는 해석은 확인 전입니다(원본 종료일만 쓴 경우와 모두 평가).");
            expiresOn = outerEnd === "unbounded" || perEp < outerEnd ? perEp : outerEnd;
          }
        }
      }
      const cs = combos({ basis: bases, inclusive: optionsFor(I.endInclusive), span: optionsFor(I.spanPolicy), end: ends });
      const outcome = (c: (typeof cs)[number]): "in" | "out" => {
        const conv: BoundaryConvention = { basis: c.basis, endInclusive: c.inclusive };
        const pos: WindowPosition = positionInWindow(slot, startV.value, c.end, conv);
        if (pos === "in") return "in";
        if (pos === "straddles_end") return c.span === "start_only" ? "in" : "out";
        return "out";
      };
      const outs = new Set(cs.map(outcome));
      if (outs.size === 1 && outs.has("in")) ok.push("window");
      else if (outs.size === 1) {
        const pos = positionInWindow(slot, startV.value, outerEnd, { basis: cs[0].basis, endInclusive: cs[0].inclusive });
        rs.push({ code: pos === "before_start" || pos === "straddles_start" ? "WINDOW_NOT_STARTED" : "WINDOW_EXPIRED", text: `방영 기간(${startV.value} ~ ${outerEnd === "unbounded" ? "무기한" : outerEnd}) 밖입니다`, severity: "unavailable" });
      } else {
        const keys = splitKeys(cs, outcome);
        const label: Record<string, string> = { basis: "달력/방송일 기준", inclusive: "종료일 포함 여부", span: "자정 넘어 만료되는 방송의 판단", end: "회차별 기간 기준" };
        rs.push({ code: "BOUNDARY_UNCONFIRMED", text: `기간 경계라 해석에 따라 가능/불가가 갈립니다 — 확인 필요: ${keys.map((k) => label[k] ?? k).join(", ")}`, severity: "conditional" });
        asm.push(...keys.map((k) => `확인 전 해석: ${label[k] ?? k}`));
      }
    }

    // 횟수
    const lim = g.rules.count.limit;
    if (lim.state === "unknown") {
      rs.push({ code: "COUNT_LIMIT_UNKNOWN", text: "방수(방영 가능 횟수)가 비어 있거나 읽을 수 없습니다(무제한으로 보지 않음)", severity: "unknown" });
      missing.push("count_limit");
    } else if (lim.state === "value") {
      const unitOpts = optionsFor(I.countUnit);
      const rems = unitOpts.map((u) => lim.value - usedUnits(ctx.ledger, { poolId: pool, episode: ep, channelId: u === "per_episode_per_channel" ? slot.channelId : undefined }));
      remaining = Math.min(...rems);
      if (rems.every((r) => r <= 0)) rs.push({ code: "COUNT_EXHAUSTED", text: `잔여 횟수가 0입니다(한도 ${lim.value}회)`, severity: "unavailable" });
      else if (rems.some((r) => r <= 0)) rs.push({ code: "COUNT_UNIT_UNCONFIRMED", text: "방수가 채널 합산인지 채널별인지에 따라 잔여가 0이 됩니다 — 단위 확인 필요", severity: "conditional" });
      else {
        const baselineOk = g.usageBaseline !== "unknown" || ctx.confirmations.some((x) => x.grantId === g.grantId && x.rowHash === g.rowHash && x.topic === "usage_baseline");
        if (baselineOk) ok.push("count");
        else rs.push({ code: "USAGE_BASELINE_UNKNOWN", text: "이미 방영한 횟수가 원장에 없어 잔여 횟수를 단정할 수 없습니다(기소진 확인 필요)", severity: "conditional" });
      }
    } else ok.push("count");

    // 1st window 순서
    const gate = g.rules.firstWindowGate;
    if (gate && channelKey(gate.channel) !== channelKey(slot.channelId)) {
      const unitOpts = optionsFor(I.firstWindowGate);
      const slotAt = slotStartIso;
      const gateEntries = [...latestByUsage(ctx.ledger).values()].filter((e) => e.poolId === pool && channelKey(e.channelId) === channelKey(gate.channel));
      const before = (e: UsageEntry) => ((e.actualAt ?? e.scheduledAt ?? "").slice(0, 10) || "9999") <= slotAt;
      const evalUnit = (u: "per_episode" | "per_title") => {
        const pick = gateEntries.filter((e) => (u === "per_title" || e.episode === ep) && before(e));
        if (pick.some((e) => e.event === "consume")) return "done";
        if (pick.some((e) => e.event === "reserve")) return "planned";
        return "none";
      };
      const outs = new Set(unitOpts.map(evalUnit));
      if (outs.size === 1 && outs.has("done")) ok.push("first_window");
      else
        rs.push({
          code: outs.has("none") ? "FIRST_WINDOW_NOT_BROADCAST" : "FIRST_WINDOW_PLANNED",
          text: `1st window 채널(${gate.channel})의 최초 방송 전입니다${outs.has("none") ? "" : "(편성 예정, 아직 방송 전)"} — 그 뒤에야 ${slot.channelId} 편성이 가능합니다`,
          severity: "conditional",
        });
      if (unitOpts.length > 1) asm.push("1st window 최초 방송이 회차마다 필요한지 작품 단위인지 확인 전입니다(두 해석 모두 평가).");
    } else if (gate) ok.push("first_window_channel");

    // 회차 순서 · 재방 간격
    if (g.rules.episodeOrder.state === "value" && g.rules.episodeOrder.value === "sequential" && ep !== null && g.scope.episodes.kind === "ranges") {
      const first = Math.min(...g.scope.episodes.ranges.map(([a]) => a));
      if (ep > first) {
        const prevAired = countedUsages(ctx.ledger).some((e) => e.poolId === pool && e.episode === ep - 1);
        if (!prevAired) rs.push({ code: "EPISODE_ORDER", text: `${ep - 1}회가 먼저 방영(또는 예약)되어야 합니다`, severity: "unavailable" });
      }
    }
    if (g.rules.minRerunGapDays.state === "value" && ep !== null) {
      const gap = g.rules.minRerunGapDays.value;
      const clash = countedUsages(ctx.ledger).some((e) => {
        const d = (e.actualAt ?? e.scheduledAt ?? "").slice(0, 10);
        return e.poolId === pool && e.episode === ep && !!d && Math.abs(dayNumber(slot.broadcastDate) - dayNumber(d)) < gap && d !== slot.broadcastDate;
      });
      if (clash) rs.push({ code: "RERUN_GAP", text: `같은 회차 방영 간격이 ${gap}일 미만입니다`, severity: "unavailable" });
    }
    return { reasons: rs, remaining, assumptions: asm, expiresOn, ok };
  };

  let eligible: number[] | null = null;
  let remaining: number | null = null;
  let expiresOn: string | null = null;
  const baseStatus = statusOf(reasons);
  if (baseStatus === "unavailable" && episode === null && epSet === null) {
    // 회차를 알 수 없는데 이미 불가가 확정된 경우 — 회차별 계산 생략
  } else if (episode !== null || epSet === null || epSet.length === 0) {
    const r = perEpisode(episode);
    reasons.push(...r.reasons);
    assumptions.push(...r.assumptions);
    satisfied.push(...r.ok);
    remaining = r.remaining;
    expiresOn = r.expiresOn;
    if (episode !== null && statusOf([...reasons]) === "available") eligible = [episode];
  } else {
    // 회차 미지정: 회차마다 평가해 쓸 수 있는 회차를 모은다
    const cap = epSet.slice(0, 500);
    const per = cap.map((n) => ({ n, r: perEpisode(n) }));
    const good = per.filter((p) => statusOf([...reasons, ...p.r.reasons]) === "available");
    if (good.length > 0) {
      eligible = good.map((p) => p.n);
      remaining = Math.max(...good.map((p) => p.r.remaining ?? 0));
      expiresOn = good[0].r.expiresOn;
      satisfied.push(...new Set(good.flatMap((p) => p.r.ok)));
    } else {
      // 가장 가능성이 높은 회차의 사유를 보여 준다(조건부 > unknown > 불가)
      const best = [...per].sort((a, b) => RANK[statusOf([...reasons, ...b.r.reasons])] - RANK[statusOf([...reasons, ...a.r.reasons])])[0];
      reasons.push(...best.r.reasons);
      expiresOn = best.r.expiresOn;
      remaining = best.r.remaining;
    }
    assumptions.push(...new Set(per.flatMap((p) => p.r.assumptions)));
  }

  // 동일 사유 중복 제거
  const seen = new Set<string>();
  const uniq = reasons.filter((r) => (seen.has(r.code + r.text) ? false : (seen.add(r.code + r.text), true)));
  return { grant: g, status: statusOf(uniq), reasons: uniq, satisfied: [...new Set(satisfied)], missing: [...new Set(missing)], assumptions: [...new Set(assumptions)], eligibleEpisodes: eligible, expiresOn, remaining };
}

// ── 후보 1건 평가 ───────────────────────────────────────

const familyOf = (genre: string | null | undefined): string | null => (!genre ? null : genre.includes("드라마") ? "드라마" : genre.includes("예능") ? "예능" : null);
const isOriginalQuery = (q: ContentQuery, ctx: EvalContext) => /오리지널/.test(q.genre ?? "") || (!!q.programId && (ctx.originalProgramIds ?? []).includes(q.programId));

function resultFrom(ctx: EvalContext, slot: SlotRef, parts: { status: EligibilityStatus; reasons: Reason[]; satisfied?: string[]; missing?: string[]; assumptions?: string[]; grants?: Grant[]; eligibleEpisodes?: number[] | null; expiresOn?: string | null; remaining?: number | null }): EligibilityResult {
  void slot;
  return {
    status: parts.status,
    reasonCodes: parts.reasons.map((r) => r.code),
    satisfiedRules: parts.satisfied ?? [],
    missingFields: parts.missing ?? [],
    grantRevisionIds: (parts.grants ?? []).map((g) => g.revisionId),
    reasons: parts.reasons.map((r) => r.text),
    assumptions: parts.assumptions ?? [],
    eligibleEpisodes: parts.eligibleEpisodes ?? null,
    expiresOn: parts.expiresOn ?? null,
    remaining: parts.remaining ?? null,
    evaluatedAt: ctx.now,
    scheduleRevisionId: ctx.scheduleRevisionId ?? null,
    inventoryVersion: ctx.inventoryVersion,
    sourceRefs: (parts.grants ?? []).map((g) => ({ grantId: g.grantId, revisionId: g.revisionId, file: g.source.file, sheet: g.source.sheet, row: g.source.row })),
  };
}

export function evaluateEligibility(q: ContentQuery, slot: SlotRef, ctx: EvalContext): EligibilityResult {
  if (ctx.grants.length === 0) {
    return resultFrom(ctx, slot, { status: "unknown", reasons: [{ code: "AVAIL_NOT_LOADED", text: "Avail(권리) 자료가 아직 입력되지 않았습니다 — 성과 분석·탐색은 가능하지만 실행 가능 여부는 판정하지 못합니다", severity: "unknown" }], missing: ["avail"] });
  }
  const m = matchGrantsCached(q, ctx);
  if (m.grants.length === 0) {
    if (m.markerConflicts.length) {
      return resultFrom(ctx, slot, { status: "unknown", reasons: [{ code: "SEASON_VERSION_UNCONFIRMED", text: `시즌·편집판·제작년도 표지가 달라 같은 콘텐츠인지 확인이 필요합니다(${m.markerConflicts.join("; ")})`, severity: "unknown" }], missing: ["content_link"] });
    }
    if (m.needsConfirmation) {
      return resultFrom(ctx, slot, { status: "unknown", reasons: [{ code: "CONTENT_LINK_UNCONFIRMED", text: `비슷한 Avail 제목 후보가 있어 운영자 연결 확인이 필요합니다(${m.candidateKeys.slice(0, 3).join(", ")})`, severity: "unknown" }], missing: ["content_link"] });
    }
    // Avail 행이 없을 때만 오리지널 설정을 쓴다
    if (isOriginalQuery(q, ctx)) {
      const fam = familyOf(q.genre);
      if (fam && ctx.originalPolicy.unboundedFamilies.includes(fam)) {
        return resultFrom(ctx, slot, { status: "available", reasons: [], satisfied: ["original_no_avail_row"], assumptions: [`오리지널 ${fam}: Avail 행이 없어 권리 제한 없음으로 처리했습니다(운영자 설정, 확정 전). Avail 행이 입력되면 행이 우선합니다.`] });
      }
      if (fam && ctx.originalPolicy.needsAvailFamilies.includes(fam)) {
        return resultFrom(ctx, slot, { status: "unknown", reasons: [{ code: "ORIGINAL_NEEDS_AVAIL", text: `오리지널 ${fam}은 판권 기간이 있어 Avail 행 확인이 필요합니다`, severity: "unknown" }], missing: ["avail_row"] });
      }
    }
    return resultFrom(ctx, slot, { status: "unknown", reasons: [{ code: "NO_GRANT_RECORD", text: "이 콘텐츠의 Avail 행을 찾지 못했습니다(권리 미확인)", severity: "unknown" }], missing: ["avail_row"] });
  }

  const evals = m.grants.map((g) => evalGrant(g, q, q.episodeNumber ?? null, slot, ctx));
  const best = [...evals].sort((a, b) => RANK[b.status] - RANK[a.status] || (b.remaining ?? 0) - (a.remaining ?? 0))[0];
  const status = best.status;
  const used = status === "available" ? evals.filter((e) => e.status === "available") : [best];
  const reasons = status === "available" ? [] : best.reasons;
  const expires = used.map((e) => e.expiresOn).filter((x): x is string => !!x).sort();
  return resultFrom(ctx, slot, {
    status,
    reasons,
    satisfied: [...new Set(used.flatMap((e) => e.satisfied))],
    missing: [...new Set(used.flatMap((e) => e.missing))],
    assumptions: [...new Set(used.flatMap((e) => e.assumptions))],
    grants: used.map((e) => e.grant),
    eligibleEpisodes: status === "available" ? [...new Set(used.flatMap((e) => e.eligibleEpisodes ?? []))].sort((a, b) => a - b) : null,
    expiresOn: expires[expires.length - 1] ?? null,
    remaining: used.map((e) => e.remaining).filter((x): x is number => x !== null).reduce<number | null>((a, x) => (a === null ? x : Math.max(a, x)), null),
  });
}

/** 사유 문장 목록(코드 포함) — 화면·API에서 쓴다 */
export function reasonLines(r: EligibilityResult): string[] {
  return r.reasons.map((t, i) => `${r.reasonCodes[i] ?? ""}${r.reasonCodes[i] ? ": " : ""}${t}`);
}

