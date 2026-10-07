// 콘텐츠 구매 검토(단계 13) — Avail 기준 확보 단계 분류(순수 함수).
// 단계는 두 가지다: 보유(OWNED) / 보유 예정(PLANNED). 아직 Avail에 없는 신규 구매 후보도 구매하면 보유 예정이 되므로 보유 예정으로 둔다 —
// 다만 근거를 구분한다: Avail에 시작 전 권리 행이 있는 예정(avail_row)과, 행이 없어 권리 획득을 가정한 예정(assumed).
// 두 경우 모두 실행 가능으로 표시하지 않는다(실행 가능은 보유 + 칸별 권리 available 뿐).
// 그 밖에 '확인 못함' 상태 둘: 비슷한 제목·시즌/판이 달라 연결 확인이 필요한 경우(NEEDS_LINK), Avail 자료가 없는 경우(NO_AVAIL_DATA).
// 원칙
//  · "이 채널에서 방영한 적이 없다"는 사실은 구매 가능성의 증거가 아니다 — 방영 이력은 단계 분류에 쓰지 않는다.
//  · 비슷한 제목·시즌/판이 다른 Avail 행은 자동으로 같은 콘텐츠로 보지 않는다.
//  · Avail 자료가 없으면 '미확보'가 아니라 '확인 못함'이다.
//  · 방영권 종료일·제작년도는 값이 있을 때만 적고, 없으면 '미확인'이다(빈칸을 무제한으로 보지 않는다).
import { channelKey } from "@/lib/avail/adapters/common";
import type { GrantMatch } from "@/lib/avail/evaluate";
import type { Grant } from "@/lib/avail/types";

export type AcquisitionStage = "OWNED" | "PLANNED" | "NEEDS_LINK" | "NO_AVAIL_DATA";
/** 보유의 근거: Avail 권리 행이 있음 / 이 채널에서 최근 방영 중이지만 Avail 행이 없음(권리 기간·방수는 확인 못함) */
export type OwnedBasis = "avail_row" | "airing_only";
/** 보유 예정의 근거: Avail에 시작 전 권리 행이 있음 / 행이 없어 권리 획득을 가정함 */
export type PlannedBasis = "avail_row" | "assumed";

export const STAGE_LABEL: Record<AcquisitionStage, string> = {
  OWNED: "보유",
  PLANNED: "보유 예정",
  NEEDS_LINK: "Avail 연결 확인 필요",
  NO_AVAIL_DATA: "Avail 미입력(확인 못함)",
};
export const OWNED_BASIS_LABEL: Record<OwnedBasis, string> = {
  avail_row: "Avail 행 있음",
  airing_only: "방영 중 · Avail 행 없음(권리 확인 못함)",
};
export const PLANNED_BASIS_LABEL: Record<PlannedBasis, string> = {
  avail_row: "Avail 행 있음(시작 전)",
  assumed: "구매 검토·권리 획득 가정",
};

/** 방영권 종료 임박 기준(일) */
export const ENDS_SOON_DAYS = 60;

export interface GrantBrief {
  grantId: string;
  /** all = 전 채널, unknown = 원본 빈칸 */
  channels: string[] | "all" | "unknown";
  coversChannel: boolean;
  start: string | "unknown";
  startClock: string | null;
  /** 방영권 종료일. unbounded = 무제한이라고 명시, unknown = 빈칸 */
  end: string | "unbounded" | "unknown";
  /** 종료까지 남은 일수(오늘 기준, 음수면 종료됨). 종료일을 모르면 null */
  daysToEnd: number | null;
  endState: "ended" | "ends_soon" | "open" | "unbounded" | "unknown";
  countLimit: number | "unbounded" | "unknown";
  /** 화면 표기: 종료·방수 문구(서버에서 만들어 클라이언트가 그대로 보여 준다) */
  endLabel: string;
  countLabel: string;
  episodeCount: number | null;
  runtimeMin: number | null;
  productionYear: string | null;
  status: Grant["status"];
  manual: boolean;
  source: string;
}

export interface AcquisitionView {
  stage: AcquisitionStage;
  label: string;
  plannedBasis: PlannedBasis | null;
  ownedBasis: OwnedBasis | null;
  /** 화면에 그대로 보이는 한 줄 설명 */
  note: string;
  grants: GrantBrief[];
  /** 이 채널 기준으로 가장 늦은 방영권 종료 표기(없으면 null) */
  rightsEnd: { text: string; state: GrantBrief["endState"] } | null;
  candidateKeys: string[];
  markerConflicts: string[];
}

const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

export function briefOf(g: Grant, channelCode: string, today: string): GrantBrief {
  const ch = g.scope.channels;
  const covers = ch.kind === "all" || (ch.kind === "list" && ch.ids.some((id) => channelKey(id) === channelKey(channelCode)));
  const lim = g.rules.count.limit;
  const end: GrantBrief["end"] = g.window.end.state === "value" ? g.window.end.value : g.window.end.state === "unbounded" ? "unbounded" : "unknown";
  const daysToEnd = end !== "unbounded" && end !== "unknown" ? dayDiff(end, today) : null;
  const endState: GrantBrief["endState"] = end === "unbounded" ? "unbounded" : end === "unknown" ? "unknown" : daysToEnd! < 0 ? "ended" : daysToEnd! <= ENDS_SOON_DAYS ? "ends_soon" : "open";
  return {
    grantId: g.grantId,
    channels: ch.kind === "all" ? "all" : ch.kind === "list" ? ch.ids : "unknown",
    coversChannel: covers,
    start: g.window.start.state === "value" ? g.window.start.value : "unknown",
    startClock: typeof g.window.startMin === "number" ? clock(g.window.startMin) : null,
    end,
    daysToEnd,
    endState,
    countLimit: lim.state === "value" ? lim.value : lim.state === "unbounded" ? "unbounded" : "unknown",
    endLabel: endText({ end, daysToEnd, endState }),
    countLabel: lim.state === "value" ? "방수 " + lim.value + "회" : lim.state === "unbounded" ? "방수 제한 없음(명시)" : "방수 미확인",
    episodeCount: g.content.episodeCount.state === "value" ? g.content.episodeCount.value : null,
    runtimeMin: g.content.runtimeMin.state === "value" ? g.content.runtimeMin.value : null,
    productionYear: g.content.productionYear.state === "value" ? g.content.productionYear.value : null,
    status: g.status,
    manual: !!g.manual?.override,
    source: g.source.kind === "manual" ? "운영자 입력" : `${g.source.file}${g.source.sheet ? ` · ${g.source.sheet}` : ""}${g.source.row ? ` · ${g.source.row}행` : ""}`,
  };
}

/** 방영권 종료 표기 문구 — 종료일·남은 일수·종료/임박 여부를 한 줄로 */
export function endText(b: Pick<GrantBrief, "end" | "daysToEnd" | "endState">): string {
  switch (b.endState) {
    case "unbounded":
      return "방영권 종료: 제한 없음(Avail 명시)";
    case "unknown":
      return "방영권 종료일 미확인(빈칸을 무제한으로 보지 않음)";
    case "ended":
      return `방영권 종료: ${b.end} (${Math.abs(b.daysToEnd!)}일 전 종료)`;
    case "ends_soon":
      return `방영권 종료: ${b.end} (${b.daysToEnd}일 남음 · 종료 임박)`;
    default:
      return `방영권 종료: ${b.end} (${b.daysToEnd}일 남음)`;
  }
}

/** 이 채널 권리 중 가장 늦은 종료를 대표 표기로 쓴다(하나라도 종료일 미확인이면 미확인을 우선 알린다). */
function rightsEndOf(briefs: GrantBrief[]): AcquisitionView["rightsEnd"] {
  const mine = briefs.filter((b) => b.coversChannel);
  if (mine.length === 0) return null;
  if (mine.some((b) => b.endState === "unbounded")) return { text: endText({ end: "unbounded", daysToEnd: null, endState: "unbounded" }), state: "unbounded" };
  if (mine.some((b) => b.endState === "unknown")) return { text: endText({ end: "unknown", daysToEnd: null, endState: "unknown" }), state: "unknown" };
  const latest = [...mine].sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  return { text: endText(latest), state: latest.endState };
}

/**
 * 확보 단계 분류. today = 오늘(KST, YYYY-MM-DD). 판정 대상 채널의 권리만 본다 — 다른 채널용 권리만 있으면 이 채널 기준으로는 보유 예정(가정)이다.
 * 시작 시각(23:50 등)이 있는 운영자 입력 권리는 시작일이 오늘이어도 시각 전이면 예정으로 본다(nowMinKst: 오늘 0시부터의 분).
 */
export function classifyAcquisition(args: {
  availConfigured: boolean;
  match: GrantMatch | null;
  channelCode: string;
  today: string;
  nowMinKst?: number;
  /** 이 채널에서 최근(약 3개월) 방영 이력이 있는가 — 보유의 증거로만 쓴다(없다는 사실은 구매 가능성의 증거가 아니다) */
  ownRecentAiring?: boolean;
}): AcquisitionView {
  const { availConfigured, match, channelCode, today } = args;
  const mk = (stage: AcquisitionStage, note: string, extra: Partial<AcquisitionView> = {}): AcquisitionView => ({ stage, label: STAGE_LABEL[stage], plannedBasis: null, ownedBasis: null, note, grants: [], rightsEnd: null, candidateKeys: [], markerConflicts: [], ...extra });
  const airingOnly = (note: string, grants: GrantBrief[] = []) => mk("OWNED", note, { ownedBasis: "airing_only", grants });
  const assumed = (note: string, grants: GrantBrief[] = []) => mk("PLANNED", note, { plannedBasis: "assumed", grants, rightsEnd: null });

  if (!availConfigured || !match) return mk("NO_AVAIL_DATA", "Avail(권리) 자료가 입력되지 않아 보유·예정 여부를 확인하지 못했습니다. 보유 예정이 아니라 '확인 못함'입니다.");
  if (match.grants.length === 0) {
    if (match.markerConflicts.length > 0) return mk("NEEDS_LINK", `같은 제목의 Avail 행이 있지만 시즌·편집판·제작년도가 달라 같은 콘텐츠인지 확인이 필요합니다(${match.markerConflicts.join("; ")}). 확인 전에는 권리를 가정하지 않습니다.`, { candidateKeys: match.candidateKeys, markerConflicts: match.markerConflicts });
    if (match.needsConfirmation) return mk("NEEDS_LINK", `비슷한 Avail 제목 후보가 있습니다(${match.candidateKeys.slice(0, 3).join(", ")}). 제목이 비슷하다는 사실만으로 같은 콘텐츠로 보지 않으니 운영자 연결 확인이 필요합니다.`, { candidateKeys: match.candidateKeys });
    if (args.ownRecentAiring) return airingOnly("이 채널에서 최근 방영 중인 작품이라 보유로 봅니다. 다만 Avail에 권리 행이 없어 방영 기간·방수·종료일은 확인하지 못했습니다(Avail 입력 필요) — 실행 가능으로 표시하지 않습니다.");
    return assumed("Avail에 이 콘텐츠가 없는 신규 구매 검토 후보입니다. 구매하면 보유 예정이 되므로 보유 예정으로 두되, 아래 예측은 권리를 얻는다고 가정한 시뮬레이션이며 실행 가능이 아닙니다. 이 채널에서 방영한 적이 없다는 사실은 구매 가능성의 증거가 아닙니다.");
  }
  const briefs = match.grants.map((g) => briefOf(g, channelCode, today));
  const live = match.grants.filter((g) => g.status === "active" || g.status === "proposed_revoke");
  if (live.length === 0) return assumed("Avail 행이 모두 철회·만료로 처리되어 현재 보유한 권리가 없습니다. 다시 확보하는 것으로 가정한 보유 예정 시뮬레이션입니다.", briefs);
  const covering = live.filter((g) => briefOf(g, channelCode, today).coversChannel || g.scope.channels.kind === "unknown");
  if (covering.length === 0) {
    const others = [...new Set(briefs.flatMap((b) => (Array.isArray(b.channels) ? b.channels : [])))];
    if (args.ownRecentAiring) return airingOnly(`이 채널에서 최근 방영 중인 작품이라 보유로 봅니다. 다만 Avail에는 다른 채널용 권리만 있어${others.length ? `(${others.join(", ")})` : ""} 이 채널의 방영 기간·방수·종료일은 확인하지 못했습니다 — 실행 가능으로 표시하지 않습니다.`, briefs);
    return assumed(`Avail에는 다른 채널용 권리만 있습니다${others.length ? `(${others.join(", ")})` : ""}. 이 채널 권리는 확보하는 것으로 가정한 보유 예정 시뮬레이션입니다.`, briefs);
  }
  const ended = (g: Grant) => g.window.end.state === "value" && g.window.end.value < today;
  const live2 = covering.filter((g) => !ended(g));
  if (live2.length === 0) return assumed(`이 채널 방영권이 종료되었습니다(${rightsEndOf(briefs)?.text ?? "종료일 경과"}). 재확보하는 것으로 가정한 보유 예정 시뮬레이션입니다.`, briefs);
  const started = (g: Grant) => {
    if (g.window.start.state !== "value") return null; // 시작을 모름
    if (g.window.start.value < today) return true;
    if (g.window.start.value > today) return false;
    return typeof g.window.startMin === "number" && args.nowMinKst !== undefined ? args.nowMinKst >= g.window.startMin : true;
  };
  const states = live2.map(started);
  const rightsEnd = rightsEndOf(briefs);
  if (states.every((s) => s === false)) {
    const first = live2.map((g) => (g.window.start.state === "value" ? g.window.start.value : "")).filter(Boolean).sort()[0];
    return mk("PLANNED", `Avail에 이 채널 권리 행이 있으나 시작 전입니다(${first ?? "시작일 확인"}${live2.some((g) => typeof g.window.startMin === "number") ? " 지정 시각" : ""} 이후). 시작 전에는 편성할 수 없고, 아래 예측은 시작 뒤 편성을 가정한 값입니다.`, { plannedBasis: "avail_row", grants: briefs, rightsEnd });
  }
  const unknownStart = states.every((s) => s === null);
  return mk("OWNED", unknownStart ? "Avail에 이 채널 권리 행이 있으나 시작일이 비어 있어 시작 여부를 확인하지 못했습니다. 판정은 칸별 권리 확인을 따릅니다." : "Avail에 이 채널 권리 행이 있습니다. 실제 편성 가능 여부는 칸별 권리 확인(기간·방수·조건)을 따릅니다.", { ownedBasis: "avail_row", grants: briefs, rightsEnd });
}

/** 방영권 종료가 요청한 편성 시점보다 빠른지(편성 날짜 이후에 종료되어야 안전) */
export function endsBefore(b: Pick<GrantBrief, "end">, airDate: string): boolean {
  return b.end !== "unbounded" && b.end !== "unknown" && b.end < airDate;
}
