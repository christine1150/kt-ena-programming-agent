// 본방 편성 패턴(네이버 방송 정보·관리자 등록 요일·시각) 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음(합성 픽스처).
// 실행: npm run test:broadcast-pattern
//
// 보증하는 것: 네이버 카드 해석(채널·기간·요일·시각·회차), 제목 일치(약칭 포함), 채널 표기 → 자사 코드, 요일·시각 표기 변형,
//   본방 판정 규칙(본방 채널 슬롯 안/밖, 다른 자사 채널, 슬롯 첫 관측 이전, 회차 방송일 시각 변경, 자정 넘김), 실제 방영 시각 학습, 회차 부여 범위, 등록 패턴 우선.
// 보증하지 못하는 것: 네이버 페이지 구조가 바뀐 뒤의 동작(운영에서 not_found가 늘면 구조 변경을 의심한다).
import { naverTitleMatches, ownChannelCodeOf, parseDays, parseKoreanClock, parseNaverSchedule } from "../src/lib/broadcastPattern/naverSchedule";
import { calendarOf, describeLearned, inferRuns, type RunPattern } from "../src/lib/broadcastPattern/inferRuns";
import { naverPattern, registeredPattern } from "../src/lib/broadcastPattern/load";
import { lookupProgram, type Searcher } from "../src/lib/broadcastPattern/naverFetch";
import { patternRunsForDay } from "../src/lib/broadcastPattern/dayFill";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// ── 1. 네이버 카드 해석 ─────────────────────────────────────
const ep = (no: number, date: string) => `<li class="_item"><div class="info_title"><strong class="title_txt"> <span class="num_txt">${no}</span>회</strong> <span class="date_info">${date}</span></div></li>`;
const card = (title: string, dd: string, episodes = "") => `<div class="area_text_title"><span><strong class="_text">${title}</strong></span></div><dl><dt><span class="cm_bar"></span>편성</dt> <dd>${dd}</dd></dl>${episodes}`;
const SOLO = card(
  "나는 SOLO",
  ' <a href="https://plus.sbs.co.kr">SBS Plus</a>, <a href="https://ktena.co.kr/">ENA</a> <span class="text"> 2021.07.14. ~ </span> <span class="text">(수) 오후 10:30</span> ',
  [ep(276, "2026.10.21(수)"), ep(275, "2026.10.14(수)"), ep(274, "2026.10.07(수)")].join("")
);
const solo = parseNaverSchedule(SOLO);
check("파싱: 제목", solo?.title === "나는 SOLO");
check("파싱: 본방 채널(동시 방송 포함)", JSON.stringify(solo?.channels) === JSON.stringify(["SBS Plus", "ENA"]));
check("파싱: 방송 기간(방송 중)", solo?.startDate === "2021-07-14" && solo?.endDate === null);
check("파싱: 요일·시각(수 오후 10:30 = 22:30)", solo?.slots.length === 1 && solo.slots[0].minute === 1350 && solo.slots[0].days.join() === "2");
check("파싱: 회차 최신순", solo?.episodes.map((e) => `${e.no}@${e.date}`).join() === "276@2026-10-21,275@2026-10-14,274@2026-10-07");

const ENDED = parseNaverSchedule(card("모범택시3", ' <a href="#">SBS</a> <span class="text"> 2025.11.21. ~ 2026.01.10. 16부작 </span> '));
check("파싱: 종영작은 종영일만 있고 요일·시각 없음", ENDED?.endDate === "2026-01-10" && ENDED.slots.length === 0 && ENDED.episodes.length === 0);
check("파싱: 편성 줄이 없으면 null", parseNaverSchedule('<div class="area_text_title"><strong class="_text">없음</strong></div>') === null);
check("파싱: 카드가 없으면 null", parseNaverSchedule("<html></html>") === null);

const MULTI = parseNaverSchedule(card("일일드라마", ' <a href="#">KBS1</a> <span class="text"> 2026.01.05. ~ </span> <span class="text">(월~금) 오후 8:30</span> <span class="text">(토, 일) 오전 12:10</span> '));
check("파싱: 월~금과 주말이 다른 시각", MULTI?.slots.length === 2 && MULTI.slots.some((s) => s.minute === 1230 && s.days.join() === "0,1,2,3,4") && MULTI.slots.some((s) => s.minute === 10 && s.days.join() === "5,6"));

check("요일: 범위·나열·매일", parseDays("월~금").join() === "0,1,2,3,4" && parseDays("토, 일").join() === "5,6" && parseDays("월/수/금").join() === "0,2,4" && parseDays("매일").length === 7);
check("요일: 일~화처럼 주를 넘는 범위", parseDays("금~월").join() === "0,4,5,6");
check("시각: 오전 12시는 0시, 오후 12시는 정오", parseKoreanClock("오전", "12", "30") === 30 && parseKoreanClock("오후", "12", "05") === 725 && parseKoreanClock("오후", "10", "30") === 1350);

// ── 2. 제목·채널 ───────────────────────────────────────────
check("제목: 같은 제목", naverTitleMatches("나는SOLO", "나는 SOLO"));
check("제목: 끝 괄호 약칭", naverTitleMatches("나솔사계", "나는 SOLO, 그 후 사랑은 계속된다(나솔사계)"));
check("제목: 긴 정식 제목 ↔ 네이버 제목", naverTitleMatches("나는SOLO그후사랑은계속된다", "나는 SOLO, 그 후 사랑은 계속된다(나솔사계)"));
check("제목: 다른 작품은 불일치", !naverTitleMatches("니돈내산", "나는 SOLO"));
check("채널: 표기 변형 → 자사 코드", ownChannelCodeOf("ENA") === "ENA" && ownChannelCodeOf("ENA PLAY") === "ENA_PLAY" && ownChannelCodeOf("ENA 플레이") === "ENA_PLAY" && ownChannelCodeOf("ENA DRAMA") === "ENA_DRAMA" && ownChannelCodeOf("skyUHD") === "SKYUHD");
check("채널: 타사는 null", ownChannelCodeOf("SBS Plus") === null && ownChannelCodeOf("tvN") === null);

// ── 3. 검색 조립(가짜 검색기) ────────────────────────────────
const searchChecks = (async () => {
  const calls: string[] = [];
  const mk = (map: Record<string, string | null>): Searcher => async (q) => {
    calls.push(q);
    const html = map[q];
    return { ok: true, schedule: html ? parseNaverSchedule(html) : null };
  };
  const a = await lookupProgram("나는SOLO", mk({ 나는SOLO: SOLO }));
  check("검색: 제목이 같으면 found(첫 검색어에서 멈춤)", a.ok && a.status === "found" && calls.length === 1);
  const b = await lookupProgram("니돈내산", mk({ 니돈내산: SOLO }));
  check("검색: 카드 제목이 다르면 review", b.ok && b.status === "review");
  const c = await lookupProgram("없는작품", mk({}));
  check("검색: 카드가 없으면 not_found", c.ok && c.status === "not_found");
  const d = await lookupProgram("나는SOLO", async () => ({ ok: false, blocked: true, message: "차단" }));
  check("검색: 차단은 실패로 돌려준다(저장하지 않음)", !d.ok && d.blocked);
})();

// ── 4. 본방 판정 ───────────────────────────────────────────
const naverSolo = naverPattern({ program_key: "나는SOLO", title_raw: "나는솔로", status: "found", matched_title: "나는 SOLO", channels: ["SBS Plus", "ENA"], start_date: "2021-07-14", end_date: null, slots: solo!.slots, episodes: solo!.episodes, fetched_at: "2026-10-22T00:00:00Z" }).pattern!;
check("패턴: 자사 채널만 본방 채널로(SBS Plus 제외)", JSON.stringify(naverSolo.channelCodes) === JSON.stringify(["ENA"]));
check("패턴: 자사 채널이 없으면 쓰지 않음(타사 본방을 사 온 작품)", naverPattern({ program_key: "X", title_raw: "X", status: "found", matched_title: "X", channels: ["tvN"], start_date: null, end_date: null, slots: [], episodes: [], fetched_at: "" }).skipped === true);
check("패턴: 몰아보기처럼 본편 카드가 잡힌 편집본은 쓰지 않음", naverPattern({ program_key: "연애박사몰아보기", title_raw: "연애박사몰아보기", status: "found", matched_title: "연애박사", channels: ["ENA"], start_date: "2026-10-05", end_date: null, slots: [{ days: [0, 1], minute: 1320 }], episodes: [], fetched_at: "" }).pattern === null);
check("패턴: 제목 자체가 스페셜인 카드면 그대로 씀", naverPattern({ program_key: "S", title_raw: "음악 스페셜", status: "found", matched_title: "음악 스페셜", channels: ["ENA"], start_date: null, end_date: null, slots: [{ days: [5], minute: 600 }], episodes: [], fetched_at: "" }).pattern !== null);
check("패턴: 못 찾은 작품은 패턴 없음", naverPattern({ program_key: "X", title_raw: "X", status: "not_found", matched_title: null, channels: [], start_date: null, end_date: null, slots: [], episodes: [], fetched_at: "" }).pattern === null);

const air = (channelCode: string, date: string, startTime: string | null) => ({ channelCode, date, startTime });
const airings = [
  air("ENA", "2026-10-21", "22:31:00"), // 0 수 본방(회차 276)
  air("ENA", "2026-10-14", "22:30:00"), // 1 수 본방(275)
  air("ENA", "2026-10-15", "10:00:00"), // 2 목 낮 — 본방 슬롯 밖, 슬롯 첫 관측 이후 → 재방
  air("ENA_PLAY", "2026-10-16", "09:00:00"), // 3 다른 자사 채널 → 재방
  air("ENA", "2026-09-02", "22:32:00"), // 4 수 본방(회차 목록 밖)
  air("ENA", "2026-08-25", "15:00:00"), // 5 화 낮 — 슬롯 첫 관측(9/2) 이전 → 모름
  air("ENA", "2026-10-07", "21:00:00"), // 6 수 21:00 — 시각이 바뀐 회차(274): 회차 방송일이고 패턴 시각과 90분 차
  air("ENA", "2026-10-21", null), // 7 시작 시각 없음 → 모름
  air("ENA_PLAY", "2020-01-01", "09:00:00"), // 8 패턴 시작일 이전 → 모름
];
const r1 = inferRuns(airings, [naverSolo]);
const run = (i: number) => r1.results[i].firstRun;
check("판정: 본방 슬롯 방영은 본방", run(0) === true && run(1) === true && run(4) === true);
check("판정: 본방 채널의 슬롯 밖 방영은 재방(슬롯 첫 관측 이후)", run(2) === false);
check("판정: 본방 채널이 아닌 자사 채널은 재방", run(3) === false);
check("판정: 슬롯이 처음 관측되기 전 방영은 모름", run(5) === null);
check("판정: 회차 방송일이면 시각이 바뀌어도 본방", run(6) === true);
check("판정: 시작 시각이 없으면 모름", run(7) === null);
check("판정: 패턴 시작일 이전은 모름", run(8) === null);
check("회차: 네이버 회차 방송일과 일치하는 본방에만", r1.results[0].episode === 276 && r1.results[1].episode === 275 && r1.results[6].episode === 274 && r1.results[4].episode === null);
check("회차: 재방에는 붙이지 않음", r1.results[2].episode === null && r1.results[3].episode === null);
check("판정: 근거 출처가 남음", r1.results[0].source === "naver" && r1.results[5].source === null);

// 실제 방영 시각 학습 — 22:31·22:30·22:32의 중앙값
const learned = r1.learned.find((l) => l.channelCode === "ENA");
check("시각 학습: 패턴 22:30 → 닐슨 실측 중앙값 22:31", learned?.nominalMinute === 1350 && learned.actualMinute === 1351 && learned.observed >= 3, JSON.stringify(learned));
check("시각 학습: 사람이 읽는 표기", learned ? describeLearned(learned) === "수 22:31" : false);

// 학습한 시각 기준 슬롯 폭(±20분): 실측 22:31에서 25분 늦은 방영은 슬롯 밖(재방), 15분 늦은 방영은 슬롯 안
const r2 = inferRuns([air("ENA", "2026-10-21", "22:31:00"), air("ENA", "2026-10-14", "22:30:00"), air("ENA", "2026-10-28", "22:46:00"), air("ENA", "2026-11-04", "22:56:00")], [naverSolo]);
check("슬롯 폭: 실측 시각 ±20분", r2.results[2].firstRun === true && r2.results[3].firstRun === false);

// 자정 넘김 — 방송일 수요일의 00:35는 달력 목요일 00:35
check("달력 변환: 00~01시는 다음 날 새벽", calendarOf("2026-10-21", "00:35:00")?.dow === 3 && calendarOf("2026-10-21", "22:30:00")?.dow === 2);
const night: RunPattern = { source: "naver", programKey: "심야", label: "심야", channelCodes: ["ENA"], slots: [{ days: [3], minute: 30 }], startDate: null, endDate: null, episodes: [] };
const r3 = inferRuns([air("ENA", "2026-10-21", "00:35:00"), air("ENA", "2026-10-22", "13:00:00")], [night]);
check("자정 넘김: 방송일 수요일 00:35가 (목) 오전 12:30 슬롯의 본방", r3.results[0].firstRun === true && r3.results[1].firstRun === false);

// 종영일 이후 방영은 패턴 밖
const ended: RunPattern = { ...naverSolo, endDate: "2026-10-14", episodes: [] };
check("종영일 이후 방영은 본방으로 세지 않음", inferRuns([air("ENA", "2026-10-21", "22:30:00")], [ended]).results[0].firstRun === null);

// ── 5. 관리자 등록 패턴 ─────────────────────────────────────
const reg = registeredPattern({ broadcast_day_of_week: ["수"], broadcast_time: "22:30:00", broadcast_start_date: "2026-01-07", broadcast_end_date: null }, ["ENA", null], "나는솔로")!;
check("등록: 요일·시각·채널을 패턴으로", reg.source === "registered" && reg.channelCodes.join() === "ENA" && reg.slots[0].minute === 1350 && reg.slots[0].days.join() === "2");
check("등록: 시각이 없으면 패턴 없음", registeredPattern({ broadcast_day_of_week: ["수"], broadcast_time: null, broadcast_start_date: null, broadcast_end_date: null }, ["ENA"], "x") === null);
const both = inferRuns([air("ENA", "2026-10-21", "22:31:00"), air("ENA", "2026-10-14", "22:30:00")], [reg, naverSolo]);
check("우선순위: 등록 패턴이 먼저 판정하고 회차는 네이버가 채움", both.results[0].source === "registered" && both.results[0].firstRun === true && both.results[0].episode === 276);
const conflict = inferRuns([air("ENA_PLAY", "2026-10-21", "22:31:00")], [reg, { ...naverSolo, channelCodes: ["ENA_PLAY"] }]);
check("우선순위: 등록 패턴이 재방으로 본 방영은 네이버가 뒤집지 않음", conflict.results[0].firstRun === false && conflict.results[0].source === "registered");

// ── 6. 하루치(학습 없이 패턴 시각 ±20분) ─────────────────────
const oneDay = inferRuns([air("ENA", "2026-10-21", "22:30:00"), air("ENA", "2026-10-21", "23:40:00"), air("ENA_PLAY", "2026-10-21", "10:00:00")], [naverSolo], { learn: false });
check("하루치: 슬롯 방영은 본방, 같은 날 슬롯 밖 본방 채널 방영은 재방, 다른 자사 채널은 재방", oneDay.results[0].firstRun === true && oneDay.results[1].firstRun === false && oneDay.results[2].firstRun === false);
check("하루치: 슬롯 방영이 없는 날의 본방 채널 방영은 모름", inferRuns([air("ENA", "2026-10-22", "23:40:00")], [naverSolo], { learn: false }).results[0].firstRun === null);
check("하루치: 시각을 학습하지 않는다(패턴 22:30 그대로)", oneDay.learned.every((l) => l.actualMinute === l.nominalMinute));

// 가짜 DB로 하루치 보완 전체 경로(등록·네이버 읽기 → 프로그램별 판정)
const dayChecks = (async () => {
  const tables: Record<string, unknown[]> = {
    channels: [{ id: "c-ena", code: "ENA" }, { id: "c-play", code: "ENA_PLAY" }],
    featured_content: [],
    program_naver_schedule: [{ program_key: "나는SOLO", title_raw: "나는SOLO", status: "found", matched_title: "나는 SOLO", channels: ["SBS Plus", "ENA"], start_date: "2021-07-14", end_date: null, slots: solo!.slots, episodes: solo!.episodes, fetched_at: "2026-10-22T00:00:00Z" }],
  };
  const fake = {
    from: (t: string) => ({
      select: () => {
        const q: { data?: unknown[]; error: null; in: () => unknown } & PromiseLike<{ data: unknown[]; error: null }> = {
          error: null,
          in: () => q,
          then: (f: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(f),
        } as never;
        return q;
      },
    }),
  };
  const res = await patternRunsForDay(fake, {
    channelId: "c-ena",
    channelCode: "ENA",
    date: "2026-10-21",
    rows: [
      { programId: "p1", name: "나는SOLO", startTime: "22:30:00" },
      { programId: "p2", name: "다른프로그램", startTime: "21:00:00" },
    ],
  });
  check("하루치 보완: 네이버 패턴이 있는 프로그램은 본방·회차, 없는 프로그램은 그대로 모름", res[0].firstRun === true && res[0].episode === 276 && res[1].firstRun === null && res[1].episode === null, JSON.stringify(res));
  const broken = await patternRunsForDay({ from: () => { throw new Error("DB 오류"); } }, { channelId: "c-ena", channelCode: "ENA", date: "2026-10-21", rows: [{ programId: "p1", name: "나는SOLO", startTime: "22:30:00" }] });
  check("하루치 보완: 읽기 실패는 보완 없음(예외를 던지지 않음)", broken[0].firstRun === null);
})();

Promise.all([searchChecks, dayChecks]).then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
});
