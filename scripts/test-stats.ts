// 보조 통계(metrics/stats.ts) 테스트 — DB·네트워크 없음. 실행: npm run test:stats
import { describeLine, describeValues, SMALL_SAMPLE_N, weightedMean } from "../src/lib/metrics/stats";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

const spike = describeValues([1, 2, 3, 4, 100]);
check("이상치 한 개: 평균 22, 중앙값 3, 최대 제외 평균 2.5", spike.n === 5 && near(spike.mean, 22) && near(spike.median, 3) && near(spike.meanExMax, 2.5) && spike.max === 100 && spike.min === 1 && !spike.small);
check("짝수 개 중앙값은 가운데 두 값의 평균(2.5)", near(describeValues([4, 1, 3, 2]).median, 2.5));
check("원본 배열을 바꾸지 않는다", (() => { const a = [3, 1, 2]; describeValues(a); return a.join() === "3,1,2"; })());

const one = describeValues([1.5]);
check("관측 1개: 중앙값은 그 값, 최대 제외 평균은 null, 소표본", near(one.median, 1.5) && one.meanExMax === null && one.small);
const two = describeValues([1, 3]);
check("관측 2개: 최대 제외 평균은 작은 값", near(two.meanExMax, 1) && two.small);
check(`관측 ${SMALL_SAMPLE_N}개부터 소표본 아님`, !describeValues([1, 2, 3]).small && describeValues([1, 2]).small);

const empty = describeValues([]);
check("빈 배열은 n=0, 값은 모두 null", empty.n === 0 && empty.mean === null && empty.median === null && empty.max === null);
const withGaps = describeValues([0, null, 2, undefined, NaN]);
check("결측(null/undefined/NaN)은 빼고 0 은 관측값으로 센다", withGaps.n === 2 && near(withGaps.mean, 1));

check("가중 평균: (1×30 + 3×90) / 120 = 2.5", near(weightedMean([{ value: 1, weight: 30 }, { value: 3, weight: 90 }]), 2.5));
check("가중 평균: 결측 값과 0 이하 가중치는 뺀다", near(weightedMean([{ value: 1, weight: 30 }, { value: null, weight: 90 }, { value: 9, weight: 0 }]), 1));
check("가중 평균: 남은 가중치가 없으면 null", weightedMean([{ value: null, weight: 10 }]) === null && weightedMean([]) === null);

const line = describeLine(spike, "일");
check("한 줄 표기에 n·평균·중앙값·최대 제외 평균이 모두 있다", line === "5일 · 평균 22.000 · 중앙값 3.000 · 최대 제외 평균 2.500", line);
check("소표본이면 '참고용'을 붙인다", describeLine(two, "일").includes("참고용") && !line.includes("참고용"));
check("값이 없으면 '값 없음'", describeLine(empty, "일") === "일 값 없음");

console.log(`\n${failures.length === 0 ? "✅ 모두 통과" : "❌ 실패 있음"} — 통과 ${passed}건${failures.length ? `, 실패 ${failures.length}건` : ""}`);
if (failures.length) process.exit(1);
