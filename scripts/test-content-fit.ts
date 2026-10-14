// 콘텐츠 적합도(CONTENT FITS) 엔진 테스트 — 테스트 프레임워크 없이 tsx로 실행. DB·네트워크 접근 없음(가짜 DB 사용).
// 실행: npm run test:content-fit
//
// 이 테스트가 보증하는 것: 사용자 제기 사례(시청률 좋은 장기 프로그램이 시청률 낮은 소표본 프로그램보다 낮게 나오는 문제)의
// 회귀 방지, 시청률 단조성·슬롯 보정·표본 수축·결측/0 처리·보정 폭 상한·결정론·미래 누수 차단·판정선·설명 문구.
// 보증하지 못하는 것: 운영 데이터에서의 예측 타당도(docs/content-fit/CONTENT_FIT_LOGIC.md의 백테스트 기록 참고).
import { CONTENT_FIT_CONFIG, computeContentFit, explainContentFit, formatTrendCell, scheduleNote, scheduleAction, scheduleCheck, scheduleGroupOf, fitTypeOf, fitTypeSummary, summarizeTable, audienceRoleOf, describeTrend, describeBaseline, trendPct, fmtTimes, type ContentFitAiring, type ContentFitItem } from "../src/lib/contentFit";
import { loadContentFitWith } from "../src/lib/contentFit/sourceCore";
import { findWordingIssues } from "../src/lib/ui/glossary";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

// ── 합성 채널 ─────────────────────────────────────────────────
const ASOF = "2026-10-13";
function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
// 같은 칸(요일×시)에 다른 프로그램(필러)이 충분히(≥15건) 있도록 시간대마다 필러 4개가 매일 방영
const BASE: Record<number, { rating: number; reach: number; tss: number }> = { 3: { rating: 0.004, reach: 0.02, tss: 8 }, 10: { rating: 0.02, reach: 0.1, tss: 15 }, 21: { rating: 0.05, reach: 0.2, tss: 20 } };
function fillers(): ContentFitAiring[] {
  const out: ContentFitAiring[] = [];
  for (const h of [3, 10, 21]) {
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 84; i++) {
        const date = addDays(ASOF, -i);
        const noise = 1 + 0.05 * Math.sin(i * 1.7 + k);
        out.push({ programId: `F${h}-${k}`, date, startTime: `${String(h).padStart(2, "0")}:${k * 10}:00`.replace(/:(\d):/, ":0$1:"), rating: BASE[h].rating * noise, reach: BASE[h].reach * noise, timeSpentShare: BASE[h].tss * noise, firstRun: null });
      }
    }
  }
  return out;
}
interface Spec {
  id: string;
  hour: number;
  days: number;
  rating: number | ((i: number) => number);
  reach?: number;
  tss?: number;
  endOffset?: number;
}
function prog(s: Spec): ContentFitAiring[] {
  const out: ContentFitAiring[] = [];
  for (let i = 0; i < s.days; i++) {
    const r = typeof s.rating === "function" ? s.rating(i) : s.rating;
    out.push({ programId: s.id, date: addDays(ASOF, -i - (s.endOffset ?? 0)), startTime: `${String(s.hour).padStart(2, "0")}:05:00`, rating: r, reach: s.reach ?? BASE[s.hour].reach, timeSpentShare: s.tss ?? BASE[s.hour].tss, firstRun: null });
  }
  return out;
}
const run = (specs: Spec[], extra: ContentFitAiring[] = [], asOf = ASOF) => computeContentFit([...fillers(), ...specs.flatMap(prog), ...extra], asOf);
const itemOf = (res: ReturnType<typeof run>, id: string): ContentFitItem => res.items.find((i) => i.programId === id) as ContentFitItem;

// ── 1. 사용자 제기 사례 회귀 ─────────────────────────────────────
{
  // 57일 방영·슬롯 평균의 1.4배 프로그램 vs 5일 방영·시청률이 슬롯의 1/4인 프로그램(다른 시간대)
  const res = run([
    { id: "LONG", hour: 21, days: 57, rating: 0.07 },
    { id: "BLIP", hour: 10, days: 5, rating: 0.005 },
  ]);
  const a = itemOf(res, "LONG");
  const b = itemOf(res, "BLIP");
  check("사용자 사례: 57일 방영·슬롯 1.4배 프로그램이 5일 방영·시청률 낮은 프로그램보다 점수가 높다", (a.score ?? 0) > (b.score ?? 100) + 20, `${a.score?.toFixed(1)} vs ${b.score?.toFixed(1)}`);
  check("사용자 사례: 장기 프로그램은 정식 판정(유지 이상)", a.tier === "FORMAL" && (a.tag === "KEEP" || a.tag === "STRENGTHEN"), `${a.tier}/${a.tag}`);
  check("사용자 사례: 5일 방영은 표본 적음(테스트)으로 참고용이며 흐름은 '낮음'", b.tier === "REFERENCE" && b.tag === "TEST" && b.lean === "BELOW", `${b.tier}/${b.tag}/${b.lean}`);
  check("사용자 사례: 표본 적은 프로그램은 신뢰도 49% 이하로 표시", b.confidencePct <= 49 && a.confidencePct >= 50, `${b.confidencePct}/${a.confidencePct}`);
}

// ── 2. 시청률 단조성·우세 쌍 ─────────────────────────────────────
{
  const ratings = [0.01, 0.03, 0.05, 0.08];
  const res = run(ratings.map((r, i) => ({ id: `M${i}`, hour: 21, days: 30, rating: r })));
  const scores = ratings.map((_, i) => itemOf(res, `M${i}`));
  check("시청률이 높을수록 슬롯 대비 성과·규모·점수가 모두 올라간다(다른 조건 동일)", scores.every((s, i) => i === 0 || ((s.score as number) > (scores[i - 1].score as number) && (s.slotIndex as number) > (scores[i - 1].slotIndex as number) && (s.scaleIndex as number) > (scores[i - 1].scaleIndex as number))), scores.map((s) => s.score?.toFixed(1)).join(","));
  // 같은 슬롯에서 시청률·도달률·방영일수가 모두 앞서면 점수가 뒤지지 않는다
  const specs: Spec[] = [
    { id: "D1", hour: 21, days: 40, rating: 0.09, reach: 0.3, tss: 25 },
    { id: "D2", hour: 21, days: 30, rating: 0.05, reach: 0.2, tss: 20 },
    { id: "D3", hour: 21, days: 20, rating: 0.02, reach: 0.1, tss: 12 },
    { id: "D4", hour: 21, days: 12, rating: 0.008, reach: 0.04, tss: 6 },
  ];
  const r2 = run(specs);
  let violations = 0;
  for (let i = 0; i < specs.length; i++) for (let j = i + 1; j < specs.length; j++) if ((itemOf(r2, specs[i].id).score as number) < (itemOf(r2, specs[j].id).score as number) - 1e-9) violations++;
  check("시청률·도달률·방영일수가 모두 앞서는 프로그램이 점수에서 뒤지는 쌍이 0개", violations === 0, String(violations));
  check("정렬: 점수 내림차순, 보류는 맨 뒤", r2.items.every((it, i, a) => i === 0 || it.score === null || a[i - 1].score !== null && (a[i - 1].score as number) >= (it.score as number)));
}

// ── 3. 슬롯 보정 ────────────────────────────────────────────────
{
  // 같은 시청률(0.02)이라도 약한 슬롯(오전, 같은 시간대 평균 0.02)과 강한 슬롯(저녁, 평균 0.05)에서 성과 의미가 다르다
  const res = run([
    { id: "WEAKSLOT", hour: 10, days: 30, rating: 0.02 },
    { id: "STRONGSLOT", hour: 21, days: 30, rating: 0.02 },
  ]);
  const w = itemOf(res, "WEAKSLOT");
  const s = itemOf(res, "STRONGSLOT");
  check("슬롯 보정: 같은 시청률이면 강한 슬롯에 편성된 쪽의 슬롯 대비 성과가 훨씬 낮다", (w.slotIndex as number) > 2 * (s.slotIndex as number), `${w.slotIndex?.toFixed(2)} vs ${s.slotIndex?.toFixed(2)}`);
  check("슬롯 보정: 강한 슬롯의 부진은 교체 검토, 약한 슬롯의 평균 수준은 유지", s.tag === "REPLACE" && w.tag === "KEEP", `${s.tag}/${w.tag}`);
  check("시청 규모(절대 수준)는 슬롯과 무관하게 같은 시청률이면 같다", Math.abs((w.scaleIndex as number) - (s.scaleIndex as number)) < 1e-9);
  // 약한 슬롯의 강자는 노출 확대 검토 대상이지만 규모가 작아 점수는 강한 슬롯의 강자보다 낮다
  const r2 = run([
    { id: "GEM", hour: 3, days: 30, rating: 0.012 },
    { id: "HIT", hour: 21, days: 30, rating: 0.09 },
  ]);
  const gem = itemOf(r2, "GEM");
  const hit = itemOf(r2, "HIT");
  check("약한 슬롯의 강자: 슬롯 대비 1.5배 이상이라 강화 검토지만 규모는 채널 평균 미만", gem.tag === "STRENGTHEN" && (gem.scaleIndex as number) < 1, `${gem.tag}/${gem.scaleIndex?.toFixed(2)}`);
  check("약한 슬롯의 강자는 강한 슬롯의 강자보다 종합 점수가 낮다(규모 반영)", (gem.score as number) < (hit.score as number), `${gem.score?.toFixed(1)} vs ${hit.score?.toFixed(1)}`);
}

// ── 4. 표본 수축·결측/0 처리 ─────────────────────────────────────
{
  // 기대 시청률이 거의 없는 슬롯(0.004)에서 6일 방영 0.012 — 원지수 3.0이 그대로 나오면 안 된다(수축)
  const res = run([{ id: "SMALLN", hour: 3, days: 6, rating: 0.012 }]);
  const it = itemOf(res, "SMALLN");
  check("표본 수축: 6일 방영의 슬롯 대비 지수는 원지수 3.0보다 작고 1.0보다 크다", (it.slotIndex as number) < 2.2 && (it.slotIndex as number) > 1, it.slotIndex?.toFixed(2));
  // 시청률이 전부 0인 장기 프로그램은 '중립'이 아니라 낮은 점수·교체 검토
  const z = run([{ id: "ZERO", hour: 21, days: 30, rating: 0 }]);
  const zi = itemOf(z, "ZERO");
  check("전부 0인 프로그램은 중립값으로 채워지지 않고 낮은 점수·교체 검토", (zi.score as number) < 20 && zi.tag === "REPLACE" && (zi.slotIndex as number) < 0.3, `${zi.score?.toFixed(1)}/${zi.tag}/${zi.slotIndex?.toFixed(2)}`);
  // 신뢰도: 방영 일수 구간
  const res2 = run([
    { id: "D2", hour: 21, days: 2, rating: 0.05 },
    { id: "D3", hour: 21, days: 3, rating: 0.05 },
    { id: "D7", hour: 21, days: 7, rating: 0.05 },
    { id: "D8", hour: 21, days: 8, rating: 0.05 },
  ]);
  const t2 = itemOf(res2, "D2");
  const t3 = itemOf(res2, "D3");
  const t7 = itemOf(res2, "D7");
  const t8 = itemOf(res2, "D8");
  check("방영 2일은 판단 보류(점수·판정 없음, 맨 뒤)", t2.tier === "HOLD" && t2.score === null && t2.tag === null && res2.items[res2.items.length - 1].programId === "D2");
  check("방영 3~7일은 참고용(테스트 태그, 점수는 있음)", t3.tier === "REFERENCE" && t7.tier === "REFERENCE" && t3.tag === "TEST" && t7.tag === "TEST" && t3.score !== null);
  check("방영 8일부터 정식 판정", t8.tier === "FORMAL" && t8.tag !== "TEST" && t8.tag !== null);
  check("표본이 적을수록 지수가 1.0쪽으로 보정된다(같은 시청률 3일 < 8일 지수 차이)", Math.abs((t3.slotIndex as number) - 1) < Math.abs((t8.slotIndex as number) - 1) + 1e-12 || (t3.slotIndex as number) < (t8.slotIndex as number) + 1e-12);
}

// ── 5. 보정 폭 상한(비보상)·추세 ─────────────────────────────────
{
  const specs: Spec[] = [
    { id: "ENG_HI", hour: 21, days: 40, rating: 0.01, reach: 0.9, tss: 90 }, // 시청률 낮고 도달률·시청시간만 극단적으로 높음
    { id: "ENG_LO", hour: 21, days: 40, rating: 0.09, reach: 0.001, tss: 0.5 },
    { id: "UP", hour: 21, days: 84, rating: (i) => (i < 28 ? 0.2 : 0.02) },
  ];
  const res = run(specs);
  let within = true;
  for (const it of res.items) {
    if (it.score === null || it.slotScore === null || it.scaleScore === null) continue;
    const core = (it.slotScore + it.scaleScore) / 2;
    const adj = it.score - core;
    if (adj > CONTENT_FIT_CONFIG.adjustCapUp + 1e-9 || adj < -CONTENT_FIT_CONFIG.adjustCapDown - 1e-9) within = false;
  }
  check("몰입도·추세 보정은 +10/-15점 범위를 넘지 않는다", within);
  const hi = itemOf(res, "ENG_HI");
  check("시청률이 낮은 프로그램은 도달률·시청시간이 아무리 높아도 판정이 '유지' 이상이 되지 않는다", hi.tag === "REPLACE" || hi.tag === "WATCH", `${hi.tag}/${hi.slotIndex?.toFixed(2)}`);
  const lo = itemOf(res, "ENG_LO");
  check("시청률이 높은 프로그램은 몰입도가 낮아도 보정 하한(-15점) 안에서만 깎인다", (lo.score as number) >= ((lo.slotScore as number) + (lo.scaleScore as number)) / 2 - 15 - 1e-9);
}
{
  // 최근 4주 하락 → 한 단계 낮춰 관찰
  const res = run([
    { id: "FALL_KEEP", hour: 21, days: 84, rating: (i) => (i < 28 ? 0.03 : 0.07) },
    { id: "FALL_STRONG", hour: 21, days: 84, rating: (i) => (i < 28 ? 0.05 : 0.12) },
    { id: "STEADY", hour: 21, days: 84, rating: 0.065 },
  ]);
  const k = itemOf(res, "FALL_KEEP");
  const s = itemOf(res, "FALL_STRONG");
  const st = itemOf(res, "STEADY");
  check("추세: 최근 4주 큰 하락이 있으면 '유지' 대신 '관찰'", k.tag === "WATCH" && (k.trend?.delta ?? 0) <= CONTENT_FIT_CONFIG.trendDownDelta, `${k.tag}/${k.trend?.delta.toFixed(2)}/${k.slotIndex?.toFixed(2)}`);
  check("추세: 강화 검토 수준이어도 큰 하락이 있으면 '유지'로 한 단계 낮춘다", s.tag === "KEEP" && (s.slotIndex as number) >= CONTENT_FIT_CONFIG.cut.strengthen, `${s.tag}/${s.slotIndex?.toFixed(2)}`);
  check("추세: 안정적인 프로그램은 추세 보정이 없다", st.trend !== null && Math.abs(st.trend.delta) < 0.05 && trendPct(st) !== null && Math.abs(trendPct(st) as number) < 4);
}

// ── 6. MOVE(이동 검토)는 '더 좋은 슬롯'에서 평균 이상일 때만 ────────────
{
  const mv = run([
    { id: "MV", hour: 10, days: 14, rating: 0.0005 },
    { id: "MV", hour: 21, days: 3, rating: 0.06, endOffset: 20 },
  ].flatMap((s) => [s]));
  // 같은 id를 두 Spec으로 만들었으므로 한 프로그램으로 합쳐진다
  const it = itemOf(mv, "MV");
  check("이동 검토: 현재 시간대는 크게 부진하고 더 좋은 슬롯(저녁)에서는 평균 이상이면 MOVE와 이동 시간대를 준다", it.tag === "MOVE" && it.moveTo === "저녁_심야", `${it.tag}/${it.moveTo}/${it.slotIndex?.toFixed(2)}`);
  const mv2 = run([
    { id: "MV2", hour: 21, days: 14, rating: 0.001 },
    { id: "MV2", hour: 3, days: 3, rating: 0.006, endOffset: 20 },
  ]);
  const it2 = itemOf(mv2, "MV2");
  check("이동 검토: 더 약한 슬롯(새벽)에서 평균 이상인 것은 이동 근거가 아니다(교체 검토)", it2.tag === "REPLACE" && it2.moveTo === null, `${it2.tag}/${it2.moveTo}`);
}

// ── 7. 결정론·미래 누수·윈도우 ───────────────────────────────────
{
  const specs: Spec[] = [
    { id: "A", hour: 21, days: 40, rating: 0.07 },
    { id: "B", hour: 10, days: 12, rating: 0.01 },
    { id: "C", hour: 3, days: 5, rating: 0.003 },
  ];
  const base = [...fillers(), ...specs.flatMap(prog)];
  const r1 = computeContentFit(base, ASOF);
  const shuffled = [...base].sort((x, y) => (x.date + x.programId < y.date + y.programId ? 1 : -1));
  const r2 = computeContentFit(shuffled, ASOF);
  check("결정론: 입력 순서를 바꿔도 결과가 같다", JSON.stringify(r1) === JSON.stringify(r2));
  const future: ContentFitAiring[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ programId: "A", date: addDays(ASOF, 1 + i), startTime: "21:05:00", rating: 9, reach: 5, timeSpentShare: 99, firstRun: null }));
  const old: ContentFitAiring[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({ programId: "A", date: addDays(ASOF, -84 - i), startTime: "21:05:00", rating: 9, reach: 5, timeSpentShare: 99, firstRun: null }));
  check("미래 방영(기준일 이후)은 점수에 영향을 주지 않는다", JSON.stringify(computeContentFit([...base, ...future], ASOF)) === JSON.stringify(r1));
  check("윈도우(84일) 밖 과거 방영도 영향을 주지 않는다", JSON.stringify(computeContentFit([...base, ...old], ASOF)) === JSON.stringify(r1));
  check("기준일을 과거로 옮기면 그날까지의 데이터만 쓴다(방영 수 감소)", computeContentFit(base, addDays(ASOF, -30)).airingCount < r1.airingCount);
  check("모델 버전·윈도우 정보가 결과에 담긴다", r1.modelVersion === "content-fit-v1" && r1.windowFrom === addDays(ASOF, -83) && r1.windowDays === 84);
}

// ── 8. 설정 불변식 ───────────────────────────────────────────────
{
  const c = CONTENT_FIT_CONFIG;
  check("설정: 판정선이 내림차순이고 방영 일수 구간이 서로 맞는다", c.cut.strengthen > c.cut.keep && c.cut.keep > c.cut.watch && c.cut.watch > 0 && c.minDays < c.fullDays && c.fullDays < c.fullConfidenceDays);
  check("설정: 종합 비중과 보정 상한이 유효 범위", c.scaleWeight > 0 && c.scaleWeight < 1 && c.engagementWeight >= 0 && c.trendWeight >= 0 && c.adjustCapUp > 0 && c.adjustCapDown > 0 && c.kappa >= 0 && c.minOtherAirings >= 1);
  check("설정: 기존 TEST 규칙(신뢰도 50% = 16일의 절반)과 정식 판정 최소 일수가 같다", c.fullDays * 2 === c.fullConfidenceDays);
}

// ── 9. 설명 문구 ─────────────────────────────────────────────────
{
  const res = run([
    { id: "LONG", hour: 21, days: 57, rating: 0.07 },
    { id: "NEW", hour: 10, days: 5, rating: 0.005 },
    { id: "BAD", hour: 21, days: 30, rating: 0.01 },
    { id: "ONE", hour: 21, days: 1, rating: 0.05 },
  ]);
  const names: Record<string, string> = { LONG: "신병4사보타주", NEW: "ENA케이팝업차트쇼", BAD: "곽준빈의세계기사식당2", ONE: "도스토옙스키" };
  const nameOf = (id: string) => names[id] ?? id;
  const texts = (["LONG", "NEW", "BAD", "ONE"] as const).map((id) => {
    const e = explainContentFit(itemOf(res, id), names[id]);
    return `${e.headline} ${e.basis} ${e.trend ?? ""}`;
  });
  check("설명: 프로그램 이름과 배수가 들어가고 조사가 맞는다('가'/'는')", texts[0].includes("'신병4사보타주'가") && texts[0].includes("배") && texts[2].includes("'곽준빈의세계기사식당2'는"), texts[0]);
  check("설명: 표본 적음은 '참고용'이라고 밝히고, 보류는 '보류'라고 말한다", texts[1].includes("참고용") && texts[3].includes("보류"), texts[1]);
  check("설명: 교체 검토 문구에 원인 단정 표현이 없다('때문에'·'탓')", !texts.some((t) => /때문에|탓|밀려|원인은/.test(t)), texts.join(" | "));
  check("설명: 화면 문구 규칙(용어·내부 이름) 위반 0건", texts.every((t) => findWordingIssues(t).length === 0), texts.map((t) => findWordingIssues(t).map((i) => i.rule).join(",")).join(" | "));
  check("설명: 연령 구성(타깃 선호도)을 점수 근거로 말하지 않는다", !texts.some((t) => /선호도|연령/.test(t)));
  const note = scheduleNote(itemOf(res, "BAD"));
  check("제안 사항: 교체 검토는 '교체 또는 시간대 변경 검토'로 안내", note.includes("교체") && note.includes("배"), note);
  check("제안 사항: 참고·보류 구간은 표본 안내", scheduleNote(itemOf(res, "NEW")).includes("표본 적음") && scheduleNote(itemOf(res, "ONE")).includes("보류"));
  const sum = summarizeTable(res.items, nameOf);
  check("표 아래 요약: 가장 앞선 프로그램과 가장 부진한 프로그램, 참고·보류 개수를 말한다", sum.includes("신병4사보타주") && sum.includes("곽준빈의세계기사식당2") && sum.includes("참고용") && sum.includes("보류"), sum);
  check("배수 표기", fmtTimes(1.3449) === "1.34배" && fmtTimes(null) === "—");
  check("시청자 유형: 도달률·시청시간 모두 높으면 대중, 둘 다 낮으면 이탈위험, 모호하면 없음", audienceRoleOf({ reachIndex: 1.3, timeSpentIndex: 1.2 }) === "MASS" && audienceRoleOf({ reachIndex: 0.7, timeSpentIndex: 0.8 }) === "ZAPPING_RISK" && audienceRoleOf({ reachIndex: 1.0, timeSpentIndex: 1.0 }) === null && audienceRoleOf({ reachIndex: 0.8, timeSpentIndex: 1.3 }) === "CORE");
}

// ── 9-2. 표기 보조(추세 칸·규모 모양·비교 기준) ──────────────────────
{
  const mk = (delta: number | null): ContentFitItem => ({ tier: "FORMAL", trend: delta === null ? null : { delta, recentIndex: 1, priorIndex: 1, recentDays: 5, priorDays: 5 }, slotIndex: 1, scaleIndex: 1, baselineShare: { slot: 1, dowDaypart: 0, daypart: 0, channel: 0 } }) as unknown as ContentFitItem;
  check("추세 칸: 큰 상승은 ▲, 큰 하락은 ▼, ±10% 미만은 '비슷', 계산 불가는 '—'", formatTrendCell(mk(Math.log2(1.39))).text === "▲39%" && formatTrendCell(mk(Math.log2(0.8))).text === "▼20%" && formatTrendCell(mk(Math.log2(1.05))).text === "비슷" && formatTrendCell(mk(null)).text === "—");
  check("추세 칸: 극단적 상승은 300%를 넘는 숫자로 표기하지 않는다", formatTrendCell(mk(Math.log2(6))).text === "▲300%+" && (describeTrend(mk(Math.log2(6))) ?? "").includes("300% 이상"), formatTrendCell(mk(Math.log2(6))).text);
  const base = { tier: "FORMAL" as const, slotIndex: 1, scaleIndex: 1 };
  check("유형: 평균 근처는 균형, 자리·규모 모두 이상은 주력, 작은 규모로 자리 기대 이상은 효율, 규모만 큰 경우는 총량, 둘 다 낮으면 부진", fitTypeOf({ ...base, slotIndex: 1.1, scaleIndex: 1.1 }) === "균형" && fitTypeOf({ ...base, slotIndex: 1.0, scaleIndex: 0.9 }) === "균형" && fitTypeOf({ ...base, slotIndex: 1.5, scaleIndex: 1.5 }) === "주력" && fitTypeOf({ ...base, slotIndex: 1.5, scaleIndex: 0.7 }) === "효율" && fitTypeOf({ ...base, slotIndex: 0.7, scaleIndex: 1.5 }) === "총량" && fitTypeOf({ ...base, slotIndex: 0.6, scaleIndex: 0.6 }) === "부진");
  check("유형: 표본이 적은 참고·보류 구간에는 유형을 붙이지 않는다", fitTypeOf({ tier: "REFERENCE", slotIndex: 1.5, scaleIndex: 1.5 }) === null && fitTypeOf({ tier: "HOLD", slotIndex: null, scaleIndex: null }) === null);
  check("유형: 개수 문장은 있는 유형만 적는다", fitTypeSummary([{ ...base, slotIndex: 1.5, scaleIndex: 1.5 }, { ...base, slotIndex: 1.6, scaleIndex: 1.3 }, { ...base, slotIndex: 1.0, scaleIndex: 1.0 }, { tier: "HOLD", slotIndex: null, scaleIndex: null }]) === "유형: 주력 2개 · 균형 1개." && fitTypeSummary([]) === "");
  {
    const it = (tag: string | null, tier: "FORMAL" | "REFERENCE" | "HOLD", extra: Record<string, unknown> = {}) => ({ tag, tier, sampleDays: 5, moveTo: null, slotIndex: 1, ...extra }) as unknown as ContentFitItem;
    check("조치: 핵심 수치(동시간대 평균·채널 평균)를 앞에, 조치를 뒤에 짧게 적는다", scheduleAction(it("KEEP", "FORMAL", { slotIndex: 0.94, scaleIndex: 1.06 })) === "동시간대 평균 0.94배 · 채널 평균 1.06배 - 편성 유지" && scheduleAction(it("REPLACE", "FORMAL", { slotIndex: 0.4, scaleIndex: 0.5 })).startsWith("동시간대 평균 0.40배 · 채널 평균 0.50배 - 교체"), scheduleAction(it("KEEP", "FORMAL", { slotIndex: 0.94, scaleIndex: 1.06 })));
    check("조치: 표본이 적어도 채널 평균·동시간대 평균을 맨 앞에 적고 남은 일수를 알린다", scheduleAction(it("TEST", "REFERENCE", { sampleDays: 6, slotIndex: 0.88, scaleIndex: 2.59 })) === "채널 평균 2.59배 · 동시간대 평균 0.88배 - 표본 적음(방영 6일), 2일 더 쌓인 뒤 재평가", scheduleAction(it("TEST", "REFERENCE", { sampleDays: 6, slotIndex: 0.88, scaleIndex: 2.59 })));
    check("줄글: 'N배' 앞에 '같은 시간대 평균의'·'채널 평균 방영 시청률의' 같은 긴 말 대신 '동시간대 평균 N배'·'채널 평균 N배'를 쓴다", (() => { const ex = explainContentFit({ tier: "FORMAL", tag: "KEEP", slotIndex: 1.1, scaleIndex: 1.06, sampleDays: 30, airings: 40 } as unknown as ContentFitItem, "가나다"); return ex.headline.includes("동시간대 평균 1.10배") && ex.basis.startsWith("채널 평균 1.06배") && !ex.basis.includes("방영 시청률의"); })());
    check("확인 기준: 판정 선(1.5·0.85·0.55)을 그대로 인용한다", scheduleCheck(it("STRENGTHEN", "FORMAL")).includes("1.5배") && scheduleCheck(it("KEEP", "FORMAL")).includes("0.85배") && scheduleCheck(it("WATCH", "FORMAL", { slotIndex: 0.7 })).includes("0.55배") && scheduleCheck(it("WATCH", "FORMAL", { slotIndex: 1.35 })).includes("하락이 멈추면") && scheduleCheck(it("TEST", "REFERENCE")).includes("8일"));
    check("조치 묶음: 교체·이동은 먼저 결정, 관찰·표본 적음은 지켜볼 것, 강화는 확대, 유지는 그대로", scheduleGroupOf(it("REPLACE", "FORMAL")) === 1 && scheduleGroupOf(it("MOVE", "FORMAL")) === 1 && scheduleGroupOf(it("WATCH", "FORMAL")) === 2 && scheduleGroupOf(it(null, "REFERENCE")) === 2 && scheduleGroupOf(it("STRENGTHEN", "FORMAL")) === 3 && scheduleGroupOf(it("KEEP", "FORMAL")) === 4);
  }
  check("비교 기준 설명: 같은 시간대 비교 표본이 부족해 채널 전체와 견줬으면 그 사실을 알린다", (describeBaseline({ tier: "FORMAL", baselineShare: { slot: 0, dowDaypart: 0.1, daypart: 0.1, channel: 0.8 } }) ?? "").includes("표본이 적어") && !(describeBaseline({ tier: "FORMAL", baselineShare: { slot: 1, dowDaypart: 0, daypart: 0, channel: 0 } }) ?? "").includes("표본이 적어") && describeBaseline({ tier: "HOLD", baselineShare: { slot: 0, dowDaypart: 0, daypart: 0, channel: 0 } }) === null);
}

// ── 10. 성능 ─────────────────────────────────────────────────────
{
  const big: ContentFitAiring[] = [];
  const progs = Array.from({ length: 120 }, (_, i) => `P${i}`);
  for (const p of progs) for (let i = 0; i < 84; i++) big.push({ programId: p, date: addDays(ASOF, -i), startTime: `${String((i * 7 + progs.indexOf(p)) % 24).padStart(2, "0")}:10:00`, rating: 0.01 + ((i * 13 + progs.indexOf(p)) % 17) / 500, reach: 0.1, timeSpentShare: 10, firstRun: null });
  const t0 = Date.now();
  const res = computeContentFit(big, ASOF);
  const ms = Date.now() - t0;
  check(`성능: 프로그램 120개·방영 ${big.length}건 계산이 2초 안에 끝난다`, ms < 2000 && res.items.length === 120, `${ms}ms`);
}

// ── 11. 서버 조회(가짜 DB): KPI 타깃·윈도우·페이지네이션·이름 ───────────
async function sourceTests() {
  const db = new FakeDb();
  db.seed("channels", [
    { id: "ch-d", code: "ENA_DRAMA", name: "ENA Drama", primary_target: "수도권 개인2049" },
    { id: "ch-s", code: "SKYUHD", name: "skyUHD", primary_target: "National 유료방송가입가구" },
    { id: "ch-n", code: "NOTARGET", name: "무타깃", primary_target: null },
  ]);
  db.seed("targets", [
    { id: "t-kpi", label: "수도권 2049" },
    { id: "t-other", label: "수도권 여30대" },
  ]);
  db.seed("programs", [
    { id: "p1", canonical_name: "프로그램가", raw_name: "프로그램가 <본>", first_run: true },
    { id: "p2", canonical_name: "프로그램나", raw_name: null, first_run: null },
  ]);
  const rows: Record<string, unknown>[] = [];
  const pushRows = (n: number, program: string, target: string, ratingOf: (i: number) => number | null, dateOffset = 0) => {
    for (let i = 0; i < n; i++) rows.push({ channel_id: "ch-d", source_type: "nielsen_daily", target_id: target, program_id: program, broadcast_date: addDays("2026-10-10", -(i % 84) - dateOffset), start_time: `${String(10 + (i % 3)).padStart(2, "0")}:00:00`, rating: ratingOf(i), reach: 0.1, time_spent_share: 10, is_first_run: null });
  };
  pushRows(1500, "p1", "t-kpi", () => 0.03); // 1000행 페이지를 넘는 분량
  pushRows(40, "p2", "t-kpi", () => 0.02);
  pushRows(60, "p2", "t-other", () => 0.5); // 다른 타깃은 읽지 않는다
  pushRows(30, "p2", "t-kpi", () => 0.9, 200); // 윈도우 밖
  pushRows(20, "p2", "t-kpi", () => null); // 시청률 없는 행은 건너뛴다
  db.seed("ratings", rows);

  const load = await loadContentFitWith(db, "ENA_DRAMA", "2026-10-10");
  check("서버 조회: KPI 타깃 행만, 윈도우 안, 시청률 있는 행만 읽는다(1500+40 = 1540건)", load !== null && load.result.airingCount === 1540, String(load?.result.airingCount));
  check("서버 조회: 1000행 페이지를 넘어도 전량을 읽는다(프로그램가 1500건)", load !== null && itemOfLoad(load, "p1")?.airings === 1500);
  check("서버 조회: KPI 타깃 라벨은 채널 KPI(수도권 개인2049)에서 '수도권 2049'로 찾는다", load?.kpiTargetLabel === "수도권 2049");
  check("서버 조회: 프로그램 이름·본방 여부를 붙인다", load?.programs.get("p1")?.canonicalName === "프로그램가" && load?.programs.get("p1")?.firstRun === true && load?.programs.get("p2")?.firstRun === null);
  check("서버 조회: skyUHD·KPI 없는 채널·없는 채널은 null", (await loadContentFitWith(db, "SKYUHD", "2026-10-10")) === null && (await loadContentFitWith(db, "NOTARGET", "2026-10-10")) === null && (await loadContentFitWith(db, "NONE", "2026-10-10")) === null);
  const latest = await loadContentFitWith(db, "ENA_DRAMA", null);
  check("서버 조회: 기준일을 안 주면 데이터가 있는 가장 최근 방송일", latest?.result.asOf === "2026-10-10", latest?.result.asOf);
}
function itemOfLoad(load: NonNullable<Awaited<ReturnType<typeof loadContentFitWith>>>, id: string) {
  return load.result.items.find((i) => i.programId === id);
}

sourceTests()
  .then(() => {
    console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
    if (failures.length) {
      console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
