// 관리자 운영 품질(단계 05) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크·메일에 접근하지 않는다(Supabase는 메모리 대역).
// 실행: npm run test:admin
import fs from "node:fs";
import path from "node:path";
import { FakeDb } from "./lib/fakeSupabase";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");

/** route 파일에서 내보낸 핸들러별 본문을 잘라낸다. */
function handlers(src: string): { method: string; body: string }[] {
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g;
  const marks = [...src.matchAll(re)].map((m) => ({ method: m[1], at: m.index ?? 0 }));
  return marks.map((m, i) => ({ method: m.method, body: src.slice(m.at, marks[i + 1]?.at ?? src.length) }));
}

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-real";
  process.env.ADMIN_SESSION_SECRET = "test-secret-not-real";

  const { supabase } = await import("../src/lib/supabase");
  const db = new FakeDb();
  (supabase as unknown as { from: (t: string) => unknown }).from = (t) => db.from(t);

  const F = await import("../src/lib/admin/featureMap");
  const P = await import("../src/lib/admin/permissions");
  const FP = await import("../src/lib/admin/fieldPrecedence");
  const UP = await import("../src/lib/admin/uploadPolicy");
  const IS = await import("../src/lib/admin/ingestStatus");
  const GC = await import("../src/lib/admin/genreCoverage");
  const ND = await import("../src/lib/admin/newsDiff");
  const LS = await import("../src/lib/admin/lockStore");
  const EM = await import("../src/lib/epgMatch");
  const S = await import("../src/lib/session");
  const AA = await import("../src/lib/adminAuth");

  // ── 기능 위치표 ────────────────────────────────────────────
  {
    const required = ["nielsen", "skyuhd", "olife_epg", "manual_report", "monthly_trend", "schedule_grid", "channel_master", "target_goals", "market_ytd_rank", "episode_catalog", "genre_map", "mail_ingestion", "news", "featured", "login_history"];
    const ids = new Set(F.ADMIN_FEATURES.map((f) => f.id));
    check("요구된 관리자 기능(15종)이 위치표에 모두 있다", required.every((r) => ids.has(r)), required.filter((r) => !ids.has(r)).join());
    check("모든 기능에 유지/이동/통합 위치가 있다", F.ADMIN_FEATURES.every((f) => ["유지", "이동", "통합"].includes(f.disposition) && f.destination.length > 0));
    const compFiles = fs.readdirSync(path.join(ROOT, "src/app/admin")).filter((n) => n.endsWith(".tsx") && !["page.tsx", "layout.tsx", "LogoutButton.tsx", "FileInputTrigger.tsx"].includes(n)).map((n) => n.replace(".tsx", ""));
    const missingComp = compFiles.filter((c) => !F.featureComponents().includes(c));
    check("src/app/admin의 모든 화면 컴포넌트가 위치표에 있다", missingComp.length === 0, missingComp.join());
    const apiRoutes = walk(path.join(ROOT, "src/app/api/admin"))
      .filter((p) => p.endsWith("route.ts"))
      .map((p) => "/" + rel(p).replace("src/app/", "").replace("/route.ts", ""))
      .filter((r) => !["/api/admin/login", "/api/admin/logout"].includes(r));
    const missingApi = apiRoutes.filter((r) => !F.featureApis().includes(r));
    check("모든 관리자 API(로그인·로그아웃 제외)가 위치표에 있다", missingApi.length === 0, missingApi.join());
    const pages = ["login-history", "ask-gaps", "schedule-grid"].map((p) => `/admin/${p}`);
    check("관리자 하위 페이지(로그인 이력·질문 사각지대·편성표)가 위치표에 있다", pages.every((p) => F.ADMIN_FEATURES.some((f) => f.page === p)));
    check("업로드 API마다 업로드 정책이 정의돼 있다", walk(path.join(ROOT, "src/app/api/admin/upload")).filter((p) => p.endsWith("route.ts")).every((p) => UP.UPLOAD_POLICIES.some((u) => u.api.includes("/" + rel(p).replace("src/app/", "").replace("/route.ts", "").split("/").slice(-1)[0]))));
  }

  // ── 권한: PD 권한으로 관리자 API 쓰기는 거부 ───────────────
  {
    const adminRoutes = walk(path.join(ROOT, "src/app/api/admin")).filter((p) => p.endsWith("route.ts") && !/\/(login|logout)\//.test(p.replace(/\\/g, "/")));
    const publicReadAllowed = new Set(["api/admin/news"]); // 1페이지가 읽는 공개 목록(GET). 버전 조회 분기는 별도 검사
    const bad: string[] = [];
    for (const p of adminRoutes) {
      for (const h of handlers(fs.readFileSync(p, "utf8"))) {
        const route = rel(p).replace("src/app/", "").replace("/route.ts", "");
        if (h.method === "GET" && publicReadAllowed.has(route)) continue;
        if (!h.body.includes("getAdminSession()")) bad.push(`${route} ${h.method}`);
        else if (!/status: 401/.test(h.body)) bad.push(`${route} ${h.method}(401 응답 없음)`);
      }
    }
    check("관리자 API의 모든 핸들러가 서버에서 관리자 세션을 검사한다(PD 세션은 거부)", bad.length === 0, bad.join(" | "));

    const newsSrc = fs.readFileSync(path.join(ROOT, "src/app/api/admin/news/route.ts"), "utf8");
    const getBody = handlers(newsSrc).find((h) => h.method === "GET")!.body;
    check("뉴스 GET의 이전 버전 조회 분기는 관리자 전용이다", /searchParams\.get\("versions"\)[\s\S]{0,200}getAdminSession\(\)/.test(getBody));

    const authRefs = /getAdminSession|getCurrentSession|requireActor/;
    const exempt = new Set(["api/logout", "api/pd/login", "api/admin/login", "api/admin/logout"]);
    const unprotected: string[] = [];
    for (const p of walk(path.join(ROOT, "src/app/api")).filter((x) => x.endsWith("route.ts"))) {
      const route = rel(p).replace("src/app/", "").replace("/route.ts", "");
      if (exempt.has(route)) continue;
      for (const h of handlers(fs.readFileSync(p, "utf8"))) {
        if (h.method === "GET") continue;
        if (!authRefs.test(h.body)) unprotected.push(`${route} ${h.method}`);
      }
    }
    check("쓰기(POST/PUT/PATCH/DELETE) API는 모두 세션 검사를 한다(로그인·로그아웃 제외)", unprotected.length === 0, unprotected.join(" | "));

    const pd = await S.createSessionToken({ role: "pd", pdId: "pd1", name: "PD", exp: Date.now() + 60000 });
    const admin = await S.createSessionToken({ role: "admin", adminId: "a1", email: "a@x.kr", exp: Date.now() + 60000 });
    check("PD 토큰은 관리자 세션으로 인정되지 않는다(관리자 쿠키에 넣어도 거부)", (await AA.adminSessionFromToken(pd)) === null);
    check("관리자 토큰은 관리자 세션으로 인정된다", (await AA.adminSessionFromToken(admin))?.role === "admin");
    const [data, sig] = pd.split(".");
    const forged = Buffer.from(JSON.stringify({ role: "admin", adminId: "x", email: "x@x.kr", exp: Date.now() + 60000 })).toString("base64url");
    check("PD 토큰의 내용을 admin으로 바꿔도 서명 불일치로 거부", (await AA.adminSessionFromToken(`${forged}.${sig}`)) === null && !!data);
    check("만료된 관리자 토큰은 거부", (await AA.adminSessionFromToken(await S.createSessionToken({ role: "admin", adminId: "a1", email: "a@x.kr", exp: Date.now() - 1 }))) === null);
    check("토큰이 없으면 거부", (await AA.adminSessionFromToken(undefined)) === null);

    const planner = P.roleOfSession({ role: "pd" });
    check("PD는 편성자 역할이며 업로드·승인·권리·기준정보·정책·잠금 해제는 할 수 없다", planner === "planner" && !["upload", "approve", "rights_edit", "master_edit", "policy_edit", "lock_override"].some((a) => P.can(planner, a as never)));
    check("편성자는 조회·내보내기·편성 확정 권한을 가진다", P.can(planner, "view") && P.can(planner, "export") && P.can(planner, "schedule_finalize"));
    check("편성자는 주간 편성표 업로드와 채널별 최적화 설정·필수 편성 변경을 할 수 있다(사용자 결정 2026-10-06, 권한표=서버 동작)", P.can(planner, "schedule_upload") && P.can(planner, "channel_policy_edit") && !P.can("viewer", "schedule_upload") && !P.can("viewer", "channel_policy_edit") && !P.can(null, "schedule_upload"));
    check("열람자는 조회만 가능", P.can("viewer", "view") && !P.can("viewer", "export") && !P.can("viewer", "upload"));
    check("관리자는 모든 행동 가능, 세션 없음은 불가", (Object.keys(P.MIN_ROLE) as (keyof typeof P.MIN_ROLE)[]).every((a) => P.can("admin", a)) && !P.can(null, "view"));
    check("위치표의 최소 역할은 정의된 행동만 쓴다", F.ADMIN_FEATURES.every((f) => f.minRole in P.MIN_ROLE));
  }

  // ── 필드 우선순위·수동 잠금 ───────────────────────────────
  {
    const lock = { field: "target_goal" as const, key: "ENA:2026", value: { target_rank: 30, target_rating: 0.2 }, lockedBy: "a@x.kr", lockedAt: "2026-10-06", effectiveFrom: null, reason: "임원 확정" };
    const d1 = FP.decideWrite({ field: "target_goal", incomingSource: "channel_master_file", incomingValue: { target_rank: 25, target_rating: 0.25 }, existing: { source: "manual_admin", value: lock.value }, lock });
    check("수동 목표 보호: 잠긴 목표를 Channel Master 파일이 덮지 못한다", d1.action === "skip_locked");
    const d2 = FP.decideWrite({ field: "target_goal", incomingSource: "manual_admin", incomingValue: { target_rank: 28, target_rating: 0.22 }, existing: { source: "manual_admin", value: lock.value }, lock });
    check("수동 입력은 잠긴 목표를 바꿀 수 있다", d2.action === "write");
    const d3 = FP.decideWrite({ field: "target_goal", incomingSource: "channel_master_file", incomingValue: { a: 1 }, existing: null, lock: null });
    check("잠금도 기존 값도 없으면 파일 값을 쓴다", d3.action === "write");
    check("같은 값이면 변경 없음", FP.decideWrite({ field: "target_goal", incomingSource: "channel_master_file", incomingValue: 1, existing: { source: "channel_master_file", value: 1 } }).action === "noop");
    check("PD 메모는 공식 시청률 사실을 덮을 수 없다(출처 거부)", FP.decideWrite({ field: "rating_fact", incomingSource: "pd_memo", incomingValue: 9.9, existing: { source: "official_nielsen", value: 1 } }).action === "reject_source");
    check("공식 닐슨 값은 rating_fact에 쓸 수 있다", FP.decideWrite({ field: "rating_fact", incomingSource: "official_nielsen", incomingValue: 2, existing: { source: "official_nielsen", value: 1 } }).action === "write");
    check("수정 EPG가 자동 EPG보다 우선: 자동 EPG 재업로드는 수정 값을 덮지 못한다", FP.decideWrite({ field: "episode_info", incomingSource: "epg_daily", incomingValue: "자동", existing: { source: "epg_corrected", value: "수정" } }).action === "skip_lower_priority");
    check("일일 EPG는 주간 편성표 값을 대체할 수 있다", FP.decideWrite({ field: "episode_info", incomingSource: "epg_daily", incomingValue: "실제", existing: { source: "weekly_plan", value: "계획" } }).action === "write");
    check("PD 수동 리뷰가 계산 리뷰보다 우선", FP.decideWrite({ field: "review_text", incomingSource: "calc_review", incomingValue: "계산", existing: { source: "pd_manual_review", value: "수동" } }).action === "skip_lower_priority");
    check("일간 실적이 주간 예정보다 우선", FP.decideWrite({ field: "airing_schedule", incomingSource: "weekly_plan", incomingValue: "계획", existing: { source: "daily_actual", value: "실적" } }).action === "skip_lower_priority");
    check("목록에 없는 출처는 그 필드에 쓸 수 없다", FP.decideWrite({ field: "target_goal", incomingSource: "weekly_plan", incomingValue: 1 }).action === "reject_source");
  }

  // ── 잠금 저장소(메모리 DB) ────────────────────────────────
  {
    db.tables.clear();
    const ok = await LS.setManualLock({ field: "target_goal", key: "ENA:2026", value: { target_rank: 30, target_rating: 0.2 }, actor: "a@x.kr", reason: "임원 확정", effectiveFrom: "2026-01-01" });
    check("수동 입력이 잠금과 변경 이력(변경자·근거·적용일)을 남긴다", ok && db.rows("admin_field_locks").length === 1 && db.rows("admin_change_log").length === 1 && db.rows("admin_field_locks")[0].effective_from === "2026-01-01" && db.rows("admin_field_locks")[0].locked_by === "a@x.kr");
    const up = await LS.decideGoalFromFile({ channelCode: "ENA", year: 2026, incoming: { target_rank: "25", target_rating: 0.25 }, actor: "a@x.kr", fileName: "채널기본정보.xlsx" });
    check("수동목표보호: Channel Master 재업로드는 건너뛰고 이력에 남긴다", up.decision.action === "skip_locked" && up.lockAvailable && db.rows("admin_change_log").some((r) => r.action === "upload_skipped_locked"));
    const other = await LS.decideGoalFromFile({ channelCode: "ENA_PLAY", year: 2026, incoming: { target_rank: "40", target_rating: 0.1 }, actor: "a@x.kr", fileName: "f.xlsx" });
    check("잠기지 않은 다른 채널 목표는 파일 값을 반영한다", other.decision.action === "write");
    const rel1 = await LS.releaseLock({ field: "target_goal", key: "ENA:2026", actor: "a@x.kr", reason: "해제" });
    const after = await LS.decideGoalFromFile({ channelCode: "ENA", year: 2026, incoming: { target_rank: "25", target_rating: 0.25 }, actor: "a@x.kr", fileName: "f.xlsx" });
    check("잠금 해제 후에는 파일이 다시 반영되고 해제 이력이 남는다(행은 보존)", rel1 && after.decision.action === "write" && db.rows("admin_field_locks").length === 1 && db.rows("admin_change_log").some((r) => r.action === "release"));
    await LS.setManualLock({ field: "target_goal", key: "ENA:2026", value: { target_rank: 20, target_rating: 0.3 }, actor: "b@x.kr", reason: "재설정" });
    const active = db.rows("admin_field_locks").filter((r) => r.released_at === null || r.released_at === undefined);
    check("새 수동 입력은 이전 잠금을 해제하고 유효 잠금은 하나만 남긴다", active.length === 1 && db.rows("admin_field_locks").length === 2);
    check("해제할 잠금이 없으면 false", (await LS.releaseLock({ field: "target_goal", key: "NONE:2026", actor: "a", reason: "x" })) === false);
    db.failNext({ table: "admin_field_locks", op: "select", message: "Could not find the table 'admin_field_locks'", times: 1 });
    const noTable = await LS.getActiveLock("target_goal", "ENA:2026");
    check("잠금 테이블이 없으면 available=false로 알리고 기존 업로드는 막지 않는다", noTable.available === false && noTable.lock === null);
  }

  // ── 업로드 정책·오류 형식 ─────────────────────────────────
  {
    const rows = [
      { row: 2, ok: true },
      { row: 3, ok: false, issue: { column: "목표 시청률", cause: "숫자가 아님('abc')", example: "0.250", severity: "error" as const } },
      { row: 4, ok: true },
    ];
    const atomic = UP.planApplication("all_or_nothing", rows, { file: "a.xlsx", sheet: "채널" });
    check("전체 원자 적용: 한 행이라도 오류면 아무것도 반영하지 않는다", atomic.blockedAll && atomic.applyRows.length === 0 && atomic.skipped.length === 1);
    const partial = UP.planApplication("valid_rows_only", rows, { file: "a.xlsx", sheet: "채널" });
    check("정상 행만 반영: 오류 행은 건너뛰고 목록으로 돌려준다", !partial.blockedAll && partial.applyRows.join() === "2,4" && partial.skipped[0].row === 3);
    const line = UP.formatUploadIssue(partial.skipped[0]);
    check("오류 문구에 파일·시트·행·열·원인·수정 예시가 모두 있다", ["a.xlsx", "시트 채널", "3행", "목표 시청률 열", "숫자가 아님", "예: 0.250"].every((k) => line.includes(k)), line);
    check("전부 정상이면 모두 반영", UP.planApplication("all_or_nothing", [{ row: 1, ok: true }], { file: "f", sheet: null }).applyRows.length === 1);
    check("모든 정책이 정책(target)과 현재 구현(implemented)을 구분해 적는다", UP.UPLOAD_POLICIES.every((p) => p.target && p.implemented && p.samePeriodReupload.length > 0));
    check("미리보기가 구현되지 않은 유형을 구현됐다고 표시하지 않는다", UP.UPLOAD_POLICIES.every((p) => p.implemented.preview === false || p.id === "news" || p.id === "avail") || UP.UPLOAD_POLICIES.filter((p) => p.implemented.preview).length === 0);
  }

  // ── 수신 현황(수집됨 vs 분석 반영 완료) ───────────────────
  {
    const today = "2026-10-06";
    const win = { from: "2026-09-29", to: today };
    const facts = [
      ...["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"].map((d) => ({ channel: "ENA", kind: "nielsen_daily" as const, date: d, state: "applied" as const, appliedAt: `${d}T09:00:00Z`, martComputedAt: `${d}T09:30:00Z`, martRequired: true })),
      { channel: "ENA", kind: "nielsen_daily" as const, date: "2026-10-05", state: "applied" as const, appliedAt: "2026-10-06T08:00:00Z", martComputedAt: "2026-10-05T09:30:00Z", martRequired: true }, // 재업로드로 다시 반영, 마트는 이전 계산
      { channel: "ENA_PLAY", kind: "nielsen_daily" as const, date: "2026-10-05", state: "received" as const },
      { channel: "ENA_PLAY", kind: "nielsen_daily" as const, date: "2026-10-04", state: "failed" as const },
      { channel: "SKYUHD", kind: "skyuhd" as const, date: "2026-10-03", state: "applied" as const, martRequired: false },
    ];
    const rows = IS.computeReceiptMatrix({ channels: ["ENA", "ENA_PLAY", "SKYUHD"], window: win, facts, today });
    const ena = rows.find((r) => r.channel === "ENA" && r.kind === "nielsen_daily")!;
    check("미수신 날짜(어제까지 기준 빠진 날)를 찾는다", ena.missingDates.join() === "2026-09-29,2026-09-30" || ena.missingDates.length === 2, ena.missingDates.join());
    check("반영됐지만 마트가 이전 계산이면 '재계산 대기'이며 분석 반영 완료일은 그 전 날짜", ena.recomputePending.join() === "2026-10-05" && ena.latestAppliedDate === "2026-10-05" && ena.latestAnalysisReadyDate === "2026-10-04", `${ena.recomputePending} / ${ena.latestAnalysisReadyDate}`);
    const play = rows.find((r) => r.channel === "ENA_PLAY" && r.kind === "nielsen_daily")!;
    check("수집만 된 날짜(received)는 '수집됨·미반영'으로 분리된다", play.collectedNotApplied.includes("2026-10-05") && play.latestAppliedDate === null);
    check("실패한 날짜와 상태가 표시된다", play.failedDates.includes("2026-10-04") && play.health === "failed");
    const sky = rows.find((r) => r.channel === "SKYUHD")!;
    check("skyUHD는 일정이 불규칙이라 미수신을 세지 않고 반영만 있으면 정상", sky.missingDates.length === 0 && sky.health === "ok" && sky.latestAnalysisReadyDate === "2026-10-03");
    check("해당 없는 조합(SKYUHD의 닐슨 일간 등)은 행을 만들지 않는다", !rows.some((r) => r.channel === "SKYUHD" && r.kind === "nielsen_daily"));
    const empty = IS.computeReceiptMatrix({ channels: ["ENA"], window: win, facts: [], today });
    check("아무 것도 못 받은 채널은 '미수신'이지 정상이 아니다", empty.filter((r) => r.kind === "nielsen_daily")[0].health === "missing");
    const weekly = IS.computeReceiptMatrix({ channels: ["ENA"], window: win, today, facts: [{ channel: "ENA", kind: "nielsen_weekly", date: "2026-09-20", state: "applied", martRequired: false }] }).find((r) => r.kind === "nielsen_weekly")!;
    check("주간 자료가 10일을 넘기면 지연", weekly.health === "delayed" && weekly.latestAnalysisReadyDate === "2026-09-20");
    const sum = IS.summarizeReceipts(rows);
    check("요약이 미수신·실패·미반영·재계산 대기를 센다", sum.failedDays >= 1 && sum.recomputePending >= 1 && sum.collectedNotApplied >= 1 && sum.total === rows.length);
  }

  // ── 장르 분류율 ────────────────────────────────────────────
  {
    const a = GC.formatCoverage({ classifiedMinutes: 99_700, totalMinutes: 100_000, unclassifiedCount: 3 });
    check("99.7%를 반올림해 100%로 보이지 않게 하고 미분류 건수·분을 병기", a.pct === 99.7 && a.text.includes("미분류 3건(300분)"), a.text);
    const b = GC.formatCoverage({ classifiedMinutes: 99_996, totalMinutes: 100_000, unclassifiedCount: 1 });
    check("미분류가 남았으면 어떤 경우에도 100%가 아니다", b.pct < 100 && b.pct === 99.9, String(b.pct));
    const r = GC.formatCoverage({ classifiedMinutes: 99_650, totalMinutes: 100_000, unclassifiedCount: 5 });
    check("소수 첫째 자리는 반올림이 아니라 내림(99.65 → 99.6)", r.pct === 99.6, String(r.pct));
    const z = GC.formatCoverage({ classifiedMinutes: 500, totalMinutes: 500, unclassifiedCount: 2 });
    check("미분류 건수가 있으면 분 단위로 100%여도 100%로 표시하지 않는다(0분짜리 미분류)", z.pct === 99.9 && z.text.includes("미분류 2건"), z.text);
    const c = GC.formatCoverage({ classifiedMinutes: 500, totalMinutes: 500, unclassifiedCount: 0 });
    check("미분류가 정말 0건일 때만 100%와 '미분류 0건'", c.pct === 100 && c.text.includes("미분류 0건"));
    check("편성 자료가 없으면 0%가 아니라 '자료 없음'", GC.formatCoverage({ classifiedMinutes: 0, totalMinutes: 0, unclassifiedCount: 0 }).text === "편성 자료 없음");
  }

  // ── 뉴스 미리보기 차이 ─────────────────────────────────────
  {
    const before = [{ category: "A", title: "t1", url: "u1" }, { category: "A", title: "t2", url: "u2" }];
    const after = [{ category: "A", title: "t2", url: "u2" }, { category: "B", title: "t3", url: "u3" }];
    const d = ND.diffNews(before, after);
    check("뉴스 교체 미리보기: 추가·삭제·유지를 센다", d.added.length === 1 && d.removed.length === 1 && d.unchanged === 1 && d.removed[0].title === "t1");
    check("카테고리별 건수", ND.countByCategory(after).length === 2);
    check("같은 목록이면 변경 없음", ND.diffNews(before, before).added.length === 0 && ND.diffNews(before, before).removed.length === 0);
  }

  // ── EPG 매칭 증거·미매칭 큐 ───────────────────────────────
  {
    const epg = (name: string, start: string, ep: number | null = null, sub: string | null = null) => ({ broadcastDate: "2026-10-04", startTime: start, endTime: "", programNameRaw: name, episodeNumber: ep, subtitle: sub, runType: null });
    const np = [{ startTime: "21:00:00", canonicalName: "세계테마기행" }];
    const one = EM.matchEpgWithEvidence(np, [epg("세계테마기행(폐쇄자막)", "21:05", 12, "스페인")], 60)[0];
    check("후보가 하나면 매칭되고 원제목·부제·회차 증거가 남는다", one.status === "matched" && one.chosen?.episodeNumber === 12 && one.chosen?.subtitle === "스페인" && one.chosen?.programNameRaw.includes("폐쇄자막"));
    const amb = EM.matchEpgWithEvidence(np, [epg("세계테마기행", "21:04", 12), epg("세계테마기행", "21:08", 13)], 60)[0];
    check("모호 후보(시각 차이 10분 미만 둘): 가장 가까운 후보로 채우되 모호로 표시(사용자 결정)", amb.status === "ambiguous" && amb.chosen?.episodeNumber === 12 && amb.candidates.length === 2 && amb.reason.includes("확인이 필요"));
    const clear = EM.matchEpgWithEvidence(np, [epg("세계테마기행", "21:02", 12), epg("세계테마기행", "21:40", 13)], 60)[0];
    check("1·2순위 시각 차이가 충분하면 매칭", clear.status === "matched" && clear.chosen?.episodeNumber === 12);
    const exact = EM.matchEpgWithEvidence(np, [epg("세계테마기행스페셜", "21:01", 99), epg("세계테마기행", "21:30", 5)], 60)[0];
    check("이름이 같은 후보가 허용 오차 안에 있으면 스페셜(부분 일치)보다 우선", exact.chosen?.episodeNumber === 5 && exact.chosen?.nameMatch === "exact");
    const far = EM.matchEpgWithEvidence(np, [epg("세계테마기행", "23:30", 7)], 60)[0];
    check("이름은 맞지만 시각이 허용 오차를 넘으면 미매칭이며 이유에 분이 나온다", far.status === "unmatched" && far.reason.includes("150분") && far.candidates.length === 1);
    const none = EM.matchEpgWithEvidence(np, [epg("다른프로그램", "21:00", 1)], 60)[0];
    check("EPG에 이름이 없으면 미매칭 이유를 밝힌다", none.status === "unmatched" && none.reason.includes("프로그램명이 없음"));
    const map = EM.matchEpgToRatings(np, [epg("세계테마기행", "21:04", 12), epg("세계테마기행", "21:08", 13)], 60);
    check("matchEpgToRatings는 기존 동작(가장 가까운 후보로 채움)을 유지", map.get(np[0])?.episodeNumber === 12);
    const night = EM.matchEpgWithEvidence([{ startTime: "01:10:00", canonicalName: "심야극장" }], [epg("심야극장", "01:00", 3)], 60)[0];
    check("방송일 25시대(01시) 프로그램도 02시 이전 보정으로 매칭된다", night.status === "matched" && night.chosen?.diffMinutes === 10);
  }

  console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
  if (failures.length) {
    console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
