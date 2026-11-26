// 라인업 순수 함수 시험(npm run test:lineup) — 날짜 계산·맞대결·빈 주·양식 해석·업로드 비교.
// 대외비 원자료를 쓰지 않는다: 시험용 엑셀은 이 파일 안에서 가짜 제목으로 만든다.
import * as XLSX from "xlsx";
import {
  addDays, compareBlockOf, drawSpan, estimateEnd, findGaps, isHeadToHead, isoDow, monthlyDates, occupancyEnd, parseClock, parseDays,
} from "../src/lib/lineup/dates";
import { splitTitleEpisodes, titleKey } from "../src/lib/lineup/titles";
import { parseOwnLineupXlsx, asOfFromFileName } from "../src/lib/lineup/parse/ownSheet";
import { industrySheetFilter, outletKey, parseIndustryLineupXlsx } from "../src/lib/lineup/parse/industrySheet";
import { planUpload, type PlanContext } from "../src/lib/lineup/plan";
import { parseStandardLineupXlsx, parseStartText, splitCast, standardGenre } from "../src/lib/lineup/parse/standardSheet";
import { ottGenre, parseOttCadence, parseOttLineupXlsx, splitOttTitle } from "../src/lib/lineup/parse/ottSheet";
import { holdbackMarks } from "../src/lib/lineup/holdback";
import { COMPARE_MODES, outletSelected, scopeOf, scopeSel, selIsAll, selIsNone, STATUS_LABEL } from "../src/lib/lineup/viewModel";
import { airingsOf } from "../src/lib/lineup/airings";
import { effectiveEnd, headToHeadLevel, isIsoDate, type AirWindow, type GapSpan } from "../src/lib/lineup/dates";
import { holdbackRuleFor } from "../src/lib/lineup/holdbackRules";
import { barWeekDays, buildCalendar, calendarFetchRange, clampRange, dayAirings } from "../src/lib/lineup/calendar";
import { addMonthsDate, assignLanes, buildCompareRows, buildUndated, EPISODE_TABLE, episodeTable, kindLabel, lineupSearch, ottBucket, parseLineupQuery, periodDot, periodText, queryRange, relatedFor, runExtent, runMatchesQuery, slotLabel, weekStartOf } from "../src/lib/lineup/viewModel";
import { BRAND, contrastRatio, GENRE_FILL, GENRE_ON, UI } from "../src/lib/lineup/tokens";
import { laneEvents, mergeHolidays, parseEventInput, placeLane } from "../src/lib/lineup/events";
import type { DrawSpan, LineupPayload, OutletDto, RunDto, SlotDto, WorkDto } from "../src/lib/lineup/types";

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
};

// ── 날짜 ──
check("isoDow: 2026-11-16은 월요일", isoDow("2026-11-16") === 1);
check("자리 점유 끝: 월화 자리 마지막 화요일 → 그 주 일요일", occupancyEnd("2026-12-22", [1, 2]) === "2026-12-27");
check("자리 점유 끝: 토일 자리 마지막 일요일 → 다음 금요일", occupancyEnd("2026-12-27", [6, 7]) === "2027-01-01");
check("자리 점유 끝: 매일 방송이면 그대로", occupancyEnd("2026-12-22", [1, 2, 3, 4, 5, 6, 7]) === "2026-12-22");
check("끝 추정: 월화 12회 11/16 시작 → 12/22", estimateEnd("2026-11-16", [1, 2], 12) === "2026-12-22", estimateEnd("2026-11-16", [1, 2], 12));
check("끝 추정: 토일 16회 1/16(토) 시작 → 3/7", estimateEnd("2027-01-16", [6, 7], 16) === "2027-03-07", estimateEnd("2027-01-16", [6, 7], 16));
check("월 1회 마지막 화요일", JSON.stringify(monthlyDates("2026-10-01", "2026-12-31", 2, "last")) === JSON.stringify(["2026-10-27", "2026-11-24", "2026-12-29"]));
check("시각 읽기", parseClock("22:00") === 1320 && parseClock("21시") === 1260 && parseClock("2250") === 1370 && parseClock("금23") === 1380 && parseClock("1일2회") === null && parseClock("01:10") === 1510);
check("요일 읽기", JSON.stringify(parseDays("월화")) === "[1,2]" && JSON.stringify(parseDays("토일")) === "[6,7]" && JSON.stringify(parseDays("주말 (금9시/ 11시)")) === "[5]");
check("비교 묶음", compareBlockOf([1, 2]) === "mon_tue" && compareBlockOf([3]) === "wed_thu" && compareBlockOf([5, 6]) === "weekend" && compareBlockOf([2, 5]) === "other");

// ── 그리기 구간 ──
const bar = drawSpan({ runKind: "series", startDate: "2026-11-16", startPrecision: "day", endDate: "2026-12-22", endPrecision: "day", episodes: 12, recurrence: null, airDates: null }, [1, 2], "2027-12-31");
check("막대: 자리 점유로 끝을 늘림", bar?.shape === "bar" && bar.from === "2026-11-16" && bar.to === "2026-12-27" && bar.estimatedFrom === null, bar);
const est = drawSpan({ runKind: "series", startDate: "2027-01-29", startPrecision: "day", endDate: null, endPrecision: "unknown", episodes: 12, recurrence: null, airDates: null }, [5, 6], "2027-12-31");
check("첫방일만: 회차로 끝 추정 + 흐림 시작", est?.shape === "bar" && est.to === occupancyEnd("2027-03-06", [5, 6]) && est.estimatedFrom !== null, est);
const br = drawSpan({ runKind: "series", startDate: "2027-01-01", startPrecision: "month", endDate: "2027-02-28", endPrecision: "month", episodes: 12, recurrence: null, airDates: null }, [1, 2], "2027-12-31");
check("월 단위: 범위 괄호(1일~말일)", br?.shape === "bracket" && br.from === "2027-01-01" && br.to === "2027-02-28", br);
const dots = drawSpan({ runKind: "monthly", startDate: "2026-03-31", startPrecision: "day", endDate: "2026-12-29", endPrecision: "day", episodes: null, recurrence: "월1회·마지막주", airDates: null }, [2], "2027-12-31");
check("월 1회: 방송일 점", dots?.shape === "dots" && dots.dates?.length === 10 && dots.dates?.[0] === "2026-03-31", dots);
const dia = drawSpan({ runKind: "multi_day", startDate: "2026-11-07", startPrecision: "day", endDate: "2026-11-08", endPrecision: "day", episodes: 2, recurrence: null, airDates: null }, [6], "2027-12-31");
check("이틀 행사: 마름모 2개", dia?.shape === "diamond" && dia.dates?.length === 2, dia);

// ── 맞대결·빈 주 ──
check("맞대결: 같은 요일·±90분·기간 겹침", isHeadToHead({ days: [6, 7], startMinute: 1280, from: "2027-01-16", to: "2027-03-07" }, { days: [5, 6], startMinute: 1310, from: "2027-01-29", to: "2027-03-06" }));
check("맞대결 아님: 시각 차이 120분", !isHeadToHead({ days: [6], startMinute: 1200, from: "2027-01-01", to: "2027-02-01" }, { days: [6], startMinute: 1320, from: "2027-01-01", to: "2027-02-01" }));
check("맞대결 아님: 요일 다름", !isHeadToHead({ days: [1, 2], startMinute: 1320, from: "2027-01-01", to: "2027-02-01" }, { days: [6, 7], startMinute: 1320, from: "2027-01-01", to: "2027-02-01" }));
const gaps = findGaps("s", [{ from: "2026-11-16", to: "2026-12-27" }, { from: "2027-01-25", to: "2027-03-07" }], "2026-11-01", "2027-06-30");
check("빈 주: 12/28~1/24 = 4주", gaps.length === 1 && gaps[0].from === "2026-12-28" && gaps[0].to === "2027-01-24" && gaps[0].weeks === 4, gaps);
check("빈 주 없음: 이어지는 작품", findGaps("s", [{ from: "2026-11-16", to: "2026-12-27" }, { from: "2026-12-28", to: "2027-02-01" }], "2026-11-01", "2027-06-30").length === 0);

// ── 제목 ──
check("제목 키: 띄어쓰기·문장부호 무시", titleKey("가상 조사관 하나") === titleKey("가상조사관 하나") && titleKey("가상 쇼, 그 후") === titleKey("가상쇼그후"));
const se = splitTitleEpisodes("가상 작품(12) 제작사 연출/작가/ 배우1,배우2");
check("제목(회차) 나누기", se.title === "가상 작품" && se.episodes === 12 && se.rest.startsWith("제작사"), se);
check("파일 이름 기준일", asOfFromFileName("라인업_2026-11-06.xlsx") === "2026-11-06" && asOfFromFileName("종합(20261117).xlsx") === "2026-11-17" && asOfFromFileName("라인업_261029.xlsx") === "2026-10-29");
check("업계 종합본 시트: 2026 하반기부터", industrySheetFilter("2026드라마-2nd") && industrySheetFilter("2027드라마") && !industrySheetFilter("2026드라마-1st") && !industrySheetFilter("2025드라마-1st"));

// ── 자사 라인업 양식(가짜 제목으로 만든 엑셀) ──
function ownWorkbook(): Buffer {
  const aoa: string[][] = [
    ["가상 채널 편성센터 · 오리지널 라인업 2026년 11월~2027년 1월"],
    ["장르", "요일", "시간대", "11월", "", "", "", "", "12월", "", "", "", "1월 '27", "", "", ""],
    ["", "", "", "2", "9", "16", "23", "30", "7", "14", "21", "28", "4", "11", "18", "25"],
    ["기념일·행사"],
    ["드라마", "월화", "22:00", "", "", "가상극 하나 11/16~12/22, 12", "", "", "", "", "", "", "", "", "", "가상극 둘 1/25~3/2, 12"],
    ["", "", "", "", "", "배우가, 배우나"],
    ["예능", "토", "19:50", "가상 시상식 11/7~11/8, 2", "가상 예능 10/17~1/30, 15"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [
    { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
    { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },
    { s: { r: 4, c: 2 }, e: { r: 5, c: 2 } },
    { s: { r: 4, c: 5 }, e: { r: 4, c: 10 } },
    { s: { r: 5, c: 5 }, e: { r: 5, c: 10 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "라인업");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
const own = parseOwnLineupXlsx(ownWorkbook(), { outletCode: "ENA", fileName: "가상_2026-11-06.xlsx" });
const one = own.items.find((i) => i.work?.title === "가상극 하나");
check("자사 양식: 날짜·회차·주연", one?.run.startDate === "2026-11-16" && one.run.endDate === "2026-12-22" && one.run.episodes === 12 && one.work?.cast.join() === "배우가,배우나" && one.slot.name === "월화 22:00", one);
const two = own.items.find((i) => i.work?.title === "가상극 둘");
check("자사 양식: 해 넘김 연도", two?.run.startDate === "2027-01-25" && two.run.endDate === "2027-03-02", two?.run);
const ev = own.items.find((i) => i.work?.title === "가상 시상식");
check("자사 양식: 이틀 행사", ev?.run.runKind === "multi_day" && ev.run.airDates?.length === 2, ev?.run);
const cross = own.items.find((i) => i.work?.title === "가상 예능");
check("자사 양식: 전년도 시작(10/17~1/30)", cross?.run.startDate === "2026-10-17" && cross.run.endDate === "2027-01-30", cross?.run);

// ── 업계 종합본 양식(가짜) — 토·일 섹션에 같은 작품, 병합 안 된 한 칸 ──
function industryWorkbook(): Buffer {
  const head = (days: string[]) => [["구분", "방송사", "JAN", "", "", "", "", "FEB"], ["", "", ...days]];
  const aoa: string[][] = [
    ["", "", "2027 DRAMA LINE-UP"],
    ...head(["2", "9", "16", "23", "30", "6"]),
    ["주말 8~10시 (토)", "가상방송 21:20", "가상 주말극(16) 감독/작가/ 배우1,배우2"],
    ["", "TVN 22:00", "미정(12)", "", "", "남은 글자(12)"],
    ...head(["3", "10", "17", "24", "31", "7"]),
    ["주말 8~10시(일)", "가상방송 21:20", "가상 주말극(16) 감독/작가/ 배우1,배우2"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [
    { s: { r: 3, c: 2 }, e: { r: 3, c: 5 } },
    { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } },
    { s: { r: 7, c: 2 }, e: { r: 7, c: 5 } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "2027드라마");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
const aliases = new Map([[outletKey("가상방송"), "FAKE"], [outletKey("tvN"), "TVN"]]);
const ind = parseIndustryLineupXlsx(industryWorkbook(), { outletAliases: aliases, fileName: "종합(20261117).xlsx" });
const wk = ind.items.find((i) => i.work?.title === "가상 주말극");
check("업계 양식: 토·일 섹션 같은 작품 → 한 구간(토일)", ind.items.filter((i) => i.work?.title === "가상 주말극").length === 1 && wk?.slot.name === "토일 21:20" && wk.run.startDate === "2027-01-02" && wk.run.endDate === "2027-01-24", wk);
check("업계 양식: 주연·회차·주 단위", wk?.work?.cast.join() === "배우1,배우2" && wk.run.episodes === 16 && wk.run.startPrecision === "week");
const tbd = ind.items.find((i) => i.run.runKind === "tbd");
check("업계 양식: 미정(12) → 미정 자리", tbd?.run.episodes === 12 && tbd.outletCode === "TVN", tbd);
const stale = ind.items.find((i) => i.work?.title === "남은 글자");
check("업계 양식: 병합 안 된 한 칸 → 확인 필요", stale?.run.needsReview === true, stale?.run);

// ── 업로드 비교 ──
const ctx: PlanContext = {
  outlets: [{ id: "o1", code: "ENA", side: "own" }, { id: "o2", code: "FAKE", side: "rival" }, { id: "o3", code: "TVN", side: "rival" }],
  slots: [{ id: "s1", outlet_id: "o1", name: "월화 22:00" }],
  works: [{ id: "w1", outlet_id: "o1", title: "가상극 하나", title_key: titleKey("가상극 하나"), aliases: [], total_episodes: 12, cast_main: ["배우가", "배우나"], genre: "drama" }],
  runs: [{ id: "r1", slot_id: "s1", work_id: "w1", run_kind: "series", status: "confirmed", label: null, start_date: "2026-11-16", start_precision: "day", end_date: "2026-12-15", end_precision: "day", episodes: 12, episode_from: null, recurrence: null, air_dates: null, reason: null, source_id: "src0" }],
  sourceKindById: new Map([["src0", "own_xlsx"]]),
};
const plan = planUpload(own, ctx);
const upd = plan.actions.find((a) => a.runId === "r1");
check("업로드 비교: 같은 작품 종료일 바뀜 → 바뀜", upd?.kind === "update" && upd.changes.some((c) => c.field === "end_date" && c.after === "2026-12-22"), upd);
check("업로드 비교: 새 작품 → 새로 생김", plan.actions.filter((a) => a.kind === "create").length === own.items.length - 1);
const ownInIndustry = planUpload(
  { ...ind, items: [{ ...wk!, outletCode: "ENA", work: { ...wk!.work!, title: "가상극 하나", titleKey: titleKey("가상극 하나") } }] },
  ctx
);
check("업계 자료의 자사 작품은 이미 있으면 건너뜀(자사 양식 기준)", ownInIndustry.actions[0]?.kind === "skip", ownInIndustry.actions[0]);
const downgrade = planUpload(
  { ...own, kind: "own_xlsx", items: [{ ...one!, run: { ...one!.run, startDate: "2026-11-16", startPrecision: "week", endDate: "2026-12-29", endPrecision: "week" } }] },
  ctx
);
check("덜 정밀한 자료로 날짜를 덮어쓰지 않음", downgrade.actions[0]?.changes.every((c) => c.field !== "end_date") === true, downgrade.actions[0]);
check("addDays", addDays("2026-12-31", 1) === "2027-01-01");

// ── 표준 양식(한 줄 = 한 작품, 신작 목록) — 가짜 제목 ──
{
  const head = ["채널", "프로그램", "편성 구분", "론칭/시작 시기", "요일", "본방 시각", "총 편수", "주요 출연진·진행", "장르", "추가 내용·주의", "출처 URL", "정보 근거", "편성 확정도", "조사 기준일", "정렬용 시작일", "종영일(확인 시)"];
  const rows = [
    ["가상방송", "가상 퀴즈쇼", "신작·편성확정", "2026-11-21", "토", "08:30", "", "사람가·사람나(MC) 등", "토크/퀴즈", "", "", "", "확정", "2026-11-25", "", ""],
    ["가상교육", "가상 다큐", "편성확정·교양", "2026-11-23", "월", "21:55", "5부작", "해외 전문가 등", "다큐멘터리", "11/23~12/21 방송", "", "", "확정", "2026-11-25", "", ""],
    ["가상방송", "가상 가요제", "행사확정·방송시각점검", "2026-12-24~25", "목·금", "TV 미확인", "2일 특집", "", "음악 특집", "", "", "", "행사 시간≠방송 확정", "2026-11-25", "", ""],
    ["가상방송", "가상 내년작", "신작·시기확정", "2027 상반기", "미발표", "미발표", "", "미정(모집 중)", "리얼리티", "", "", "", "날짜·시간 미발표", "2026-11-25", "", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "신규");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const std = parseStandardLineupXlsx(buf, { fileName: "신작_1125.xlsx", outletAliases: new Map([[outletKey("가상방송"), "FAKE"], [outletKey("가상교육"), "EBS1"]]) });
  const quiz = std.items.find((i) => i.work?.title === "가상 퀴즈쇼");
  check("표준 양식: 하루 단위·자리·출연진(괄호·'등' 제거)·예능", quiz?.run.startDate === "2026-11-21" && quiz.slot.name === "토 08:30" && quiz.work?.cast.join() === "사람가,사람나" && quiz.work?.genre === "variety" && quiz.run.status === "confirmed", quiz);
  const docu = std.items.find((i) => i.work?.title === "가상 다큐");
  check("표준 양식: 메모의 M/D~M/D로 종영일, 다큐 = 교양(기타)", docu?.run.endDate === "2026-12-21" && docu.run.episodes === 5 && docu.work?.genre === "other", docu?.run);
  const fest = std.items.find((i) => i.work?.title === "가상 가요제");
  check("표준 양식: 이틀 특집 = 여러 날 행사, 음악 = 예능, 시각 미발표 자리", fest?.run.runKind === "multi_day" && fest.run.airDates?.length === 2 && fest.work?.genre === "variety" && fest.slot.name === "목금 시각 미발표" && fest.run.status === "planned", fest);
  const next = std.items.find((i) => i.work?.title === "가상 내년작");
  check("표준 양식: '2027 상반기' = 월 단위 1~6월, 요일 미발표 자리", next?.run.startPrecision === "month" && next.run.startDate === "2027-01-01" && next.run.endDate === "2027-06-30" && next.slot.name === "요일·시각 미발표" && next.work?.cast.length === 0, next);
  check("표준 양식: 세부 장르는 작품 메모로", (quiz?.work?.note ?? "").includes("세부 장르: 토크/퀴즈"));
  check("표준 양식: KBS1·EBS의 음악 아닌 프로그램은 교양", standardGenre("토크/퀴즈", "", "KBS1") === "other" && standardGenre("음악 특집", "", "KBS1") === "variety" && standardGenre("토크", "", "SBS") === "variety");
  check("표준 양식: 시작 시기 읽기", parseStartText("2027").end === "2027-12-31" && parseStartText("2027-01").precision === "month" && parseStartText("2026-12-24~25").end === "2026-12-25");
  check("표준 양식: 출연진 '미정' → 빈 목록", splitCast("미정(특수부대 예비역 모집)").length === 0);
}

// ── OTT 양식(한 줄 = 한 작품) — 가짜 제목 ──
{
  const head = ["OTT 플랫폼", "작품명", "분류", "확정수준", "공개 시기", "첫 공개일(YYYY-MM-DD)", "공개 시각(KST)", "총 편수", "주요 출연진·패널", "공개 방식·요일", "유통·제작 유형", "확인사항·비고", "근거 URL 1", "근거 URL 2", "자료 확인일"];
  const rows = [
    ["가상플러스", "가상 몰아보기 (Fake Binge)", "드라마", "날짜확정", "2026-12-01", "2026-12-01", "", "8부작(2차 확인)", "배우 가·배우 나", "전편 공개", "국내 오리지널", "", "", "", "2026-11-25"],
    ["가상플러스", "가상 주간극", "드라마", "날짜확정", "2027-01-06", "2027-01-06", "", "8부작", "외국 배우·테스트 이름", "1/6 2화, 이후 매주 수요일", "해외 오리지널", "", "", "", "2026-11-25"],
    ["가상플러스", "가상 분할극", "드라마", "날짜확정", "2026-12-11", "2026-12-11", "17:00", "22부작", "배우 다", "12/11 1~8화 → 12/18 9~15화 → 12/25 16~22화", "", "", "", "", "2026-11-25"],
    ["가상TV", "가상 예능", "연애 리얼리티 예능", "월확정", "2026년 12월", "", "", "", "고정출연진 미발표", "상세 날짜 미발표", "", "", "", "", "2026-11-25"],
    ["가상TV", "가상 연말쇼", "예능", "반기확정", "2027년 상반기", "", "", "", "AK-99 외 미공개", "공개 방식 미정", "", "", "", "", "2026-11-25"],
    ["가상TV", "가상 미정극(가제)", "시트콤", "제작확정·일정미정", "공개 시기 미발표", "", "", "", "배우 라", "공개 방식 미발표", "", "", "", "", "2026-11-25"],
    ["가상TV", "가상 다큐", "다큐·음악", "연도확정", "2027년", "", "", "6부작", "", "매주 목요일 17:00", "", "", "", "", "2026-11-25"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "OTT_전체");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const ott = parseOttLineupXlsx(buf, { fileName: "OTT.xlsx", outletAliases: new Map([[outletKey("가상플러스"), "OTT_FAKE"], [outletKey("가상TV"), "OTT_FAKE2"]]) });
  const get = (t: string) => ott.items.find((i) => i.work?.title === t);
  const binge = get("가상 몰아보기");
  check("OTT: 전편 공개 = 단발, 원제는 메모로·제목에서 뺌, 편수·출연자(띄어쓰기 유지)", binge?.run.runKind === "single" && binge.run.endDate === "2026-12-01" && binge.run.episodes === 8 && (binge.work?.note ?? "").includes("원제 : Fake Binge") && binge.work?.cast.join() === "배우 가,배우 나", binge);
  const weekly = get("가상 주간극");
  check("OTT: 첫날 2화 + 매주 수요일 8부작 → 1/6~2/17 막대", weekly?.run.runKind === "series" && weekly.run.endDate === "2027-02-17" && weekly.run.recurrence === "매주 수요일" && weekly.work?.cast.join() === "외국 배우,테스트 이름", weekly?.run);
  const split = get("가상 분할극");
  check("OTT: 날짜가 여럿이면 분할 공개(여러 날 마름모)", split?.run.runKind === "multi_day" && split.run.airDates?.join() === "2026-12-11,2026-12-18,2026-12-25" && split.run.endDate === "2026-12-25" && split.run.episodes === 22, split?.run);
  const month = get("가상 예능");
  check("OTT: '2026년 12월' = 월 단위 12/1~12/31, 분류 연애 리얼리티 예능 = 예능, '미발표' 출연진 = 빈 목록", month?.run.startPrecision === "month" && month.run.startDate === "2026-12-01" && month.run.endDate === "2026-12-31" && month.run.startText === "2026년 12월" && month.work?.genre === "variety" && month.work.cast.length === 0, month);
  const half = get("가상 연말쇼");
  check("OTT: '2027년 상반기' = 1~6월, '외 미공개' 제거", half?.run.endDate === "2027-06-30" && half.run.startText === "2027년 상반기" && half.work?.cast.join() === "AK-99", half);
  const none = get("가상 미정극");
  check("OTT: 일정미정 = 날짜 없음(지어내지 않음), 가제, 시트콤 = 드라마, 확인 필요 아님", none?.run.startDate === null && none.run.startPrecision === "unknown" && none.work?.tentative === true && none.work.genre === "drama" && none.run.needsReview === false, none);
  const docu = get("가상 다큐");
  check("OTT: 다큐·음악 = 교양(기타), 매주인데 첫 공개일 없이 연도만 → 월 단위 범위", docu?.work?.genre === "other" && docu.run.startPrecision === "month" && docu.run.endDate === "2027-12-31", docu);
  check("OTT: 자료 종류 outlet_xlsx·기준일·기간·미정 경고", ott.kind === "outlet_xlsx" && ott.asOf === "2026-11-25" && ott.period?.from === "2026-12-01" && ott.period.to === "2027-12-31" && ott.warnings.some((w) => w.includes("미정")), ott);
  check("OTT: 분류 → 장르", ottGenre("예능") === "variety" && ottGenre("시트콤") === "drama" && ottGenre("다큐·음악") === "other" && ottGenre("연애 리얼리티 예능") === "variety");
  check("OTT: 제목 나누기", splitOttTitle("가상 제목 (Fake Title)").title === "가상 제목" && splitOttTitle("가상 제목 (실사)").title === "가상 제목 (실사)" && splitOttTitle("가상극(가제)").tentative === true);
  check("OTT: 공개 방식 → 형태", parseOttCadence("매주 목요일 17:00", "2026-12-03", null).endPrecision === "open" && parseOttCadence("회차별 공개 방식 추가 확인", "2026-12-02", 10).recurrence === "첫 공개일만 확인" && parseOttCadence("OTT 전편 공개; KBS2 11/27 금 20:30 첫방", "2026-11-20", 6).runKind === "single");
  check("OTT: 매주 + 종영일이 적혀 있으면 그 날짜", parseOttCadence("매주 수요일 1화, 2027-02-03 종영 예정", "2026-12-02", 10).end === "2027-02-03");
}

// ── OTT 화면 배치(경쟁 비교 맨 아래 묶음·미정 목록·줄 쌓기) ──
{
  const mkOutlet = (id: string, code: string, name: string, ott: boolean, sortOrder: number): OutletDto => ({ id, code, name, side: "rival", color: "#123456", logo: null, group: null, ott, sortOrder });
  const outlets = [mkOutlet("o1", "TVN", "tvN", false, 10), mkOutlet("o2", "OTT_FAKE", "가상플러스", true, 30)];
  const slots: SlotDto[] = [
    { id: "s1", outletId: "o1", name: "월화 22:00", days: [1, 2], startMinute: 1320, timeNote: null, compareBlock: "mon_tue", defaultGenre: "drama", sortOrder: 1 },
    { id: "s2", outletId: "o2", name: "공개 일정", days: [1, 2, 3, 4, 5, 6, 7], startMinute: null, timeNote: null, compareBlock: "other", defaultGenre: "other", sortOrder: 1 },
  ];
  const mkRun = (id: string, slotId: string, draw: DrawSpan | null, extra: Partial<RunDto> = {}): RunDto => ({
    id, slotId, workId: null, runKind: "single", status: "confirmed", startDate: draw?.from ?? null, startPrecision: draw ? "day" : "unknown", endDate: draw?.to ?? null,
    endPrecision: draw ? "day" : "unknown", startText: null, endText: null, episodes: null, episodeFrom: null, recurrence: null, airDates: null, label: null, reason: null,
    note: null, needsReview: false, sourceId: null, sourceCell: null, sourceText: null, updatedAt: "", archived: false, draw, rivals: [], ...extra,
  });
  const dia = (d: string): DrawSpan => ({ shape: "diamond", from: d, to: d, estimatedFrom: null, dates: [d] });
  const runs = [
    mkRun("r1", "s2", dia("2026-12-01")),
    mkRun("r2", "s2", dia("2026-12-03")),
    mkRun("r3", "s2", null, { runKind: "series", workId: "w3" }),
    mkRun("r4", "s1", { shape: "bar", from: "2026-12-01", to: "2026-12-27", estimatedFrom: null, dates: null }, { runKind: "series" }),
  ];
  const works: WorkDto[] = [{ id: "w3", title: "가상 미정극", shortTitle: null, tentative: false, genre: "drama", totalEpisodes: null, cast: [], directors: [], writers: [], producers: [], logline: null, ottNote: null, note: null }];
  const data = { ok: true, from: "2026-12-01", to: "2027-02-28", today: "2026-12-01", canEdit: false, outlets, slots, works, runs, holidays: [], events: [], sources: [], gaps: [] } as LineupPayload;
  const f = { channels: [], genres: [], dows: [] };
  const cmp = buildCompareRows(data, f);
  const labels = cmp.rows.map((r) => `${r.kind}:${r.label}${r.chip ? `|${r.chip}` : ""}`);
  // 이 묶음에 KT ENA 편성이 없으면 빈 KT ENA 줄을 만들지 않는다(2026-11-26 사용자 요청)
  check("OTT 배치: 경쟁 비교 맨 아래에 OTT 묶음, 방송사는 요일 묶음에 그대로, 편성 없는 KT ENA 줄은 없음", labels.join(",") === "group:월화,slot:tvN|월화,group:OTT · 공개 일정,slot:가상플러스|OTT", labels);
  // 2차 개선(P0-06): 요일 필터는 TV 방송에만 — OTT 공개 일정은 요일을 골라도 남는다
  check("OTT 배치: 요일을 골라도 OTT 묶음은 남음(요일은 TV에만)", buildCompareRows(data, { ...f, dows: [1] }).rows.some((r) => r.key === "b:ott"));
  check("OTT 배치: OTT '없음'이면 OTT 묶음 빠짐, 방송사 '없음'이면 tvN 줄 빠짐", !buildCompareRows(data, { ...f, ott: "none" }).rows.some((r) => r.key === "b:ott") && !buildCompareRows(data, { ...f, tv: "none" }).rows.some((r) => r.label === "tvN"));
  const und = buildUndated(data, f);
  check("OTT 배치: 날짜 없는 작품은 플랫폼별 '공개 시기 미정' 목록", und.length === 1 && und[0].outlet.code === "OTT_FAKE" && und[0].runs[0].id === "r3" && buildUndated(data, { ...f, dows: [1] }).length === 0);
  const yearRun = mkRun("r6", "s2", { shape: "bracket", from: "2027-01-01", to: "2027-12-31", estimatedFrom: null, dates: null }, { runKind: "series", startPrecision: "month", startDate: "2027-01-01", endDate: "2027-12-31", endPrecision: "month", startText: "2027년" });
  const withYear = { ...data, runs: [...runs, yearRun] } as LineupPayload;
  const cmpYear = buildCompareRows(withYear, f);
  const undYear = buildUndated(withYear, f);
  check("OTT 배치: 공개 연도만 아는 작품은 격자에서 빼고 목록으로(연도 아는 작품이 먼저)", !(cmpYear.runsBySlot.get("s2") ?? []).some((r) => r.id === "r6") && undYear[0]?.runs.map((r) => r.id).join() === "r6,r3" && periodText(yearRun) === "2027년", undYear[0]?.runs.map((r) => r.id));
  const near = assignLanes([runs[0], runs[1]], { labelDays: () => 10 });
  const far = assignLanes([runs[0], mkRun("r5", "s2", dia("2027-01-20"))], { labelDays: () => 10 });
  check("OTT 줄 쌓기: 공개일이 가까우면(제목 글자가 겹치면) 줄을 늘리고 멀면 한 줄", near.main.length === 2 && far.main.length === 1 && near.events.length === 0, { near: near.main.length, far: far.main.length });
  check("OTT 표기: 자리 글자 없음·형태 말·일정 미정", slotLabel(slots[1], outlets[1]) === "" && slotLabel(slots[0], outlets[0]) === "월화 22:00" && kindLabel(runs[0], true) === "공개일" && kindLabel(runs[2], true) === "공개 시기 미정" && periodText(runs[2]) === "일정 미정");
}

// ── 월 캘린더 보기(가상 제목만) ──
{
  const o = (id: string, code: string, name: string, side: "own" | "rival", ott = false, sortOrder = 1): OutletDto => ({ id, code, name, side, color: "#123456", logo: null, group: null, ott, sortOrder });
  const outlets = [o("o1", "ENA", "ENA", "own"), o("o2", "SBS", "SBS", "rival", false, 2), o("o3", "OTT_FAKE", "가상OTT", "rival", true, 3)];
  const sl = (id: string, outletId: string, days: number[], startMinute: number | null, g: SlotDto["defaultGenre"]): SlotDto => ({ id, outletId, name: id, days, startMinute, timeNote: null, compareBlock: "other", defaultGenre: g, sortOrder: 1 });
  const slots = [sl("s1", "o1", [1, 2], 1290, "drama"), sl("s2", "o2", [3, 4], 1260, "drama"), sl("s3", "o3", [1, 2, 3, 4, 5, 6, 7], null, "other")];
  const wk = (id: string, title: string, genre: WorkDto["genre"] = "drama", cast: string[] = []): WorkDto => ({ id, title, shortTitle: null, tentative: false, genre, totalEpisodes: null, cast, directors: [], writers: [], producers: [], logline: null, ottNote: null, note: null });
  const works = [{ ...wk("w1", "가상극A", "drama", ["가상배우 갑", "가상배우 을"]), shortTitle: "가상A" }, wk("w2", "가상극B"), wk("w3", "가상극C"), wk("w4", "가상OTT작품", "variety"), wk("w5", "가상극D"), wk("w6", "가상월간"), wk("w7", "가상미정", "variety")];
  const mk = (id: string, slotId: string, workId: string | null, p: Partial<RunDto>): RunDto => {
    const slot = slots.find((s) => s.id === slotId) as SlotDto;
    const base = { runKind: "series", startDate: null, startPrecision: "day", endDate: null, endPrecision: "day", episodes: null, recurrence: null, airDates: null, ...p } as RunDto;
    const draw = drawSpan({ runKind: base.runKind, startDate: base.startDate, startPrecision: base.startPrecision, endDate: base.endDate, endPrecision: base.endPrecision, episodes: base.episodes, recurrence: base.recurrence, airDates: base.airDates }, slot.days, "2027-12-31");
    return { ...base, id, slotId, workId, status: "confirmed", startText: null, endText: null, episodeFrom: null, label: null, reason: null, note: null, needsReview: false, sourceId: null, sourceCell: null, sourceText: null, updatedAt: "", archived: false, rivals: [], draw } as RunDto;
  };
  const runs = [
    mk("c1", "s1", "w1", { startDate: "2027-01-04", endDate: "2027-02-16", episodes: 12 }), // ENA 월화
    mk("c2", "s2", "w2", { startDate: "2027-01-06", endDate: "2027-02-25", episodes: 16 }), // SBS 수목, 첫방 1/6
    mk("c3", "s2", "w3", { startDate: "2027-02-03", startPrecision: "week", endPrecision: "week", endDate: null, episodes: 16 }), // 주 단위
    mk("c4", "s3", "w4", { runKind: "series", startDate: "2027-01-06", endDate: "2027-02-17", episodes: 8 }), // OTT 매주
    mk("c5", "s3", "w7", { runKind: "tbd", startDate: null, startPrecision: "unknown", endPrecision: "unknown" }), // 날짜 없음(그리지 않음)
    mk("c6", "s2", "w5", { startDate: "2027-01-01", startPrecision: "month", endDate: "2027-01-31", endPrecision: "month" }), // 월 단위
    mk("c7", "s1", "w6", { runKind: "monthly", startDate: "2027-01-01", endDate: "2027-03-31", recurrence: "월1회·마지막주" }),
    mk("c8", "s1", null, { runKind: "hiatus", startDate: "2027-01-11", endDate: "2027-01-17", episodes: null, label: "결방" }),
  ];
  const data = { ok: true, from: "2026-12-28", to: "2027-02-28", today: "2027-01-02", canEdit: false, outlets, slots, works, runs, holidays: [{ date: "2027-01-01", name: "신정" }], events: [], sources: [], gaps: [{ slotId: "s1", from: "2027-02-17", to: "2027-02-28", weeks: 2 }] } as unknown as LineupPayload;
  const jan = { from: "2027-01-01", to: "2027-01-31" };
  const cal = buildCalendar(data, { ...jan, channels: [], genres: [], hide: [] });
  check("캘린더: 월요일 시작 주 5줄(12/28~1/31)", cal.weeks.length === 5 && cal.weeks[0].start === "2026-12-28" && cal.weeks[4].start === "2027-01-25", cal.weeks.map((w) => w.start));
  check("캘린더: 범위 밖 날(12/28~31)은 inRange false, 신정 표시", !cal.weeks[0].days[0].inRange && cal.weeks[0].days[4].holiday === "신정" && cal.weeks[0].days[4].inRange);
  const bar1 = cal.weeks[1].bars.find((b) => b.runId === "c1");
  const wd = bar1 ? barWeekDays(bar1, "2027-01-04") : [];
  check("캘린더: 월화 작품은 월·화 칸에만(첫방 월요일 가장 진함·회차 추정·시각)", wd.map((d) => `${d.col}${d.kind}${d.episode}`).join() === "0first1회,1air2회" && bar1?.time === "21:30", wd);
  const wk3 = bar1 ? barWeekDays(bar1, "2027-01-11") : [];
  check("캘린더: 휴방 주(1/11~17)와 쉬는 요일에는 아무것도 그리지 않음", wk3.length === 0 && wd.every((d) => d.col <= 1));
  const febLast = buildCalendar(data, { from: "2027-02-01", to: "2027-02-28", channels: [], genres: [], hide: [] });
  const lastDays = febLast.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c1").flatMap((b) => b.days);
  const lastSet = [...new Set(lastDays.filter((d) => d.last).map((d) => d.date))];
  const firstOnly = buildCalendar(data, { ...jan, channels: [], genres: [], hide: [], show: ["first"] });
  const fDays = firstOnly.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c1").flatMap((b) => b.days.map((d) => d.date));
  check("캘린더: 첫방만 보기 — 첫 월·화 묶음(1/4·1/5)만", [...new Set(fDays)].join() === "2027-01-04,2027-01-05", fDays);
  const endOnly = buildCalendar(data, { from: "2027-02-01", to: "2027-02-28", channels: [], genres: [], hide: [], show: ["end"] });
  const eDays = [...new Set(endOnly.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c1").flatMap((b) => b.days.map((d) => d.date)))];
  check("캘린더: 종영일 보기 — 마지막 월·화 묶음(2/15·2/16)만", eDays.join() === "2027-02-15,2027-02-16", eDays);
  const offOwn = buildCalendar(data, { ...jan, channels: [], genres: [], hide: [], show: [] });
  check("캘린더: 자사 방송일 보기를 모두 끄면 자사 작품 없음", offOwn.weeks.every((w) => w.bars.length === 0));
  const allDays = cal.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c1").flatMap((b) => b.days);
  check("캘린더: 출연자는 첫 회에만(opening) · 추정 표기 없음 · 줄임말 필드", new Set(allDays.filter((d) => d.opening).map((d) => d.date)).size === 1 && allDays.every((d) => !d.episode.includes("추정")) && cal.weeks.flatMap((w) => w.bars).find((b) => b.runId === "c1")?.shortTitle === "가상A");
  check("캘린더: 마지막 방송일(2/16)에만 종영 표시", lastSet.join() === "2027-02-16" && lastDays[lastDays.length - 1].date === "2027-02-16", lastDays.slice(-3));
  check("캘린더: 같은 작품은 주가 바뀌어도 같은 줄", cal.weeks.filter((w) => w.bars.some((b) => b.runId === "c1")).every((w) => w.bars.find((b) => b.runId === "c1")?.lane === bar1?.lane));
  const sbsMarks = cal.weeks[1].days[2].marks;
  check("캘린더: 타사 첫방은 1/6 칸에 표식(▶), 날짜 단위", sbsMarks.some((m) => m.runId === "c2" && m.kind === "first" && !m.approx), sbsMarks);
  const ottMark = cal.weeks[1].days[2].marks.find((m) => m.runId === "c4");
  check("캘린더: OTT 매주 공개는 첫 공개일에 ◆ 한 번만(매주 반복 없음)", ottMark?.kind === "open" && cal.weeks.flatMap((w) => w.days).filter((d) => d.marks.some((m) => m.runId === "c4")).length === 1);
  check("캘린더: 주 단위 자료(c3)는 날짜 칸에 놓지 않고 2월 주 띠에만", !cal.weeks.some((w) => w.strip.length > 0) && cal.weeks.flatMap((w) => w.days).every((d) => !d.marks.some((m) => m.runId === "c3")));
  const feb = buildCalendar(data, { from: "2027-02-01", to: "2027-02-28", channels: [], genres: [], hide: [] });
  check("캘린더: 주 단위 자료는 그 주(2/1 주) 띠 '≈'", feb.weeks.find((w) => w.start === "2027-02-01")?.strip.map((s) => s.runId).join() === "c3");
  check("캘린더: 종영일 표식(OTT 2/17·타사 2/25)", feb.weeks.flatMap((w) => w.days).some((d) => d.date === "2027-02-17" && d.marks.some((m) => m.runId === "c4" && m.kind === "end")) && feb.weeks.flatMap((w) => w.days).some((d) => d.date === "2027-02-25" && d.marks.some((m) => m.runId === "c2" && m.kind === "end")));
  check("캘린더: 월 단위 자료는 '이 달 예정' 상자", cal.monthBoxes.length === 1 && cal.monthBoxes[0].ym === "2027-01" && cal.monthBoxes[0].items.some((i) => i.runId === "c6"), cal.monthBoxes);
  check("캘린더: 날짜 없는 OTT는 달력에 놓지 않고 아래 목록", cal.undated.length === 1 && cal.undated[0].runs[0].id === "c5" && !cal.weeks.flatMap((w) => w.days).some((d) => d.marks.some((m) => m.runId === "c5")));
  const monthly = cal.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c7" && b.single).map((b) => b.days[0].date);
  check("캘린더: 월 1회(자리 첫 요일=월요일의 마지막 주) 1/25 하루 칸만", monthly.join() === "2027-01-25", monthly);
  const febCal = feb.weeks.flatMap((w) => w.bars).find((b) => b.kind === "gap");
  check("캘린더: 자사 드라마 빈 자리는 '2주 비어있음' 점선 칸", febCal?.title === "2주 비어있음");
  const hidden = buildCalendar(data, { ...jan, channels: [], genres: [], hide: ["own", "ott"] });
  check("캘린더: 표시 끄기 — 자사 막대·OTT 표식·미정 목록이 사라지고 타사만 남음", hidden.weeks.every((w) => w.bars.length === 0) && !hidden.weeks.flatMap((w) => w.days).some((d) => d.marks.some((m) => m.ott)) && hidden.undated.length === 0 && hidden.weeks.flatMap((w) => w.days).some((d) => d.marks.some((m) => m.runId === "c2")));
  const noHoliday = buildCalendar(data, { ...jan, channels: [], genres: [], hide: ["event"] });
  check("캘린더: 공휴일·행사 끄기", noHoliday.weeks[0].days[4].holiday === null);
  const d5 = dayAirings(data, "2027-01-05", [], []);
  check("그날 편성: 화요일 — 자사 2회(추정) 먼저", d5[0]?.own && d5[0].title === "가상극A" && d5[0].episode === "2회", d5);
  const d6 = dayAirings(data, "2027-01-06", [], []);
  check("그날 편성: 1/6 — 타사 첫방 + OTT 공개(시각 없는 줄은 뒤)", d6.map((r) => r.title).join() === "가상극B,가상OTT작품" && d6[0].tag === "첫방" && d6[1].tag === "공개", d6);
  check("그날 편성: 휴방 1/12·방송 요일 아닌 날은 비어 있음", dayAirings(data, "2027-01-12", [], []).every((r) => r.title !== "가상극A") && dayAirings(data, "2027-01-07", [], []).every((r) => r.title !== "가상극A"));
  // 홀드백(방영 가능 일시)
  const rGyeol = holdbackRuleFor("결이 다른 전쟁사", "variety");
  check("홀드백 규칙: 전쟁사 — ENA Drama 직후·그 밖 5채널 4주 후·ENA 자신 없음", rGyeol?.delays.ENA_DRAMA === 0 && rGyeol.delays.ENA_PLAY === 28 && rGyeol.delays.SKYUHD === 28 && rGyeol.delays.ENA === undefined);
  const rKau = holdbackRuleFor("카드 한 장에 우정이 흔들리는 줄은 몰랐습니다만", "variety");
  check("홀드백 규칙: 카우몰 — OLIFE 제외 5채널 직후", !!rKau && Object.keys(rKau.delays).length === 5 && rKau.delays.OLIFE === undefined && rKau.delays.ONCE === 0);
  const rPlay = holdbackRuleFor("맡겨만 주십숏", "variety");
  check("홀드백 규칙: 맡겨만 주십숏 — ENA Play만 직후, 그 밖 28일", rPlay?.delays.ENA_PLAY === 0 && rPlay.delays.ONCE === 28);
  check("홀드백 규칙: 오리지널 드라마는 기본 규칙(6채널 직후), 규칙 없는 예능은 null", holdbackRuleFor("가상극Z", "drama")?.id === "drama" && holdbackRuleFor("가상예능Z", "variety") === null);
  const hbData = { ...data, holdbackMinutes: { w1: 51 }, holdbackEnds: { w1: { "2027-01-05": 1342 } } } as LineupPayload;
  const hb = holdbackMarks(hbData, "ENA_PLAY", "2027-01-01", "2027-01-31").filter((m) => m.workId === "w1");
  check("홀드백: 방송 길이 중간값 — 1/4 21:30 시작 + 51분 → 22:21 직후 가능", hb[0]?.date === "2027-01-04" && hb[0].time === "22:21" && hb[0].episode === "1회", hb[0]);
  check("홀드백: 이미 방송된 회차는 실제 종료 시각(1/5 22:22)", hb[1]?.date === "2027-01-05" && hb[1].time === "22:22", hb[1]);
  const hbMid = holdbackMarks({ ...hbData, holdbackMinutes: { w1: 80 }, holdbackEnds: {} } as LineupPayload, "OLIFE", "2027-01-01", "2027-01-31").find((m) => m.workId === "w1");
  check("홀드백: 자정을 넘기면 다음 날 날짜(21:30 + 80분 → 1/5 22:50은 같은 날, 100분 → 다음 날)", hbMid?.date === "2027-01-04" && holdbackMarks({ ...hbData, holdbackMinutes: { w1: 150 }, holdbackEnds: {} } as LineupPayload, "OLIFE", "2027-01-01", "2027-01-31").find((m) => m.workId === "w1")?.date === "2027-01-05");
  const noDur = holdbackMarks({ ...data, holdbackMinutes: {}, holdbackEnds: {} } as LineupPayload, "ENA_PLAY", "2027-01-01", "2027-01-31").find((m) => m.workId === "w1");
  check("홀드백: 방송 길이를 모르면 시각 없이 날짜만(추정 금지)", noDur?.time === null && noDur.date === "2027-01-04");
  check("홀드백: ENA 자신은 계산하지 않음, 규칙 없는 타사 작품은 안 나옴", holdbackMarks(hbData, "ENA", "2027-01-01", "2027-01-31").length === 0 && !holdbackMarks(hbData, "ENA_PLAY", "2027-01-01", "2027-01-31").some((m) => m.workId === "w2"));
  const calHb = buildCalendar(hbData, { ...jan, channels: [], genres: [], hide: [], can: "ENA_PLAY" });
  check("홀드백: 캘린더 1/4 칸에 가능 표식(◇)과 시각", calHb.weeks[1].days[0].marks.some((m) => m.kind === "avail" && m.note === "≈22:21~"), calHb.weeks[1].days[0].marks);
  const cl = clampRange("2027-03-01", "2027-06-01");
  check("캘린더: 기간 지정은 42일까지(길면 자름)·거꾸로 적어도 바로잡음", cl.clipped && cl.to === "2027-04-11" && clampRange("2027-02-05", "2027-02-01").from === "2027-02-01");
  const fr = calendarFetchRange("2027-01-01", "2027-01-31");
  check("캘린더: 자료 범위는 주 단위로 넓힘", fr.from === "2026-12-28" && fr.to === "2027-01-31");

  // ── 2026-11-26 리디자인: 관련 정보·비교 묶음·이벤트 띠(가상 자료) ──
  const rel = relatedFor(data, runs[0]);
  check("상세 관련: 같은 장르 기간 중첩(SBS 가상극B)·방송 기간 중 OTT 공개(가상OTT작품) — 점수 없이 자료만", rel.overlap.some((r) => r.id === "c2") && rel.ott.some((r) => r.id === "c4") && !rel.nearby.some((r) => r.id === "c2"), { o: rel.overlap.map((r) => r.id), t: rel.ott.map((r) => r.id), n: rel.nearby.map((r) => r.id) });
  const byTime = buildCompareRows(data, { channels: [], genres: [], dows: [] }, "time");
  check("경쟁 비교 묶음: 동시간대 — 21시대(자사 21:30 위)·OTT는 맨 아래", byTime.rows[0]?.kind === "group" && byTime.rows[0].label.startsWith("21시대") && byTime.rows[1]?.emphasis === true && byTime.rows[byTime.rows.length - 2]?.label === "OTT · 공개 일정", byTime.rows.map((r) => r.label));
  const byGenre = buildCompareRows(data, { channels: [], genres: [], dows: [] }, "genre");
  check("경쟁 비교 묶음: 동일 장르 — 드라마 묶음", byGenre.rows[0]?.label === "드라마", byGenre.rows.map((r) => r.label));
  const onlyOtt = buildCompareRows(data, { channels: [], genres: [], dows: [], outlets: ["OTT_FAKE"] }, "dow");
  check("경쟁 비교: 방송사·OTT 거르기 — 고른 OTT만(경쟁 방송사 줄 없음)", !onlyOtt.rows.some((r) => r.outlet?.code === "SBS") && onlyOtt.rows.some((r) => r.outlet?.code === "OTT_FAKE"));
  const plannedOnly = buildCompareRows(data, { channels: [], genres: [], dows: [], statuses: ["planned"] }, "all");
  check("경쟁 비교: 상태 거르기 — 확정만 있는 가상 자료에서 예정이면 작품 구간 없음(휴방 칸은 남음)", [...plannedOnly.runsBySlot.values()].flat().every((r) => !r.workId), [...plannedOnly.runsBySlot.values()].flat().map((r) => r.id));
  const evData = { ...data, holidays: [{ date: "2027-02-06", name: "설날 연휴" }, { date: "2027-02-07", name: "설날" }, { date: "2027-02-08", name: "설날 연휴" }, { date: "2027-02-09", name: "대체공휴일" }], events: [{ id: "e1", name: "가상 시상식", kind: "awards", startDate: "2027-02-05", endDate: "2027-02-05" }] } as LineupPayload;
  const lane = laneEvents(evData);
  check("이벤트: 이어지는 설 공휴일 4일 → 설 연휴 한 구간(2/6~2/9), 등록 이벤트는 따로", lane.length === 2 && lane[1].title === "설 연휴" && lane[1].from === "2027-02-06" && lane[1].to === "2027-02-09" && lane[0].kind === "awards", lane.map((e) => [e.title, e.from, e.to]));
  // 일정 종류(2026-11-26): 첫방만 고르면 종영·특집이 빠지고, 특집을 고르면 월 1회·단발이 나온다
  const onlyFirst = buildCalendar(data, { ...jan, channels: [], genres: [], hide: [], show: ["first"] });
  const allMarks = (m: ReturnType<typeof buildCalendar>) => m.weeks.flatMap((w) => w.days.flatMap((d) => d.marks));
  check("일정 종류: 첫방만 — 경쟁 첫방·OTT 공개는 있고 종영·자사 월 1회는 없음", allMarks(onlyFirst).some((m) => m.runId === "c2" && m.kind === "first") && allMarks(onlyFirst).some((m) => m.runId === "c4") && !allMarks(onlyFirst).some((m) => m.kind === "end") && !onlyFirst.weeks.flatMap((w) => w.bars).some((b) => b.runId === "c7"));
  const onlySpecial = buildCalendar(data, { ...jan, channels: [], genres: [], hide: [], show: ["special"] });
  check("일정 종류: 특집만 — 자사 월 1회는 있고 경쟁 첫방은 없음", onlySpecial.weeks.flatMap((w) => w.bars).some((b) => b.runId === "c7") && !allMarks(onlySpecial).some((m) => m.runId === "c2"));
  // 회차 별도(재방·재편집이 섞인 편성): 메모의 '회차 편성표:' 줄을 날짜별 회차로, 첫방·종영 표시 없음
  const tblRun = { ...runs[0], id: "c9", recurrence: EPISODE_TABLE, note: "회차 편성표: 1/4 17회 · 1/5 스페셜 2 · 1/11 16회\n설명 줄 1/12 무시" } as RunDto;
  const tbl = episodeTable(tblRun);
  check("회차 별도: 편성표 줄만 읽고 연도는 기간 안에서", tbl?.get("2027-01-04") === "17회" && tbl?.get("2027-01-05") === "스페셜 2" && tbl?.size === 3, tbl && [...tbl.entries()]);
  const tblCal = buildCalendar({ ...data, runs: [tblRun] } as LineupPayload, { ...jan, channels: [], genres: [], hide: [] });
  const tblDays = tblCal.weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c9").flatMap((b) => b.days);
  check("회차 별도: 캘린더 회차 = 편성표, 첫방·종영 표시 없음, 편성표에 없는 날은 빈 회차", tblDays[0]?.episode === "17회" && tblDays[1]?.episode === "스페셜 2" && tblDays.every((d) => d.kind === "air" && !d.last) && tblDays.some((d) => d.episode === ""), tblDays.slice(0, 4));
  // 이어지는 편성(장수 예능 자료 구간 경계): 중간 회차부터 시작하면 첫방 아님, 같은 자리 뒤 구간이 있으면 종영 아님
  const contA = { ...runs[0], id: "c10", episodeFrom: 161 } as RunDto;
  const contB = { ...runs[0], id: "c11", startDate: "2027-02-22", endDate: null, endPrecision: "open" } as RunDto;
  const contDays = buildCalendar({ ...data, runs: [contA, contB] } as LineupPayload, { from: "2027-01-01", to: "2027-02-28", channels: [], genres: [], hide: [] }).weeks.flatMap((w) => w.bars).filter((b) => b.runId === "c10").flatMap((b) => b.days);
  check("이어지는 편성: 중간 회차 시작은 첫방 아님 · 같은 자리 뒤 구간이 있으면 종영 아님", contDays.length > 0 && contDays.every((d) => d.kind === "air" && !d.last), contDays.slice(0, 2));
  const febEv = buildCalendar(evData, { from: "2027-02-01", to: "2027-02-28", channels: [], genres: [], hide: [] });
  const bands = febEv.weeks.flatMap((w) => w.bands).filter((b) => b.ev.title === "설 연휴");
  check("캘린더 종일 띠: 주를 넘는 연휴는 두 주에 이어 그림(앞 주 끝 이어짐·다음 주 이어받음)", bands.length === 2 && bands[0].contToNext && bands[0].col0 === 5 && bands[0].col1 === 6 && bands[1].contFromPrev && bands[1].col0 === 0 && bands[1].col1 === 1, bands.map((b) => [b.col0, b.col1, b.contFromPrev, b.contToNext]));
}

// ── 2026-11-26 리디자인: 토큰 대비·표기·검색·OTT 정밀도·이벤트 입력·주소 ──
check("토큰: 장르 채움 위 글자 대비 4.5:1 이상(밝은 시안 위는 어두운 글씨)", (Object.keys(GENRE_FILL) as (keyof typeof GENRE_FILL)[]).every((g) => contrastRatio(GENRE_FILL[g], GENRE_ON[g]) >= 4.5) && GENRE_ON.business === "#17181c", Object.fromEntries(Object.keys(GENRE_FILL).map((g) => [g, contrastRatio(GENRE_FILL[g as "drama"], GENRE_ON[g as "drama"]).toFixed(2)])));
check("토큰: 사업형 = ENA PLAY 공식 BI 시안 #00C8D2(어두운 청록 아님)", GENRE_FILL.business === "#00c8d2" && BRAND.ENA_PLAY === "#00c8d2");
check("토큰: 보조 글자 대비(흰 바탕·페이지 바탕 4.5:1 이상), 입력 테두리·빈 자리 빨강 기준", contrastRatio(UI.text2, UI.canvas) >= 4.5 && contrastRatio(UI.text2, UI.page) >= 4.5 && contrastRatio(UI.control, UI.canvas) >= 3 && contrastRatio(UI.danger, UI.canvas) >= 4.5);
{
  const base = { id: "x", slotId: "s", workId: "w", runKind: "series", status: "confirmed", startText: null, endText: null, episodeFrom: null, recurrence: null, airDates: null, label: null, reason: null, note: null, needsReview: false, sourceId: null, sourceCell: null, sourceText: null, updatedAt: "", archived: false, rivals: [], draw: null } as unknown as RunDto;
  const r = (p: Partial<RunDto>) => ({ ...base, ...p }) as RunDto;
  const span = r({ startDate: "2026-11-16", startPrecision: "day", endDate: "2026-12-22", endPrecision: "day", episodes: 12 });
  const wkStart = r({ startDate: "2026-11-30", startPrecision: "week", endDate: "2027-01-05", endPrecision: "week", episodes: 12 });
  const startOnly = r({ startDate: "2026-12-01", startPrecision: "day", endDate: null, endPrecision: "unknown", episodes: null });
  const open = r({ startDate: "2026-10-01", startPrecision: "day", endDate: null, endPrecision: "open", episodes: null });
  check("기간 표기: 11.16–12.22 · 주 단위 ≈ · 상시 종료 미정 · 시작만 기간 미정", periodDot(span) === "11.16–12.22" && periodDot(wkStart) === "≈11.30–≈01.05" && periodDot(open) === "10.01– 종료 미정" && periodDot(startOnly) === "12.01– 기간 미정", [periodDot(span), periodDot(wkStart), periodDot(open), periodDot(startOnly)]);
  check("막대 범위: 첫방일만(끝·편수 없음)은 임의 4주 막대 대신 시작 표식, 상시는 열린 끝", runExtent(startOnly) === "start" && runExtent(open) === "open" && runExtent(span) === "span" && runExtent(r({ ...startOnly, episodes: 8 })) === "span");
  const w = { id: "w", title: "가상 드라마 하나", shortTitle: "가드", tentative: false, genre: "drama", totalEpisodes: 12, cast: ["가상배우 갑"], directors: [], writers: [], producers: [], logline: null, ottNote: null, note: null } as WorkDto;
  check("검색: 띄어쓰기 무시 제목·줄임말·출연진", runMatchesQuery(span, w, "가상드라마") && runMatchesQuery(span, w, "가드") && runMatchesQuery(span, w, "배우 갑") && !runMatchesQuery(span, w, "없는말"));
  check("OTT 정밀도: 미정 · 반기 · 연도 · 월 · 일자", ottBucket(r({ startDate: null, startPrecision: "unknown" })) === "none" && ottBucket(r({ startDate: "2027-01-01", startPrecision: "month", startText: "2027년 상반기", endDate: "2027-06-30", endPrecision: "month" })) === "half" && ottBucket(r({ startDate: "2027-01-01", startPrecision: "month", startText: "2027년", endDate: "2027-12-31", endPrecision: "month" })) === "year" && ottBucket(r({ startDate: "2027-01-01", startPrecision: "month", startText: "2027년 1월", endDate: "2027-01-31", endPrecision: "month" })) === "month" && ottBucket(span) === "day");
}
{
  const ok = parseEventInput({ name: "가상 대회", kind: "sports", startDate: "2027-02-01", endDate: "2027-02-03" }, false);
  const movieBefore = parseEventInput({ name: "가상 영화", kind: "movie", startDate: "2027-02-01" }, false);
  const movieAfter = parseEventInput({ name: "가상 영화", kind: "movie", startDate: "2027-02-01" }, true);
  check("이벤트 입력: 기존 유형은 확장 전에도 저장, 영화 개봉은 확장(승인) 뒤에만", ok.ok && !movieBefore.ok && movieAfter.ok && movieAfter.value.endDate === "2027-02-01");
  check("이벤트 입력: 종료<시작·시각 없는 지정 시간·잘못된 출처 URL은 거절", !parseEventInput({ name: "가", kind: "other", startDate: "2027-02-03", endDate: "2027-02-01" }, true).ok && !parseEventInput({ name: "가", kind: "other", startDate: "2027-02-03", allDay: false }, true).ok && !parseEventInput({ name: "가", kind: "other", startDate: "2027-02-03", sourceUrl: "javascript:alert(1)" }, true).ok);
  const merged = mergeHolidays([{ date: "2027-03-01", name: "삼일절" }]);
  check("이벤트: 하루 공휴일은 이름 그대로", merged.length === 1 && merged[0].title === "삼일절");
  const pl = placeLane([{ leftPx: 0, widthPx: 50 }, { leftPx: 20, widthPx: 50 }, { leftPx: 30, widthPx: 50 }, { leftPx: 100, widthPx: 20 }], 2, 4);
  check("이벤트 띠: 겹치면 둘째 줄, 둘째 줄도 차면 +N으로 넘김", pl.placed.length === 3 && pl.overflow.length === 1 && pl.placed.find((p) => p.leftPx === 20)?.row === 1 && pl.placed.find((p) => p.leftPx === 100)?.row === 0);
}
{
  const q = parseLineupQuery((k) => ({ view: "compare", len: "5", st: "planned,bad", out: "tvn,SBS", q: "가상", cmp: "time", empty: "1" } as Record<string, string>)[k], "2026-10");
  const back = new URLSearchParams(lineupSearch(q, "2026-10"));
  check("주소: 새 조건(상태·방송사·검색·비교 묶음·직접 지정 길이) 읽고 다시 씀 — 옛 out=TV코드는 방송사 일부·OTT 없음으로(옛 화면 그대로)", q.len === 5 && q.st.join() === "planned" && JSON.stringify(q.tv) === '["TVN","SBS"]' && q.ott === "none" && back.get("tv") === "TVN,SBS" && back.get("ott") === "none" && !back.has("out") && q.cmp === "time" && q.empty && back.get("cmp") === "time" && back.get("st") === "planned" && back.get("len") === "5" && back.get("q") === "가상", Object.fromEntries(back));
  const cal = parseLineupQuery((k) => ({ view: "calendar" } as Record<string, string>)[k], "2026-10");
  check("주소: 캘린더 기본 = 첫방·종영 + KT ENA 전체 회차, 기본값은 주소에서 뺌, 특집 키 읽음", cal.show.join() === "first,end,all" && !new URLSearchParams(lineupSearch(cal, "2026-10")).has("show") && parseLineupQuery((k) => ({ view: "calendar", show: "first,special" } as Record<string, string>)[k], "2026-10").show.join() === "first,special");
  // 기본 시작 = 오늘이 든 주의 월요일(2026-11-26 사용자 요청)
  check("기본 시작: 2026-11-26(목) → 그 주 월요일 11/23, 일요일 11/29도 11/23", weekStartOf("2026-11-26") === "2026-11-23" && weekStartOf("2026-11-29") === "2026-11-23" && weekStartOf("2026-11-30") === "2026-11-30");
  const wq = parseLineupQuery(() => undefined, "2026-11-23", "2026-11");
  check("기본 시작: 날짜 시작 8개월 = 11/23 ~ 다음 해 7/22, 캘린더 기본 달 = 이번 달", wq.from === "2026-11-23" && queryRange(wq.from, wq.len).to === "2027-07-22" && wq.month === "2026-11" && !new URLSearchParams(lineupSearch(wq, "2026-11-23", "2026-11")).has("from"), queryRange(wq.from, wq.len));
  check("기간: 옛 달 시작(2026-10, 8개월)은 그대로 10/1~5/31, 말일 넘침은 그달 말일로", queryRange("2026-10", 8).to === "2027-05-31" && addMonthsDate("2027-01-31", 1) === "2027-02-28");
}

// ── 2026-11-26 2차 개선 P0 회귀(외부 검토 재현 사례) ──
{
  const sp = (from: string, to: string, extra: Partial<GapSpan> = {}): GapSpan => ({ from, to, ...extra });
  // P0-01 빈 주: 겹친 구간을 합친 뒤 계산 — A 1/1~1/31, B 1/5~1/10(A 안), C 2/8~ → 공백은 2/1~2/7만
  const g1 = findGaps("s", [sp("2027-01-01", "2027-01-31"), sp("2027-01-05", "2027-01-10"), sp("2027-02-08", "2027-02-20")], "2026-12-01", "2027-03-31");
  check("P0-01 빈 주: 중첩 구간 합친 뒤 2/1~2/7 한 건(예전 1/11~2/7 오류)", g1.length === 1 && g1[0].from === "2027-02-01" && g1[0].to === "2027-02-07" && g1[0].confirmed, g1);
  const g2 = findGaps("s", [sp("2027-01-01", "2027-01-28", { placeholder: true }), sp("2027-03-01", "2027-03-31")], "2026-12-01", "2027-04-30");
  check("P0-01 빈 주: 앞 편성 끝을 모르면(첫방만 확인) 공백으로 단정하지 않음", g2.length === 0, g2);
  const g3 = findGaps("s", [sp("2027-01-01", "2027-01-31", { endKnown: false }), sp("2027-03-01", "2027-03-31")], "2026-12-01", "2027-04-30");
  check("P0-01 빈 주: 앞 편성 끝이 추정이면 '추정 공백'(confirmed=false)", g3.length === 1 && !g3[0].confirmed, g3);

  // P0-02 동시간대: 공통 방송일 · 실제/추정/인접 구분
  const w = (o: Partial<AirWindow>): AirWindow => ({ days: [1, 2], startMinute: 1290, from: "2027-01-04", to: "2027-02-23", ...o });
  check("P0-02 맞대결: 시작만 가깝고 길이 모름 → 인접 시간대", headToHeadLevel(w({}), w({ startMinute: 1320 })) === "adjacent");
  check("P0-02 맞대결: 먼저 시작한 쪽 검증 길이(70분) 안에 뒤 편성 시작 → 추정 중첩", headToHeadLevel(w({ runtime: 70 }), w({ startMinute: 1320 })) === "estimated");
  check("P0-02 맞대결: 확인된 종료 시각이 서로 안 겹치면 경쟁 아님", headToHeadLevel(w({ endMinute: 1350 }), w({ startMinute: 1350, endMinute: 1420 })) === null);
  check("P0-02 맞대결: 기간은 겹쳐도 공통 방송일이 휴방뿐이면 경쟁 아님", headToHeadLevel(w({ from: "2027-01-04", to: "2027-01-12" }), w({ from: "2027-01-11", to: "2027-02-23", skip: [{ from: "2027-01-11", to: "2027-01-17" }] })) === null);
  check("P0-02 맞대결: 시각 미확인 자리는 판정하지 않음", headToHeadLevel(w({ startMinute: null }), w({})) === null);
  check("P0-02 맞대결: 자정 이후(24:30=1470분) 방송끼리도 비교", headToHeadLevel(w({ startMinute: 1470 }), w({ startMinute: 1480 })) === "adjacent");

  // P0-03 회차: 월화 드라마 1/4 시작, 1/11~1/17 휴방 → 1/18은 3회(월간·그날 일정·홀드백 같은 값)
  const ena: OutletDto = { id: "o1", code: "ENA", name: "ENA", side: "own", color: null, logo: null, group: "A", ott: false, sortOrder: 1 };
  const play: OutletDto = { ...ena, id: "o2", code: "ENA_PLAY", name: "ENA PLAY", sortOrder: 2 };
  const slot: SlotDto = { id: "sl", outletId: "o1", name: "월화 21:30", days: [1, 2], startMinute: 1290, timeNote: null, compareBlock: "mon_tue", defaultGenre: "drama", sortOrder: 1 };
  const SKIP = [{ from: "2027-01-11", to: "2027-01-17" }];
  const mk = (o: Partial<RunDto>): RunDto => {
    const base = { id: "r", slotId: "sl", workId: "wk", runKind: "series", status: "confirmed", startDate: "2027-01-04", startPrecision: "day", endDate: null, endPrecision: "unknown", startText: null, endText: null, episodes: null, episodeFrom: null, recurrence: null, airDates: null, label: null, reason: null, note: null, needsReview: false, sourceId: null, sourceCell: null, sourceText: null, updatedAt: null, archived: false, draw: null, rivals: [], ...o } as RunDto;
    return { ...base, draw: drawSpan(base, slot.days, "2027-12-31", o.runKind === "hiatus" ? undefined : SKIP) };
  };
  const work: WorkDto = { id: "wk", title: "가상 월화극", shortTitle: null, tentative: false, genre: "drama", totalEpisodes: 8, cast: [], directors: [], writers: [], producers: [], logline: null, ottNote: null, note: null };
  const drama = mk({ id: "d1", episodes: 8 });
  const hiat = mk({ id: "h1", workId: null, runKind: "hiatus", startDate: "2027-01-11", endDate: "2027-01-17", endPrecision: "day", label: "휴방" });
  const p3 = { ok: true, from: "2027-01-01", to: "2027-03-31", today: "2026-12-01", canEdit: false, outlets: [ena, play], slots: [slot], works: [work], runs: [drama, hiat], holidays: [], events: [], sources: [], gaps: [], holdbackMinutes: { wk: 60 } } as LineupPayload;
  const calEp = buildCalendar(p3, { from: "2027-01-01", to: "2027-01-31", channels: [], genres: [], hide: [] }).weeks.flatMap((x) => x.bars).flatMap((b) => b.days).find((d) => d.date === "2027-01-18")?.episode;
  const dayEp = dayAirings(p3, "2027-01-18", ["ENA"], []).find((r) => r.runId === "d1")?.episode;
  const air = airingsOf(drama, slot, { work, skip: SKIP, until: "2027-12-31" });
  check("P0-03 회차: 휴방 뒤 1/18 = 3회 — 월간 캘린더·그날 일정 같은 값(예전 그날 일정 5회)", calEp === "3회" && dayEp === "3회", { calEp, dayEp });
  check("P0-03 회차: 8편 + 휴방 1주 → 마지막 8회는 2/2(휴방만큼 밀림)", air.length === 8 && air[7].date === "2027-02-02" && air[7].label === "8회", air.map((a) => a.date));
  check("P0-03 회차: 편수로 정한 그리기 끝도 휴방만큼 늘어남", !!drama.draw && drama.draw.to >= "2027-02-02", drama.draw);

  // P0-05 첫방만 확인: 회차·종영·홀드백을 지어내지 않는다
  const only = mk({ id: "d2", episodes: null });
  const onlyWork = { ...work, totalEpisodes: null };
  check("P0-05 첫방만: 그리기는 배치용(placeholder) 표시", !!only.draw?.placeholder, only.draw);
  check("P0-05 첫방만: 방송일은 첫 방송 하루(예전: 4주·8회 생성)", airingsOf(only, slot, { work: onlyWork, until: "2027-12-31" }).length === 1);
  const p5 = { ...p3, works: [onlyWork], runs: [only] } as LineupPayload;
  const cal5 = buildCalendar(p5, { from: "2027-01-01", to: "2027-02-28", channels: [], genres: [], hide: [] }).weeks.flatMap((x) => x.bars).flatMap((b) => b.days);
  check("P0-05 첫방만: 캘린더는 첫방 1칸만", cal5.length === 1 && cal5[0].kind === "first", cal5);
  const hb5 = holdbackMarks(p5, "ENA_PLAY", "2027-01-01", "2027-03-31");
  check("P0-05 첫방만: 홀드백도 첫 방송분만", hb5.length <= 1, hb5.map((h) => h.enaDate));
  check("P0-05 effectiveEnd: 끝·편수 모르면 null(임의 27일 없음)", effectiveEnd({ runKind: "series", startDate: "2027-01-04", startPrecision: "day", endDate: null, endPrecision: "unknown", episodes: null, recurrence: null, airDates: null }, [1, 2], "2027-12-31").end === null);

  // P0-07 홀드백: 실제 종료 기록과 추정 구분
  const hb7 = holdbackMarks({ ...p3, holdbackEnds: { wk: { "2027-01-04": 1352 } } } as LineupPayload, "ENA_PLAY", "2027-01-01", "2027-01-31");
  const h104 = hb7.find((h) => h.enaDate === "2027-01-04");
  const h105 = hb7.find((h) => h.enaDate === "2027-01-05");
  check("P0-07 홀드백: 실제 종료 기록이 있는 회차는 actual, 없는 회차는 추정", !!h104?.actual && h104.time === "22:32" && !!h105 && !h105.actual && h105.time === "22:30", { h104, h105 });
  check("P0-07 홀드백: 휴방 주에는 방영 가능 표식 없음", !hb7.some((h) => h.enaDate >= "2027-01-11" && h.enaDate <= "2027-01-17"));

  // P0-08 날짜 검증
  check("P0-08 날짜: 2027-02-29·2026-11-31·2026-13-01 거부, 2028-02-29 허용", !isIsoDate("2027-02-29") && !isIsoDate("2026-11-31") && !isIsoDate("2026-13-01") && isIsoDate("2028-02-29") && isIsoDate("2026-12-31"));
  const badQ = parseLineupQuery((k) => ({ from: "2026-11-31", dfrom: "2027-02-29", dto: "2027-03-05" } as Record<string, string>)[k], "2026-11-23");
  check("P0-08 날짜: 주소의 없는 날짜는 기본값으로", badQ.from === "2026-11-23" && badQ.dfrom === null, { from: badQ.from, dfrom: badQ.dfrom });
}

// ── 2차 개선: 비교 범위·선택 모델(전체·일부·없음) — 지시문 §4.4·§10 ──
{
  const P = (o: Record<string, string>) => parseLineupQuery((k) => o[k], "2026-11-23", "2026-11");
  const d0 = P({ view: "compare" });
  check("범위: 기본 = 시장 전체(방송사·OTT 전체), 주소에 안 남음", scopeOf(d0) === "market" && !new URLSearchParams(lineupSearch(d0, "2026-11-23", "2026-11")).has("tv"));
  check("범위: 프리셋 4종 → 선택 상태", scopeOf({ ...d0, ...scopeSel("tv") }) === "tv" && scopeOf({ ...d0, ...scopeSel("ott") }) === "ott" && scopeOf({ ...d0, ...scopeSel("own") }) === "own" && scopeOf({ ...d0, ...scopeSel("market") }) === "market");
  check("범위: 개별 채널을 바꾸면 '맞춤'", scopeOf({ tv: ["SBS"], ott: "all" }) === "custom" && scopeOf({ tv: "all", ott: ["OTT_NETFLIX"] }) === "custom");
  check("선택: 빈 목록은 '없음'(전체와 구분)", selIsNone([]) && !selIsAll([]) && selIsAll("all") && selIsNone("none"));
  const sbs = { id: "x", code: "SBS", name: "SBS", side: "rival", color: null, logo: null, group: null, ott: false, sortOrder: 1 } as OutletDto;
  const nf = { ...sbs, code: "OTT_NETFLIX", name: "넷플릭스", ott: true } as OutletDto;
  const enaO = { ...sbs, code: "ENA", side: "own" } as OutletDto;
  check("선택: 시장 전체에서 OTT 하나만 고르면 방송사는 그대로 전체(예전 out 배열 충돌 재현 방지)", outletSelected(sbs, { tv: "all", ott: ["OTT_NETFLIX"] }) && outletSelected(nf, { tv: "all", ott: ["OTT_NETFLIX"] }) && !outletSelected({ ...nf, code: "OTT_TVING" } as OutletDto, { tv: "all", ott: ["OTT_NETFLIX"] }));
  check("선택: 방송사 그룹 전체 해제 후 OTT만 / OTT 해제 후 방송사만 / 모두 해제", !outletSelected(sbs, { tv: "none", ott: "all" }) && outletSelected(nf, { tv: "none", ott: "all" }) && outletSelected(sbs, { tv: "all", ott: "none" }) && !outletSelected(nf, { tv: "all", ott: "none" }) && !outletSelected(sbs, { tv: "none", ott: "none" }));
  check("선택: KT ENA 채널은 경쟁 선택과 무관하게 참(기준 채널은 따로)", outletSelected(enaO, { tv: "none", ott: "none" }));
  check("선택: 옛 out 배열도 그대로 읽음", outletSelected(sbs, { outlets: ["SBS"] }) && !outletSelected(nf, { outlets: ["SBS"] }));
  const old1 = P({ view: "compare", out: "OTT_NETFLIX" });
  check("옛 주소: out=OTT 코드만 → 방송사 없음 · OTT 그 코드(옛 화면 그대로)", old1.tv === "none" && JSON.stringify(old1.ott) === '["OTT_NETFLIX"]');
  const rt = P({ view: "compare", tv: "none", ott: "all", nobase: "1", hm: "cast,eps", legend: "1" });
  const back = new URLSearchParams(lineupSearch(rt, "2026-11-23", "2026-11"));
  check("주소: OTT 범위·기준 숨김·표시 항목·범례 왕복", rt.tv === "none" && rt.ott === "all" && rt.nobase && rt.hm.join() === "cast,eps" && rt.legend && back.get("tv") === "none" && !back.has("ott") && back.get("nobase") === "1" && back.get("hm") === "cast,eps" && back.get("legend") === "1");
  check("묶음: 방송사별 추가, 시간대는 '시작 시간대별'로 표기", COMPARE_MODES.some((m) => m.key === "outlet" && m.label === "방송사별") && COMPARE_MODES.find((m) => m.key === "time")?.label === "시작 시간대별" && P({ view: "compare", cmp: "outlet" }).cmp === "outlet");
  check("상태 문구: 가안 → 미정", STATUS_LABEL.tentative === "미정");
}

if (failed > 0) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
