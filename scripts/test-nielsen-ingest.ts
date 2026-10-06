// 닐슨 수집(단계 01) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크·메일에 접근하지 않는다
// (Supabase 클라이언트를 메모리 대역으로 바꿔 끼운다). 실제 원본 XLS 대조는 파일이 있을 때만 실행하고, 없으면 SKIP으로 표시한다.
// 실행: npm run test:nielsen   (원본 폴더·패키지 JSON 위치는 NIELSEN_FIXTURE_DIR, NIELSEN_GOLDEN_JSON 환경변수로 바꿀 수 있다)
import fs from "node:fs";
import path from "node:path";
import { FakeDb } from "./lib/fakeSupabase";
import { CHANNELS, buildDailyWorkbook, buildPeriodWorkbook, type DailySpec } from "./lib/nielsenFixtures";

let passed = 0;
let skipped = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
function skip(name: string, why: string) {
  skipped++;
  console.log(`⏭️  SKIP ${name} — ${why}`);
}
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a !== null && a !== undefined && Math.abs(a - b) < eps;

async function main() {
  // 어떤 경우에도 운영 DB를 가리키지 않게 더미 값으로 덮어쓴다(대역이 모든 호출을 가로채므로 네트워크는 쓰이지 않는다).
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-real";

  const { supabase } = await import("../src/lib/supabase");
  const db = new FakeDb();
  (supabase as unknown as { from: (t: string) => unknown }).from = (t) => db.from(t);
  (supabase as unknown as { rpc: () => unknown }).rpc = () => db.rpc();

  const D = await import("../src/lib/nielsenDaily");
  const P = await import("../src/lib/nielsenPeriod");
  const C = await import("../src/lib/nielsenIngestChecks");
  const X = await import("../src/lib/nielsenFileDispatch");

  // ── A. 순수 함수 ─────────────────────────────────────────────
  {
    const rowsOf = (text: string) => [[text]] as (string | undefined)[][];
    check("분석기간 하루 → 날짜", D.parseDailyAnalysisDate(rowsOf("- 분석기간 : 2026. 10. 04. (일요일)")) === "2026-10-04");
    check("분석기간 범위 → null(일간 아님)", D.parseDailyAnalysisDate(rowsOf("- 분석기간 : 2026.09.28 - 2026.10.04")) === null);
    check("분석기간 줄 없음 → null", D.parseDailyAnalysisDate(rowsOf("제목")) === null);
    check("주간 기간 파싱(기존 동작 유지)", JSON.stringify(P.parseAnalysisPeriod(rowsOf("- 분석기간 : 2026.09.28 - 2026.10.04"))) === JSON.stringify({ from: "2026-09-28", to: "2026-10-04" }));
    check("파일 해시는 내용 기준·결정적", C.fileSha256(Buffer.from("a")) === C.fileSha256(Buffer.from("a")) && C.fileSha256(Buffer.from("a")) !== C.fileSha256(Buffer.from("b")) && C.fileSha256(Buffer.from("a")).length === 64);
    check("경쟁시트 라벨 → 타깃상세 라벨", C.competitorLabelToDetailLabel("개인2049") === "수도권 2049" && C.competitorLabelToDetailLabel("개인2039") === "수도권 2039" && C.competitorLabelToDetailLabel("유료방송가구") === "전국 유료가구" && C.competitorLabelToDetailLabel("여자3049") === "수도권 여3049" && C.competitorLabelToDetailLabel("개인5064") === null);
    check("어댑터 상태: 주간 검증됨 / 월간 잠정", C.periodAdapterStatus("weekly").status === "verified" && C.periodAdapterStatus("monthly").status === "provisional" && !!C.periodAdapterStatus("monthly").note);
    check("주간 형태: 월~일 7일이면 경고 없음, 아니면 경고", C.checkWeeklyShape("2026-09-28", "2026-10-04").length === 0 && C.checkWeeklyShape("2026-09-29", "2026-10-05").length === 1 && C.checkWeeklyShape("2026-09-28", "2026-10-02").length === 1);
    const before = [
      { channelCode: "ENA", targetLabel: "개인2049", rank: 7, rating: 0.11358 },
      { channelCode: "ENA", targetLabel: "개인2039", rank: 7, rating: 0.05 },
      { channelCode: "OLD", targetLabel: "x", rank: 1, rating: 1 },
    ];
    const after = [
      { channelCode: "ENA", targetLabel: "개인2049", rank: 8, rating: 0.11358 },
      { channelCode: "ENA", targetLabel: "개인2039", rank: 7, rating: 0.05 },
      { channelCode: "NEW", targetLabel: "y", rank: 2, rating: null },
    ];
    const d = C.diffRankRows(before, after);
    check("재수신 차이: 변경1·동일1·추가1·삭제1", d.changed === 1 && d.unchanged === 1 && d.added === 1 && d.removed === 1 && d.samples.length === 1);
    check("재수신 차이: 같으면 변경 0", C.diffRankRows(before, before).changed === 0);
    const now = new Date("2026-10-06T12:00:00Z");
    const ago = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
    check("메일 재시도: processed는 완료", C.mailRetryState({ status: "processed" }, now) === "done");
    check("메일 재시도: processing은 진행 중(다른 실행)", C.mailRetryState({ status: "processing" }, now) === "in_progress");
    check("메일 재시도: error 1회 + 10분 경과는 대기", C.mailRetryState({ status: "error", attemptCount: 1, processedAt: ago(10) }, now) === "waiting");
    check("메일 재시도: error 1회 + 31분 경과는 재시도", C.mailRetryState({ status: "error", attemptCount: 1, processedAt: ago(31) }, now) === "retry");
    check("메일 재시도: 상한(3회) 도달은 dead-letter", C.mailRetryState({ status: "error", attemptCount: 3, processedAt: ago(500) }, now) === "dead_letter");
    check("메일 재시도: skipped는 재시도 안 함", C.mailRetryState({ status: "skipped" }, now) === "done");
  }

  // ── B. 합성 일간 파일 파싱 ───────────────────────────────────
  const base: DailySpec = { sheetDate: "2026-10-04" };
  const parse = (spec: DailySpec, name: string) => D.parseNielsenDailyWorkbook(buildDailyWorkbook(spec), name, new Set());
  {
    const ok = parse(base, "닐슨_채널시청률(261004).xls");
    check("날짜: 시트·파일명 일치 → sheet+filename", ok.ok && ok.dateSource === "sheet+filename" && ok.reportDate === "2026-10-04");
    const noName = parse(base, "아무이름.xls");
    check("날짜: 파일명에 날짜가 없어도 시트 분석기간으로 판정", noName.ok && noName.dateSource === "sheet" && noName.reportDate === "2026-10-04");
    const mismatch = parse(base, "닐슨_채널시청률(261005).xls");
    check("날짜: 파일명과 시트가 다르면 적재 거부(다른 날 덮어쓰기 방지)", !mismatch.ok && /다릅니다/.test(mismatch.ok ? "" : mismatch.message));
    const noSheetDate = parse({ ...base, sheetDate: null }, "닐슨_채널시청률(261004).xls");
    check("날짜: 시트에 분석기간이 없으면 파일명 날짜로 폴백(표시)", noSheetDate.ok && noSheetDate.dateSource === "filename");
    const none = parse({ ...base, sheetDate: null }, "아무이름.xls");
    check("날짜: 둘 다 없으면 명확한 오류", !none.ok);
    const range = parse(base, "닐슨_채널시청률(260928-261004).xls");
    check("범위 파일명은 일간 파서가 거부", !range.ok);
    const noRank = parse({ ...base, omitRankSheet: true }, "닐슨_채널시청률(261004).xls");
    check("필수 시트 없음 → 시트 이름이 담긴 오류", !noRank.ok && /유료방송가입가구/.test(noRank.ok ? "" : noRank.message));
    const extra = parse({ ...base, extraSheet: true }, "닐슨_채널시청률(261004).xls");
    check("알 수 없는 시트는 무시하고 정상 처리", extra.ok && extra.programRows.length > 0);

    const play = (r: ReturnType<typeof parse>) => (r.ok ? r.programRows.filter((x) => x.channelCode === "ENA_PLAY" && x.startTime === "07:54:58" && !x.isDailyAggregate) : []);
    const a = play(parse({ ...base, playHeaderOrder: ["수도권 2039", "수도권 2049"] }, "닐슨_채널시청률(261004).xls"));
    const b = play(parse({ ...base, playHeaderOrder: ["수도권 2049", "수도권 2039"] }, "닐슨_채널시청률(261004).xls"));
    const val = (rows: typeof a, label: string) => rows.find((x) => x.targetLabel === label)?.rating;
    check("ENA PLAY 헤더 순서 D=2039/I=2049 → 헤더로 매핑", close(val(a, "수도권 2039"), 0.02327) && close(val(a, "수도권 2049"), 0.07742));
    check("ENA PLAY 헤더 순서가 바뀌어도(D=2049/I=2039) 같은 값이 같은 타깃에 매핑", close(val(b, "수도권 2039"), 0.02327) && close(val(b, "수도권 2049"), 0.07742));

    const withNumeric = parse({ ...base, numericTimes: true }, "닐슨_채널시청률(261004).xls");
    const nt = withNumeric.ok ? withNumeric.programRows.find((x) => x.channelCode === "ENA_PLAY" && !x.isDailyAggregate && x.rawProgramName === "심야극장") : undefined;
    check("엑셀 일수 실수 시간·24시 이상 시간이 시계 시각으로 정규화(25:30 → 01:30:00)", nt?.startTime === "01:30:00" && withNumeric.ok && withNumeric.programRows.some((x) => x.startTime === "07:54:58"));
    const strTimes = parse(base, "닐슨_채널시청률(261004).xls");
    const st = strTimes.ok ? strTimes.programRows.find((x) => x.rawProgramName === "심야극장") : undefined;
    check("문자열 '25:30:00'도 같은 결과", st?.startTime === "01:30:00");

    const agg = ok.ok ? ok.programRows.filter((x) => x.isDailyAggregate) : [];
    check("하루전체 행은 프로그램이 아니라 채널 집계(isDailyAggregate)로 분리", agg.length > 0 && agg.every((x) => x.startTime === null && x.rawProgramName === "하루전체"));
    const onceNames = ok.ok ? [...new Set(ok.programRows.filter((x) => x.channelCode === "ONCE").map((x) => x.rawProgramName))] : [];
    const olifeNames = ok.ok ? [...new Set(ok.programRows.filter((x) => x.channelCode === "OLIFE").map((x) => x.rawProgramName))] : [];
    check("다중 채널 시트: 블록 헤더로 채널을 구분(시트명이 아님)", onceNames.includes("ONCE프로") && !onceNames.includes("OLIFE프로") && olifeNames.includes("OLIFE프로"));
    const blank = parse({ ...base, enaBlankRating: true }, "닐슨_채널시청률(261004).xls");
    const enaRows = blank.ok ? blank.programRows.filter((x) => x.channelCode === "ENA" && !x.isDailyAggregate) : [];
    check("빈 셀=결측(null), 숫자 0=관측값 0 구분", enaRows.find((x) => x.targetLabel === "수도권 2049")?.rating === null && enaRows.find((x) => x.targetLabel === "수도권 2039")?.rating === 0);

    // 교차 검증(경쟁시트 자사 블록 ↔ 타깃상세)
    const cross = (spec: DailySpec) => {
      const buf = buildDailyWorkbook({ ...spec, includeCompetitorOwnBlock: true });
      const r = D.parseNielsenDailyWorkbook(buf, "닐슨_채널시청률(261004).xls", new Set());
      return r.ok ? C.crossCheckOwnChannelTargets(r.programRows, C.inspectDailyWorkbook(buf)) : null;
    };
    const good = cross(base);
    check("교차 검증: ENA PLAY 타깃상세(D=2039,I=2049)와 경쟁시트(2049,2039) 일치", !!good && good.checked >= 2 && good.mismatches.length === 0, JSON.stringify(good?.mismatches));
    const bad = cross({ ...base, ownBlockPlay: [0.02327, 0.07742] });
    check("교차 검증: 열이 뒤바뀐 값은 불일치로 경고", !!bad && bad.mismatches.length >= 1 && bad.issues.length === 1);
  }

  // ── C. 적재 흐름(대역 DB) ────────────────────────────────────
  const channelIdByCode = new Map(CHANNELS.map((c) => [c.code, `ch-${c.code}`]));
  const primary = new Map<string, string | null>([
    ["ENA", "수도권 개인2049"],
    ["ENA_DRAMA", "수도권 개인2049"],
    ["ENA_PLAY", "수도권 개인2049"],
    ["ENA_STORY", "National 유료방송가입가구"],
    ["OLIFE", "National 유료방송가입가구"],
    ["ONCE", "National 유료방송가입가구"],
    ["SKYUHD", "National 유료방송가입가구"],
  ]);
  const newCtx = (): import("../src/lib/nielsenFileDispatch").NielsenFileDispatchContext => ({
    dailyCtx: {
      channelIdByCode,
      targetIdCache: new Map(),
      knownTargetLabels: new Set(),
      competitorNames: new Set(),
      competitorNameByCode: new Map(),
      registeredCompetitorByChannel: new Map(),
      primaryTargetByCode: primary,
    },
    channelIdByCode,
    targetIdByLabel: new Map([["개인2049", "t-2049"], ["National 유료방송가입가구", "t-hh"], ["수도권 2049", "t-d2049"]]),
  });
  const file = "닐슨_채널시청률(261004).xls";
  const batches = () => db.rows("nielsen_ingest_batches");
  const ratingsOfDay = () => db.rows("ratings").filter((r) => r.broadcast_date === "2026-10-04" && r.source_type === "nielsen_daily");
  const ratingRank = (code: string, label: string) => {
    const tid = db.rows("targets").find((t) => t.label === label)?.id;
    return db.rows("ratings").find((r) => r.channel_id === `ch-${code}` && r.target_id === tid && r.program_id === null && r.rank !== null && r.rank !== undefined);
  };

  const A = buildDailyWorkbook(base);
  const r1 = await X.ingestAnyNielsenFile(A, file, newCtx());
  check("1차 적재 성공 + 개정 1", r1.kind === "daily" && r1.ok && !("duplicate" in r1 && r1.duplicate) && ("revision" in r1 && r1.revision === 1));
  check("원장: applied 1건, 해시·파서 버전·단계 기록", batches().length === 1 && batches()[0].status === "applied" && batches()[0].file_sha256 === C.fileSha256(A) && batches()[0].parser_version === C.NIELSEN_PARSER_VERSION && (batches()[0].stage_log as { stage: string }[]).map((s) => s.stage).join(",") === "received,parsed,validated,applied");
  check("원장: 원본 헤더(시트명·타깃 라벨)와 교차검증 요약 보존", JSON.stringify(batches()[0].sheet_meta).includes("개인2049") && JSON.stringify(batches()[0].sheet_meta).includes("수도권 2039"));
  check("file_uploads에 file_hash 기록", db.rows("file_uploads").some((f) => f.file_hash === C.fileSha256(A)));
  check("채널 랭킹 행: ENA 개인2049 시청률 0.01·순위 1", close(Number(ratingRank("ENA", "개인2049")?.rating), 0.01) && Number(ratingRank("ENA", "개인2049")?.rank) === 1);
  check("하루전체 행은 program_id 없는 채널 집계로 저장, programs에 '하루전체' 없음", db.rows("ratings").some((r) => r.program_id === null && r.rank === undefined && r.broadcast_date === "2026-10-04") && !db.rows("programs").some((p) => String(p.canonical_name).includes("하루전체")));
  const n1 = ratingsOfDay().length;

  const delBefore = db.opsOf("ratings", "delete");
  const insBefore = db.opsOf("ratings", "insert");
  const r2 = await X.ingestAnyNielsenFile(A, file, newCtx());
  check("동일 파일 재업로드 → 변경 없음(duplicate)", r2.kind === "daily" && r2.ok && "duplicate" in r2 && r2.duplicate === true);
  check("재업로드는 ratings를 지우지도 넣지도 않음(멱등)", db.opsOf("ratings", "delete") === delBefore && db.opsOf("ratings", "insert") === insBefore && ratingsOfDay().length === n1);
  check("원장: skipped_duplicate 기록, 개정 번호 유지", batches().length === 2 && batches()[1].status === "skipped_duplicate" && batches()[1].revision === 1);

  const B = buildDailyWorkbook({ ...base, rankRating: { "ENA|개인2049": 0.5 } });
  const r3 = await X.ingestAnyNielsenFile(B, file, newCtx());
  check("같은 날짜 수정본 → 개정 2 + 차이 1건 이상", r3.kind === "daily" && r3.ok && "revision" in r3 && r3.revision === 2 && !!r3.diff && r3.diff.changed >= 1, JSON.stringify(r3.kind === "daily" ? r3.diff : null));
  check("수정본 값이 반영(0.5)되고 행 수는 유지", close(Number(ratingRank("ENA", "개인2049")?.rating), 0.5) && ratingsOfDay().length === n1);
  check("원장: 개정 2가 개정 1을 supersede", batches().find((b) => b.revision === 2 && b.status === "applied")?.supersedes_batch_id === batches()[0].id);
  check("수정본 경고(차이)가 사용자 경고에 포함", r3.kind === "daily" && (r3.qualityWarnings ?? []).some((m) => /이전 반영본/.test(m)));

  const r4 = await X.ingestAnyNielsenFile(A, file, newCtx());
  check("A→B→A 되돌리기 재업로드는 변경으로 처리(최신본이 B이므로 duplicate 아님)", r4.kind === "daily" && r4.ok && !("duplicate" in r4 && r4.duplicate) && "revision" in r4 && r4.revision === 3 && close(Number(ratingRank("ENA", "개인2049")?.rating), 0.01));

  // 실패 롤백
  const stateBefore = JSON.stringify(db.snapshot("ratings"));
  const Cfile = buildDailyWorkbook({ ...base, rankRating: { "ENA|개인2049": 0.9 } });
  db.failNext({ table: "ratings", op: "insert", message: "의도적 삽입 실패", times: 1, when: (c) => (c.rows ?? []).length > 0 && (c.rows ?? [])[0].broadcast_date === "2026-10-04" && (c.rows ?? [])[0].program_id !== undefined });
  const r5 = await X.ingestAnyNielsenFile(Cfile, file, newCtx());
  check("ratings 삽입 실패 → 실패 보고 + '되돌렸습니다'", r5.kind === "daily" && !r5.ok && /되돌렸습니다/.test(r5.message ?? ""), r5.message);
  const idsOf = (rows: { id?: unknown }[]) => rows.map((r) => String(r.id)).sort().join("|");
  check("롤백: 실패 후 ratings가 실패 전과 동일(행·값)", idsOf(db.rows("ratings")) === idsOf(JSON.parse(stateBefore)) && close(Number(ratingRank("ENA", "개인2049")?.rating), 0.01));
  check("원장: failed 기록, 이전 반영본이 계속 최신(applied)", batches().some((b) => b.status === "failed") && batches().filter((b) => b.status === "applied").slice(-1)[0].revision === 3);

  // 실패 후 같은 파일 재시도는 성공(실패가 최신 반영본으로 남지 않음)
  const r6 = await X.ingestAnyNielsenFile(Cfile, file, newCtx());
  check("실패한 파일의 재시도는 정상 적재(개정 4)", r6.kind === "daily" && r6.ok && "revision" in r6 && r6.revision === 4 && close(Number(ratingRank("ENA", "개인2049")?.rating), 0.9));

  // 백업(스냅샷) 실패 → 아무것도 지우지 않음
  const D2 = buildDailyWorkbook({ ...base, rankRating: { "ENA|개인2049": 0.3 } });
  const keep = idsOf(db.rows("ratings"));
  const delCount = db.opsOf("ratings", "delete");
  db.failNext({ table: "ratings", op: "select", message: "백업 조회 실패", times: 1 });
  const r7 = await X.ingestAnyNielsenFile(D2, file, newCtx());
  check("백업 실패 → 적재 중단, 아무것도 지우지 않음", r7.kind === "daily" && !r7.ok && db.opsOf("ratings", "delete") === delCount && idsOf(db.rows("ratings")) === keep && /백업/.test(r7.message ?? ""));

  // 경쟁채널 테이블 실패 → 부분 성공
  const ctxComp = newCtx();
  ctxComp.dailyCtx.registeredCompetitorByChannel = new Map();
  const E = buildDailyWorkbook({ ...base, rankRating: { "ENA|개인2049": 0.31 }, includeCompetitorOwnBlock: true });
  db.failNext({ table: "competitor_ratings", op: "insert", message: "경쟁 실패", times: 1 });
  ctxComp.dailyCtx.competitorNames = new Set(["ENA"]);
  ctxComp.dailyCtx.competitorNameByCode = new Map([["ENA", "ENA"]]);
  const r8 = await X.ingestAnyNielsenFile(E, file, ctxComp);
  check("경쟁채널 테이블 실패는 부분 성공(핵심 ratings는 반영)으로 표시", r8.kind === "daily" && r8.ok && (r8.partial === true || (r8.qualityWarnings ?? []).some((m) => /competitor_ratings/.test(m))) && close(Number(ratingRank("ENA", "개인2049")?.rating), 0.31));

  // KPI 타깃 누락 경고(헤더 변경으로 개인2049 블록이 빠진 경우)
  {
    const noKpi = buildDailyWorkbook({ ...base, rankRating: { "ENA|개인2049": 0.2 } });
    const parsedOk = D.parseNielsenDailyWorkbook(noKpi, file, new Set());
    if (parsedOk.ok) {
      const stripped = parsedOk.rankRows.filter((r) => !(r.channelCode === "ENA" && r.targetLabel === "개인2049"));
      const issues = C.checkKpiTargetCoverage(stripped, primary);
      check("헤더 변경으로 KPI 타깃이 빠지면 경고", issues.some((i) => /ENA의 KPI 타깃\(개인2049\)/.test(i.message)) && C.checkKpiTargetCoverage(parsedOk.rankRows, primary).length === 0);
    }
  }

  // ── C2. 주간·월간: 프로그램 상세를 만들지도 지우지도 않는다 ───────────
  {
    const programsBefore = JSON.stringify(db.snapshot("programs"));
    const ratingsBefore = JSON.stringify(db.snapshot("ratings"));
    const W = buildPeriodWorkbook("2026-09-28", "2026-10-04", 0.1);
    const w1 = await X.ingestAnyNielsenFile(W, "닐슨_채널시청률(260928-261004).xls", newCtx());
    check("주간 2시트 적재 성공(어댑터 검증됨)", w1.kind === "period" && w1.ok && w1.periodType === "weekly" && w1.adapterStatus === "verified" && (w1.inserted ?? 0) > 0);
    check("주간 입력은 programs·ratings를 만들지도 지우지도 않음", JSON.stringify(db.snapshot("programs")) === programsBefore && JSON.stringify(db.snapshot("ratings")) === ratingsBefore);
    check("주간 행은 nielsen_period_rank에만 저장", db.rows("nielsen_period_rank").length === (w1.kind === "period" ? w1.inserted : -1) && db.rows("nielsen_period_rank").every((r) => r.period_type === "weekly" && r.date_from === "2026-09-28"));
    const w2 = await X.ingestAnyNielsenFile(W, "닐슨_채널시청률(260928-261004).xls", newCtx());
    check("주간 동일 파일 재수신 → duplicate, 행 수 불변", w2.kind === "period" && w2.ok && w2.duplicate === true && db.rows("nielsen_period_rank").length === (w1.kind === "period" ? (w1.inserted ?? 0) : -1));
    const W2 = buildPeriodWorkbook("2026-09-28", "2026-10-04", 0.2);
    const w3 = await X.ingestAnyNielsenFile(W2, "닐슨_채널시청률(260928-261004).xls", newCtx());
    check("주간 수정본 → 개정 2 + 차이 보고", w3.kind === "period" && w3.ok && w3.revision === 2 && !!w3.diff && w3.diff.changed >= 1);
    const m1 = await X.ingestAnyNielsenFile(buildPeriodWorkbook("2026-09-01", "2026-09-30"), "닐슨_채널시청률(260901-260930).xls", newCtx());
    check("월간 파일은 잠정 어댑터 상태로 표시", m1.kind === "period" && m1.ok && m1.periodType === "monthly" && m1.adapterStatus === "provisional" && (m1.qualityWarnings ?? []).some((x) => /잠정/.test(x)));
    check("월간·주간 모두 프로그램 상세 불변", JSON.stringify(db.snapshot("programs")) === programsBefore && JSON.stringify(db.snapshot("ratings")) === ratingsBefore);
    const odd = await X.ingestAnyNielsenFile(buildPeriodWorkbook("2026-09-29", "2026-10-05"), "x(260929-261005).xls", newCtx());
    check("월~일이 아닌 7일 주간은 경고", odd.kind === "period" && (odd.qualityWarnings ?? []).some((x) => /월~일/.test(x)));
    const nonSheet = await X.ingestAnyNielsenFile(Buffer.from("not an excel"), "깨진파일.xls", newCtx());
    check("엑셀이 아닌 파일은 오류로 거부(적재 없음)", !nonSheet.ok);
  }

  // ── D. 실제 원본 XLS 대조(파일이 있을 때만) ───────────────────
  const fixtureDir = process.env.NIELSEN_FIXTURE_DIR ?? path.resolve("Nielsen Data/2026/10");
  const goldenPath = process.env.NIELSEN_GOLDEN_JSON ?? path.resolve("ENA_Agent_개선패키지/03_원본대조_회귀사례.json");
  if (!fs.existsSync(fixtureDir) || !fs.existsSync(goldenPath)) {
    skip("실제 원본 XLS 골든 대조", `원본 폴더(${fixtureDir}) 또는 골든 JSON(${goldenPath})이 없음`);
  } else {
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as {
      channel_golden_records: { source_file: string; channel_id: string; target: string; period_start: string; period_end: string; metrics: Record<string, { value: number | string }>; viewer_time_seconds: number }[];
    };
    const read = (f: string) => fs.readFileSync(path.join(fixtureDir, f));
    const files = [...new Set(golden.channel_golden_records.map((g) => g.source_file))];
    if (files.some((f) => !fs.existsSync(path.join(fixtureDir, f)))) skip("실제 원본 XLS 골든 대조", "골든이 가리키는 원본 파일 일부가 폴더에 없음");
    else {
      const comp = new Set(["MBC every1", "tvN SHOW", "KBS JOY"]);
      const daily = D.parseNielsenDailyWorkbook(read("닐슨_채널시청률(261004).xls"), "닐슨_채널시청률(261004).xls", comp);
      const weekly = P.parseNielsenPeriodWorkbook(read("닐슨_채널시청률(260928-261004).xls"));
      check("실제 일간 파일 파싱(10/4, 시트 분석기간 기준)", daily.ok && daily.reportDate === "2026-10-04" && daily.dateSource === "sheet+filename" && daily.missingSheets.length === 0);
      check("실제 주간 파일 파싱(2시트, 9/28~10/4, 주간)", !("message" in weekly) && weekly.periodType === "weekly" && weekly.dateFrom === "2026-09-28" && weekly.dateTo === "2026-10-04");
      if (daily.ok && !("message" in weekly)) {
        // 골든 target 표기 → 파서 라벨: 시트의 개인2049 / National 유료방송가입가구
        const labelOf = (t: string) => (t === "개인2049" ? "개인2049" : "National 유료방송가입가구");
        const codeOf = (c: string) => (c === "SKYUHD" ? "SKYUHD" : c);
        let okCount = 0;
        const bad: string[] = [];
        for (const g of golden.channel_golden_records) {
          const rows = g.source_file.includes("-") ? weekly.rows : daily.rankRows;
          const row = rows.find((r) => r.channelCode === codeOf(g.channel_id) && r.targetLabel === labelOf(g.target));
          const m = g.metrics;
          const good =
            !!row &&
            row.rank === Number(m.rank.value) &&
            close(row.rating, Number(m.rating_percent.value)) &&
            close(row.share, Number(m.share_percent.value)) &&
            close(row.reach, Number(m.reach_source_percent.value)) &&
            row.timeSpentSeconds === g.viewer_time_seconds;
          if (good) okCount++;
          else bad.push(`${g.channel_id}/${g.period_end}`);
        }
        check(`원본 14개 채널·기간 골든(순위·시청률·점유율·Reach·시청시간 초) 파서 출력 일치 ${okCount}/${golden.channel_golden_records.length}`, okCount === golden.channel_golden_records.length, bad.join(","));
        const premiere = daily.programRows.filter((r) => r.channelCode === "ENA_PLAY" && r.startTime === "07:54:58" && r.endTime === "09:01:07" && !r.isDailyAggregate);
        const rv = (l: string) => premiere.find((r) => r.targetLabel === l)?.rating;
        check("원본 ENA PLAY 타깃상세 D14/I14: 2039=0.02327, 2049=0.07742로 헤더 매핑", close(rv("수도권 2039"), 0.02327) && close(rv("수도권 2049"), 0.07742));
        const insp = C.inspectDailyWorkbook(read("닐슨_채널시청률(261004).xls"));
        const cross = C.crossCheckOwnChannelTargets(daily.programRows, insp);
        const pr = insp?.ownBlockRows.find((o) => o.channelCode === "ENA_PLAY" && o.start === "07:54:58");
        const v49 = pr?.ratings.find((x) => x.label === "개인2049")?.rating;
        const v39 = pr?.ratings.find((x) => x.label === "개인2039")?.rating;
        check("원본 경쟁시트 D12/E12(0.07742/0.02327)와 타깃상세 D14/I14 교차 일치", close(v49, 0.07742) && close(v39, 0.02327) && cross.checked > 0 && cross.mismatches.length === 0, `checked=${cross.checked} mismatch=${cross.mismatches.length}`);
        check("원본 경쟁시트 E9=0은 결측이 아닌 0으로 유지", !!insp && insp.ownBlockRows.some((o) => o.channelCode === "ENA_PLAY" && o.ratings.some((x) => x.label === "개인2039" && x.rating === 0)));
        const aggs = daily.programRows.filter((r) => r.isDailyAggregate);
        check("원본 하루전체 총계행은 프로그램이 아닌 집계로 분리(ENA PLAY 2049=0.02998)", aggs.length > 0 && close(aggs.find((r) => r.channelCode === "ENA_PLAY" && r.targetLabel === "수도권 2049")?.rating, 0.02998));
        const seen = new Map<string, number>();
        for (const r of daily.programRows) {
          if (r.isDailyAggregate) continue;
          const k = `${r.channelCode}|${r.startTime}|${r.rawProgramName}|${r.targetLabel}`;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        const dups = [...seen].filter(([, n]) => n > 1);
        check("같은 방송이 타깃상세와 경쟁시트에 모두 있어도 (채널·시작·프로그램·타깃) 중복 행이 없음", dups.length === 0, dups.slice(0, 3).map(([k]) => k).join(" ; "));
        const distinctAirings = new Set(daily.programRows.filter((r) => !r.isDailyAggregate && r.channelCode === "ENA_STORY").map((r) => `${r.startTime}|${r.rawProgramName}`));
        check("같은 프로그램의 여러 방영(재방 회차)은 시작시각별 행으로 분리되어 합쳐지지 않음", distinctAirings.size > new Set([...distinctAirings].map((k) => k.split("|")[1])).size);
        check("원본 시트 4개 블록 헤더(ONCE·OLIFE·ENA STORY 섹션)로 채널 구분", ["ONCE", "OLIFE", "ENA_STORY"].every((c) => daily.programRows.some((r) => r.channelCode === c && !r.isDailyAggregate)));

        // 실제 파일을 대역 DB에 적재
        const real = new FakeDb();
        (supabase as unknown as { from: (t: string) => unknown }).from = (t) => real.from(t);
        const realCtx = newCtx();
        realCtx.dailyCtx.competitorNames = comp;
        const rr = await X.ingestAnyNielsenFile(read("닐슨_채널시청률(261004).xls"), "닐슨_채널시청률(261004).xls", realCtx);
        check("실제 일간 파일 적재(대역 DB) 성공", rr.kind === "daily" && rr.ok && (rr.ratingsInserted ?? 0) > 1000, JSON.stringify(rr).slice(0, 200));
        const enaTid = real.rows("targets").find((t) => t.label === "개인2049")?.id;
        const enaRow = real.rows("ratings").find((r) => r.channel_id === "ch-ENA" && r.target_id === enaTid && r.program_id === null && r.rank !== undefined && r.rank !== null);
        check("저장된 ENA 개인2049 일간: 시청률 0.06047·순위 18", close(Number(enaRow?.rating), 0.06047) && Number(enaRow?.rank) === 18);
        const progBefore = real.rows("programs").length;
        const ratBefore = real.rows("ratings").length;
        const wr = await X.ingestAnyNielsenFile(read("닐슨_채널시청률(260928-261004).xls"), "닐슨_채널시청률(260928-261004).xls", realCtx);
        const wkEna = real.rows("nielsen_period_rank").find((r) => r.channel_id === "ch-ENA" && r.target_id === "t-2049");
        check("실제 주간 파일 적재: ENA 개인2049 주간 7위·0.11358, 프로그램 상세 불변", wr.kind === "period" && wr.ok && Number(wkEna?.rank) === 7 && close(Number(wkEna?.rating), 0.11358) && real.rows("programs").length === progBefore && real.rows("ratings").length === ratBefore);
        const again = await X.ingestAnyNielsenFile(read("닐슨_채널시청률(261004).xls"), "닐슨_채널시청률(261004).xls", realCtx);
        check("실제 일간 파일 재업로드는 변경 없음", again.kind === "daily" && "duplicate" in again && again.duplicate === true);
        for (const f of ["닐슨_채널시청률(261001).xls", "닐슨_채널시청률(261002).xls", "닐슨_채널시청률(261003).xls", "닐슨_채널시청률(261005).xls"]) {
          if (!fs.existsSync(path.join(fixtureDir, f))) continue;
          const r = D.parseNielsenDailyWorkbook(read(f), f, comp);
          check(`${f}: 시트 분석기간과 파일명 날짜가 일치하며 파싱`, r.ok && r.dateSource === "sheet+filename" && r.rankRows.length > 0);
        }
      }
    }
  }

  console.log(`\n${passed}건 통과, ${failures.length}건 실패${skipped ? `, ${skipped}건 SKIP(검증 안 됨)` : ""}`);
  if (failures.length) {
    console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
