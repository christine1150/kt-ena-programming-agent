// 라인업 표준 양식(한 줄 = 한 작품) 읽기 — 신문 기사·보도자료로 모은 타 채널 신작 목록(2026-11-25 사용자 제공 '신규_확정및예정').
// 머리 이름으로 열을 찾는다: 채널 · 프로그램 · 편성 구분 · 론칭/시작 시기 · 요일 · 본방 시각 · 총 편수 · 주요 출연진·진행 · 장르 ·
// 추가 내용·주의 · 출처 URL · 정보 근거 · 편성 확정도 · 조사 기준일 · 종영일(확인 시). 없는 열은 비워 둔다.
//
// 장르 대분류(막대 색)는 원자료 '장르'(세부)에서 정한다 — 사용자 지시(2026-11-25): "교양을 제외하고는 대부분 예능이나 음악".
//   드라마 → 드라마 / 다큐·교육·교양·시사·책, 그리고 KBS1·EBS의 음악 아닌 프로그램 → 교양(기타 색) / 그 밖(음악·토크·관찰·서바이벌 등) → 예능.
//   (확인: KBS1 '인생퀴즈'는 KBS가 '1TV 새 시사교양 프로그램'으로 소개, '억지로 독서 클럽'은 교양 프로그램 — 2026-11 보도)
//   세부 장르 원문은 작품 메모에 남긴다.
import { addDays, compareBlockOf, daysBetween, daysLabel, clockLabel, parseClock, parseDays } from "../dates";
import { titleKey } from "../titles";
import type { Genre, ParsedItem, ParsedLineup, ParsedRun } from "../types";
import { outletKey } from "./industrySheet";
import { asOfFromFileName } from "./ownSheet";
import { readWorkbook, Sheet } from "./sheet";

const COLS = {
  channel: ["채널", "방송사"],
  title: ["프로그램", "제목", "프로그램명"],
  kind: ["편성 구분", "구분"],
  start: ["론칭/시작 시기", "시작 시기", "첫방", "첫 방송"],
  dow: ["요일"],
  time: ["본방 시각", "시각", "방송 시각"],
  episodes: ["총 편수", "편수", "회차"],
  cast: ["주요 출연진·진행", "출연진", "주연", "출연"],
  genre: ["장르"],
  memo: ["추가 내용·주의", "비고", "메모"],
  url: ["출처 URL", "출처"],
  basis: ["정보 근거"],
  certainty: ["편성 확정도", "확정도"],
  asOf: ["조사 기준일", "기준일"],
  end: ["종영일(확인 시)", "종영일", "종료일"],
} as const;
type ColKey = keyof typeof COLS;

const norm = (s: string) => s.replace(/\s+/g, "");

/** 세부 장르·방송사 → 막대 색 대분류. */
export function standardGenre(detail: string, kind: string, outletCode: string | null): Genre {
  const t = `${detail} ${kind}`;
  if (/드라마/.test(t)) return "drama";
  if (/음악|가요|트로트|오디션|노래|콘서트/.test(t)) return "variety";
  if (/다큐|교육|교양|시사|책|강연|역사/.test(t)) return "other";
  if (outletCode === "KBS1" || (outletCode ?? "").startsWith("EBS")) return "other";
  return "variety";
}

/** 출연진 '김성주(MC)·안정환·황신혜 등 / 게스트…' → 이름 목록(괄호 설명·'등' 제거, 미정이면 빈 목록). */
export function splitCast(text: string): string[] {
  if (!text || /^미정/.test(text.trim())) return [];
  // 괄호 설명('(MC)', '(2차 기사, 확인 필요)')을 먼저 지우고 나눈다 — 괄호 안 쉼표로 잘못 나뉘지 않게.
  // 띄어쓰기가 든 조각('해외 전문가', 'AI 진행자')은 사람 이름이 아닌 설명이라 뺀다.
  return [
    ...new Set(
      text
        .replace(/\([^)]*\)/g, "")
        .split(/[·,/、]/)
        .map((s) => s.replace(/게스트/g, "").replace(/\s*등\s*$/, "").trim())
        .filter((s) => s.length >= 2 && s.length <= 12 && !/\s/.test(s) && !/미정|추가|확인/.test(s))
    ),
  ];
}

function isoOf(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** '2026-11-21' · '2026-12-24~25' · '2027-01' · '2027 상반기' · '2027' → 시작·끝과 정밀도. */
export function parseStartText(text: string): { start: string | null; end: string | null; precision: "day" | "month" | "unknown"; endPrecision: "day" | "month" | "unknown" } {
  const t = text.trim();
  let m = t.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})(?:\s*~\s*(?:(\d{1,2})-)?(\d{1,2}))?/);
  if (m) {
    const start = isoOf(+m[1], +m[2], +m[3]);
    const end = m[5] ? isoOf(+m[1], m[4] ? +m[4] : +m[2], +m[5]) : null;
    return { start, end, precision: "day", endPrecision: end ? "day" : "unknown" };
  }
  m = t.match(/^(20\d{2})-(\d{1,2})$/);
  if (m) return { start: isoOf(+m[1], +m[2], 1), end: null, precision: "month", endPrecision: "unknown" };
  m = t.match(/^(20\d{2})\s*(상반기|하반기)?$/);
  if (m) {
    const y = +m[1];
    if (m[2] === "상반기") return { start: isoOf(y, 1, 1), end: isoOf(y, 6, 30), precision: "month", endPrecision: "month" };
    if (m[2] === "하반기") return { start: isoOf(y, 7, 1), end: isoOf(y, 12, 31), precision: "month", endPrecision: "month" };
    return { start: isoOf(y, 1, 1), end: isoOf(y, 12, 31), precision: "month", endPrecision: "month" };
  }
  return { start: null, end: null, precision: "unknown", endPrecision: "unknown" };
}

export function parseStandardLineupXlsx(buf: Buffer, opts: { fileName?: string; outletAliases: Map<string, string> }): ParsedLineup {
  const wb = readWorkbook(buf);
  const items: ParsedItem[] = [];
  const warnings: string[] = [];
  let asOf: string | null = asOfFromFileName(opts.fileName ?? "");
  let from: string | null = null;
  let to: string | null = null;
  const unknownOutlets = new Set<string>();

  for (const name of wb.sheetNames) {
    const sh = wb.sheet(name);
    if (!sh) continue;
    // 머리 행: '채널'과 '프로그램'이 함께 있는 첫 행
    let head = -1;
    const col: Partial<Record<ColKey, number>> = {};
    for (let r = 0; r < Math.min(sh.rows, 10) && head < 0; r++) {
      const cells = Array.from({ length: sh.cols }, (_, c) => norm(sh.text(r, c)));
      const find = (names: readonly string[]) => cells.findIndex((x) => names.some((n) => x === norm(n)));
      if (find(COLS.channel) >= 0 && find(COLS.title) >= 0) {
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
      const outletLabel = get(r, "channel");
      const title = get(r, "title");
      if (!outletLabel || !title) continue;
      const code = opts.outletAliases.get(outletKey(outletLabel)) ?? null;
      if (!code) unknownOutlets.add(outletLabel);
      if (!asOf) asOf = /^\d{4}-\d{2}-\d{2}$/.test(get(r, "asOf")) ? get(r, "asOf") : null;

      const kindText = get(r, "kind");
      const startText = get(r, "start");
      const memo = get(r, "memo");
      const certainty = get(r, "certainty");
      const genreDetail = get(r, "genre");
      const days = parseDays(get(r, "dow"));
      const minute = parseClock(get(r, "time"));
      const epText = get(r, "episodes");
      const epNum = epText.match(/(\d+)\s*(?:부작|회|편)/);
      const episodes = epNum ? Number(epNum[1]) : null;

      const sp = parseStartText(startText);
      let end = sp.end;
      let endPrecision: ParsedRun["endPrecision"] = sp.endPrecision;
      const endCol = get(r, "end");
      if (/^\d{4}-\d{2}-\d{2}$/.test(endCol)) {
        end = endCol;
        endPrecision = "day";
      } else if (!end && sp.start && sp.precision === "day") {
        // 메모의 'M/D~M/D 방송'에서 끝 날짜를 읽는다(같은 해 또는 다음 해).
        const mm = memo.match(/(\d{1,2})\/(\d{1,2})\s*~\s*(\d{1,2})\/(\d{1,2})/);
        if (mm) {
          let e = isoOf(Number(sp.start.slice(0, 4)), +mm[3], +mm[4]);
          if (e < sp.start) e = isoOf(Number(sp.start.slice(0, 4)) + 1, +mm[3], +mm[4]);
          end = e;
          endPrecision = "day";
        }
      }
      const isSpecial = /특집|행사/.test(`${kindText} ${epText} ${genreDetail}`);
      const span = sp.start && end ? daysBetween(sp.start, end) : null;
      const runKind: ParsedRun["runKind"] =
        isSpecial && (episodes === 1 || (span !== null && span === 0) || !end) ? "single" : span !== null && span <= 3 && span >= 1 ? "multi_day" : "series";
      if (runKind === "single" && !end && sp.start) {
        end = sp.start;
        endPrecision = "day";
      }
      const status: ParsedRun["status"] = /확정\s*아님|비공식/.test(certainty) ? "tentative" : /^확정/.test(certainty) ? "confirmed" : "planned";
      const genre = standardGenre(genreDetail, kindText, code);
      const slotDays = days.length ? days : [1, 2, 3, 4, 5, 6, 7];
      const slotName = days.length ? `${daysLabel(days)} ${minute !== null ? clockLabel(minute) : "시각 미발표"}` : "요일·시각 미발표";
      const reviewNotes: string[] = [];
      if (!code) reviewNotes.push(`방송사 표기 '${outletLabel}'를 알아보지 못함`);
      if (!sp.start) reviewNotes.push(`시작 시기 '${startText}'를 읽지 못함`);
      const noteLines = [genreDetail && `세부 장르: ${genreDetail}`, memo, certainty && !/^확정$/.test(certainty) ? `편성 확정도: ${certainty}` : ""].filter(Boolean);
      items.push({
        outletCode: code,
        outletLabel,
        slot: { name: slotName, days: slotDays, startMinute: minute, timeNote: null, compareBlock: days.length ? compareBlockOf(days) : "other", defaultGenre: genre },
        work: {
          title,
          titleKey: titleKey(title),
          tentative: false,
          genre,
          totalEpisodes: episodes,
          cast: splitCast(get(r, "cast")),
          credits: null,
          ottNote: /netflix|넷플릭스|티빙|쿠팡|웨이브|디즈니/i.test(memo) ? memo : null,
          note: noteLines.join("\n") || null,
        },
        run: {
          runKind,
          status,
          startDate: sp.start,
          startPrecision: sp.start ? sp.precision : "unknown",
          endDate: end,
          endPrecision: end ? endPrecision : "unknown",
          startText: startText || null,
          endText: endCol || null,
          episodes,
          episodeFrom: null,
          recurrence: null,
          airDates: runKind === "multi_day" && sp.start && end ? Array.from({ length: (span ?? 0) + 1 }, (_, i) => addDays(sp.start as string, i)) : null,
          label: null,
          reason: null,
          sourceCell: `${name}!${Sheet.cellName(r, 0)}`,
          sourceText: [outletLabel, title, kindText, startText, get(r, "dow"), get(r, "time"), get(r, "url")].filter(Boolean).join(" | "),
          needsReview: reviewNotes.length > 0,
          reviewNote: reviewNotes.join(" · ") || null,
        },
      });
      if (sp.start) {
        if (!from || sp.start < from) from = sp.start;
        const last = end ?? sp.start;
        if (!to || last > to) to = last;
      }
    }
  }
  for (const o of unknownOutlets) warnings.push(`방송사 표기 '${o}'를 기준표에서 찾지 못했습니다(확인 필요로 표시).`);
  if (items.length === 0) warnings.push("읽은 항목이 없습니다. 표준 양식(채널·프로그램·론칭/시작 시기 머리)이 맞는지 확인해 주세요.");
  return { kind: "standard_xlsx", title: "신작 목록(표준 양식)", asOf, changeNote: null, period: from && to ? { from, to } : null, items, warnings };
}
