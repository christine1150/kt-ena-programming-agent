// 주간 채널 성과 리뷰 문장·선별 규칙 검증(2026-11-23). 실제 11/16~22 주간 응답을 고정 자료로 저장해 두고 시나리오 A~D·G를 확인한다.
import { readFileSync } from "node:fs";
import {
  buildHeadline,
  buildInsightCards,
  checkPoints,
  coreChangeLabel,
  fmtPct,
  groupShifts,
  josa,
  slotWhen,
  performanceSentences,
  rankStreak,
  shiftItems,
  shiftSummary,
  sortChannels,
  trendSentences,
  type WeeklyInput,
} from "../src/lib/weeklyReview/narrative";
import type { RankSlide } from "../src/lib/rankSlide";

let fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`}`);
}

const fx = JSON.parse(readFileSync(new URL("./fixtures/weekly-review-20261116.json", import.meta.url), "utf8")) as { weeklyReview: WeeklyInput; rankSlides: RankSlide[] };
const wr = fx.weeklyReview;
const slides = fx.rankSlides;
const ch = (code: string) => wr.channels.find((c) => c.channelCode === code)!;

// A. 전체 요약
const h = buildHeadline(wr);
eq("A 상승·유지·하락 수", [h.up, h.flat, h.down, h.total], [5, 1, 1, 7]);
eq("A 대표 문장", h.sentence, "7개 채널 중 5개 채널의 순위가 올랐습니다. ENA Drama의 개선이 가장 두드러졌고, OLIFE는 하락했습니다.");

// 인사이트 카드
const cards = buildInsightCards(wr, slides);
eq("카드 종류·채널", cards.map((c) => [c.kind, c.channelCode]), [["best", "ENA_DRAMA"], ["watch", "OLIFE"], ["longterm", "ONCE"]]);

// B. ENA Drama
eq("B 카드 사실", cards[0].facts, ["이번 주 27위", "지난주보다 5계단 상승", "시청률 36.2% 증가"]);
eq("B 해석", cards[0].note, "순위와 시청률이 함께 개선됐습니다.");
eq("B 성능 문장", performanceSentences(ch("ENA_DRAMA")).slice(0, 2), ["ENA Drama는 27위로, 지난주보다 5계단 상승했습니다.", "시청률도 36.2% 증가했습니다."]);
eq("B 핵심 변화", coreChangeLabel(ch("ENA_DRAMA"), wr, slides), "이번 주 가장 큰 순위 상승");

// C. OLIFE
eq("C 카드 사실", cards[1].facts, ["이번 주 33위", "지난주보다 3계단 하락", "시청률 11.4% 감소"]);
eq("C 해석", cards[1].note, "이번 주 순위와 시청률이 모두 하락했습니다.");
eq("C 핵심 변화", coreChangeLabel(ch("OLIFE"), wr, slides), "순위·시청률 동반 하락");
eq("C 시청률 표기", fmtPct(ch("OLIFE").ratingChangePct), "−11.4%");

// D. ONCE — 단기(전주 +2)와 장기(9/21 대비 −15)를 섞지 않는다
eq("D 카드 사실", cards[2].facts, ["이번 주 84위", "지난주보다 2계단 상승", "9월 21일 69위에서 15계단 하락", "같은 기간 시청률 약 25% 감소"]);
eq("D 해석", cards[2].note, "이번 주 소폭 회복했지만, 장기적인 부진이 남아 있습니다.");
eq("D 핵심 변화", coreChangeLabel(ch("ONCE"), wr, slides), "단기 반등, 장기 부진");
eq("D 추이 문장", trendSentences(ch("ONCE")), ["ONCE는 9월 21일 69위에서 이번 주 84위로 15계단 하락했습니다.", "다만 직전 주 86위와 비교하면 2계단 회복했습니다."]);
eq("D 성능 문장", performanceSentences(ch("ONCE")).slice(0, 2), ["ONCE는 84위로, 지난주보다 2계단 상승했습니다.", "시청률도 8.8% 증가했습니다."]);

// 나머지 성적표 라벨(지시서 표와 대조)
eq(
  "성적표 핵심 변화",
  ["ENA", "ENA_PLAY", "ENA_STORY", "SKYUHD"].map((c) => coreChangeLabel(ch(c), wr, slides)),
  ["순위 유지, 시청률 소폭 하락", "순위·시청률 동반 개선", "순위·시청률 동반 개선", "소폭 개선"]
);

// E. 편성 영향 — 비교 대상(이전·현재 프로그램, 같은 시간대)이 문장과 연결되고 원인 단정 표현이 없다
const dramaItems = shiftItems(ch("ENA_DRAMA"));
eq("E 첫 항목 = 크래시2 상승", [dramaItems[0].program, dramaItems[0].direction, dramaItems[0].priorProgram, dramaItems[0].currentProgram], ["크래시2", "up", "벌거벗은세계사", "크래시2"]);
eq("E 문장", dramaItems[0].sentence, "연애박사·뿅뿅지구오락실2가 있던 시간대를 이어받아 이전 편성보다 높은 시청률이 나왔습니다.");
const onceDecline = shiftItems(ch("ONCE")).find((x) => x.direction === "down")!;
eq("E 하락 이어받기 주어 = 후속작", [onceDecline.program, onceDecline.sentence], ["야인시대", "자이언트가 있던 시간대를 이어받았지만 이전 편성보다 시청률이 낮았습니다."]);
const allText = [
  ...wr.channels.flatMap((c) => [...performanceSentences(c), shiftSummary(c, shiftItems(c)), ...shiftItems(c).map((x) => x.sentence), ...checkPoints(c, shiftItems(c), slides, wr.weekStart), ...trendSentences(c)]),
  ...cards.flatMap((c) => [...c.facts, c.note]),
].join("\n");
for (const banned of ["때문", "덕분", "견인", "대성공", "실패", "판단됩니다", "살펴보면"]) eq(`E 금지 표현 없음: ${banned}`, allText.includes(banned), false);
eq("확인할 점(ONCE) 장기 하락 먼저", checkPoints(ch("ONCE"), shiftItems(ch("ONCE")), slides, wr.weekStart)[0], "이번 주 회복이 다음 주에도 이어지는지 주간 순위로 확인할 필요가 있습니다.");
eq("E 확인할 점(ENA Drama)", checkPoints(ch("ENA_DRAMA"), dramaItems, slides, wr.weekStart).length > 0, true);

// 시청률이 거의 그대로면 방향을 붙이지 않는다
const flat = { ...ch("OLIFE"), ratingChangePct: -0.3 };
eq("±1% 미만 = 비슷", coreChangeLabel(flat, { ...wr, channels: wr.channels.map((c) => (c.channelCode === "OLIFE" ? flat : c)) }, slides), "순위 하락, 시청률은 비슷");

// 정렬
eq("반대 방향 둘 다 크면 모두 표시(ONCE 야인시대)", shiftItems(ch("ONCE")).map((x) => [x.program, x.direction]), [["야인시대", "up"], ["야인시대", "down"], ["하나뿐인내편", "up"]]);
const onceGroups = groupShifts(shiftItems(ch("ONCE")));
eq("ONCE 야인시대 한 묶음(좋아진 13곳·나빠진 9곳)", [onceGroups[0].program, onceGroups[0].mixed, onceGroups[0].upCount, onceGroups[0].downCount], ["야인시대", true, 13, 9]);
eq("ONCE 묶음 요약", onceGroups[0].summary, "야인시대는 시간대에 따라 결과가 갈렸습니다. 좋아진 시간대 13곳, 나빠진 시간대 9곳입니다.");
eq("시각 범위 표기", slotWhen([1, 2, 3, 5, 7], [12, 13, 14, 15, 22, 23]), "월·화·수·금·일 12~15·22~23시");
eq("정렬 기본 순서", sortChannels(wr.channels, "default", slides, wr.weekStart).map((c) => c.channelCode), ["ENA", "ENA_PLAY", "ENA_DRAMA", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"]);
eq("편성 변화 중복 제거(지구마불은 영향 큰 프라임 상승만)", shiftItems(ch("ENA_DRAMA")).map((x) => [x.program, x.direction]), [["크래시2", "up"], ["지구마불세계여행4", "up"], ["벌거벗은세계사", "down"]]);
eq("정렬 순위 상승순", sortChannels(wr.channels, "rankUp", slides, wr.weekStart).map((c) => c.channelCode), ["ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "ONCE", "SKYUHD", "ENA", "OLIFE"]);
eq("정렬 확인 필요순 앞 2개", sortChannels(wr.channels, "attention", slides, wr.weekStart).slice(0, 2).map((c) => c.channelCode), ["OLIFE", "ONCE"]);

// G. 예외 — 전주 없음, 시청률 0, 편성 변화 없음
const g: WeeklyInput = {
  weekStart: "2026-01-05",
  weekEnd: "2026-01-11",
  priorWeekStart: null,
  channels: [
    { channelCode: "ENA", targetLabel: "개인2049", weeks: [{ weekStart: "2026-01-05", rank: 9, rating: 0 }], rankChange: null, ratingChangePct: null, lineup: null },
    { channelCode: "SKYUHD", targetLabel: "가구", weeks: [{ weekStart: "2026-01-05", rank: null, rating: null }], rankChange: null, ratingChangePct: null, lineup: null },
  ],
};
eq("G 대표 문장", buildHeadline(g).sentence, "이번 주는 지난주와 비교할 순위 자료가 없습니다.");
eq("G 카드 없음", buildInsightCards(g, []).length, 0);
eq("G 성능 문장", performanceSentences(g.channels[0]), ["ENA는 이번 주 9위입니다. 지난주 순위 자료는 없습니다."]);
eq("G 순위 없음", performanceSentences(g.channels[1]), ["skyUHD는 이번 주 순위 자료가 없습니다."]);
eq("G 추이 없음", trendSentences(g.channels[0]), []);
eq("G 편성 요약", shiftSummary(g.channels[0], []), "이번 주는 편성 변화 비교 자료가 없습니다.");
eq("G 핵심 변화", coreChangeLabel(g.channels[0], g, []), "전주 비교 자료 없음");
eq("G 0% 표기", fmtPct(0), "0.0%");

// 보조
eq("연속 상승", rankStreak([{ weekStart: "a", rank: 10, rating: 1 }, { weekStart: "b", rank: 8, rating: 1 }, { weekStart: "c", rank: 7, rating: 1 }, { weekStart: "d", rank: 5, rating: 1 }]), 3);
eq("조사", [josa("크래시2", "이/가"), josa("인간극장", "이/가"), josa("84위", "으로/로"), josa("7위", "으로/로")], ["크래시2가", "인간극장이", "84위로", "7위로"]);

console.log(fail === 0 ? "\n모두 통과" : `\n실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
