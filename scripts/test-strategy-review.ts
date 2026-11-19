// 편성 전략 점검(src/lib/review/strategyReviewPlans.ts) 단위 테스트 — 2026-11-19 크래시2 리뷰 계획(구간 A·B·C).
import { STRATEGY_REVIEW_PLANS, buildStrategyReview, findStrategyPlan, overlapMinutes, phaseFor, type OurEpisodePoint, type RivalPoint } from "../src/lib/review/strategyReviewPlans";

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`✅ ${name}`); } else { fails.push(name); console.log(`❌ ${name}${detail ? " — " + detail : ""}`); }
}

const plan = STRATEGY_REVIEW_PLANS.find((p) => p.id === "crash2-2026-11")!;

// 계획 찾기·구간
check("공백·쌍점 표기가 달라도 크래시2 계획을 찾는다", findStrategyPlan("ENA", "크래시2:분노의도로", "2026-11-17")?.id === plan.id);
check("다른 채널이면 계획 없음", findStrategyPlan("ENA_DRAMA", "크래시2", "2026-11-17") === null);
check("방영 기간 밖이면 계획 없음", findStrategyPlan("ENA", "크래시2", "2026-12-23") === null);
check("11/24는 구간 A", phaseFor(plan, "2026-11-24")?.key === "A");
check("11/30은 구간 B", phaseFor(plan, "2026-11-30")?.key === "B");
check("12/7은 구간 C(21:55)", phaseFor(plan, "2026-12-07")?.key === "C" && phaseFor(plan, "2026-12-07")?.plannedStart === "21:55");

// 겹친 시간(자정 넘김 포함)
check("겹친 시간 — 21:55~23:00 vs 22:10~23:30 = 50분", overlapMinutes("21:55:00", "23:00:00", "22:10:00", "23:30:00") === 50);
check("자정을 넘긴 끝 시각도 계산", overlapMinutes("22:00:00", "23:10:00", "22:30:00", "00:20:00") === 40);
check("겹치지 않으면 0", overlapMinutes("22:00:00", "23:00:00", "20:50:00", "21:54:00") === 0);

const ep = (date: string, start: string, end: string, p2049: number, household: number): OurEpisodePoint => ({ date, start, end, p2049, household });
const rv = (date: string, start: string, end: string, rating: number, programName = "TVN월화드라마(나의유죄인간<본>)"): RivalPoint => ({ date, programName, start, end, rating, share: null });
const ours = [
  ep("2026-11-16", "22:00:00", "23:02:48", 0.776, 2.8),
  ep("2026-11-17", "22:00:00", "23:03:59", 0.858, 3.67),
  ep("2026-11-23", "22:00:00", "23:03:00", 0.8, 3.2),
  ep("2026-11-24", "22:00:00", "23:03:00", 0.82, 3.3),
  ep("2026-11-30", "22:00:00", "23:03:00", 0.9, 3.5),
  ep("2026-12-01", "22:00:00", "23:03:00", 0.94, 3.6),
  ep("2026-12-07", "21:55:00", "22:58:00", 0.7, 3.0),
];
const predecessor = [ep("2026-10-05", "22:00:00", "23:10:00", 0.354, 1.76), ep("2026-10-06", "22:00:00", "23:14:00", 0.594, 2.36)];
const guilty = [rv("2026-11-16", "20:50:01", "21:54:12", 1.453), rv("2026-11-17", "20:49:54", "21:52:33", 1.944), rv("2026-11-23", "20:50:00", "21:55:00", 1.8), rv("2026-11-24", "20:50:00", "22:00:00", 2.2)];
const signal = [rv("2026-12-07", "22:10:00", "23:30:00", 2.5, "TVN월화드라마(시그널2<본>)")];

// 구간 A(11/17)
const a = buildStrategyReview({ plan, asOfDate: "2026-11-17", ours, predecessor, rivals: { guilty, signal2: signal }, rivalChannelSlot: [] });
check("A: 1~2회 평균과 전작 대비", !!a && a.phaseKey === "A" && a.findings[0].startsWith("1~2회 본방 평균 2049 0.817") && a.findings[0].includes("<연애박사>"), a?.findings[0]);
check("A: 나의 유죄인간 끝 시각(21:52)과 크래시2 시작 간격(8분)", !!a && a.findings.some((f) => f.includes("8분 간격")), a?.findings.join(" | "));
check("A: 다음 점검에 11/24 종영·12/7 맞대결", !!a && a.upcoming[0].startsWith("11/24") && a.upcoming.some((u) => u.startsWith("12/7")));
check("A: 아직 오지 않은 회차는 쓰지 않는다(11/17까지 2회)", !!a && !a.findings.some((f) => f.includes("1~3회")));

// 구간 B(11/30)
const b = buildStrategyReview({
  plan,
  asOfDate: "2026-11-30",
  ours,
  predecessor,
  rivals: { guilty, signal2: [] },
  rivalChannelSlot: [{ date: "2026-11-30", programName: "벌거벗은세계사", start: "22:03:35", end: "23:35:43", rating: 0.649, share: null }],
});
check("B: 나의 유죄인간 결산(본방 4회)", !!b && b.findings.some((f) => f.includes("결산: 본방 4회")), b?.findings.join(" | "));
check("B: 종영 전(1~4회) → 종영 후(5회) 비교", !!b && b.findings.some((f) => f.includes("종영 전(1~4회)") && f.includes("종영 후(5회)")), b?.findings.join(" | "));
check("B: tvN 저녁 편성 줄", !!b && b.findings.some((f) => f.includes("벌거벗은세계사")));

// 구간 C(12/7)
const c = buildStrategyReview({ plan, asOfDate: "2026-12-07", ours, predecessor, rivals: { guilty, signal2: signal }, rivalChannelSlot: [] });
check("C: 21:55 시작 반영 확인", !!c && c.findings.some((f) => f.includes("계획(21:55) 대로")), c?.findings.join(" | "));
check("C: 시그널2 겹친 시간 48분·15분 먼저 시작", !!c && c.findings.some((f) => f.includes("겹친 시간 48분") && f.includes("15분 먼저 시작")), c?.findings.join(" | "));
check("C: 시각 변경 첫 회 하락 경고(직전 2회 평균 0.92 대비 -23.9%)", !!c && c.findings.some((f) => f.includes("▼ 23.9%") && f.includes("변경 고지")), c?.findings.join(" | "));
const cLate = buildStrategyReview({ plan, asOfDate: "2026-12-07", ours: ours.map((o) => (o.date === "2026-12-07" ? { ...o, start: "22:00:00" } : o)), predecessor, rivals: { guilty, signal2: [] }, rivalChannelSlot: [] });
check("C: 실제 시작이 22:00이면 차이 경고", !!cLate && cLate.findings.some((f) => f.includes("5분 차이")));
check("C: 시그널2 자료가 없으면 확인 필요 문구", !!cLate && cLate.findings.some((f) => f.includes("<시그널2> 본방 기록을")));

check("방영 기간 밖이면 null", buildStrategyReview({ plan, asOfDate: "2026-12-30", ours, predecessor, rivals: {}, rivalChannelSlot: [] }) === null);

console.log(`\n${pass} pass, ${fails.length} fail`);
if (fails.length) process.exit(1);
