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

if (failed > 0) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
