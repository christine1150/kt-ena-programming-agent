// 라인업 화면 배치 도우미(그리기 전용, 화면·인쇄·엑셀 공용) — 수치(맞대결·빈 주·자리 점유 끝)는 서버가 계산해 주고, 여기서는 줄·칸·위치만 정한다.
import { addMonths as addMonthsYm } from "@/lib/lineup/dates";
import { GENRE_FILL } from "@/lib/lineup/tokens";
import type { CompareBlock, Genre, LineupPayload, OutletDto, RunDto, RunStatus, SlotDto, WorkDto } from "@/lib/lineup/types";

export type ViewMode = "own" | "compare" | "list" | "calendar";
export type Density = "comfy" | "compact";
/** 경쟁 비교 묶음 기준(2026-11-26): 동일 요일 · 동시간대 · 동일 장르 · 전체 */
export type CompareMode = "dow" | "time" | "genre" | "all";
export const COMPARE_MODES: { key: CompareMode; label: string }[] = [
  { key: "dow", label: "동일 요일" },
  { key: "time", label: "동시간대" },
  { key: "genre", label: "동일 장르" },
  { key: "all", label: "전체" },
];

export const GENRE_LABEL: Record<Genre, string> = { drama: "드라마", variety: "예능", business: "사업형", other: "교양·기타" };
/**
 * 장르색 — 2026-11-26 전면 리디자인(D+ ENA Modern Pop, 사용자 확정): 드라마 #D91D60 · 예능 #4036E8 · 사업형 #00C8D2(ENA PLAY 공식 BI 시안) · 교양·기타 #676D79.
 * 자사 막대는 이 색으로 채우고, 경쟁사는 흰 바탕에 이 색 아웃라인(Style 2). 값은 tokens.ts(GENRE_FILL)와 lineup.css가 원본이다.
 * (이전: 2026-11-25 편성센터 분홍·남색·호박·모래 — 폐기)
 */
export const GENRE_HEX: Record<Genre, string> = GENRE_FILL;
export const GENRE_VAR: Record<Genre, string> = GENRE_HEX;
export const BLOCK_LABEL: Record<CompareBlock, string> = { mon_tue: "월화", wed_thu: "수목", weekend: "주말 (금·토·일)", other: "그 밖" };
export const BLOCK_ORDER: CompareBlock[] = ["mon_tue", "wed_thu", "weekend", "other"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
export const dowLabel = (days: number[]) => days.map((d) => DOW[d - 1]).join("");
export const STATUS_LABEL = { confirmed: "확정", planned: "예정", tentative: "가안" } as const;
export const KIND_LABEL: Record<RunDto["runKind"], string> = {
  series: "연속 편성", monthly: "월 1회", single: "단발", multi_day: "행사(여러 날)", tbd: "미정 자리", hiatus: "휴방·결방", filler: "수급물",
};
/** OTT는 편성이 아니라 공개 — 같은 구간 종류를 공개 방식 말로(2026-11-25). */
export function kindLabel(run: RunDto, ott: boolean): string {
  if (!ott) return KIND_LABEL[run.runKind];
  if (!run.startDate) return "공개 시기 미정";
  if (run.startPrecision === "month") return "공개 시기만 확인";
  return ({ series: "연속 공개", single: "공개일", multi_day: "분할 공개" } as Partial<Record<RunDto["runKind"], string>>)[run.runKind] ?? KIND_LABEL[run.runKind];
}

/** 자리 글자 — 'OTT 공개 일정'처럼 요일·시각이 없는 자리(매일·시각 없음)는 요일을 쓰지 않는다. */
export function slotLabel(s: SlotDto, o?: OutletDto): string {
  if (o?.ott) return "";
  if (s.days.length === 7 && s.startMinute === null) return slotTime(s);
  return `${dowLabel(s.days)} ${slotTime(s)}`.trim();
}

export const LAYOUT = {
  // 2026-11-26 리디자인: 기본 줄 48px(막대 40px = 제목 13px + 기간·편수·출연 11.5px 두 줄), 촘촘 34px(막대 26px 한 줄).
  comfy: { row: 48, bar: 40, event: 18 },
  compact: { row: 34, bar: 26, event: 14 },
  label: { own: { comfy: 176, compact: 160 }, compare: { comfy: 212, compact: 196 } },
  minWeekPx: 18,
};

const MS = 86400000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const dayIndex = (from: string, d: string) => Math.round((ms(d) - ms(from)) / MS);
export const addDaysIso = (d: string, n: number) => new Date(ms(d) + n * MS).toISOString().slice(0, 10);

/** 기간 안 위치(0~100%). 기간 밖은 0/100으로 자른다. */
export function pct(from: string, totalDays: number, d: string): number {
  return Math.max(0, Math.min(100, (dayIndex(from, d) / totalDays) * 100));
}

/** 글자 폭 대략값(px) — 한글·한자 1em, 그 밖 0.6em. 막대 안 글자 고르기에만 쓴다. */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? size : size * 0.6;
  return w;
}

export function runTitle(run: RunDto, work: WorkDto | undefined): string {
  if (work) return work.tentative ? `${work.title}(가제)` : work.title;
  if (run.runKind === "tbd") return run.episodes ? `미정 · ${run.episodes}회` : "미정";
  if (run.runKind === "hiatus") return run.reason ? `${run.label ?? "결방"} · ${run.reason}` : run.label ?? "휴방";
  return run.label ?? "";
}

export function runGenre(run: RunDto, work: WorkDto | undefined, slot: SlotDto | undefined): Genre {
  return work?.genre ?? slot?.defaultGenre ?? "other";
}

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");
/** 기간 글자 — 정밀도대로(하루 단위 '11/16~12/22', 월 단위 원문 '1~2월', 주 단위 '1월 넷째 주~'). */
export function periodText(run: RunDto): string {
  if (!run.startDate) return "일정 미정";
  if (run.startPrecision === "month") return run.startText ?? `${Number(run.startDate?.slice(5, 7))}월~${run.endDate ? `${Number(run.endDate.slice(5, 7))}월` : ""}`;
  const approx = run.startPrecision === "week" ? "≈" : "";
  if (run.runKind === "single") return md(run.startDate);
  const end = run.endDate ? md(run.endDate) : run.episodes ? "≈" : "";
  return `${approx}${md(run.startDate)}~${end}`;
}

export function episodeText(run: RunDto, work: WorkDto | undefined): string {
  if (run.episodeFrom) return `${run.episodeFrom}회~`;
  const n = run.episodes ?? work?.totalEpisodes;
  return n ? `${n}회` : "";
}

// ── 2026-11-26 리디자인 표기 ──
/** '2026-11-16' → '11.16' */
export const dateDot = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : "");
/** '2026-11-16' → '2026.11.16' */
export const dateFull = (d: string | null | undefined) => (d ? d.replaceAll("-", ".") : "");

/**
 * 막대·목록의 기간 글자 — '11.16–12.22'. 정밀도를 지킨다: 주 단위 '≈11.30–', 월 단위는 원문('2027년 1월'),
 * 끝이 회차 추정이면 '–≈01.30', 끝 모름이면 '11.16– 기간 미정', 상시면 '11.16– 종료 미정'.
 */
export function periodDot(run: RunDto): string {
  if (!run.startDate) return "일정 미정";
  if (run.startPrecision === "month") return run.startText ?? periodText(run);
  const approx = run.startPrecision === "week" ? "≈" : "";
  if (run.runKind === "single") return `${approx}${dateDot(run.startDate)}`;
  const start = `${approx}${dateDot(run.startDate)}`;
  if (run.endDate) return `${start}–${run.endPrecision === "day" ? "" : "≈"}${dateDot(run.endDate)}`;
  if (run.endPrecision === "open") return `${start}– 종료 미정`;
  if (run.draw?.estimatedFrom && run.draw.to) return `${start}–≈`;
  return `${start}– 기간 미정`;
}

/**
 * 막대 그리기 범위 판단(화면 전용, 서버 drawSpan은 그대로) — 지시문 §5:
 * - 'span': 시작·끝(또는 회차로 추정한 끝)이 있어 실제 길이로 그린다.
 * - 'start': 첫 방송일만 있고 종료일·편수가 없다 → 임의 4주 막대 대신 시작 표식 + '기간 미정'.
 * - 'open': 상시(끝 열림) → 오늘까지 채우고 이후는 점선 꼬리 '종료 미정'.
 */
export function runExtent(run: RunDto): "span" | "start" | "open" {
  if (run.runKind !== "series" || !run.startDate || run.startPrecision === "month") return "span";
  if (run.endPrecision === "open") return "open";
  if (!run.endDate && !run.episodes) return "start";
  return "span";
}

/** 검색(작품명·줄임말·출연진·라벨) — 띄어쓰기·대소문자 무시. */
export function searchKey(s: string): string {
  return s.toLowerCase().replace(/[\s·,.:;!?'"()[\]<>-]/g, "");
}
export function runMatchesQuery(run: RunDto, work: WorkDto | undefined, q: string): boolean {
  const k = searchKey(q);
  if (!k) return true;
  const hay = [work?.title, work?.shortTitle, run.label, ...(work?.cast ?? []), ...(work?.directors ?? []), ...(work?.writers ?? [])].filter(Boolean).map((x) => searchKey(x as string));
  return hay.some((h) => h.includes(k));
}

/** OTT 공개 시기 정밀도(공개 예정 패널 묶음) — 원문을 그대로 두고 단위만 가른다. 날짜를 지어내지 않는다. */
export type OttBucket = "year" | "half" | "quarter" | "month" | "day" | "none";
export const OTT_BUCKET_LABEL: Record<OttBucket, string> = { year: "연도 단위", half: "반기 단위", quarter: "분기 단위", month: "월 단위", day: "공개일 확정", none: "미정" };
export function ottBucket(run: RunDto): OttBucket {
  if (!run.startDate) return "none";
  const t = `${run.startText ?? ""} ${run.endText ?? ""}`;
  if (/상반기|하반기|반기/.test(t)) return "half";
  if (/분기|Q[1-4]/i.test(t)) return "quarter";
  if (isYearOnly(run)) return "year";
  if (run.startPrecision === "month") return "month";
  return "day";
}

export interface Row {
  key: string;
  kind: "group" | "subgroup" | "slot";
  label: string;
  sublabel?: string;
  chip?: string; // 요일 칩(비교 보기)
  outlet?: OutletDto;
  slot?: SlotDto;
  emphasis?: boolean; // 자사 고정 줄
  color?: string | null; // 채널 띠
  empty?: boolean;
  // 2026-11-26 리디자인(화면 전용, 엑셀은 쓰지 않는다)
  genre?: Genre; // 자사 보기: 이 자리가 속한 장르 묶음
  groupLabel?: string; // 자사 보기 채널 줄: 'A · 2049 핵심'
  count?: number; // 채널·묶음 안 구간 수
}

export interface Filters {
  channels: string[]; // 자사 채널 코드(빈 배열 = 라인업이 있는 채널 전부)
  genres: Genre[]; // 빈 배열 = 전부
  dows: number[]; // 빈 배열 = 전부
  statuses?: RunStatus[]; // 편성 상태(빈 배열·없음 = 전부)
  outlets?: string[]; // 경쟁 방송사·OTT 코드(빈 배열·없음 = 전부) — 자사 채널은 channels로 고른다
}

function runMatches(run: RunDto, slot: SlotDto, f: Filters, works: Map<string, WorkDto>) {
  const g = runGenre(run, run.workId ? works.get(run.workId) : undefined, slot);
  if (f.genres.length > 0 && !f.genres.includes(g)) return false;
  // 상태 거르기는 작품 구간에만(휴방·미정 칸은 상태와 무관하게 남긴다)
  if (f.statuses && f.statuses.length > 0 && run.workId && !f.statuses.includes(run.status)) return false;
  return true;
}

const slotMatchesDow = (slot: SlotDto, f: Filters) => f.dows.length === 0 || slot.days.some((d) => f.dows.includes(d));

/** 자사 라인업 줄: 채널 묶음(A·B) > 채널 > 장르 > 자리. 라인업이 없는 채널은 숨긴다(showEmpty면 채널 줄만 '자료 없음'으로 남긴다). */
export function buildOwnRows(data: LineupPayload, f: Filters, opts?: { showEmpty?: boolean }): { rows: Row[]; runsBySlot: Map<string, RunDto[]>; hiddenChannels: string[] } {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const runsBySlot = new Map<string, RunDto[]>();
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    if (!slot || !runMatches(r, slot, f, works)) continue;
    const arr = runsBySlot.get(r.slotId) ?? [];
    arr.push(r);
    runsBySlot.set(r.slotId, arr);
  }
  const rows: Row[] = [];
  const hidden: string[] = [];
  const own = data.outlets.filter((o) => o.side === "own");
  for (const group of ["A", "B"] as const) {
    const groupOutlets = own.filter((o) => o.group === group);
    const groupRows: Row[] = [];
    for (const o of groupOutlets) {
      if (f.channels.length > 0 && !f.channels.includes(o.code)) continue;
      const oSlots = data.slots.filter((s) => s.outletId === o.id && slotMatchesDow(s, f) && (runsBySlot.get(s.id)?.length ?? 0) > 0);
      const groupLabel = group === "A" ? "A · 2049 핵심" : "B · 가구 핵심";
      if (oSlots.length === 0) {
        hidden.push(o.name);
        if (opts?.showEmpty) groupRows.push({ key: `o:${o.id}`, kind: "subgroup", label: o.name, outlet: o, color: o.color, groupLabel, empty: true, count: 0 });
        continue;
      }
      const count = oSlots.reduce((n, s) => n + (runsBySlot.get(s.id)?.filter((r) => r.workId).length ?? 0), 0);
      groupRows.push({ key: `o:${o.id}`, kind: "subgroup", label: o.name, outlet: o, color: o.color, groupLabel, count });
      for (const g of ["drama", "variety", "business", "other"] as Genre[]) {
        const gs = oSlots
          .filter((s) => {
            const rs = runsBySlot.get(s.id) ?? [];
            const main = rs.map((r) => runGenre(r, r.workId ? works.get(r.workId) : undefined, s));
            const top = main.includes(s.defaultGenre) ? s.defaultGenre : main[0] ?? s.defaultGenre;
            return top === g;
          })
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
        gs.forEach((s, i) =>
          groupRows.push({ key: `s:${s.id}`, kind: "slot", label: s.name, sublabel: i === 0 ? GENRE_LABEL[g] : undefined, outlet: o, slot: s, color: o.color, genre: g })
        );
      }
    }
    if (groupRows.length > 0) {
      rows.push({ key: `g:${group}`, kind: "group", label: group === "A" ? "A 묶음 · 2049 핵심" : "B 묶음 · 가구 핵심" });
      rows.push(...groupRows);
    }
  }
  return { rows, runsBySlot, hiddenChannels: hidden };
}

const DAYCHIP_ORDER = (days: number[]) => days.join("");
/** 자리의 대표 장르 — 기간 안 구간의 장르 중 자리 기본 장르가 있으면 그것, 없으면 첫 구간 장르. */
function slotGenre(s: SlotDto, runs: RunDto[], works: Map<string, WorkDto>): Genre {
  const gs = runs.map((r) => runGenre(r, r.workId ? works.get(r.workId) : undefined, s));
  return gs.includes(s.defaultGenre) ? s.defaultGenre : gs[0] ?? s.defaultGenre;
}
/** 동시간대 묶음 — 시작 시각(방송일 기준 분)의 한 시간대. 시각을 모르는 자리는 '시각 미확인'(동시간대 경쟁으로 확정하지 않는다). */
function timeBand(s: SlotDto): { key: string; label: string; order: number } {
  if (s.startMinute === null) return { key: "t:none", label: "시각 미확인 · 확인 필요", order: 99 };
  const h = Math.floor(s.startMinute / 60);
  if (h < 18) return { key: "t:day", label: "18시 이전", order: 0 };
  return { key: `t:${h}`, label: `${h % 24}시대 (${String(h % 24).padStart(2, "0")}:00–${String(h % 24).padStart(2, "0")}:59)`, order: h };
}

/**
 * 경쟁 비교 줄(2026-11-26 리디자인) — 묶음 기준(mode)마다 묶음 > [기준 자사 채널 자리를 위에] > 경쟁사 자리. OTT는 맨 아래 묶음.
 * dow(기본): 월화·수목·주말·그 밖 / time: 시작 시각 한 시간대 / genre: 자리 대표 장르 / all: 한 묶음.
 */
export function buildCompareRows(data: LineupPayload, f: Filters, mode: CompareMode = "dow"): { rows: Row[]; runsBySlot: Map<string, RunDto[]> } {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const runsBySlot = new Map<string, RunDto[]>();
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    if (!slot || !runMatches(r, slot, f, works)) continue;
    // 공개 연도만 아는 OTT 작품은 1년 길이 괄호가 줄만 차지하므로 격자에서 빼고 격자 아래 '공개 예정' 목록에 둔다.
    if (outlets.get(slot.outletId)?.ott && isYearOnly(r)) continue;
    const arr = runsBySlot.get(r.slotId) ?? [];
    arr.push(r);
    runsBySlot.set(r.slotId, arr);
  }
  const ownCodes = f.channels.length > 0 ? f.channels : ["ENA"];
  const outletOk = (s: SlotDto) => {
    const o = outlets.get(s.outletId);
    return !f.outlets || f.outlets.length === 0 || (!!o && f.outlets.includes(o.code));
  };
  const isOttSlot = (s: SlotDto) => !!outlets.get(s.outletId)?.ott;
  const hasRuns = (s: SlotDto) => (runsBySlot.get(s.id)?.length ?? 0) > 0;
  const genreOf = (s: SlotDto) => slotGenre(s, runsBySlot.get(s.id) ?? [], works);
  const genreOk = (s: SlotDto) => f.genres.length === 0 || f.genres.includes(genreOf(s));
  const base = data.slots.filter((s) => !isOttSlot(s) && slotMatchesDow(s, f));
  const ownAll = base
    .filter((s) => {
      const o = outlets.get(s.outletId);
      return o?.side === "own" && ownCodes.includes(o.code) && genreOk(s) && (hasRuns(s) || (mode === "dow" && s.defaultGenre === "drama"));
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const rivalAll = base
    .filter((s) => outlets.get(s.outletId)?.side === "rival" && hasRuns(s) && outletOk(s))
    .sort((a, b) => {
      const ca = DAYCHIP_ORDER(a.days);
      const cb = DAYCHIP_ORDER(b.days);
      if (mode !== "time" && ca !== cb) return ca.localeCompare(cb);
      if (mode === "time" && (a.startMinute ?? 0) !== (b.startMinute ?? 0)) return (a.startMinute ?? 0) - (b.startMinute ?? 0);
      const oa = outlets.get(a.outletId)?.sortOrder ?? 0;
      const ob = outlets.get(b.outletId)?.sortOrder ?? 0;
      return oa - ob || (a.startMinute ?? 0) - (b.startMinute ?? 0);
    });
  // 묶음 키 → 이름·순서
  const groupOf = (s: SlotDto): { key: string; label: string; order: number } => {
    if (mode === "time") return timeBand(s);
    if (mode === "genre") {
      const g = genreOf(s);
      return { key: `g:${g}`, label: GENRE_LABEL[g], order: ["drama", "variety", "business", "other"].indexOf(g) };
    }
    if (mode === "all") return { key: "all", label: "전체 라인업", order: 0 };
    return { key: `b:${s.compareBlock}`, label: BLOCK_LABEL[s.compareBlock], order: BLOCK_ORDER.indexOf(s.compareBlock) };
  };
  const groups = new Map<string, { label: string; order: number; own: SlotDto[]; rival: SlotDto[] }>();
  const ensure = (s: SlotDto) => {
    const g = groupOf(s);
    if (!groups.has(g.key)) groups.set(g.key, { label: g.label, order: g.order, own: [], rival: [] });
    return groups.get(g.key)!;
  };
  for (const s of ownAll) ensure(s).own.push(s);
  for (const s of rivalAll) ensure(s).rival.push(s);
  const rows: Row[] = [];
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (g.own.length === 0 && g.rival.length === 0) continue;
    const count = [...g.own, ...g.rival].reduce((n, s) => n + (runsBySlot.get(s.id)?.filter((r) => r.workId).length ?? 0), 0);
    rows.push({ key, kind: "group", label: g.label, count });
    if (g.own.length === 0 && mode === "dow") {
      const o = data.outlets.find((x) => x.code === ownCodes[0]);
      rows.push({ key: `e:${key}`, kind: "slot", label: o?.name ?? "자사", sublabel: "-", outlet: o, emphasis: true, empty: true, color: o?.color ?? null });
    }
    for (const s of g.own) {
      const o = outlets.get(s.outletId);
      rows.push({ key: `s:${s.id}`, kind: "slot", label: o?.name ?? "", sublabel: slotTime(s), chip: dowLabel(s.days), outlet: o, slot: s, emphasis: true, color: o?.color ?? null, genre: genreOf(s) });
    }
    for (const s of g.rival) {
      const o = outlets.get(s.outletId);
      rows.push({ key: `s:${s.id}`, kind: "slot", label: o?.name ?? "", sublabel: slotTime(s), chip: dowLabel(s.days), outlet: o, slot: s, color: o?.color ?? null, genre: genreOf(s) });
    }
  }
  // OTT 묶음(2026-11-25) — 방송 요일·시각이 없어 요일 묶음에 못 넣는다. 맨 아래에 플랫폼마다 한 줄(공개 일정). 요일을 거르면 요일이 없는 OTT는 뺀다.
  if (f.dows.length === 0) {
    const ott = data.slots
      .filter((s) => isOttSlot(s) && outletOk(s) && (runsBySlot.get(s.id) ?? []).some((r) => r.draw))
      .sort((a, b) => (outlets.get(a.outletId)?.sortOrder ?? 0) - (outlets.get(b.outletId)?.sortOrder ?? 0));
    if (ott.length > 0) {
      rows.push({ key: "b:ott", kind: "group", label: "OTT · 공개 일정" });
      for (const s of ott) {
        const o = outlets.get(s.outletId);
        rows.push({ key: `s:${s.id}`, kind: "slot", label: o?.name ?? "", chip: "OTT", outlet: o, slot: s, color: o?.color ?? null });
      }
    }
  }
  return { rows, runsBySlot };
}

/** 공개 연도만 아는 구간(월 단위 정밀도에 길이가 1년 가까이) — 격자에 그려도 1년짜리 줄이라 목록으로 옮긴다. */
export function isYearOnly(run: RunDto): boolean {
  return run.startPrecision === "month" && !!run.startDate && !!run.endDate && dayIndex(run.startDate, run.endDate) >= 300;
}

/** 공개 시기를 모르거나(날짜 없음) 연도만 아는 OTT 작품 — 시간 축에 놓을 수 없어 격자 아래 목록으로 보인다(경쟁 비교·인쇄·엑셀). 요일을 거르면 뺀다. */
export function buildUndated(data: LineupPayload, f: Filters): { outlet: OutletDto; runs: RunDto[] }[] {
  if (f.dows.length > 0) return [];
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const by = new Map<string, RunDto[]>();
  for (const r of data.runs) {
    if (r.startDate && !isYearOnly(r)) continue;
    const s = slots.get(r.slotId);
    const o = s ? outlets.get(s.outletId) : undefined;
    if (!s || !o?.ott || !runMatches(r, s, f, works)) continue;
    by.set(o.id, [...(by.get(o.id) ?? []), r]);
  }
  return data.outlets
    .filter((o) => o.ott && by.has(o.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((o) => ({
      outlet: o,
      // 연도를 아는 작품을 먼저, 그다음 날짜 없는 작품. 같은 무리 안은 제목순.
      runs: (by.get(o.id) as RunDto[]).sort((a, b) => {
        const x = a.startDate ? 0 : 1;
        const y = b.startDate ? 0 : 1;
        return x - y || runTitle(a, works.get(a.workId ?? "")).localeCompare(runTitle(b, works.get(b.workId ?? "")), "ko");
      }),
    }));
}

/** OTT 줄 글자(공개일 마름모·월 단위 괄호 옆 제목·기간·회차 / 출연자)가 차지하는 가로 길이(px, 대략) — 줄 쌓기에 쓴다. 출연자는 4명까지만 쓴다. */
export const OTT_CAST_MAX = 4;
export function ottLabelPx(run: RunDto, work: WorkDto | undefined): number {
  const eps = episodeText(run, work);
  const line1 = `${runTitle(run, work)} ${[periodText(run), eps].filter(Boolean).join(", ")}`;
  const line2 = [eps, (work?.cast ?? []).slice(0, OTT_CAST_MAX).join(", ")].filter(Boolean).join(" · ");
  return Math.min(340, Math.max(textWidth(line1, 14), textWidth(line2, 12.5)) + 30);
}

export const slotTime = (s: SlotDto) => {
  if (s.startMinute === null) return s.timeNote ?? "";
  const h = Math.floor(s.startMinute / 60) % 24;
  const m = s.startMinute % 60;
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return s.timeNote && /·/.test(s.timeNote) ? s.timeNote : t;
};

/** 한 줄 안 겹침 배치 — 마름모(단발·행사)는 연속 편성과 겹치면 위 얇은 행사 줄로, 연속 편성끼리 겹치면 줄을 늘린다. */
export function assignLanes(runs: RunDto[], opts?: { labelDays?: (r: RunDto) => number }): { main: RunDto[][]; events: RunDto[] } {
  const spans = runs.filter((r) => r.draw);
  if (opts?.labelDays) {
    // OTT 줄 — 공개일 마름모·월 단위 괄호도 제목 글자만큼 자리를 차지하므로 막대와 같이 줄에 쌓는다(겹치면 줄을 늘림, 위 행사 줄 없음).
    const label = opts.labelDays;
    const end = (r: RunDto) => {
      const d = r.draw!;
      if (d.shape !== "diamond" && d.shape !== "bracket") return d.to; // 마름모·월 단위 괄호는 글자가 더 길면 글자만큼 자리를 잡는다
      const t = addDaysIso(d.from, label(r));
      return t > d.to ? t : d.to;
    };
    const sorted = [...spans].sort((a, b) => (a.draw!.from < b.draw!.from ? -1 : a.draw!.from > b.draw!.from ? 1 : 0));
    const stacked: RunDto[][] = [];
    for (const r of sorted) {
      const lane = stacked.find((l) => l.every((x) => end(x) < r.draw!.from || x.draw!.from > end(r)));
      if (lane) lane.push(r);
      else stacked.push([r]);
    }
    if (stacked.length === 0) stacked.push([]);
    return { main: stacked, events: [] };
  }
  const bars = spans.filter((r) => r.draw!.shape !== "diamond").sort((a, b) => (a.draw!.from < b.draw!.from ? -1 : 1));
  const diamonds = spans.filter((r) => r.draw!.shape === "diamond");
  const lanes: RunDto[][] = [];
  for (const r of bars) {
    const lane = lanes.find((l) => l.every((x) => x.draw!.to < r.draw!.from || x.draw!.from > r.draw!.to));
    if (lane) lane.push(r);
    else lanes.push([r]);
  }
  if (lanes.length === 0) lanes.push([]);
  const events: RunDto[] = [];
  for (const d of diamonds) {
    const overlaps = bars.some((b) => b.draw!.from <= d.draw!.to && d.draw!.from <= b.draw!.to);
    if (overlaps) events.push(d);
    else lanes[0].push(d);
  }
  return { main: lanes, events };
}

// ── 주소 쿼리(화면·인쇄·엑셀 공용) ──
export type Paper = "A4" | "A3";
export interface LineupQuery {
  view: ViewMode;
  from: string; // YYYY-MM
  len: number; // 3 | 6 | 8 | 12개월
  channels: string[];
  genres: Genre[];
  dows: number[];
  density: Density;
  paper: Paper;
  // 캘린더 보기(2026-11-25) — 한 달(month) 또는 임의 기간(dfrom~dto, 최대 42일), 끈 표시 층(hide)
  month: string; // YYYY-MM
  dfrom: string | null;
  dto: string | null;
  hide: string[]; // own | rival | ott | event
  can: string | null; // 방영 가능 일시를 볼 자사 채널 코드(홀드백, 캘린더)
  show: string[]; // 자사 방송일 보기: first(첫방) | end(종영일) | all(전체 방영일). 비면 자사 작품을 그리지 않는다
  // 2026-11-26 리디자인
  st: RunStatus[]; // 편성 상태 거르기(빈 배열 = 전부)
  out: string[]; // 경쟁 방송사·OTT 코드 거르기(빈 배열 = 전부)
  q: string; // 검색(작품명·출연진·이벤트명)
  cmp: CompareMode; // 경쟁 비교 묶음 기준
  cv: "month" | "week"; // 캘린더 월간·주간
  empty: boolean; // 자료 없는 자사 채널도 보이기
}
export const LENGTHS = [3, 6, 8, 12];
/** 직접 지정 기간 상한(개월) */
export const MAX_LEN = 24;
const STATUS_SET = new Set(["confirmed", "planned", "tentative"]);
const GENRE_SET = new Set(["drama", "variety", "business", "other"]);
const listOf = (v: string | null | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** 주소 쿼리 → 보기 조건. 잘못된 값은 기본값으로(기본: KT ENA, 지난달부터 8개월, 장르 전체, 밀도 넉넉). */
export function parseLineupQuery(get: (k: string) => string | null | undefined, defaultFrom: string): LineupQuery {
  const viewQ = get("view");
  const view: ViewMode = viewQ === "compare" || viewQ === "list" || viewQ === "calendar" ? viewQ : "own";
  const showRaw = get("show");
  const isYm = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const fromQ = get("from");
  const lenQ = Number(get("len"));
  const densityQ = get("density");
  const genres = listOf(get("genre")).filter((g) => GENRE_SET.has(g)) as Genre[];
  const cmpQ = get("cmp");
  return {
    view,
    from: fromQ && /^\d{4}-\d{2}$/.test(fromQ) ? fromQ : defaultFrom,
    // 3·6·8·12개월 + 직접 지정(1~24개월)
    len: Number.isInteger(lenQ) && lenQ >= 1 && lenQ <= MAX_LEN ? lenQ : 8,
    channels: listOf(get("ch")).map((c) => c.toUpperCase()).filter((c) => /^[A-Z_]{2,12}$/.test(c)),
    // 장르 기본 = 전체(2026-11-25: 타사 예능·교양 신작이 들어와 경쟁 비교도 전체가 기본). 옛 링크의 genre=all도 전체로 읽는다.
    genres: get("genre") === "all" ? [] : genres,
    dows: listOf(get("dow")).map(Number).filter((d) => d >= 1 && d <= 7),
    density: densityQ === "compact" ? "compact" : "comfy", // 기본 = 넉넉(모든 보기, 사용자 요청 2026-11-25)
    paper: get("paper") === "A3" ? "A3" : "A4",
    // 캘린더 기본 월 = 이번 달(기본 시작 월 defaultFrom은 지난달)
    month: isYm(get("month")) ? (get("month") as string) : addMonthsYm(defaultFrom, 1),
    dfrom: isDay(get("dfrom")) && isDay(get("dto")) ? (get("dfrom") as string) : null,
    dto: isDay(get("dfrom")) && isDay(get("dto")) ? (get("dto") as string) : null,
    hide: listOf(get("hide")).filter((h) => ["own", "rival", "ott", "event"].includes(h)),
    can: /^[A-Z_]{2,12}$/.test((get("can") ?? "").toUpperCase()) ? (get("can") as string).toUpperCase() : null,
    // 캘린더 기본 = 주요 일정(자사 첫방·종영, 2026-11-26 리디자인). 전체 회차는 '자사 편성'·'전체 일정'에서.
    show: showRaw === "none" ? [] : listOf(showRaw).filter((h) => ["first", "end", "all"].includes(h)).length > 0 ? listOf(showRaw).filter((h) => ["first", "end", "all"].includes(h)) : [...DEFAULT_SHOW],
    st: listOf(get("st")).filter((s) => STATUS_SET.has(s)) as RunStatus[],
    out: listOf(get("out")).map((c) => c.toUpperCase()).filter((c) => /^[A-Z0-9_]{2,16}$/.test(c)),
    q: (get("q") ?? "").slice(0, 60),
    cmp: cmpQ === "time" || cmpQ === "genre" || cmpQ === "all" ? cmpQ : "dow",
    cv: get("cv") === "week" ? "week" : "month",
    empty: get("empty") === "1",
  };
}
/** 캘린더 자사 방송일 기본 보기 — 주요 일정(첫방·종영). */
export const DEFAULT_SHOW = ["first", "end"] as const;
const isDefaultShow = (show: string[]) => show.length === DEFAULT_SHOW.length && DEFAULT_SHOW.every((x) => show.includes(x));

/** 보기 조건 → 주소 쿼리 문자열(기본값은 뺀다). */
export function lineupSearch(q: Partial<LineupQuery>, defaultFrom: string): string {
  const s = new URLSearchParams();
  if (q.view && q.view !== "own") s.set("view", q.view);
  if (q.from && q.from !== defaultFrom) s.set("from", q.from);
  if (q.len && q.len !== 8) s.set("len", String(q.len));
  if (q.channels?.length) s.set("ch", q.channels.join(","));
  if (q.genres?.length) s.set("genre", q.genres.join(","));
  if (q.dows?.length) s.set("dow", q.dows.join(","));
  if (q.density === "compact") s.set("density", "compact");
  if (q.paper && q.paper !== "A4") s.set("paper", q.paper);
  if (q.st?.length) s.set("st", q.st.join(","));
  if (q.out?.length) s.set("out", q.out.join(","));
  if (q.q?.trim()) s.set("q", q.q.trim());
  if (q.view === "compare" && q.cmp && q.cmp !== "dow") s.set("cmp", q.cmp);
  if (q.empty) s.set("empty", "1");
  if (q.hide?.length && q.view !== "calendar") s.set("hide", q.hide.join(","));
  if (q.view === "calendar") {
    // 캘린더는 기간을 주소에 남긴다. 기본 월(이번 달)이면 뺀다. defaultFrom이 비어 있으면(저장·인쇄 창) 늘 싣는다.
    if (q.dfrom && q.dto) {
      s.set("dfrom", q.dfrom);
      s.set("dto", q.dto);
    } else if (q.month && (!defaultFrom || q.month !== addMonthsYm(defaultFrom, 1))) s.set("month", q.month);
    if (q.hide?.length) s.set("hide", q.hide.join(","));
    if (q.can) s.set("can", q.can);
    if (q.show && !isDefaultShow(q.show)) s.set("show", q.show.length ? q.show.join(",") : "none");
    if (q.cv === "week") s.set("cv", "week");
  }
  return s.toString();
}

/** 시작 월·길이 → 날짜 범위. */
export function queryRange(from: string, len: number): { from: string; to: string } {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7)) - 1;
  return { from: `${from}-01`, to: new Date(Date.UTC(y, m + len, 0)).toISOString().slice(0, 10) };
}

/** 지난달(YYYY-MM) — 기본 시작 월. */
export function lastMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 2;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** 조건 한 줄 요약(인쇄 머리·엑셀 제목) — 채널 이름은 호출부가 코드→이름으로 바꿔 넘긴다. */
export function conditionText(q: LineupQuery, channelNames: string[]): string {
  const viewName = q.view === "compare" ? "경쟁 비교" : q.view === "list" ? "목록" : q.view === "calendar" ? "캘린더" : "KT ENA";
  const parts = [viewName];
  parts.push(q.view === "compare" || q.view === "calendar" ? `기준 채널 ${channelNames.length ? channelNames.join("·") : "ENA"}` : channelNames.length ? `채널 ${channelNames.join("·")}` : "라인업 있는 채널 전부");
  if (q.genres.length) parts.push(`장르 ${q.genres.map((g) => GENRE_LABEL[g]).join("·")}`);
  if (q.dows.length) parts.push(`요일 ${dowLabel([...q.dows].sort())}`);
  if (q.view === "compare" && q.cmp && q.cmp !== "dow") parts.push(`묶음 ${COMPARE_MODES.find((m) => m.key === q.cmp)?.label ?? ""}`);
  if (q.st?.length) parts.push(`상태 ${q.st.map((s) => STATUS_LABEL[s]).join("·")}`);
  if (q.out?.length) parts.push(`방송사 ${q.out.length}곳`);
  if (q.q?.trim()) parts.push(`검색 '${q.q.trim()}'`);
  return parts.join(" · ");
}

/**
 * 작품 상세의 관련 정보(2026-11-26 리디자인, 지시문 §6·§9) — 서버가 준 자료만으로 고른다(점수·예측 없음).
 * - 동시간대 맞대결: 서버 계산(run.rivals — 같은 요일·시작 ±60분·기간 겹침, 시각이 확인된 자리만)
 * - 같은 장르 기간 중첩: 다른 방송사의 같은 장르 연속 편성 중 방송 기간이 겹치는 것(시각 무관)
 * - 가까운 첫방: 다른 방송사·OTT 작품 중 첫방(공개)일이 이 작품 첫방 ±14일
 * - OTT 공개: 방송 기간 안에 공개일이 확정된 OTT 작품
 */
export function relatedFor(data: LineupPayload, run: RunDto): { rivals: RunDto[]; overlap: RunDto[]; nearby: RunDto[]; ott: RunDto[] } {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const mySlot = slots.get(run.slotId);
  const myOutlet = mySlot ? outlets.get(mySlot.outletId) : undefined;
  const genre = runGenre(run, run.workId ? works.get(run.workId) : undefined, mySlot);
  const from = run.startDate;
  const to = run.endDate ?? run.draw?.to ?? run.startDate;
  const byStart = (a: RunDto, b: RunDto) => ((a.startDate ?? "") < (b.startDate ?? "") ? -1 : 1);
  const rivals = run.rivals.map((id) => data.runs.find((r) => r.id === id)).filter((r): r is RunDto => !!r).sort(byStart);
  const taken = new Set([run.id, ...rivals.map((r) => r.id)]);
  if (!from || !to) return { rivals, overlap: [], nearby: [], ott: [] };
  const others = data.runs.filter((r) => {
    if (taken.has(r.id) || !r.workId || !r.startDate) return false;
    const s = slots.get(r.slotId);
    const o = s ? outlets.get(s.outletId) : undefined;
    return !!o && o.id !== myOutlet?.id;
  });
  const outletOf = (r: RunDto) => outlets.get(slots.get(r.slotId)?.outletId ?? "");
  const endOf = (r: RunDto) => r.endDate ?? r.draw?.to ?? r.startDate ?? "";
  const overlap = others
    .filter((r) => !outletOf(r)?.ott && r.runKind === "series" && runGenre(r, works.get(r.workId ?? ""), slots.get(r.slotId)) === genre && (r.startDate as string) <= to && endOf(r) >= from)
    .sort(byStart)
    .slice(0, 8);
  const near = new Set(overlap.map((r) => r.id));
  const dist = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
  const nearby = others
    .filter((r) => !near.has(r.id) && r.startPrecision !== "month" && dist(r.startDate as string, from) <= 14)
    .sort((a, b) => dist(a.startDate as string, from) - dist(b.startDate as string, from))
    .slice(0, 6);
  const ott = others
    .filter((r) => outletOf(r)?.ott && r.startPrecision === "day" && (r.startDate as string) >= from && (r.startDate as string) <= to)
    .sort(byStart)
    .slice(0, 8);
  return { rivals, overlap, nearby, ott };
}

/** 작품 메모 표시 — 업로드가 남긴 '제작진(원문): 연출/작가'는 '제작 : 연출 / 작가'로(사용자 지시 2026-11-25). 그 밖은 '메모'. */
export function workNote(note: string | null | undefined): { label: string; text: string } | null {
  if (!note?.trim()) return null;
  const m = note.match(/^제작진\(원문\):\s*([\s\S]*)$/);
  if (m) return { label: "제작", text: m[1].replace(/\s*\/\s*/g, " / ").trim() };
  return { label: "메모", text: note.trim() };
}
