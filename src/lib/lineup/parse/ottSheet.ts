// 라인업 OTT 양식(한 줄 = 한 작품) 읽기 — 2026-11-25 사용자 제공 'OTT 전체' 시트(신문·보도자료로 모은 OTT 플랫폼 공개 일정).
// 머리 이름으로 열을 찾는다: OTT 플랫폼 · 작품명 · 분류 · 확정수준 · 공개 시기 · 첫 공개일 · 공개 시각 · 총 편수 · 주요 출연진·패널 ·
// 공개 방식·요일 · 유통·제작 유형 · 확인사항·비고 · 근거 URL 1·2 · 자료 확인일. 없는 열은 비워 둔다.
//
// OTT는 방송 요일·시각 자리가 없다 → 플랫폼마다 자리 하나('공개 일정')에 공개 구간을 모두 놓는다(경쟁 비교의 맨 아래 'OTT' 묶음).
// 공개 형태(공개 방식·요일 글자에서):
//   전편 공개·전 세계 공개·동시 공개 → 단발(공개일 마름모)
//   'M/D … → M/D …'처럼 날짜가 둘 이상 → 분할 공개(여러 날 마름모)
//   '매주 O요일' → 연속 편성(막대). 총 편수와 첫날 공개 회차로 끝을 계산, 종영일이 적혀 있으면 그 날짜. 편수 모르면 끝 미정(계속)
//   그 밖(첫 공개일만 아는 경우) → 단발(첫 공개일). 이후 공개 방식은 작품 메모에 원문으로 남긴다.
// 시기는 정밀도대로: 날짜 → 하루, '2026년 12월' → 월, '2027년 상반기'·'2027년' → 월 단위 범위. '일정미정'·시기 미발표는 날짜 없이 둔다
// (원자료가 "시기 추정 금지"라 하므로 어떤 날짜도 지어내지 않는다).
import { addDays, monthEnd } from "../dates";
import { titleKey } from "../titles";
import type { EndPrecision, Genre, ParsedItem, ParsedLineup, ParsedRun, RunKind } from "../types";
import { outletKey } from "./industrySheet";
import { asOfFromFileName } from "./ownSheet";
import { readWorkbook, Sheet } from "./sheet";

const COLS = {
  platform: ["OTT 플랫폼", "플랫폼", "OTT"],
  title: ["작품명", "제목", "프로그램"],
  kind: ["분류", "장르"],
  certainty: ["확정수준", "확정도"],
  period: ["공개 시기", "공개시기"],
  date: ["첫 공개일(YYYY-MM-DD)", "첫 공개일", "공개일"],
  time: ["공개 시각(KST)", "공개 시각"],
  episodes: ["총 편수", "편수"],
  cast: ["주요 출연진·패널", "주요 출연진", "출연진"],
  mode: ["공개 방식·요일", "공개 방식"],
  type: ["유통·제작 유형", "제작 유형"],
  memo: ["확인사항·비고", "비고"],
  url1: ["근거 URL 1"],
  url2: ["근거 URL 2"],
  asOf: ["자료 확인일", "확인일"],
} as const;
type ColKey = keyof typeof COLS;

const norm = (s: string) => s.replace(/\s+/g, "");
const isoOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 분류 → 막대 색 대분류. 시트콤은 극본형이라 드라마 색, 다큐·음악·교양은 '교양·기타'(예능이라고 적힌 것은 예능). */
export function ottGenre(kind: string): Genre {
  if (/예능/.test(kind)) return "variety";
  if (/드라마|시트콤/.test(kind)) return "drama";
  if (/다큐|교양|음악/.test(kind)) return "other";
  return "variety";
}

/** 출연진 → 이름 목록. 외국인 이름의 띄어쓰기는 살리고, '미발표'·'모집 중' 같은 설명 조각과 '등'·'외 미공개'는 뺀다. */
export function splitOttCast(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const raw of text.replace(/\([^)]*\)/g, "").split(/[·,/、]/)) {
    const piece = raw.replace(/\s*외\s*(?:미공개|미발표)?\s*$/, "").replace(/\s*등\s*$/, "").trim();
    if (!piece || piece.length > 24) continue;
    if (/미발표|미공개|미정|확인|모집|참가자|참가국|출연진|일반인|선수/.test(piece)) continue;
    out.push(piece);
  }
  return [...new Set(out)];
}

/** '가상 제목 (Fake Title)' → 제목 '가상 제목' + 원제, '가상극(가제)' → 가제. 한글 괄호('(실사)', '(최종)')는 제목의 일부로 둔다. */
export function splitOttTitle(raw: string): { title: string; original: string | null; tentative: boolean } {
  let t = raw.trim();
  let tentative = false;
  if (/\(가제\)\s*$/.test(t)) {
    tentative = true;
    t = t.replace(/\s*\(가제\)\s*$/, "");
  }
  const m = t.match(/^(.*?)\s*\(([A-Za-z][A-Za-z0-9 .,'’:!&-]*)\)\s*$/);
  if (m && m[1].trim()) return { title: m[1].trim(), original: m[2].trim(), tentative };
  return { title: t, original: null, tentative };
}

interface When {
  start: string | null;
  end: string | null;
  startPrecision: "day" | "month" | "unknown";
  endPrecision: EndPrecision;
  startText: string | null;
  note: string | null; // 읽지 못한 글자(확인 필요)
}

/** 첫 공개일·공개 시기·확정수준 → 시작·끝과 정밀도. 일정 미정이면 날짜 없음. */
export function parseOttWhen(period: string, dateCell: string, certainty: string): When {
  const none: When = { start: null, end: null, startPrecision: "unknown", endPrecision: "unknown", startText: null, note: null };
  if (/일정\s*미정/.test(certainty)) return none;
  const iso = dateCell.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) {
    const d = isoOf(+iso[1], +iso[2], +iso[3]);
    return { start: d, end: null, startPrecision: "day", endPrecision: "unknown", startText: d, note: null };
  }
  const p = period.trim();
  if (!p || /미발표|미정/.test(p)) return none;
  let m = p.match(/(20\d{2})\s*년?\s*(\d{1,2})\s*월/);
  if (m) {
    const start = isoOf(+m[1], +m[2], 1);
    return { start, end: monthEnd(start), startPrecision: "month", endPrecision: "month", startText: `${m[1]}년 ${+m[2]}월`, note: null };
  }
  m = p.match(/(20\d{2})\s*년?\s*(상반기|하반기)/);
  if (m) {
    const y = +m[1];
    const first = m[2] === "상반기";
    return { start: isoOf(y, first ? 1 : 7, 1), end: isoOf(y, first ? 6 : 12, first ? 30 : 31), startPrecision: "month", endPrecision: "month", startText: `${y}년 ${m[2]}`, note: null };
  }
  m = p.match(/^(20\d{2})\s*년?(?:\s*예정)?$/);
  if (m) return { start: isoOf(+m[1], 1, 1), end: isoOf(+m[1], 12, 31), startPrecision: "month", endPrecision: "month", startText: `${m[1]}년`, note: null };
  return { ...none, note: `공개 시기 '${p}'를 읽지 못함` };
}

interface Cadence {
  runKind: RunKind;
  end: string | null;
  endPrecision: EndPrecision;
  airDates: string[] | null;
  recurrence: string | null;
}

/** 날짜가 하루로 정해진 작품의 공개 방식 글자 → 형태·끝. 위 머리말 규칙 참고. */
export function parseOttCadence(mode: string, start: string, episodes: number | null): Cadence {
  // ① 날짜가 둘 이상(예: '12/11 1~8화 → 12/18 9~15화 → 12/25 16~22화') → 분할 공개
  const year = Number(start.slice(0, 4));
  const dates = new Set<string>();
  for (const t of mode.matchAll(/(\d{1,2})\/(\d{1,2})/g)) {
    let d = isoOf(year, +t[1], +t[2]);
    if (d < start) d = isoOf(year + 1, +t[1], +t[2]);
    dates.add(d);
  }
  const list = [...dates].sort();
  if (list.length >= 2 && list[0] === start) return { runKind: "multi_day", end: list[list.length - 1], endPrecision: "day", airDates: list, recurrence: "분할 공개" };
  // ② 전편 공개
  if (/전편|전\s*세계\s*공개|동시\s*공개|일괄/.test(mode)) return { runKind: "single", end: start, endPrecision: "day", airDates: null, recurrence: null };
  // ③ 매주 O요일 → 연속 편성
  const weekly = mode.match(/매주\s*([월화수목금토일])/);
  if (weekly) {
    const recurrence = `매주 ${weekly[1]}요일`;
    const explicit = mode.match(/(20\d{2}-\d{2}-\d{2})\s*종영/);
    if (explicit && explicit[1] >= start) return { runKind: "series", end: explicit[1], endPrecision: "day", airDates: null, recurrence };
    // 첫날 공개 회차(예: '1/6 2화, 이후 매주 수요일' → 2화, 없으면 1화)
    const firstEps = Number(mode.match(/(\d+)\s*화/)?.[1] ?? 1);
    if (episodes && episodes > 0) return { runKind: "series", end: addDays(start, 7 * Math.max(0, episodes - Math.max(1, firstEps))), endPrecision: "day", airDates: null, recurrence };
    return { runKind: "series", end: null, endPrecision: "open", airDates: null, recurrence };
  }
  // ④ 첫 공개일만 아는 경우 — 공개일 하나로 두고, 이후 방식은 메모에 원문으로
  return { runKind: "single", end: start, endPrecision: "day", airDates: null, recurrence: "첫 공개일만 확인" };
}

export function parseOttLineupXlsx(buf: Buffer, opts: { fileName?: string; outletAliases: Map<string, string> }): ParsedLineup {
  const wb = readWorkbook(buf);
  const items: ParsedItem[] = [];
  const warnings: string[] = [];
  let asOf: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  const unknown = new Set<string>();

  for (const name of wb.sheetNames) {
    const sh = wb.sheet(name);
    if (!sh) continue;
    let head = -1;
    const col: Partial<Record<ColKey, number>> = {};
    for (let r = 0; r < Math.min(sh.rows, 10) && head < 0; r++) {
      const cells = Array.from({ length: sh.cols }, (_, c) => norm(sh.text(r, c)));
      const find = (names: readonly string[]) => cells.findIndex((x) => names.some((n) => x === norm(n) || x.startsWith(norm(n))));
      if (find(COLS.platform) >= 0 && find(COLS.title) >= 0) {
        head = r;
        for (const k of Object.keys(COLS) as ColKey[]) {
          const i = find(COLS[k]);
          if (i >= 0) col[k] = i;
        }
      }
    }
    if (head < 0) continue;
    const get = (r: number, k: ColKey) => (col[k] === undefined ? "" : sh.text(r, col[k] as number));

    for (let r = head + 1; r < sh.rows; r++) {
      const platformLabel = get(r, "platform");
      const rawTitle = get(r, "title");
      if (!platformLabel || !rawTitle) continue;
      const code = opts.outletAliases.get(outletKey(platformLabel)) ?? null;
      if (!code) unknown.add(platformLabel);
      const checked = get(r, "asOf").match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
      if (checked) {
        const d = isoOf(+checked[1], +checked[2], +checked[3]);
        if (!asOf || d > asOf) asOf = d;
      }

      const { title, original, tentative } = splitOttTitle(rawTitle);
      const kindText = get(r, "kind");
      const certainty = get(r, "certainty");
      const mode = get(r, "mode");
      const memo = get(r, "memo");
      const epNum = get(r, "episodes").match(/(\d+)\s*(?:부작|부|회|편)/);
      const episodes = epNum ? Number(epNum[1]) : null;
      const genre = ottGenre(kindText);
      const when = parseOttWhen(get(r, "period"), get(r, "date"), certainty);

      let cadence: Cadence = { runKind: "series", end: when.end, endPrecision: when.endPrecision, airDates: null, recurrence: null };
      if (when.startPrecision === "day" && when.start) cadence = parseOttCadence(mode, when.start, episodes);
      const status: ParsedRun["status"] = /확정$/.test(certainty) ? "confirmed" : "planned";

      const time = get(r, "time");
      const noteLines = [
        mode && !/^(?:전\s*세계\s*)?공개\s*(?:방식|시기)\s*(?:미발표|미정)$/.test(mode) && `공개 방식 : ${mode}`, // '공개 방식 미발표'는 알려 주는 정보가 없어 뺀다
        time && `공개 시각 : ${time} (KST)`,
        kindText && !/^(드라마|예능)$/.test(kindText) && `분류 : ${kindText}`,
        get(r, "type") && `유형 : ${get(r, "type")}`,
        memo && `비고 : ${memo}`,
        original && `원제 : ${original}`,
        certainty && !/^날짜확정$/.test(certainty) && `확정 수준 : ${certainty}`,
      ].filter((x): x is string => !!x);

      const reviewNotes: string[] = [];
      if (!code) reviewNotes.push(`플랫폼 표기 '${platformLabel}'를 알아보지 못함`);
      if (when.note) reviewNotes.push(when.note);

      items.push({
        outletCode: code,
        outletLabel: platformLabel,
        slot: { name: "공개 일정", days: [1, 2, 3, 4, 5, 6, 7], startMinute: null, timeNote: null, compareBlock: "other", defaultGenre: "other" },
        work: {
          title,
          titleKey: titleKey(title),
          tentative,
          genre,
          totalEpisodes: episodes,
          cast: splitOttCast(get(r, "cast")),
          credits: null,
          ottNote: null,
          note: noteLines.join("\n") || null,
        },
        run: {
          runKind: cadence.runKind,
          status,
          startDate: when.start,
          startPrecision: when.start ? when.startPrecision : "unknown",
          endDate: cadence.end,
          endPrecision: when.start ? cadence.endPrecision : "unknown",
          startText: when.startText,
          endText: null,
          episodes,
          episodeFrom: null,
          recurrence: cadence.recurrence,
          airDates: cadence.airDates,
          label: null,
          reason: null,
          sourceCell: `${name}!${Sheet.cellName(r, 0)}`,
          sourceText: [platformLabel, rawTitle, certainty, get(r, "period"), get(r, "date"), get(r, "url1"), get(r, "url2")].filter(Boolean).join(" | "),
          needsReview: reviewNotes.length > 0,
          reviewNote: reviewNotes.join(" · ") || null,
        },
      });
      if (when.start) {
        if (!from || when.start < from) from = when.start;
        const last = cadence.end ?? when.start;
        if (!to || last > to) to = last;
      }
    }
  }
  for (const o of unknown) warnings.push(`플랫폼 표기 '${o}'를 기준표에서 찾지 못했습니다(확인 필요로 표시).`);
  const undated = items.filter((i) => !i.run.startDate).length;
  if (undated > 0) warnings.push(`공개 시기를 알 수 없는 작품 ${undated}건은 날짜 없이 '공개 시기 미정'으로 넣습니다(날짜를 짐작하지 않음).`);
  if (items.length === 0) warnings.push("읽은 항목이 없습니다. OTT 양식(OTT 플랫폼·작품명 머리)이 맞는지 확인해 주세요.");
  return {
    kind: "outlet_xlsx",
    title: "OTT 라인업",
    asOf: asOf ?? asOfFromFileName(opts.fileName ?? ""),
    changeNote: null,
    period: from && to ? { from, to } : null,
    items,
    warnings,
  };
}
