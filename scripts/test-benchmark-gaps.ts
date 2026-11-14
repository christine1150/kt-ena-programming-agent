// 비교군 격차 자리·보고서 단락 테스트(고도화 B2) — DB·네트워크 없음. 실행: npm run test:benchmark-gaps
import { computeGaps, computeSlotStats, daypartOf, slotKeyOf, slotLabel, MIN_SLOT_MINUTES, type SlotAiring } from "../src/lib/benchmark/slotGaps";
import { benchmarkGapsSection } from "../src/lib/reportSnapshot/evidenceText";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 평일(dow 2) 17시대 한 자리에 시청률 r로 n편(편당 60분), 그리고 기준 자리(평일 11시대)에 base 시청률 m편
function air(dow: number, hour: number, rating: number, name: string, n: number, tag: "본" | "재" | null = null): SlotAiring[] {
  return Array.from({ length: n }, () => ({ dow, startMin: hour * 60, dur: 60, rating, name, tag }));
}

check("시간대: 17시=17-20, 02시=02-05, 24시 이후(심야)=23-02", daypartOf(17 * 60) === "17-20" && daypartOf(2 * 60) === "02-05" && daypartOf(24 * 60 + 30) === "23-02");
check("자리 키: 토·일은 WE", slotKeyOf({ dow: 6, startMin: 12 * 60 }) === "WE|11-14" && slotKeyOf({ dow: 3, startMin: 12 * 60 }) === "WD|11-14");
check("자리 이름", slotLabel("WD|17-20") === "평일 17~20시" && slotLabel("WE|02-05") === "주말 02~05시", slotLabel("WD|17-20"));

// 자리 지수: 채널 평균 대비
{
  const xs = [...air(2, 11, 1, "낮작품", 10), ...air(2, 18, 3, "저녁작품", 10)];
  const st = computeSlotStats(xs);
  check("자리 지수 = 자리 시청률 ÷ 채널 평균(평균 2 → 0.5, 1.5)", st["WD|11-14"].index === 0.5 && st["WD|17-20"].index === 1.5, JSON.stringify(st));
  check("자리 분 합과 상위 작품", st["WD|17-20"].minutes === 600 && st["WD|17-20"].topTitles[0] === "저녁작품");
  check("표기가 없으면 재방 비중 숨김", st["WD|17-20"].rerunShare === null);
}
// 표기 규칙: <재>만 쓰는 채널 = 무표기는 본방
{
  const xs = [...air(2, 18, 2, "A", 6, "재"), ...air(2, 18, 2, "B", 4, null)];
  const st = computeSlotStats(xs);
  check("<재>만 쓰는 채널은 무표기=본방(재방 60%)", st["WD|17-20"].rerunShare === 0.6, String(st["WD|17-20"].rerunShare));
}
// <본>만 쓰는 채널 = 무표기는 재방
{
  const xs = [...air(2, 18, 2, "A", 3, "본"), ...air(2, 18, 2, "B", 7, null)];
  const st = computeSlotStats(xs);
  check("<본>만 쓰는 채널은 무표기=재방(70%)", st["WD|17-20"].rerunShare === 0.7, String(st["WD|17-20"].rerunShare));
}

// 격차 규칙
const ownAirs = [...air(2, 11, 3, "낮", 12), ...air(2, 18, 1, "저녁", 12)]; // 평균 2 → 저녁 지수 0.5
const mk = (eveningRating: number, name: string) => ({ snap: name, stats: computeSlotStats([...air(2, 11, 2, "낮", 12), ...air(2, 18, eveningRating, `${name} 저녁작품`, 12, "재")]) });
{
  const own = computeSlotStats(ownAirs);
  check("준비: 자사 저녁 지수 0.5", own["WD|17-20"].index === 0.5);
  const gaps = computeGaps(own, [mk(4, "채널가"), mk(3, "채널나")]);
  check("비교군 2곳이 모두 높으면 격차 자리 1개(저녁)", gaps.length === 1 && gaps[0].slot === "WD|17-20", JSON.stringify(gaps.map((g) => g.slot)));
  check("격차 자리 값: 비교군 지수 높은 순·중앙값·공통", gaps[0].benches[0].snap === "채널가" && gaps[0].benchHigherN === 2 && gaps[0].benchN === 2 && gaps[0].benches[0].rerunShare === 1);
  check("벤치마크 1곳이면 격차 자리 없음", computeGaps(own, [mk(4, "채널가")]).length === 0);
  check("중앙값과 차이가 0.2 미만이면 격차 아님(비교군 지수≈0.6)", computeGaps(own, [mk(0.9, "가"), mk(0.9, "나")]).length === 0);
  const few = computeSlotStats([...air(2, 11, 2, "낮", 12), ...air(2, 18, 4, "저", 2)]); // 저녁 120분 < 하한
  check("방영 분이 하한 미만인 비교군 자리는 비교에서 빠져 2곳 미만이면 없음", 120 < MIN_SLOT_MINUTES && computeGaps(own, [{ snap: "가", stats: few }, mk(4, "나")]).length === 0);
  const ownFew = computeSlotStats([...air(2, 11, 3, "낮", 12), ...air(2, 18, 1, "저", 2)]);
  check("우리 자리가 하한 미만이면 격차 아님", computeGaps(ownFew, [mk(4, "가"), mk(3, "나")]).every((g) => g.slot !== "WD|17-20"));
}
// 최대 3개·큰 격차 순
{
  const hours = [8, 11, 14, 17, 20];
  const ownMany = hours.flatMap((h, i) => air(2, h, 1 + i * 0.01, `자사${h}`, 12));
  const benchMany = (r: number[]) => hours.flatMap((h, i) => air(2, h, r[i], `비교${h}`, 12));
  const b1 = computeSlotStats(benchMany([2, 3, 4, 5, 6]));
  const b2 = computeSlotStats(benchMany([2, 3, 4, 5, 6]));
  const gaps = computeGaps(computeSlotStats(ownMany), [{ snap: "가", stats: b1 }, { snap: "나", stats: b2 }]);
  check("격차 자리는 최대 3개이고 큰 순", gaps.length <= 3 && gaps.every((g, i) => i === 0 || gaps[i - 1].benchMedian - gaps[i - 1].ownIndex >= g.benchMedian - g.ownIndex), JSON.stringify(gaps.map((g) => g.slot)));
}

// 보고서 단락
{
  const own = computeSlotStats(ownAirs);
  const gaps = computeGaps(own, [mk(4, "채널가"), mk(3, "채널나")]);
  const sec = benchmarkGapsSection({ asOf: "2026-11-15", benchmarks: ["채널가", "채널나"], windowDays: 364, gaps });
  check("단락: 키·제목·표 1개", !!sec && sec.key === "benchmark_gaps" && sec.title.includes("비교군") && sec.blocks.some((b) => b.kind === "table"));
  const text = JSON.stringify(sec);
  check("단락: 효과 약속·기대 수치 문구 없음(+n%·오른다·상승 약속)", !/[+＋]\s*\d+\s*%|올라간다|오를 것|기대 효과/.test(text.replace(/오르면 안 됨|오른다는 뜻이 아님/g, "")), text.slice(0, 120));
  check("단락: 한계 문구(모양 비교·판권과 별개)", text.includes("모양 비교") && text.includes("판권"));
  check("단락: 비교군 공통 표기", text.includes("비교군 공통"));
  check("단락: 격차 없음·적재 전·벤치마크 1곳이면 null", benchmarkGapsSection(null) === null && benchmarkGapsSection({ asOf: "2026-11-15", benchmarks: ["가", "나"], windowDays: 364, gaps: [] }) === null && benchmarkGapsSection({ asOf: "2026-11-15", benchmarks: ["가"], windowDays: 364, gaps }) === null);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
