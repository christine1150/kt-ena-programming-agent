// 라인업 화면 배치 도우미(그리기 전용, 화면·인쇄·엑셀 공용) — 수치(맞대결·빈 주·자리 점유 끝)는 서버가 계산해 주고, 여기서는 줄·칸·위치만 정한다.
import { addMonths as addMonthsYm } from "@/lib/lineup/dates";
import type { CompareBlock, Genre, LineupPayload, OutletDto, RunDto, SlotDto, WorkDto } from "@/lib/lineup/types";

export type ViewMode = "own" | "compare" | "list" | "calendar";
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
  // 막대는 늘 2줄(제목·기간·회차 / 출연자, 사용자 요청 2026-11-25)이라 촘촘도 2줄이 들어가는 높이로 둔다.
  comfy: { row: 56, bar: 48, event: 18 }, // 가독성 개선(2026-11-25): 제목 14px + 둘째 줄 12.5px
  compact: { row: 46, bar: 40, event: 16 },
  label: { own: { comfy: 200, compact: 176 }, compare: { comfy: 248, compact: 224 } },
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
    // 공개 연도만 아는 OTT 작품은 1년 길이 괄호가 줄만 차지하므로 격자에서 빼고 격자 아래 '공개 시기 미정·연 단위' 목록에 둔다.
    if (outlets.get(slot.outletId)?.ott && isYearOnly(r)) continue;
    const arr = runsBySlot.get(r.slotId) ?? [];
    arr.push(r);
    runsBySlot.set(r.slotId, arr);
  }
  const ownCodes = f.channels.length > 0 ? f.channels : ["ENA"];
  const genreOk = (s: SlotDto) => f.genres.length === 0 || f.genres.includes(s.defaultGenre);
  const isOttSlot = (s: SlotDto) => !!outlets.get(s.outletId)?.ott;
  const rows: Row[] = [];
  for (const block of BLOCK_ORDER) {
    const bs = data.slots.filter((s) => !isOttSlot(s) && s.compareBlock === block && slotMatchesDow(s, f));
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
  // OTT 묶음(2026-11-25) — 방송 요일·시각이 없어 요일 묶음에 못 넣는다. 맨 아래에 플랫폼마다 한 줄(공개 일정). 요일을 거르면 요일이 없는 OTT는 뺀다.
  if (f.dows.length === 0) {
    const ott = data.slots
      .filter((s) => isOttSlot(s) && (runsBySlot.get(s.id) ?? []).some((r) => r.draw))
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
}
export const LENGTHS = [3, 6, 8, 12];
const GENRE_SET = new Set(["drama", "variety", "business", "other"]);
const listOf = (v: string | null | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** 주소 쿼리 → 보기 조건. 잘못된 값은 기본값으로(기본: KT ENA, 지난달부터 8개월, 장르 전체, 밀도 넉넉). */
export function parseLineupQuery(get: (k: string) => string | null | undefined, defaultFrom: string): LineupQuery {
  const viewQ = get("view");
  const view: ViewMode = viewQ === "compare" || viewQ === "list" || viewQ === "calendar" ? viewQ : "own";
  const isYm = (v: string | null | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
  const isDay = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
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
    density: densityQ === "compact" ? "compact" : "comfy", // 기본 = 넉넉(모든 보기, 사용자 요청 2026-11-25)
    paper: get("paper") === "A3" ? "A3" : "A4",
    // 캘린더 기본 월 = 이번 달(기본 시작 월 defaultFrom은 지난달)
    month: isYm(get("month")) ? (get("month") as string) : addMonthsYm(defaultFrom, 1),
    dfrom: isDay(get("dfrom")) && isDay(get("dto")) ? (get("dfrom") as string) : null,
    dto: isDay(get("dfrom")) && isDay(get("dto")) ? (get("dto") as string) : null,
    hide: listOf(get("hide")).filter((h) => ["own", "rival", "ott", "event"].includes(h)),
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
  if (q.density === "compact") s.set("density", "compact");
  if (q.paper && q.paper !== "A4") s.set("paper", q.paper);
  if (q.view === "calendar") {
    // 캘린더는 기간을 주소에 남긴다. 기본 월(이번 달)이면 뺀다. defaultFrom이 비어 있으면(저장·인쇄 창) 늘 싣는다.
    if (q.dfrom && q.dto) {
      s.set("dfrom", q.dfrom);
      s.set("dto", q.dto);
    } else if (q.month && (!defaultFrom || q.month !== addMonthsYm(defaultFrom, 1))) s.set("month", q.month);
    if (q.hide?.length) s.set("hide", q.hide.join(","));
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
  return parts.join(" · ");
}

/** 작품 메모 표시 — 업로드가 남긴 '제작진(원문): 연출/작가'는 '제작 : 연출 / 작가'로(사용자 지시 2026-11-25). 그 밖은 '메모'. */
export function workNote(note: string | null | undefined): { label: string; text: string } | null {
  if (!note?.trim()) return null;
  const m = note.match(/^제작진\(원문\):\s*([\s\S]*)$/);
  if (m) return { label: "제작", text: m[1].replace(/\s*\/\s*/g, " / ").trim() };
  return { label: "메모", text: note.trim() };
}
