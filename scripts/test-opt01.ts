// OPT01 테스트 — 개선율의 "같은 시간 기준" 계산(src/lib/idealSchedule/comparison.ts)과 화면 연결. DB·네트워크 없음. 실행: npm run test:opt01
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

async function main() {
  const C = await import("../src/lib/idealSchedule/comparison");
  type B = import("../src/lib/idealSchedule/comparison").ComparableBlock;
  const blk = (weekday: number, startMin: number, endMin: number, expected: number | null, countable?: boolean): B => ({ weekday, startMin, endMin, expected, countable });
  // 하루 24시간(02~26시)을 60분 칸 24개로 — 시간대별 기대값 v(h)
  const day = (weekday: number, f: (h: number) => number | null): B[] => Array.from({ length: 24 }, (_, i) => blk(weekday, (2 + i) * 60, (3 + i) * 60, f(2 + i)));
  const flat = (v: number) => (_h: number) => v;
  const prime = (h: number) => (h >= 19 && h <= 23 ? 1.0 : 0.2);

  // 같은 시간 범위: 같은 값을 돌려준다
  {
    const ideal = day(1, prime).map((b) => ({ ...b, expected: (b.expected as number) * 1.1 }));
    const cur = day(1, prime);
    const r = C.compareOnCommonSupport(ideal, cur);
    check("같은 시간 범위: 같은 시간 기준 개선율 = 전체 평균 비교(+10%)", near(r.ratio, 0.1, 1e-9) && near(r.wholeRatio, 0.1, 1e-9) && !r.supportDiffers && C.supportNote(r) === null, JSON.stringify(r));
    check("같은 시간 범위: 분 수가 같다(1440분)", r.idealMinutes === 1440 && r.currentMinutes === 1440 && r.commonMinutes === 1440);
  }

  // OPT01 핵심 재현: 기준 주의 프라임 방영 기록이 비면 전체 평균 비교가 크게 부풀고, 같은 시간 기준은 부풀지 않는다
  {
    const ideal = day(1, prime); // 이번 안은 하루 전체
    const cur = day(1, prime).filter((b) => !(b.startMin >= 21 * 60 && b.startMin < 23 * 60)); // 기준 주 21~22시 기록 없음(프라임 일부)
    const r = C.compareOnCommonSupport(ideal, cur);
    check("프라임 공백: 기존 전체 평균 비교는 부풀려진다(양수)", (r.wholeRatio ?? 0) > 0.05, `whole=${r.wholeRatio}`);
    check("프라임 공백: 같은 시간 기준 개선율은 0(같은 편성이므로)", near(r.ratio, 0, 1e-9));
    check("프라임 공백: 시간 범위 차이를 알린다(분 수·왜곡 %p)", r.supportDiffers && r.idealMinutes === 1440 && r.currentMinutes === 1320 && (r.distortion ?? 0) > 0.05 && (C.supportNote(r) ?? "").includes("기준 주의 평가 시간이 120분 적어"), C.supportNote(r) ?? "null");
  }

  // 기대값 없음(null)·경쟁사 가상 편성은 분모에서 뺀다(기존 주간 합계 규칙과 동일)
  {
    const ideal = [blk(1, 1200, 1260, 1.0), blk(1, 1260, 1320, 3.0, false), blk(1, 1320, 1380, null)];
    const cur = [blk(1, 1200, 1260, 0.5), blk(1, 1260, 1320, 0.5), blk(1, 1320, 1380, 0.5)];
    const r = C.compareOnCommonSupport(ideal, cur);
    check("null·경쟁사 가상(countable=false)은 평가 시간에서 제외", r.idealMinutes === 60 && r.commonMinutes === 60 && near(r.ratio, 1.0));
  }

  // 요일이 다르면 같은 시간이 아니다
  {
    const r = C.compareOnCommonSupport([blk(1, 1200, 1260, 1)], [blk(2, 1200, 1260, 0.5)]);
    check("요일이 다르면 공통 시간 0 → 개선율 계산하지 않음", r.commonMinutes === 0 && r.ratio === null && r.idealAvg === null);
  }
  check("자정 넘김(25시대) 분도 센다", C.compareOnCommonSupport([blk(3, 1500, 1560, 0.4)], [blk(3, 1500, 1560, 0.2)]).commonMinutes === 60);
  check("기준 평균이 0이면 개선율을 만들지 않는다(0으로 나눔 방지)", C.compareOnCommonSupport([blk(1, 1200, 1260, 1)], [blk(1, 1200, 1260, 0)]).ratio === null);
  check("빈 입력", C.compareOnCommonSupport([], []).ratio === null && C.compareOnCommonSupport([], []).supportDiffers === false && C.supportNote(C.compareOnCommonSupport([], [])) === null);
  check("역순·길이 0 블록은 무시", C.compareOnCommonSupport([blk(1, 1260, 1200, 1), blk(1, 1200, 1200, 1)], [blk(1, 1200, 1260, 1)]).commonMinutes === 0);

  // 임계: 1~2% 차이는 같은 시간 범위로 본다
  {
    const ideal = day(1, flat(1));
    const cur = day(1, flat(1)).map((b, i) => (i === 0 ? { ...b, endMin: b.startMin + 50 } : b)); // 10분 부족(0.7%)
    const r = C.compareOnCommonSupport(ideal, cur);
    check("10분(0.7%) 차이는 시간 범위가 같다고 본다", !r.supportDiffers);
    const cur2 = day(1, flat(1)).slice(0, 20); // 4시간 부족(16.7%)
    check("4시간 차이는 시간 범위가 다르다고 본다", C.compareOnCommonSupport(ideal, cur2).supportDiffers);
  }

  // 화면 연결(정적 검사)
  const ROOT = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
  const page = read("src/app/ideal-schedule/page.tsx");
  check("화면: 개선율은 같은 시간 기준 값(supportCmp)을 우선 쓴다", page.includes("compareOnCommonSupport(") && page.includes("supportCmp?.ratio") && (page.match(/같은 시간 기준/g) ?? []).length >= 2);
  check("화면: 옛 전체 평균 비교식이 제목·모바일 막대에서 직접 쓰이지 않는다", !page.includes("(shownExpected - summary.current.expectedAvgRating) / summary.current.expectedAvgRating)}") && !/\{refWord\} 대비 \{signedPct\(\(shownExpected/.test(page));
  check("화면: 요약 패널과 상태 띠가 같은 비교를 받는다", page.includes("support={supportCmp}") && read("src/app/ideal-schedule/SummaryPanel.tsx").includes("support?.ratio") && read("src/app/ideal-schedule/RunStatusStrip.tsx").includes("{support && supportNote(support) && ("));
  check("화면: 개선율이 모델상 기대 차이이지 실제 시청률 개선이 아님을 밝힌다", page.includes("실제 시청률 개선이 아닙니다"));
  const drawer = read("src/app/ideal-schedule/BlockDrawer.tsx");
  check("블록 상세: '표본' 대신 '근거 방송 N건'(시청자 패널 표본 수가 아님)", drawer.includes("근거 방송") && drawer.includes("시청자 패널 표본 수가 아닙니다") && !/<dt[^>]*>표본<\/dt>/.test(drawer));
  check("블록 상세: 예상 범위가 미래 80% 적중을 약속하지 않는다", !drawer.includes("약 80%") && drawer.includes("미래의 적중을 보장하지 않습니다") && drawer.includes("아직 검증되지 않았습니다"));
  check("추적 스크립트가 있다(합성 세계 재현)", fs.existsSync(path.join(ROOT, "scripts/opt01-trace.ts")) && read("package.json").includes('"opt01:trace"'));

  console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
  if (failures.length) {
    console.error("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
