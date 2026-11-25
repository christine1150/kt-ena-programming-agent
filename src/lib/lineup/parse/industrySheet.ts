// 업계 드라마 라인업 종합본(블록 × 방송사, 반기별 시트) 읽기 — docs/lineup/LINEUP_DESIGN.md §7.
// 시트 안 섹션: A열 '구분' 행 = 월 머리, 다음 행 = 주 날짜(섹션 첫 요일 기준: 월화=월, 수목=수, 금=금, 토=토, 일=일).
// 섹션 이름(A열 세로 병합)이 요일 묶음, B열이 '방송사[(요일)] 시각'. 가로 병합 셀이 곧 방영 구간(주 단위 정밀도).
// 칸 글자 '제목(회차) [제작사 연출/작가/ 주연,주연]'. 특수 칸: 휴방 · OTT 수급 · 미정(N) · 스포츠 중계 등.
// 같은 방송사·같은 작품이 금/토/일 섹션(또는 앞뒤 반기 시트)에 나뉘어 있으면 한 구간으로 합친다.
import { addDays, clockLabel, compareBlockOf, daysLabel, firstAirOnOrAfter, isoDow, parseClock, parseDays } from "../dates";
import { splitNames, splitTitleEpisodes, titleKey } from "../titles";
import type { ParsedItem, ParsedLineup, ParsedRun, ParsedWork } from "../types";
import { asOfFromFileName } from "./ownSheet";
import { parseMonthHeader, readWorkbook, Sheet } from "./sheet";

/** 업계 종합본에서 읽을 시트 — 2026 하반기('2026드라마-2nd')부터(사용자 결정 2026-11-24 D7). 2027 이후 시트는 모두 읽는다. */
export function industrySheetFilter(name: string): boolean {
  const y = Number((name.match(/(20\d{2})/) ?? [])[1]);
  if (!y) return false;
  if (y > 2026) return true;
  return y === 2026 && /2nd|하반기/i.test(name);
}

/** 방송사 표기 정규화 키(공백 제거·대문자). */
export const outletKey = (s: string) => s.replace(/\s+/g, "").toUpperCase();

const SPECIAL_EVENT = /(아시안게임|올림픽|월드컵|중계|선거|시상식|특집|결방)/;

interface RawItem extends ParsedItem {
  sectionDays: number[];
  rowMinute: number | null;
  sheet: string;
}

function parseRowLabel(label: string): { outlet: string; days: number[] | null; minute: number | null; note: string | null } {
  const t = label.replace(/\s+/g, " ").trim();
  const m = t.match(/^([A-Za-z가-힣0-9]+?)(?:\(([월화수목금토일]+)\))?(?:\s+(.*))?$/);
  if (!m) return { outlet: t, days: null, minute: null, note: null };
  const rest = (m[3] ?? "").trim();
  const dayHint = rest.match(/^([월화수목금토일]+)\d/);
  const days = m[2] ? parseDays(m[2]) : dayHint ? parseDays(dayHint[1]) : null;
  const minute = parseClock(rest);
  const plainTime = /^\d{1,2}:\d{2}$|^\d{1,2}시$|^\d{4}$/.test(rest);
  return { outlet: m[1], days, minute, note: rest && !plainTime ? rest : null };
}

function classify(text: string): { work: ParsedWork | null; runKind: ParsedRun["runKind"]; label: string | null; reason: string | null; episodes: number | null } {
  const t = text.replace(/\s+/g, " ").trim();
  if (/^휴방/.test(t)) return { work: null, runKind: "hiatus", label: "휴방", reason: t.length > 2 ? t : null, episodes: null };
  if (/OTT\s*수급|수급물/.test(t)) return { work: null, runKind: "filler", label: "OTT 수급", reason: null, episodes: null };
  const se = splitTitleEpisodes(t);
  if (/^미정/.test(se.title)) return { work: null, runKind: "tbd", label: "미정", reason: null, episodes: se.episodes };
  if (se.episodes === null && SPECIAL_EVENT.test(t)) return { work: null, runKind: "hiatus", label: "결방", reason: t, episodes: null };
  let cast: string[] = [];
  let credits: string | null = null;
  const rest = se.rest;
  if (rest.includes("/ ")) {
    const i = rest.lastIndexOf("/ ");
    cast = splitNames(rest.slice(i + 2));
    credits = rest.slice(0, i).trim() || null;
  } else if (rest.includes("/")) {
    credits = rest;
  } else if (rest) {
    cast = splitNames(rest);
  }
  return {
    work: { title: se.title, titleKey: titleKey(se.title), tentative: /가제/.test(t), genre: "drama", totalEpisodes: se.episodes, cast, credits, ottNote: null },
    runKind: "series",
    label: null,
    reason: null,
    episodes: se.episodes,
  };
}

export function parseIndustryLineupXlsx(
  buf: Buffer,
  opts: { fileName?: string; outletAliases: Map<string, string>; sheetFilter?: (name: string) => boolean }
): ParsedLineup {
  const wb = readWorkbook(buf);
  const warnings: string[] = [];
  const raws: RawItem[] = [];
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const sheets = wb.sheetNames.filter((n) => (opts.sheetFilter ? opts.sheetFilter(n) : true));
  const unknownOutlets = new Set<string>();
  const outside: string[] = [];

  for (const name of sheets) {
    const sh = wb.sheet(name);
    if (!sh) continue;
    const ym = name.match(/(20\d{2})/);
    if (!ym) {
      warnings.push(`'${name}' 시트 이름에서 연도를 찾지 못해 건너뛰었습니다.`);
      continue;
    }
    const year = Number(ym[1]);
    const heads: number[] = [];
    for (let r = 0; r < sh.rows; r++) if (sh.text(r, 0) === "구분") heads.push(r);
    for (let h = 0; h < heads.length; h++) {
      const head = heads[h];
      const endRow = h + 1 < heads.length ? heads[h + 1] : sh.rows;
      const colDate = new Map<number, string>();
      let month: number | null = null;
      for (let c = 2; c < sh.cols; c++) {
        const mh = parseMonthHeader(sh.text(head, c));
        if (mh) month = mh.month;
        const day = Number(sh.text(head + 1, c));
        if (month && day >= 1 && day <= 31) colDate.set(c, `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
      }
      if (colDate.size === 0) continue;
      const ds = [...colDate.values()].sort();
      if (!periodFrom || ds[0] < periodFrom) periodFrom = ds[0];
      const last = addDays(ds[ds.length - 1], 6);
      if (!periodTo || last > periodTo) periodTo = last;
      const sectionLabel = sh.textMerged(head + 2, 0);
      const sectionDays = parseDays(sectionLabel).length > 0 ? parseDays(sectionLabel) : [isoDow(ds[0])];

      for (let r = head + 2; r < endRow; r++) {
        const rowLabel = sh.text(r, 1);
        if (!rowLabel) continue;
        const rl = parseRowLabel(rowLabel);
        const code = opts.outletAliases.get(outletKey(rl.outlet)) ?? null;
        const days = rl.days && rl.days.length > 0 ? rl.days : sectionDays;
        for (let c = 2; c < sh.cols; c++) {
          const text = sh.text(r, c);
          if (!text) continue;
          const merge = sh.mergeAt(r, c);
          const c1 = merge ? merge.c1 : c;
          const dated = [] as string[];
          for (let cc = c; cc <= c1; cc++) {
            const d = colDate.get(cc);
            if (d) dated.push(d);
          }
          const cellName = merge ? Sheet.rangeName(merge) : Sheet.cellName(r, c);
          if (dated.length === 0) {
            outside.push(`${name}!${cellName}`);
            continue;
          }
          if (!code) unknownOutlets.add(rl.outlet);
          const cls = classify(text);
          const start = firstAirOnOrAfter(dated[0], days);
          const lastWeek = dated[dated.length - 1];
          const end = days.map((d) => firstAirOnOrAfter(lastWeek, [d])).sort().pop() as string;
          const reviewNotes: string[] = [];
          if (!merge) reviewNotes.push("병합되지 않은 한 칸(지난 판 글자가 남았을 수 있음)");
          if (!code) reviewNotes.push(`방송사 표기 '${rl.outlet}'를 알아보지 못함`);
          raws.push({
            sheet: name,
            sectionDays,
            rowMinute: rl.minute,
            outletCode: code,
            outletLabel: rl.outlet,
            slot: { name: "", days, startMinute: rl.minute, timeNote: rl.note, compareBlock: compareBlockOf(days), defaultGenre: "drama" },
            work: cls.work,
            run: {
              runKind: cls.runKind,
              status: "planned",
              startDate: start,
              startPrecision: "week",
              endDate: end < start ? start : end,
              endPrecision: "week",
              startText: null,
              endText: null,
              episodes: cls.episodes,
              episodeFrom: null,
              recurrence: null,
              airDates: null,
              label: cls.label,
              reason: cls.reason,
              sourceCell: `${name}!${cellName}`,
              sourceText: sh.raw(r, c),
              needsReview: reviewNotes.length > 0,
              reviewNote: reviewNotes.join(" · ") || null,
            },
          });
        }
      }
    }
  }
  for (const o of unknownOutlets) warnings.push(`방송사 표기 '${o}'를 기준표에서 찾지 못했습니다(확인 필요로 표시).`);
  if (outside.length > 0)
    warnings.push(`날짜 머리 밖에 있는 칸 ${outside.length}개는 건너뛰었습니다(지난 판에서 남은 글자로 보임: ${outside.slice(0, 4).join(", ")}${outside.length > 4 ? " 등" : ""}).`);

  const items = mergeSplitItems(raws);
  const anyText = raws.length > 0;
  if (!anyText) warnings.push("읽은 항목이 없습니다. 업계 드라마 라인업 종합본 양식('구분'·'방송사' 머리)이 맞는지 확인해 주세요.");
  return {
    kind: "industry_xlsx",
    title: "업계 드라마 라인업 종합본",
    asOf: asOfFromFileName(opts.fileName ?? ""),
    changeNote: null,
    period: periodFrom && periodTo ? { from: periodFrom, to: periodTo } : null,
    items,
    warnings,
  };
}

/**
 * 금·토·일 섹션과 앞뒤 반기 시트에 나뉜 같은 구간을 하나로 합친다.
 * 묶음 키 = 방송사 + (작품 제목 키 | 특수 칸 글자). 기간이 겹치거나 7일 이내로 이어지면 같은 구간이다.
 * 합친 구간의 요일 = 요일 합집합(금+토 → 금토), 시각 = 가장 이른 요일 줄의 시각(다르면 시각 메모).
 */
function mergeSplitItems(raws: RawItem[]): ParsedItem[] {
  const groups = new Map<string, RawItem[]>();
  for (const r of raws) {
    const who = r.work ? `w:${r.work.titleKey}` : `l:${r.run.runKind}:${r.run.label}`;
    const key = `${r.outletCode ?? r.outletLabel}|${who}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }
  const out: ParsedItem[] = [];
  for (const arr of groups.values()) {
    arr.sort((a, b) => ((a.run.startDate ?? "") < (b.run.startDate ?? "") ? -1 : 1));
    const clusters: RawItem[][] = [];
    for (const it of arr) {
      const cl = clusters.find((c) =>
        c.some(
          (x) =>
            (x.run.startDate as string) <= addDays(it.run.endDate as string, 7) &&
            (it.run.startDate as string) <= addDays(x.run.endDate as string, 7) &&
            // 같은 요일 줄의 서로 다른 구간(파트1·2)은 합치지 않는다 — 요일이 다르거나 반기 시트가 달라야 합친다.
            (x.slot.days.join() !== it.slot.days.join() || x.sheet !== it.sheet)
        )
      );
      if (cl) cl.push(it);
      else clusters.push([it]);
    }
    for (const cl of clusters) out.push(combine(cl));
  }
  return out;
}

function combine(cl: RawItem[]): ParsedItem {
  const days = [...new Set(cl.flatMap((x) => x.slot.days))].sort((a, b) => a - b);
  const byDay = [...cl].sort((a, b) => Math.min(...a.slot.days) - Math.min(...b.slot.days));
  const minute = byDay.find((x) => x.slot.startMinute !== null)?.slot.startMinute ?? null;
  const minutes = new Map<number, number | null>();
  for (const x of byDay) for (const d of x.slot.days) if (!minutes.has(d)) minutes.set(d, x.slot.startMinute);
  const distinct = [...new Set([...minutes.values()].filter((m): m is number => m !== null))];
  const notes = [...new Set(cl.map((x) => x.slot.timeNote).filter((n): n is string => !!n))];
  const timeNote =
    distinct.length > 1
      ? [...minutes.entries()].map(([d, m]) => `${daysLabel([d])} ${clockLabel(m)}`).join(" · ")
      : notes.join(" · ") || null;
  const first = cl[0];
  const start = cl.map((x) => x.run.startDate as string).sort()[0];
  const end = cl.map((x) => x.run.endDate as string).sort().pop() as string;
  const name = `${daysLabel(days)} ${minute !== null ? clockLabel(minute) : first.slot.timeNote ?? ""}`.trim();
  const work = cl.find((x) => x.work)?.work ?? null;
  const reviewNotes = [...new Set(cl.map((x) => x.run.reviewNote).filter((n): n is string => !!n))];
  return {
    outletCode: first.outletCode,
    outletLabel: first.outletLabel,
    slot: { name, days, startMinute: minute, timeNote, compareBlock: compareBlockOf(days), defaultGenre: "drama" },
    work: work ? { ...work, cast: [...new Set(cl.flatMap((x) => x.work?.cast ?? []))], credits: cl.map((x) => x.work?.credits).find((c) => !!c) ?? null } : null,
    run: {
      ...first.run,
      startDate: start,
      endDate: end,
      episodes: cl.map((x) => x.run.episodes).find((e) => e !== null) ?? null,
      reason: cl.map((x) => x.run.reason).find((e) => !!e) ?? null,
      sourceCell: [...new Set(cl.map((x) => x.run.sourceCell))].join(", "),
      sourceText: [...new Set(cl.map((x) => x.run.sourceText))].join("\n"),
      // 한 칸만 병합 안 된 경우라도 다른 섹션에서 병합으로 확인되면 확인 필요를 풀어 준다.
      needsReview: cl.every((x) => x.run.needsReview),
      reviewNote: cl.every((x) => x.run.needsReview) ? reviewNotes.join(" · ") || null : null,
    },
  };
}
