// 주간 순위 하락 배경 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음(합성 픽스처).
// 실행: npm run test:rank-slide
//
// 보증하는 것: 하락 조건(15계단·시청률 20%), 이탈/신규 프로그램 구성 문장, 약한 신규 프로그램 지목(편성 비중·평균 비교),
// 가장 크게 떨어진 주, 시간대별 변화, 경쟁채널 비교(변화 중앙값·추월 채널), 스포츠 채널 부재 안내, 자료 부족 시 문장 생략.
// 보증하지 못하는 것: 운영 데이터에서의 값(합성 사례의 이름·수치는 실제 채널 성과가 아니다).
import { addDays, detectSlide, mondayOf, rankSlideOf, type CompetitorDay, type RankWeek, type SlideAiring } from "../src/lib/rankSlide";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// ── 1. 날짜·감지 ─────────────────────────────────────────────
check("월요일 계산", mondayOf("2026-10-25") === "2026-10-19" && mondayOf("2026-10-19") === "2026-10-19" && mondayOf("2026-10-26") === "2026-10-26");
const W = (weekStart: string, rank: number | null, rating: number | null): RankWeek => ({ weekStart, rank, rating });
const weeks: RankWeek[] = [
  W("2026-08-31", 56, 0.0612),
  W("2026-09-07", 66, 0.054),
  W("2026-09-14", 82, 0.0373),
  W("2026-09-21", 69, 0.0458),
  W("2026-09-28", 77, 0.0386),
  W("2026-10-05", 84, 0.0372),
  W("2026-10-12", 92, 0.0313),
  W("2026-10-19", 94, 0.0292),
];
{
  const d = detectSlide(weeks);
  check("56위→94위·시청률 절반이면 감지", d !== null && d.drop === 38 && d.from.weekStart === "2026-08-31" && d.to.weekStart === "2026-10-19" && d.ratingPct !== null && d.ratingPct < -50);
  check("순위가 14계단만 내려가면 감지하지 않음", detectSlide([...weeks.slice(0, 6), W("2026-10-12", 60, 0.03), W("2026-10-19", 70, 0.03)]) === null);
  check("순위만 내려가고 시청률이 거의 그대로면 감지하지 않음", detectSlide([...weeks.slice(0, 7).map((w) => ({ ...w, rating: 0.06 })), W("2026-10-19", 94, 0.055)]) === null);
  check("순위가 오르면 감지하지 않음", detectSlide([W("2026-09-28", 90, 0.03), W("2026-10-05", 85, 0.035), W("2026-10-12", 80, 0.04), W("2026-10-19", 60, 0.06)]) === null);
  check("이번 주 순위가 없으면 감지하지 않음", detectSlide([...weeks.slice(0, 7), W("2026-10-19", null, null)]) === null);
  check("비교할 이전 주가 2주 미만이면 감지하지 않음", detectSlide([W("2026-10-12", 20, 0.1), W("2026-10-19", 60, 0.04)]) === null);
  const tie = detectSlide([W("2026-07-20", 56, 0.07), W("2026-08-31", 56, 0.0612), ...weeks.slice(1)]);
  check("최고 순위가 동률이면 가장 최근 주를 기준으로", tie !== null && tie.from.weekStart === "2026-08-31");
}

// ── 2. 방영·경쟁채널 합성 자료 ─────────────────────────────
// 한 주에 하루 20시간(저녁 8시부터) 방영한다고 가정한다 — 40시간 이상 자료 기준을 넘기려 7일 모두 채운다.
function airingsOf(weekStart: string, plan: { id: string; name: string; rating: number; slots: [string, string][] }[]): SlideAiring[] {
  const out: SlideAiring[] = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    for (const p of plan) for (const [s, e] of p.slots) out.push({ programId: p.id, name: p.name, date, startTime: s, endTime: e, rating: p.rating, createdAt: null });
  }
  return out;
}
const SLOT_DAY: [string, string][] = [["09:00:00", "12:00:00"], ["13:00:00", "16:00:00"]];
const SLOT_EVE: [string, string][] = [["19:00:00", "22:00:00"]];
const SLOT_NIGHT: [string, string][] = [["22:00:00", "24:00:00"], ["00:00:00", "02:00:00"]];
// 8/31주: 주력 A(밤·낮 다편성, 평균 높음) + 저녁 B / 10/19주: 신규 C가 밤·낮을 차지(평균 낮음), 저녁은 D로 교체
let airings: SlideAiring[] = [
  ...airingsOf("2026-08-31", [
    { id: "A", name: "신사와아가씨", rating: 0.09, slots: [...SLOT_DAY, ...SLOT_NIGHT] },
    { id: "B", name: "저녁극장", rating: 0.05, slots: SLOT_EVE },
  ]),
  ...airingsOf("2026-09-07", [
    { id: "A", name: "신사와아가씨", rating: 0.09, slots: [...SLOT_DAY, ...SLOT_NIGHT] },
    { id: "B", name: "저녁극장", rating: 0.05, slots: SLOT_EVE },
  ]),
  // 9/14주: A가 빠지고 E가 들어옴 — 이 주 순위가 크게 떨어졌다고 보는 합성
  ...airingsOf("2026-09-14", [
    { id: "E", name: "왕가네", rating: 0.05, slots: [...SLOT_DAY, ...SLOT_NIGHT] },
    { id: "B", name: "저녁극장", rating: 0.05, slots: SLOT_EVE },
  ]),
  ...airingsOf("2026-10-19", [
    { id: "C", name: "자이언트", rating: 0.02, slots: [...SLOT_DAY, ...SLOT_NIGHT] },
    { id: "D", name: "탁구", rating: 0.06, slots: SLOT_EVE },
  ]),
];
// 9/14주 직전의 순위 낙폭을 크게 하려고 합성 주간 순위를 조정한다
const weeks2: RankWeek[] = [
  W("2026-08-31", 56, 0.0612),
  W("2026-09-07", 58, 0.0600),
  W("2026-09-14", 82, 0.0373),
  W("2026-09-21", 80, 0.0358),
  W("2026-09-28", 84, 0.0340),
  W("2026-10-05", 90, 0.0320),
  W("2026-10-12", 92, 0.0313),
  W("2026-10-19", 94, 0.0292),
];
const comp = (name: string, w1: number, w2: number): CompetitorDay[] => [
  ...Array.from({ length: 7 }, (_, d) => ({ name, date: addDays("2026-08-31", d), rating: w1 })),
  ...Array.from({ length: 7 }, (_, d) => ({ name, date: addDays("2026-10-19", d), rating: w2 })),
];
const competitors: CompetitorDay[] = [
  ...comp("채널가", 0.5, 0.52),
  ...comp("채널나", 0.4, 0.41),
  ...comp("채널다", 0.3, 0.29),
  ...comp("채널라", 0.2, 0.21),
  ...comp("채널마", 0.1, 0.11),
  // ONCE(0.0612→0.0292)보다 낮았다가 지금은 높은 채널 — 시청률은 소폭 상승
  ...comp("추월채널", 0.05, 0.055),
  // 자사 채널은 비교에서 빠진다
  ...comp("ENA", 0.9, 0.9),
];
{
  const s = rankSlideOf({ channelCode: "ONCE", channelName: "ONCE", weeks: weeks2, airings, competitors, registeredCompetitorNames: ["채널가", "추월채널", "ENA"], ownChannelNames: ["ONCE", "ENA"] });
  check("문장이 만들어짐", s !== null && s.lines.length >= 4, s ? `${s.lines.length}줄` : "null");
  const text = (s?.lines ?? []).join("\n");
  check("첫 줄에 56위→94위와 38계단", /56위/.test(s?.lines[0] ?? "") && /94위/.test(s?.lines[0] ?? "") && /38계단/.test(s?.lines[0] ?? ""));
  check("빠진 프로그램과 들어온 프로그램이 모두 나옴", /빠진 ‘신사와아가씨’/.test(text) && /‘자이언트’/.test(text));
  check("약한 신규 프로그램 지목(다른 신규 평균과 비교)", /특히 ‘자이언트’가/.test(text) && /다른 신규 편성 평균/.test(text));
  check("이전 주력의 편성 비중·평균이 사실로 나란히 나옴", /이전 주력 ‘신사와아가씨’는/.test(text));
  check("가장 크게 떨어진 주와 그 주에 빠진 프로그램", /9\/14주\(58위→82위\)/.test(text) && /‘신사와아가씨’가 빠진 주/.test(text));
  check("시간대별 변화 문장", /시간대별 시청률 변화는/.test(text));
  check("경쟁채널 변화 중앙값 문장(자사 채널 제외)", /등록 경쟁채널 6곳/.test(text) && !/ENA/.test(text.split("경쟁채널")[1] ?? ""));
  check("추월 채널이 있으면 이름과 시청률 변화 중앙값을 보임", /추월채널/.test(text) && /높은 곳이 1곳/.test(text));
  check("확정되지 않은 추정·미검증 안내 문구를 쓰지 않음(스포츠 채널 안내·원인 추정)", !/스포츠|야구|보입니다|것으로/.test(text));
}

// ── 3. 자료가 부족하면 있는 만큼만 ─────────────────────────
{
  const noAir = rankSlideOf({ channelCode: "ONCE", channelName: "ONCE", weeks: weeks2, airings: [], competitors: [], registeredCompetitorNames: [], ownChannelNames: [] });
  check("방영·경쟁채널 자료가 없어도 첫 줄은 나오고 프로그램·경쟁채널 문장은 없음", noAir !== null && /56위/.test(noAir.lines[0]) && !/편성 구성|등록 경쟁채널|시간대별/.test(noAir.lines.join("\n")));
  const thin = rankSlideOf({ channelCode: "ONCE", channelName: "ONCE", weeks: weeks2, airings: airings.filter((a) => a.date === "2026-10-19" || a.date === "2026-08-31"), competitors: [], registeredCompetitorNames: [], ownChannelNames: [] });
  check("편성 자료가 모자라면(주 40시간 미만) 프로그램 구성 문장을 쓰지 않음", thin !== null && !/편성 구성이 바뀌었습니다/.test(thin.lines.join("\n")));
  const fewComp = rankSlideOf({ channelCode: "ONCE", channelName: "ONCE", weeks: weeks2, airings: [], competitors: competitors.filter((c) => c.name === "채널가" || c.name === "채널나"), registeredCompetitorNames: [], ownChannelNames: [] });
  check("경쟁채널이 5곳 미만이면 비교 문장을 쓰지 않음", fewComp !== null && !/등록 경쟁채널/.test(fewComp.lines.join("\n")));
  airings = [];
}

console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
