// 주간 편성 비교(단계 10) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:schedcompare
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const near = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

async function main() {
  const C = await import("../src/lib/workspace/weekCompare");
  const L = await import("../src/lib/scheduleGridLayout");

  // ── 주 표기: 지난주는 실제 지난주일 때만 ──────────────────
  {
    const today = "2026-10-06"; // 화요일 — 이번 주 월요일 10-05
    check("월요일 계산", C.mondayOfIso("2026-10-06") === "2026-10-05" && C.mondayOfIso("2026-10-11") === "2026-10-05" && C.mondayOfIso("2026-10-05") === "2026-10-05");
    check("이번 주 = 10-05", C.weekRelation("2026-10-05", today) === "this");
    check("지난주 = 09-28", C.weekRelation("2026-09-28", today) === "last");
    check("다음 주 = 10-12", C.weekRelation("2026-10-12", today) === "next");
    check("9/14 주는 10/6 기준 지난주가 아니다(사용자 사례)", C.weekRelation("2026-09-14", today) === "other");
    check("지난주면 '지난주(기간)'", C.weekLabel("2026-09-28", today) === "지난주(09-28 ~ 10-04)", C.weekLabel("2026-09-28", today));
    check("지난주가 아니면 기간만 — '지난주' 문구가 없다", C.weekLabel("2026-09-14", today) === "09-14 ~ 09-20 주" && !C.weekLabel("2026-09-14", today).includes("지난주"), C.weekLabel("2026-09-14", today));
    check("이번 주·다음 주 표기", C.weekLabel("2026-10-05", today) === "이번 주(10-05 ~ 10-11)" && C.weekLabel("2026-10-12", today) === "다음 주(10-12 ~ 10-18)");
    check("해가 다르면 연도를 붙인다", C.weekLabel("2025-12-29", today).startsWith("2025-12-29 ~ 2026-01-04"), C.weekLabel("2025-12-29", today));
    check("문장 속 짧은 말도 같은 규칙", C.weekWord("2026-09-28", today) === "지난주" && C.weekWord("2026-09-14", today) === "09-14 ~ 09-20 주" && C.weekWord(null, today) === "기준 주");
    // 같은 주라도 오늘이 바뀌면 표기가 바뀐다(상대 표현이 저장되지 않는다)
    check("같은 주 데이터도 오늘이 지나면 '지난주'가 아니다", C.weekRelation("2026-09-28", "2026-10-13") === "other" && C.weekRelation("2026-09-28", "2026-10-07") === "last");
    check("일요일은 아직 그 주", C.weekRelation("2026-09-28", "2026-10-04") === "this");
  }

  // ── 비교 모드 ────────────────────────────────────────────
  {
    const base = { channelCode: "ENA", channelName: "ENA", week: "2026-09-21", targetLabel: "수도권 개인2049", source: "db+upload" as const };
    const r1 = C.compareSides(base, { ...base, week: "2026-09-14" });
    check("같은 채널 다른 주 → 같은 채널 주간 비교", r1.mode === "same_channel_weeks" && r1.differsList.join() === "기간" && r1.cautions.length === 0);
    const r2 = C.compareSides(base, { ...base, channelCode: "ENA_DRAMA", channelName: "ENA Drama" });
    check("다른 채널 같은 주 → 동시간대 경쟁", r2.mode === "same_week_channels" && r2.differs.channel && !r2.differs.period);
    const r3 = C.compareSides(base, { ...base, channelCode: "COMPETITOR::tvN", channelName: "tvN", targetLabel: "(경쟁채널 기준 타깃)" });
    check("타깃이 다르면 직접 비교 불가 안내", r3.cautions.some((c) => c.includes("타깃이 다릅니다") && c.includes("직접 비교할 수 없습니다")) && r3.differs.target);
    const r4 = C.compareSides(base, { ...base, channelCode: "OLIFE", channelName: "OLIFE", week: "2026-09-14" });
    check("채널·기간이 모두 다르면 mixed + 단일 원인 금지 안내", r4.mode === "mixed" && r4.cautions.some((c) => c.includes("한 가지 원인")));
    const r5 = C.compareSides({ ...base, source: "upload" }, base);
    check("같은 채널·같은 주, 업로드 vs DB → 계획 vs 실적", r5.mode === "plan_vs_actual" && r5.detail.includes("실적 순위가 없습니다"));
    check("계획 vs 실적에서는 출처 차이를 별도 주의로 반복하지 않는다", !r5.cautions.some((c) => c.includes("자료 출처가 다릅니다")));
    const r6 = C.compareSides(base, { ...base });
    check("좌우가 완전히 같으면 같은 편성표 경고", r6.mode === "identical" && r6.differsList.length === 0);
    const r7 = C.compareSides(base, { ...base, week: "2026-09-14", source: "db" });
    check("기간·출처가 다르면 출처 차이 주의", r7.cautions.some((c) => c.includes("자료 출처가 다릅니다")) && r7.differsList.includes("자료 출처"));
    check("타깃 미확인(null)도 다른 값으로 취급해 알린다", C.compareSides(base, { ...base, week: "2026-09-14", targetLabel: null }).differs.target);
  }

  // ── 같은 시간대 차이 ─────────────────────────────────────
  {
    const cell = { dow: 1, startMin: 20 * 60, endMin: 21 * 60 };
    const others = [
      { dow: 1, startMin: 19 * 60 + 30, endMin: 20 * 60 + 30, rating: 0.4 }, // 30분 겹침
      { dow: 1, startMin: 20 * 60 + 30, endMin: 22 * 60, rating: 0.8 }, // 30분 겹침
      { dow: 2, startMin: 20 * 60, endMin: 21 * 60, rating: 9 }, // 다른 요일 — 무시
    ];
    const a = C.otherSideAverage(cell, others);
    check("겹친 분 가중평균(0.4·30분 + 0.8·30분 → 0.6)", near(a.avg, 0.6) && near(a.coverage, 1), JSON.stringify(a));
    check("다른 요일 칸은 섞지 않는다", near(C.otherSideAverage(cell, others.slice(2)).avg, 0) === false && C.otherSideAverage(cell, others.slice(2)).avg === null);
    const half = C.otherSideAverage(cell, [{ dow: 1, startMin: 20 * 60, endMin: 20 * 60 + 20, rating: 1 }]);
    check("덮는 비율 50% 미만이면 평균을 내지 않는다(추정 금지)", half.avg === null && near(half.coverage, 1 / 3, 1e-6), JSON.stringify(half));
    check("시청률 없는(null) 칸은 덮는 시간에 세지 않는다", C.otherSideAverage(cell, [{ dow: 1, startMin: 20 * 60, endMin: 21 * 60, rating: null }]).avg === null);
    const d = C.cellDiff({ ...cell, rating: 0.9 }, others);
    check("차이 = 이 칸 − 반대편 평균", near(d.diff, 0.3, 1e-9), JSON.stringify(d));
    check("이 칸 시청률이 없으면 차이 없음", C.cellDiff({ ...cell, rating: null }, others).diff === null);
    const m = C.maxAbsDiff([{ ...cell, rating: 0.9 }], [{ dow: 1, startMin: 20 * 60, endMin: 21 * 60, rating: 0.3 }]);
    check("척도 한계 = 양쪽 차이 절댓값 최댓값", near(m, 0.6, 1e-9), String(m));
    check("비교할 칸이 없으면 척도 한계 null", C.maxAbsDiff([{ ...cell, rating: 1 }], []) === null);
  }

  // ── 색 ──────────────────────────────────────────────────
  {
    const pos = C.divergingColor(0.5, 0.5);
    const neg = C.divergingColor(-0.5, 0.5);
    const zero = C.divergingColor(0, 0.5);
    const tiny = C.divergingColor(0.0001, 0.5);
    check("차이 0은 흰색", zero.bg === "#ffffff" && tiny.bg === "#ffffff");
    check("양(+)은 파랑 계열(R<B), 음(−)은 빨강 계열(R>B)", (() => {
      const p = L.hexToRgb(pos.bg);
      const n = L.hexToRgb(neg.bg);
      return p[2] > p[0] && n[0] > n[2];
    })(), `${pos.bg} ${neg.bg}`);
    check("가장 진한 양수는 흰 글씨, 음수는 글자색 유지(기존 규칙)", pos.isDark === true && neg.isDark === false);
    const half = L.hexToRgb(C.divergingColor(0.25, 0.5).bg);
    const full = L.hexToRgb(pos.bg);
    check("차이가 클수록 진하다(단조)", half[0] > full[0]);
    check("척도가 없으면(0) 흰색", C.divergingColor(1, 0).bg === "#ffffff");
    const a1 = C.absoluteColor(0.2);
    const a2 = C.absoluteColor(0.8);
    check("공통 절대색: 같은 값은 채널과 무관하게 같은 색, 높을수록 진하다", C.absoluteColor(0.5).bg === C.absoluteColor(0.5).bg && L.hexToRgb(a2.bg)[1] < L.hexToRgb(a1.bg)[1]);
    check("공통 절대색: 눈금 한계 이상은 같은 색", C.absoluteColor(1.0).bg === C.absoluteColor(3.0).bg);
    check("부호 표기", C.signedDiffText(0.123, 3) === "+0.123" && C.signedDiffText(-0.045, 3) === "−0.045" && C.signedDiffText(0, 3) === "±0.000");
    check("색 모드 설명이 세 모드 모두 있다", ["channel", "absolute", "diff"].every((k) => C.COLOR_MODE_HELP[k as "channel"].length > 10));
    check("채널 기준 설명이 '같은 색이 같은 시청률이 아님'을 밝힌다", C.COLOR_MODE_HELP.channel.includes("같은 시청률이 아닙니다"));
  }

  // ── 기하(눈금) ───────────────────────────────────────────
  {
    const all = C.gridGeometry("all", null);
    check("기본(하루 전체)은 기존 눈금과 같다(0.6px/분·864px·02~25시 눈금)", near(all.pxPerMin, L.PX_PER_MIN) && all.heightPx === L.GRID_HEIGHT && all.startMin === L.GRID_START_MIN && all.endMin === L.GRID_END_MIN && all.hourTicks.join() === L.HOUR_TICKS.join() && all.fontScale === 1, JSON.stringify(all));
    const prime = C.gridGeometry("prime", null);
    check("프라임은 18~23시를 같은 높이로 확대한다", prime.startMin === 18 * 60 && prime.endMin === 23 * 60 && prime.pxPerMin > 2 && Math.abs(prime.heightPx - 864) < 1 && prime.fontScale > 1 && prime.hourTicks.length === 5, JSON.stringify(prime));
    check("프라임 범위가 시스템 프라임 정의에서 온다", C.HOUR_RANGES.prime.fromHour === 18 && C.HOUR_RANGES.prime.toHour === 23 && C.HOUR_RANGES.prime.label.includes("평일 19~23시"));
    check("요일 하나만 보면 글자가 커진다", C.gridGeometry("all", 3).fontScale > 1 && C.gridGeometry("all", 3).fontScale <= 1.5);
    check("확대 한도(3px/분)를 넘지 않는다", C.gridGeometry("prime", 1).pxPerMin <= C.MAX_PX_PER_MIN);
  }

  // ── URL 왕복·검증 ────────────────────────────────────────
  {
    const get = (q: string) => {
      const sp = new URLSearchParams(q);
      return (k: string) => sp.get(k);
    };
    const def = C.parseCompareQuery(get(""));
    check("빈 URL은 기본값", JSON.stringify(def.prefs) === JSON.stringify(C.DEFAULT_PREFS) && !def.left.channel && !def.right.week);
    check("기본값은 직렬화하지 않는다", C.serializeCompareQuery(def).toString() === "");
    const q: import("../src/lib/workspace/weekCompare").CompareQuery = {
      prefs: { range: "prime", day: 5, density: "title", color: "diff" },
      left: { channel: "ENA", week: "2026-09-14" },
      right: { channel: "COMPETITOR::tvN", week: "2026-09-21" },
    };
    const ser = C.serializeCompareQuery(q).toString();
    const back = C.parseCompareQuery(get(ser));
    check("직렬화 → 파싱 왕복(경쟁채널 코드 포함)", JSON.stringify(back) === JSON.stringify(q), ser);
    const bad = C.parseCompareQuery(get("rng=zzz&day=9&dens=x&clr=y&lc=<script>&lw=2026-13-45&rc=ena&rw=abc"));
    check("잘못된 값은 버리고 기본값을 쓴다", JSON.stringify(bad.prefs) === JSON.stringify(C.DEFAULT_PREFS) && !bad.left.channel && !bad.left.week && !bad.right.channel && !bad.right.week, JSON.stringify(bad));
    check("존재하지 않는 날짜(02-30)는 거부", C.parseCompareQuery(get("lw=2026-02-30")).left.week === undefined);
    check("day=0·소수는 거부", C.parseCompareQuery(get("day=0")).prefs.day === null && C.parseCompareQuery(get("day=2.5")).prefs.day === null);
  }

  // ── 키보드 이동 ──────────────────────────────────────────
  {
    const cells = [
      { dow: 1, startMin: 1200, endMin: 1260 }, // 0 월 20:00
      { dow: 1, startMin: 1260, endMin: 1320 }, // 1 월 21:00
      { dow: 2, startMin: 1180, endMin: 1290 }, // 2 화 19:40~21:30 (월 20:00 덮음)
      { dow: 3, startMin: 600, endMin: 660 }, //   3 수 10:00 (덮는 칸 없음)
    ];
    check("아래 방향키 = 같은 요일 다음 칸", C.neighborCell(cells, 0, "ArrowDown") === 1);
    check("위 방향키 = 같은 요일 이전 칸, 맨 위면 제자리(null)", C.neighborCell(cells, 1, "ArrowUp") === 0 && C.neighborCell(cells, 0, "ArrowUp") === null);
    check("오른쪽 = 이웃 요일에서 시작 시각을 덮는 칸", C.neighborCell(cells, 0, "ArrowRight") === 2);
    check("덮는 칸이 없으면 가장 가까운 시작 시각 칸", C.neighborCell(cells, 2, "ArrowRight") === 3);
    check("왼쪽 끝/오른쪽 끝에서는 제자리", C.neighborCell(cells, 0, "ArrowLeft") === null && C.neighborCell(cells, 3, "ArrowRight") === null);
    check("빈 요일은 건너뛴다", C.neighborCell([{ dow: 1, startMin: 1200, endMin: 1260 }, { dow: 4, startMin: 1200, endMin: 1260 }], 0, "ArrowRight") === 1);
  }

  // ── 편성안 변경 규모 요약(자판기) ───────────────────────────
  {
    const S = await import("../src/app/ideal-schedule/changeSummary");
    type Row = import("../src/app/ideal-schedule/model").CompareRow;
    const mk = (i: number, changed: boolean, diff: number | null, status = "AI", min = 60): Row => ({
      weekday: 1,
      startMin: i * 100,
      endMin: i * 100 + min,
      ideal: { blockId: "b" + i, programName: "P" + i, episodeSubtitle: null, status, contentType: "OWN", expectedKpi: 0.5, confidence: 1, reasons: null },
      current: { programName: "C" + i, episodeSubtitle: null, startMin: i * 100, expectedKpi: 0.5, actualKpi: 0.5 },
      changed,
      expectedKpiDiff: diff,
    });
    const rows: Row[] = [];
    for (let i = 0; i < 134; i++) rows.push(mk(i, i < 122, i === 0 ? 0.5 : 0.0001));
    const s = S.summarizeChanges(rows);
    check("134칸 중 122칸 변경을 센다", s.totalSlots === 134 && s.changedSlots === 122 && s.large === true);
    check("헤드라인에 규모와 방송분이 함께 나온다", S.changeHeadline(s) === "134칸 중 122칸(91%) 변경 · 변경 방송분 7,320분(전체 8,040분의 91%)", S.changeHeadline(s));
    check("영향이 한 건에 몰리면 상위 1건으로 집중도를 말한다", s.impactTop?.k === 1 && (s.impactTop?.share ?? 0) >= 0.8, JSON.stringify(s.impactTop));
    check("큰 변경 안내는 '개선으로 단정하지 말라'는 문구를 담는다", S.LARGE_CHANGE_NOTE.includes("단정하지 말고") && S.LARGE_CHANGE_NOTE.includes("모델상 값"));
    const small = S.summarizeChanges([mk(0, true, 0.1), mk(1, false, null), mk(2, false, null), mk(3, false, null)]);
    check("바뀐 칸이 적으면 큰 변경으로 표시하지 않는다", small.large === false && small.slotShare === 0.25);
    const exact = S.summarizeChanges([mk(0, true, 0.1), mk(1, false, null)]);
    check("경계: 정확히 50%면 큰 변경(이상)", exact.large === true && S.LARGE_CHANGE_SHARE === 0.5);
    const forced = S.summarizeChanges([mk(0, true, -0.2, "REQUIRED"), mk(1, true, -0.2, "MANUAL_OVERRIDE"), mk(2, true, -0.1, "AI"), mk(3, true, 0.1, "AI")]);
    check("필수·직접 교체는 따로 세고, 기대가 낮아지는 칸은 필수·잠금을 뺀다", forced.forcedChanged === 2 && forced.downChanged === 1, JSON.stringify(forced));
    const none = S.summarizeChanges([]);
    check("칸이 없으면 비율은 null, 큰 변경 아님", none.slotShare === null && none.large === false && S.changeHeadline(none) === "비교할 칸이 없습니다.");
    const unknown = S.summarizeChanges([mk(0, true, null), mk(1, true, null)]);
    check("기대 차이를 계산할 수 없으면 집중도를 만들지 않는다", unknown.impactTop === null && S.impactText(unknown) === null && unknown.measurable === 0);
    check("교체 후 유효·재계산 목록에 권리 판정 누락이 들어 있다", S.NEEDS_RECALC.some((t) => t.includes("권리") && t.includes("거치지 않음")) && S.VALID_NOW.length >= 3);
    const r0 = S.rightsText(null, 0);
    const r1 = S.rightsText({ status: "applied", mode: "executable", inventoryVersion: "v1", unconfirmedInterpretations: [], message: null }, 0);
    const r2 = S.rightsText({ status: "not_configured", mode: "explore", inventoryVersion: null, unconfirmedInterpretations: [], message: null }, 2);
    const r3 = S.rightsText({ status: "error", mode: "explore", inventoryVersion: null, unconfirmedInterpretations: [], message: "읽기 실패" }, 0);
    check("권리 상태: 기록 없음·적용·미입력·실패를 구분한다", r0.tone === "muted" && r1.tone === "ok" && r2.tone === "warn" && r3.tone === "warn" && r3.text.includes("읽기 실패"));
    check("권리 적용이어도 직접 교체가 있으면 경고하고 그 칸은 판정 밖임을 밝힌다", S.rightsText({ status: "applied", mode: "explore", inventoryVersion: "v1", unconfirmedInterpretations: [], message: null }, 3).tone === "warn" && r2.text.includes("2칸은 권리 판정을 거치지 않았습니다"));
    check("권리 미입력을 '문제 없음'으로 말하지 않는다", r2.text.includes("확인되지 않았습니다") && !r2.text.includes("문제 없음"));
  }

  // ── 소스 정적 검사(문구·상태 일관성) ─────────────────────────
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ROOT = path.resolve(__dirname, "..");
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
    const stripComments = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const uiFiles = [
      "src/app/schedule-grid/page.tsx",
      "src/components/ScheduleWeekGrid.tsx",
      "src/app/ideal-schedule/page.tsx",
      "src/app/ideal-schedule/SummaryPanel.tsx",
      "src/app/ideal-schedule/CompareTable.tsx",
      "src/app/ideal-schedule/BlockDrawer.tsx",
      "src/app/ideal-schedule/IdealWeekGrid.tsx",
      "src/app/ideal-schedule/GridLegend.tsx",
      "src/app/ideal-schedule/RunStatusStrip.tsx",
    ];
    for (const f of uiFiles) {
      const body = stripComments(read(f)).replace(/refWord = "지난주"/g, "").replace(/frameLabel = "지난주"/g, "");
      check("고정 '지난주' 문구가 화면에 남아 있지 않다: " + f, !body.includes("지난주"), (body.match(/.{0,20}지난주.{0,20}/) ?? [""])[0]);
    }
    const grid = read("src/components/ScheduleWeekGrid.tsx");
    check("편성표: 늦게 온 응답을 버리는 cancelled 보호", grid.includes("let cancelled = false") && /\.then\(\(body\) => \{\n\s+if \(cancelled\) return;/.test(grid) && /\.catch\(\(\) => \{\n\s+if \(cancelled\) return;/.test(grid) && grid.includes("cancelled = true;"));
    check("편성표: 조회 실패를 '데이터 없음'과 구분(role=alert + 다시 시도)", grid.includes("loadError") && grid.includes("조회에 실패한 것입니다") && grid.includes('role="alert"'));
    check("편성표: 칸은 키보드로 선택·이동·닫기·복귀가 된다", grid.includes('role="button"') && grid.includes("tabIndex={key === tabStop ? 0 : -1}") && grid.includes("neighborCell(") && grid.includes('e.key === "Escape"') && grid.includes("cellRefs.current.get(k)?.focus()"));
    check("편성표: 시청률 미관측은 색뿐 아니라 빗금으로도 표시", grid.includes("UNOBSERVED_HATCH") && grid.includes("backgroundImage: unobserved"));
    check("편성표: 회차를 추정하지 않는다는 문구가 근거 패널에 있다", grid.includes("이 화면이 회차를 추정하지 않습니다"));
    const page = read("src/app/schedule-grid/page.tsx");
    check("비교 화면: 바꾸는 중 이전 채널 값이 남지 않게 메타를 현재 선택과 대조한다", page.includes("meta.channelCode === side.channelCode && meta.week === side.week") && page.includes("setMeta(null)"));
    check("비교 화면: 기본 배치(왼쪽=이전 주, 오른쪽=최신 주) 보존", page.includes("loadSide(left.channelCode, setLeft, true, left.presetWeek)") && page.includes("loadSide(right.channelCode, setRight, false, right.presetWeek)"));
    check("비교 화면: 결정 카드 등 다른 쿼리를 지우지 않고 자기 키만 갈아 쓴다", page.includes("for (const k of OWN_KEYS) sp.delete(k)") && page.includes("router.replace(`/schedule-grid?${next}`"));
    const ideal = read("src/app/ideal-schedule/page.tsx");
    check("자판기: 상단·편성표 제목·출력 머리글이 같은 주간 기대값(shownExpected)을 쓴다", (ideal.match(/shownExpected/g) ?? []).length >= 8 && !ideal.includes("fmt(summary.expectedAvgRating)"));
    check("자판기: 상태 띠가 편성표 바로 위에 있다", ideal.indexOf("<RunStatusStrip") > 0 && ideal.indexOf("<RunStatusStrip") < ideal.indexOf("{gridArea}"));
    check("자판기 이름·아이콘은 그대로(사용자 결정)", ideal.includes("시청률 자판기") && ideal.includes("<VendingMachineIcon"));
  }

  // ── 코드 리뷰·UX 검토 반영분(단계 10) ───────────────────────
  {
    const D = await import("../src/lib/workspace/dates");
    const C = await import("../src/lib/workspace/weekCompare");
    const S = await import("../src/app/ideal-schedule/changeSummary");
    // KST 경계
    check("KST 변환: UTC 14:59:59는 같은 날, 15:00:00은 다음 날(KST 자정)", D.kstToday(new Date("2026-10-05T14:59:59Z")) === "2026-10-05" && D.kstToday(new Date("2026-10-05T15:00:00Z")) === "2026-10-06");
    check("KST 연말·연초 경계", D.kstToday(new Date("2026-12-31T15:00:00Z")) === "2027-01-01");
    check("일요일 23:59 KST는 아직 그 주, 월요일 00:00 KST부터 다음 주", C.weekRelation("2026-09-28", D.kstToday(new Date("2026-10-04T14:59:59Z"))) === "this" && C.weekRelation("2026-09-28", D.kstToday(new Date("2026-10-04T15:00:00Z"))) === "last");
    // 잘못된 날짜 방어(옛 저장본의 빈 값·깨진 값이 화면 전체를 죽이지 않는다)
    let threw = false;
    try {
      C.weekLabel("", "2026-10-06");
      C.weekLabel("bad", "2026-10-06");
      C.periodText("2026-13-45", "2026-10-06");
      C.weekWord("garbage", "2026-10-06");
      C.weekRelation("x", "2026-10-06");
    } catch {
      threw = true;
    }
    check("잘못된 날짜 문자열에서도 예외 없이 원문/대체 문구를 돌려준다", !threw && C.weekWord("garbage", "2026-10-06") === "기준 주" && C.weekRelation("x", "2026-10-06") === "other");
    check("존재하지 않는 날짜(02-30)는 유효하지 않다", !C.validIso("2026-02-30") && C.validIso("2026-02-28") && !C.validIso(null));
    // 경쟁채널 코드 왕복(한글·공백, 깨진 %)
    const enc = (n: string) => `COMPETITOR::${encodeURIComponent(n)}`;
    const q = (code: string) => C.parseCompareQuery((k) => (k === "rc" ? code : null)).right.channel;
    check("한글 긴 이름의 경쟁채널 코드도 URL 왕복에서 살아남는다", q(enc("가나다라마바사아자차")) === enc("가나다라마바사아자차") && q(enc("tvN STORY")) === enc("tvN STORY"));
    check("깨진 % 인코딩의 경쟁채널 코드는 받지 않는다", q("COMPETITOR::%E0%A4%A") === undefined);
    check("스크립트·구분자가 든 채널 값은 받지 않는다", q("COMPETITOR::a&b=c") === undefined && q("<img>") === undefined);
    // 비교 판정 모순
    const base = { channelCode: "ENA", channelName: "ENA", week: "2026-09-21", targetLabel: "수도권 개인2049", source: "db" as const };
    const v = C.compareSides(base, { ...base, source: "db+upload" });
    check("같은 주·같은 채널에서 출처만 다르면 '같은 편성표'라 하지 않는다", v.mode === "same_week_variant" && v.differsList.includes("자료 출처") && !v.title.includes("두 번 보고"));
    const nn = C.compareSides({ ...base, targetLabel: null }, { ...base, week: "2026-09-14", targetLabel: null });
    check("양쪽 타깃이 모두 미확인이면 같다고 안심시키지 않고 알린다", nn.cautions.some((c) => c.includes("양쪽 모두 시청률 타깃을 확인하지 못했습니다")));
    // 수동 교체 후 개수(저장 요약은 생성 시점 값)
    const blocks = [
      { layer: "IDEAL", status: "MANUAL_OVERRIDE" },
      { layer: "IDEAL", status: "REQUIRED" },
      { layer: "IDEAL", status: "LOCKED" },
      { layer: "IDEAL", status: "AI" },
      { layer: "IDEAL", status: "AI" },
      { layer: "CURRENT", status: "MANUAL_OVERRIDE" },
    ];
    check("수동 교체 칸 수는 현재 IDEAL 블록에서 센다(CURRENT 제외)", S.countManualOverrides(blocks) === 1);
    check("필수·잠금 칸 수는 상태 기준(수동 교체 제외)", S.countRequiredOrLocked(blocks) === 2);
    check("교체 0건이던 편성안에 1건 교체하면 권리 경고가 켜진다", S.rightsText({ status: "applied", mode: "executable", inventoryVersion: "v", unconfirmedInterpretations: [], message: null }, S.countManualOverrides(blocks)).tone === "warn");
    // 영향 집중도 문구
    const spread = { ...S.summarizeChanges([]), impactTop: { k: 90, share: 0.8 }, measurable: 100 };
    check("영향이 고르게 퍼지면 '모여 있다'고 말하지 않는다", (S.impactText(spread) ?? "").includes("고르게 퍼져") && !(S.impactText(spread) ?? "").includes("모여"));
    // 방송분 비율로도 큰 변경 판정
    const mk = (i: number, changed: boolean, min: number) => ({ weekday: 1, startMin: i * 100, endMin: i * 100 + min, ideal: { blockId: "b" + i, programName: "P", episodeSubtitle: null, status: "AI", contentType: "OWN", expectedKpi: 0.5, confidence: 1, reasons: null }, current: null, changed, expectedKpiDiff: 0.1 });
    const byMin = S.summarizeChanges([mk(0, true, 300), mk(1, false, 10), mk(2, false, 10), mk(3, false, 10)]);
    check("칸 비율은 낮아도 방송분 비율이 높으면 큰 변경", (byMin.slotShare ?? 1) < 0.5 && byMin.large === true);
  }

  // ── 소스 정적 검사 2(검토 반영) ──────────────────────────────
  {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const ROOT = path.resolve(__dirname, "..");
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
    const grid = read("src/components/ScheduleWeekGrid.tsx");
    check("포커스 링: 윤곽선을 인라인 스타일로 덮지 않는다(클래스로만)", !/outline: isSelected/.test(grid) && grid.includes("focus-visible:outline-indigo-600") && !/outline: "1px solid/.test(grid));
    check("로빙 tabindex: Tab 정지점은 한 칸", grid.includes("tabIndex={key === tabStop ? 0 : -1}") && !grid.includes("tabIndex={0}\n"));
    check("첫 조회 실패에도 영구 로딩이 아니다(주 정보 없이 실패 화면)", grid.includes("if (!resolvedWeek) {") && grid.includes("return loadError ? ("));
    check("재조회 시작 시 이전 주·채널의 통계를 비운다", /setWeeklyStats\(null\);\n\s+setDailyStatsByDate\(new Map\(\)\);/.test(grid));
    check("선택 키에 보기 범위·요일이 포함된다(범위 변경 후 옛 패널이 되살아나지 않는다)", grid.includes("const cellKey = (sig: string") && grid.includes("const viewSig = `${range}:${dayFilter"));
    check("주 파라미터는 인코딩해서 보낸다", grid.includes("encodeURIComponent(effectiveWeek)"));
    check("방향키는 이동할 칸이 있을 때만 기본 동작을 막는다", /if \(n !== null\) \{\n\s+e\.preventDefault\(\);/.test(grid));
    check("인쇄에 색 기준·시간·요일 한 줄이 있다", grid.includes('className="hidden text-[9px] text-zinc-600 print:block"') && grid.includes("HOUR_RANGES[range].label"));
    const page = read("src/app/schedule-grid/page.tsx");
    check("URL 동기화: 상단 채널 전환 직후 이전 값을 쓰지 않는다(forChannel)", page.includes("left.forChannel !== urlChannelCode") && page.includes("right.forChannel !== urlChannelCode"));
    check("요청 순번: 마지막 요청만 반영(loadSide)하고 업로드 갱신도 채널 일치를 본다", page.includes("++reqSeq.current[seqKey]") && /\.then\(\(body\) => \{\n\s+if \(reqSeq\.current\[seqKey\] !== token\) return;/.test(page) && /\.catch\(\(\) => \{\n\s+if \(reqSeq\.current\[seqKey\] !== token\) return;/.test(page) && page.includes("prev.channelCode !== side.channelCode"));
    check("ChannelSelect는 렌더 밖에 있고 좌우 aria-label이 다르다", /\nfunction ChannelSelect\(/.test(page) && page.includes("${label} 채널 선택") && page.includes("${label} 주 선택"));
    check("설정·범례 막대가 스크롤해도 보인다(sticky)", page.includes('aria-label="보기 설정" className="sticky top-0'));
    check("범례 도움말이 한 번만 나온다", (page.match(/COLOR_MODE_HELP\[prefs\.color\]/g) ?? []).length === 1);
    check("차이 모드 범례에 거울 안내와 타깃 다름 경고", page.includes("서로의 거울") && page.includes("차이 값을 해석할 수 없습니다"));
    check("경쟁채널은 채널 기준 범례 문구가 다르다", page.includes("function sideScaleText") && page.includes("(경쟁채널): 기준선 이하 빨강"));
    const route = read("src/app/api/schedule-grid/data/route.ts");
    check("경쟁채널 코드 디코딩이 try 안에 있다(깨진 값이 500이 되지 않음)", /try \{\n\s+const competitorName = decodeCompetitorScheduleCode\(channelCode\);/.test(route));
    const exRoute = read("src/app/api/scheduling/ideal-schedule/[runId]/export/route.ts");
    const excel = read("src/lib/idealSchedule/excel.ts");
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check("엑셀: 시트 이름·제목·열 머리글에 고정 '지난주'가 없다(기본값 제외)", !strip(excel).replace(/refWord \?\? "지난주"/g, "").includes("지난주"), (strip(excel).replace(/refWord \?\? "지난주"/g, "").match(/.{0,20}지난주.{0,20}/) ?? [""])[0]);
    check("엑셀: 수동 교체 후 재계산 전이면 칸 합산값과 작업 상태를 쓴다", exRoute.includes("const dirty = run.needs_recalc === true") && exRoute.includes("수동 교체 반영·재계산 전") && exRoute.includes('["작업 상태"'));
    const ideal = read("src/app/ideal-schedule/page.tsx");
    check("자판기: 이전 편성안 목록의 현재 편성안 값도 shownExpected", ideal.includes("r.id === runId ? shownExpected"));
    check("자판기: 직접 교체 개수는 현재 블록에서 센다", ideal.includes("manualCount={countManualOverrides(ideal)}"));
    check("자판기: 큰 변경 배지가 요약·제목·출력 머리글에 있다", (ideal.match(/크게 다름|크게 다른 안/g) ?? []).length >= 2 && read("src/app/ideal-schedule/SummaryPanel.tsx").includes("크게 다름"));
  }

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
