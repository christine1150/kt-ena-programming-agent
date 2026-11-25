// 라인업 화면 배치 도우미(그리기 전용, 화면·인쇄·엑셀 공용) — 수치(맞대결·빈 주·자리 점유 끝)는 서버가 계산해 주고, 여기서는 줄·칸·위치만 정한다.
import type { CompareBlock, Genre, LineupPayload, OutletDto, RunDto, SlotDto, WorkDto } from "@/lib/lineup/types";

export type ViewMode = "own" | "compare" | "list";
export type Density = "comfy" | "compact";

export const GENRE_LABEL: Record<Genre, string> = { drama: "드라마", variety: "예능", business: "사업형", other: "교양·기타" };
/**
 * 장르 = 채움색(막대는 이 색을 옅게 깐 음영 + 왼쪽 띠·테두리). 2026-11-25 사용자 지시: 앱 차트색(보라·청록)이 안 예뻐서
 * 편성센터 라인업의 드라마 분홍(#E0367F)·예능 남색(#3830E0)을 쓰고, 사업형·기타는 두 색과 어울리는 호박색·모래색으로.
 * 회색은 여전히 '작품 정보 없음'(미정·휴방·수급) 전용이다.
 */
export const GENRE_HEX: Record<Genre, string> = { drama: "#e0367f", variety: "#3830e0", business: "#e8930c", other: "#a07c55" };
export const GENRE_VAR: Record<Genre, string> = GENRE_HEX;
export const BLOCK_LABEL: Record<CompareBlock, string> = { mon_tue: "월화", wed_thu: "수목", weekend: "주말 (금·토·일)", other: "그 밖" };
export const BLOCK_ORDER: CompareBlock[] = ["mon_tue", "wed_thu", "weekend", "other"];
const DOW = ["월", "화", "수", "목", "금", "토", "일"];
export const dowLabel = (days: number[]) => days.map((d) => DOW[d - 1]).join("");
export const STATUS_LABEL = { confirmed: "확정", planned: "예정", tentative: "가안" } as const;
export const KIND_LABEL: Record<RunDto["runKind"], string> = {
  series: "연속 편성", monthly: "월 1회", single: "단발", multi_day: "행사(여러 날)", tbd: "미정 자리", hiatus: "휴방·결방", filler: "수급물",
};

export const LAYOUT = {
  // 막대는 늘 2줄(제목·기간·회차 / 출연자, 사용자 요청 2026-11-25)이라 촘촘도 2줄이 들어가는 높이로 둔다.
  comfy: { row: 48, bar: 40, event: 16 },
  compact: { row: 38, bar: 32, event: 14 },
  label: { own: { comfy: 184, compact: 152 }, compare: { comfy: 224, compact: 192 } },
  minWeekPx: 20,
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
}

export interface Filters {
  channels: string[]; // 자사 채널 코드(빈 배열 = 라인업이 있는 채널 전부)
  genres: Genre[]; // 빈 배열 = 전부
  dows: number[]; // 빈 배열 = 전부
}

function runMatches(run: RunDto, slot: SlotDto, f: Filters, works: Map<string, WorkDto>) {
  const g = runGenre(run, run.workId ? works.get(run.workId) : undefined, slot);
  if (f.genres.length > 0 && !f.genres.includes(g)) return false;
  return true;
}

const slotMatchesDow = (slot: SlotDto, f: Filters) => f.dows.length === 0 || slot.days.some((d) => f.dows.includes(d));

/** 자사 라인업 줄: 채널 묶음(A·B) > 채널 > 장르 > 자리. 라인업이 없는 채널은 숨긴다. */
export function buildOwnRows(data: LineupPayload, f: Filters): { rows: Row[]; runsBySlot: Map<string, RunDto[]>; hiddenChannels: string[] } {
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
      if (oSlots.length === 0) {
        hidden.push(o.name);
        continue;
      }
      groupRows.push({ key: `o:${o.id}`, kind: "subgroup", label: o.name, outlet: o, color: o.color });
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
          groupRows.push({ key: `s:${s.id}`, kind: "slot", label: s.name, sublabel: i === 0 ? GENRE_LABEL[g] : undefined, outlet: o, slot: s, color: o.color })
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
/** 경쟁 비교 줄: 묶음(월화·수목·주말·그 밖) > [선택 자사 채널 자리 고정] > 타사 자리(요일 칩 → 방송사 순). */
export function buildCompareRows(data: LineupPayload, f: Filters): { rows: Row[]; runsBySlot: Map<string, RunDto[]> } {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const runsBySlot = new Map<string, RunDto[]>();
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  for (const r of data.runs) {
    const slot = slots.get(r.slotId);
    if (!slot || !runMatches(r, slot, f, works)) continue;
    const arr = runsBySlot.get(r.slotId) ?? [];
    arr.push(r);
    runsBySlot.set(r.slotId, arr);
  }
  const ownCodes = f.channels.length > 0 ? f.channels : ["ENA"];
  const genreOk = (s: SlotDto) => f.genres.length === 0 || f.genres.includes(s.defaultGenre);
  const rows: Row[] = [];
  for (const block of BLOCK_ORDER) {
    const bs = data.slots.filter((s) => s.compareBlock === block && slotMatchesDow(s, f));
    const own = bs
      .filter((s) => {
        const o = outlets.get(s.outletId);
        return o?.side === "own" && ownCodes.includes(o.code) && genreOk(s) && ((runsBySlot.get(s.id)?.length ?? 0) > 0 || s.defaultGenre === "drama");
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const rival = bs
      .filter((s) => outlets.get(s.outletId)?.side === "rival" && (runsBySlot.get(s.id)?.length ?? 0) > 0)
      .sort((a, b) => {
        const ca = DAYCHIP_ORDER(a.days);
        const cb = DAYCHIP_ORDER(b.days);
        if (ca !== cb) return ca.localeCompare(cb);
        const oa = outlets.get(a.outletId)?.sortOrder ?? 0;
        const ob = outlets.get(b.outletId)?.sortOrder ?? 0;
        return oa - ob || (a.startMinute ?? 0) - (b.startMinute ?? 0);
      });
    if (own.length === 0 && rival.length === 0) continue;
    rows.push({ key: `b:${block}`, kind: "group", label: BLOCK_LABEL[block] });
    if (own.length === 0) {
      const o = data.outlets.find((x) => x.code === ownCodes[0]);
      rows.push({ key: `e:${block}`, kind: "slot", label: o?.name ?? "자사", sublabel: "-", outlet: o, emphasis: true, empty: true, color: o?.color ?? null });
    }
    for (const s of own) {
      const o = outlets.get(s.outletId);
      rows.push({ key: `s:${s.id}`, kind: "slot", label: o?.name ?? "", sublabel: slotTime(s), chip: dowLabel(s.days), outlet: o, slot: s, emphasis: true, color: o?.color ?? null });
    }
    for (const s of rival) {
      const o = outlets.get(s.outletId);
      rows.push({ key: `s:${s.id}`, kind: "slot", label: o?.name ?? "", sublabel: slotTime(s), chip: dowLabel(s.days), outlet: o, slot: s, color: o?.color ?? null });
    }
  }
  return { rows, runsBySlot };
}

export const slotTime = (s: SlotDto) => {
  if (s.startMinute === null) return s.timeNote ?? "";
  const h = Math.floor(s.startMinute / 60) % 24;
  const m = s.startMinute % 60;
  const t = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return s.timeNote && /·/.test(s.timeNote) ? s.timeNote : t;
};

/** 한 줄 안 겹침 배치 — 마름모(단발·행사)는 연속 편성과 겹치면 위 얇은 행사 줄로, 연속 편성끼리 겹치면 줄을 늘린다. */
export function assignLanes(runs: RunDto[]): { main: RunDto[][]; events: RunDto[] } {
  const spans = runs.filter((r) => r.draw);
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
}
export const LENGTHS = [3, 6, 8, 12];
const GENRE_SET = new Set(["drama", "variety", "business", "other"]);
const listOf = (v: string | null | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** 주소 쿼리 → 보기 조건. 잘못된 값은 기본값으로(기본: KT ENA, 지난달부터 8개월, 장르 전체, 비교 보기는 촘촘). */
export function parseLineupQuery(get: (k: string) => string | null | undefined, defaultFrom: string): LineupQuery {
  const viewQ = get("view");
  const view: ViewMode = viewQ === "compare" || viewQ === "list" ? viewQ : "own";
  const fromQ = get("from");
  const lenQ = Number(get("len"));
  const densityQ = get("density");
  const genres = listOf(get("genre")).filter((g) => GENRE_SET.has(g)) as Genre[];
  return {
    view,
    from: fromQ && /^\d{4}-\d{2}$/.test(fromQ) ? fromQ : defaultFrom,
    len: LENGTHS.includes(lenQ) ? lenQ : 8,
    channels: listOf(get("ch")).map((c) => c.toUpperCase()).filter((c) => /^[A-Z_]{2,12}$/.test(c)),
    // 장르 기본 = 전체(2026-11-25: 타사 예능·교양 신작이 들어와 경쟁 비교도 전체가 기본). 옛 링크의 genre=all도 전체로 읽는다.
    genres: get("genre") === "all" ? [] : genres,
    dows: listOf(get("dow")).map(Number).filter((d) => d >= 1 && d <= 7),
    density: densityQ === "compact" || densityQ === "comfy" ? densityQ : view === "compare" ? "compact" : "comfy",
    paper: get("paper") === "A3" ? "A3" : "A4",
  };
}

/** 보기 조건 → 주소 쿼리 문자열(기본값은 뺀다). */
export function lineupSearch(q: Partial<LineupQuery>, defaultFrom: string): string {
  const s = new URLSearchParams();
  if (q.view && q.view !== "own") s.set("view", q.view);
  if (q.from && q.from !== defaultFrom) s.set("from", q.from);
  if (q.len && q.len !== 8) s.set("len", String(q.len));
  if (q.channels?.length) s.set("ch", q.channels.join(","));
  if (q.genres?.length) s.set("genre", q.genres.join(","));
  if (q.dows?.length) s.set("dow", q.dows.join(","));
  if (q.density && q.density !== (q.view === "compare" ? "compact" : "comfy")) s.set("density", q.density);
  if (q.paper && q.paper !== "A4") s.set("paper", q.paper);
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
  const viewName = q.view === "compare" ? "경쟁 비교" : q.view === "list" ? "목록" : "KT ENA";
  const parts = [viewName];
  parts.push(q.view === "compare" ? `기준 채널 ${channelNames.length ? channelNames.join("·") : "ENA"}` : channelNames.length ? `채널 ${channelNames.join("·")}` : "라인업 있는 채널 전부");
  if (q.genres.length) parts.push(`장르 ${q.genres.map((g) => GENRE_LABEL[g]).join("·")}`);
  if (q.dows.length) parts.push(`요일 ${dowLabel([...q.dows].sort())}`);
  return parts.join(" · ");
}

/** 작품 메모 표시 — 업로드가 남긴 '제작진(원문): 연출/작가'는 '제작 : 연출 / 작가'로(사용자 지시 2026-11-25). 그 밖은 '메모'. */
export function workNote(note: string | null | undefined): { label: string; text: string } | null {
  if (!note?.trim()) return null;
  const m = note.match(/^제작진\(원문\):\s*([\s\S]*)$/);
  if (m) return { label: "제작", text: m[1].replace(/\s*\/\s*/g, " / ").trim() };
  return { label: "메모", text: note.trim() };
}
