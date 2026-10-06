// 전역 탐색·문맥·홈(단계 07) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:workspace
import fs from "node:fs";
import path from "node:path";

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

async function main() {
  const W = await import("../src/lib/workspace");
  const P = await import("../src/lib/admin/permissions");

  const get = (q: string) => {
    const sp = new URLSearchParams(q);
    return (k: string) => sp.get(k);
  };

  // ── 문맥 URL ───────────────────────────────────────────────
  {
    const a = W.parseViewContext(get("view=weekly&date=2026-10-04"));
    check("홈 문맥(view·date)을 읽는다", a.ctx.view === "weekly" && a.ctx.date === "2026-10-04" && a.issues.length === 0);
    const ser = W.serializeContext(a.ctx).toString();
    const b = W.parseViewContext(get(ser));
    check("직렬화 → 파싱 왕복에서 문맥이 같다(새로고침·북마크)", W.sameContext(a.ctx, b.ctx) && ser === "view=weekly&date=2026-10-04");
    check("기본 보기(일간)는 URL에 넣지 않는다", W.serializeContext(W.parseViewContext(get("date=2026-10-04")).ctx).toString() === "date=2026-10-04");

    const bad = W.parseViewContext(get("date=2026-02-30&channel=NOPE&preset=weird&view=yearly"));
    check("달력에 없는 날짜·알 수 없는 채널·프리셋·보기는 조용히 보정하지 않고 이유를 남긴다", bad.issues.length === 4 && bad.ctx.date === null && bad.ctx.channel === null && bad.ctx.preset === null && bad.ctx.view === "daily");
    const rev = W.parseViewContext(get("dateFrom=2026-10-05&dateTo=2026-10-01&preset=custom"));
    check("시작일이 종료일보다 늦어도 입력한 값을 버리지 않는다(기간 계산이 순서를 정렬하는 기존 동작, 날짜 입력 중간 값이 지워지지 않게)", rev.ctx.dateFrom === "2026-10-05" && rev.ctx.dateTo === "2026-10-01" && rev.issues.length === 0);
    check("보고서 링크는 거꾸로 고른 기간을 정렬해서 만든다", W.reportQuery({ ...W.EMPTY_CONTEXT, preset: "custom", dateFrom: "2026-10-05", dateTo: "2026-10-01" })?.toString() === "dateFrom=2026-10-01&dateTo=2026-10-05");
    check("직접 선택 프리셋은 날짜를 고르는 중간 상태(기간 없음)도 유지한다 — 선택이 오늘로 되돌아가지 않게", W.parseViewContext(get("preset=custom")).ctx.preset === "custom" && W.reportQuery({ ...W.EMPTY_CONTEXT, preset: "custom", dateTo: "2026-10-04" }) === null);
    const dw = W.parseViewContext(get("preset=sdow_4w&dow=3"));
    check("동요일(dow)은 0~6 정수만 받고 URL에 실린다", dw.ctx.dow === 3 && W.serializeContext(dw.ctx).toString() === "preset=sdow_4w&dow=3" && W.parseViewContext(get("dow=9")).issues.length === 1 && W.parseViewContext(get("dow=x")).ctx.dow === null && W.dataKey({ ...dw.ctx, channel: "ENA" }, "channel") !== W.dataKey({ ...dw.ctx, dow: 4, channel: "ENA" }, "channel"));
    const half = W.parseViewContext(get("compareFrom=2026-09-01"));
    check("비교 기간은 시작·종료가 함께 있어야 한다", half.ctx.compareFrom === null && half.issues.length === 1);
    check("채널은 경로 값이 쿼리보다 우선하고 대소문자를 구분하지 않는다", W.parseViewContext(get("channel=ENA"), { channelFromPath: "skyuhd" }).ctx.channel === "SKYUHD");

    const homeA = W.dataKey(W.parseViewContext(get("view=daily&date=2026-10-04")).ctx, "home");
    const homeB = W.dataKey(W.parseViewContext(get("view=monthly&date=2026-10-04")).ctx, "home");
    check("홈은 일간·주간·월간 보기만 바꿔서는 데이터 키가 바뀌지 않는다(다시 받지 않음)", homeA === homeB);
    check("날짜가 바뀌면 홈 데이터 키가 바뀐다", homeA !== W.dataKey(W.parseViewContext(get("date=2026-10-03")).ctx, "home"));
    const chA = W.dataKey(W.parseViewContext(get("preset=wow&dateTo=2026-10-04"), { channelFromPath: "ENA" }).ctx, "channel");
    check("채널 데이터 키는 채널·기간·프리셋이 다르면 달라진다", chA !== W.dataKey(W.parseViewContext(get("preset=mom&dateTo=2026-10-04"), { channelFromPath: "ENA" }).ctx, "channel") && chA !== W.dataKey(W.parseViewContext(get("preset=wow&dateTo=2026-10-04"), { channelFromPath: "ENA_PLAY" }).ctx, "channel"));
  }

  // ── 보고서 링크 쿼리: 기존 채널 화면 규칙과 같다 ─────────────
  {
    // 기존 ChannelDeepDive.buildAudienceReportHref의 규칙(복사) — 같은 입력에서 같은 결과여야 호환된다.
    const legacy = (code: string, preset: string, dateFrom: string, dateTo: string): string | null => {
      if (!dateTo) return null;
      if (preset === "today" || preset === "yesterday") return `/audience-report/${code}?date=${dateTo}`;
      if (preset === "custom") return dateFrom ? `/audience-report/${code}?dateFrom=${dateFrom}&dateTo=${dateTo}` : null;
      return `/audience-report/${code}?preset=${preset}&dateTo=${dateTo}`;
    };
    const cases: [string, string, string][] = [
      ["today", "", "2026-10-04"], ["yesterday", "", "2026-10-03"], ["custom", "2026-10-01", "2026-10-04"], ["custom", "", "2026-10-04"],
      ["wow", "", "2026-10-04"], ["mtd", "", "2026-10-04"], ["sdow_4w", "", "2026-10-04"], ["last7", "", ""],
    ];
    const diffs: string[] = [];
    for (const [preset, from, to] of cases) {
      const ctx = { ...W.EMPTY_CONTEXT, channel: "ENA", preset: preset as never, dateFrom: from || null, dateTo: to || null };
      const q = W.reportQuery(ctx, null);
      const mine = q ? `/audience-report/ENA?${q.toString()}` : null;
      if (mine !== legacy("ENA", preset, from, to)) diffs.push(`${preset}|${from}|${to}: ${mine} ≠ ${legacy("ENA", preset, from, to)}`);
    }
    check("보고서 링크 규칙이 기존 채널 화면(오늘·어제·직접·프리셋)과 같다", diffs.length === 0, diffs.join(" || "));
    const todayCtx = { ...W.EMPTY_CONTEXT, channel: "ENA" };
    check("오늘(프리셋 없음)은 서버가 정한 최신일(resolvedDateTo)로 링크를 만든다", W.hrefFor("report", todayCtx, {}, "2026-10-04") === "/audience-report/ENA?date=2026-10-04");
    check("종료일을 알 수 없으면 링크를 만들지 않고 빈 쿼리로 둔다(추측 금지)", W.reportQuery(todayCtx, null) === null);
  }

  // ── 화면 간 이동 링크 ──────────────────────────────────────
  {
    const ctx = W.parseViewContext(get("preset=wow&dateTo=2026-10-04&compareFrom=2026-09-21&compareTo=2026-09-27"), { channelFromPath: "ENA_PLAY" }).ctx;
    const ch = W.hrefFor("channel", ctx);
    check("채널 링크는 채널을 경로로, 기간·비교기간을 쿼리로 옮긴다", ch === "/channel/ENA_PLAY?preset=wow&dateTo=2026-10-04&compareFrom=2026-09-21&compareTo=2026-09-27", ch);
    check("편성 화면 링크는 channel 쿼리만 쓴다(그 화면이 읽는 이름)", W.hrefFor("schedule_grid", ctx) === "/schedule-grid?channel=ENA_PLAY" && W.hrefFor("ideal_schedule", ctx, { run: "r1" }) === "/ideal-schedule?channel=ENA_PLAY&run=r1");
    check("값이 빈 extra는 붙이지 않는다", W.hrefFor("ideal_schedule", ctx, { from: null, focus: undefined, run: "r1" }) === "/ideal-schedule?channel=ENA_PLAY&run=r1");
    check("채널 없는 문맥은 ENA로 연다(기존 홈 버튼 규칙)", W.hrefFor("schedule_grid", W.EMPTY_CONTEXT) === "/schedule-grid?channel=ENA");
    const home = W.hrefFor("home", { ...ctx, view: "monthly", date: "2026-10-04" });
    check("홈 링크는 보기·기준일만 옮긴다", home === "/?view=monthly&date=2026-10-04", home);
    const past = W.hrefFor("channel", { ...W.EMPTY_CONTEXT, channel: "ENA", date: "2026-10-03" });
    check("채널 링크: 기준일(date)만 있으면 그날 하루를 직접 선택으로 연다(채널 화면은 date를 읽지 않으므로)", past === "/channel/ENA?preset=custom&dateFrom=2026-10-03&dateTo=2026-10-03", past);
    check("채널 링크: 프리셋이 있으면 그대로 두고 date는 싣지 않는다", W.hrefFor("channel", { ...W.EMPTY_CONTEXT, channel: "ENA", preset: "wow", dateTo: "2026-10-04", date: "2026-10-03" }) === "/channel/ENA?preset=wow&dateTo=2026-10-04");
    check("종료일을 몰라도 기간 프리셋은 보고서·포트폴리오 링크에 실린다(프리셋이 사라지지 않게)", W.hrefFor("report", { ...W.EMPTY_CONTEXT, channel: "ENA", preset: "last7" }) === "/audience-report/ENA?preset=last7" && W.hrefFor("portfolio", { ...W.EMPTY_CONTEXT, preset: "mtd" }) === "/audience-report/portfolio?preset=mtd" && W.hrefFor("report", { ...W.EMPTY_CONTEXT, channel: "ENA", preset: "today" }) === "/audience-report/ENA");
    check("채널 경로는 인코딩한다(저장된 값이 경로·쿼리로 해석되지 않게)", W.hrefFor("channel", { ...W.EMPTY_CONTEXT, channel: "A/../B?x" as never }).startsWith("/channel/A%2F..%2FB%3Fx"));
    check("가장 최근 일요일·월말 계산", W.lastSundayOnOrBefore("2026-10-04") === "2026-10-04" && W.lastSundayOnOrBefore("2026-10-06") === "2026-10-04" && W.lastSundayOnOrBefore("2026-10-10") === "2026-10-04" && W.lastMonthEndOnOrBefore("2026-10-06") === "2026-09-30" && W.lastMonthEndOnOrBefore("2026-09-30") === "2026-09-30" && W.lastMonthEndOnOrBefore("2026-03-01") === "2026-02-28");
    check("관리 링크는 관리자 화면으로", W.hrefFor("admin", ctx) === "/admin");
  }

  // ── 전역 탐색·권한·호환 ────────────────────────────────────
  {
    const admin = W.visibleNav("admin").map((n) => n.id);
    const planner = W.visibleNav(P.roleOfSession({ role: "pd" })).map((n) => n.id);
    check("관리자는 8개 메뉴를 모두 본다", admin.length === 8 && ["briefing", "channel", "portfolio", "compare", "ai", "content", "reports", "admin"].every((id) => admin.includes(id as never)));
    check("편성자(PD)에게는 '관리' 메뉴가 보이지 않는다", !planner.includes("admin") && planner.length === 7);
    check("로그인하지 않으면 메뉴가 없다", W.visibleNav(null).length === 0);
    const plannerAvail = W.visibleExtras(W.NAV_ITEMS.find((n) => n.id === "content")!, "planner");
    const adminAvail = W.visibleExtras(W.NAV_ITEMS.find((n) => n.id === "content")!, "admin");
    check("Avail 관리 진입점은 권리 수정 권한이 있는 관리자에게만", plannerAvail.length === 0 && adminAvail.length === 1);
    check("메뉴 최소 권한은 서버 권한표에 있는 행동만 쓴다", W.NAV_ITEMS.every((n) => n.minAction in P.MIN_ROLE));

    const active: [string, string | null][] = [
      ["/", "briefing"], ["/channel/ENA", "channel"], ["/audience-report/portfolio", "portfolio"], ["/audience-report/ENA", "reports"],
      ["/schedule-grid", "compare"], ["/ideal-schedule", "ai"], ["/ideal-schedule/purchase", "content"], ["/admin/login-history", "admin"], ["/pd/login", null],
    ];
    check("경로별 활성 메뉴(구매 검토는 AI 편성이 아니라 콘텐츠·Avail, 포트폴리오와 채널 보고서 구분)", active.every(([p, id]) => W.activeNavId(p) === id), active.filter(([p, id]) => W.activeNavId(p) !== id).map(([p]) => p).join(","));

    const missing = W.COMPAT_ROUTES.filter((r) => !fs.existsSync(path.join(ROOT, r.file)));
    check("기존 화면 경로(호환 목록)의 파일이 모두 남아 있다 — 주소를 바꾸지 않았다", missing.length === 0, missing.map((m) => m.route).join(","));
    const pages = walk(path.join(ROOT, "src/app")).filter((p) => p.endsWith("page.tsx")).map(rel);
    const covered = new Set(W.COMPAT_ROUTES.map((r) => r.file));
    const allow = new Set(["src/app/access-denied/page.tsx", "src/app/admin/login/page.tsx", "src/app/pd/login/page.tsx"]);
    const uncovered = pages.filter((p) => !covered.has(p) && !allow.has(p) && !p.endsWith("/deck/page.tsx"));
    check("메뉴·호환 목록에 없는 화면이 없다(로그인·접근거부·PPT 보기 제외)", uncovered.length === 0, uncovered.join(","));
    const carried = W.visibleNav("admin").map((n) => W.navHref(n, { ...W.EMPTY_CONTEXT, channel: "ENA_PLAY", preset: "wow", dateTo: "2026-10-04" }, "2026-10-04", { from: "act-1", ft: "제목", hour: "14" }));
    check("메뉴 링크는 기간 문맥과 액션 문맥(from·ft·hour)을 함께 싣는다", carried.every((h) => h.includes("from=act-1") && h.includes("hour=14")) && carried[1] === "/channel/ENA_PLAY?preset=wow&dateTo=2026-10-04&from=act-1&ft=%EC%A0%9C%EB%AA%A9&hour=14", carried[1]);
    check("액션 문맥이 없으면 메뉴 링크에 아무것도 붙이지 않는다", W.navHref(W.NAV_ITEMS[0], W.EMPTY_CONTEXT) === "/" && W.actionQuerySuffix(() => null) === "");
    check("URL을 다시 쓸 때 유지할 액션 문맥 쿼리를 이어 붙인다", W.actionQuerySuffix((k) => ({ from: "act-1", ft: "제목 a", hour: "14" } as Record<string, string>)[k] ?? null) === "&from=act-1&ft=%EC%A0%9C%EB%AA%A9%20a&hour=14");
    check("슬롯 시 파라미터는 2~27 정수만 인정", W.parseFocusHour("14") === 14 && W.parseFocusHour("25") === 25 && W.parseFocusHour("1") === null && W.parseFocusHour("28") === null && W.parseFocusHour("1.5") === null && W.parseFocusHour("x") === null && W.parseFocusHour(null) === null);
    check("메뉴 8개의 목적지가 모두 호환 목록의 실제 경로", W.NAV_ITEMS.every((n) => {
      const href = W.navHref(n, { ...W.EMPTY_CONTEXT, channel: "ENA" }, "2026-10-04").split("?")[0];
      return W.COMPAT_ROUTES.some((r) => r.route === href || (r.route.includes("[") && new RegExp(`^${r.route.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(href)));
    }));
  }

  // ── 요청 상태: 오래된 응답 무시, 새 제목+이전 숫자 혼재 금지 ───
  {
    const R = W;
    type S = ReturnType<typeof R.initialRequestState<string>>;
    let s: S = R.initialRequestState<string>();
    check("처음에는 loading", R.statusOf(s) === "loading" && R.displayOf(s).data === null);
    s = R.beginRequest(s, "A", 1);
    check("요청 중에 값이 없으면 loading", R.statusOf(s) === "loading");
    s = R.receiveResponse(s, 1, "A", "값A", 100);
    check("키가 같은 응답을 받으면 ready·현재 값", R.statusOf(s) === "ready" && R.isCurrent(s) && R.displayOf(s).data === "값A");
    s = R.beginRequest(s, "B", 2);
    const d = R.displayOf(s);
    check("새 기간을 요청한 뒤 응답 전에는 stale이며 값은 이전 문맥(A)의 것임을 알린다", d.status === "stale" && !d.isCurrent && d.shownKey === "A" && d.data === "값A");
    s = R.receiveResponse(s, 2, "B", "값B", 200);
    check("새 응답이 오면 ready", R.statusOf(s) === "ready" && R.displayOf(s).data === "값B" && R.displayOf(s).shownKey === "B");
    s = R.beginRequest(s, "B", 3);
    check("같은 문맥을 다시 받는 동안은 현재 값이며 새로고침 중으로 표시", R.statusOf(s) === "ready" && R.isRefreshing(s));

    // 빠른 전환 A→B→C 후 응답이 모든 순서로 도착해도 마지막 요청(C)의 값만 남는다.
    const perms: number[][] = [[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]];
    const bad: string[] = [];
    for (const order of perms) {
      let x: S = R.initialRequestState<string>();
      x = R.beginRequest(x, "A", 1);
      x = R.beginRequest(x, "B", 2);
      x = R.beginRequest(x, "C", 3);
      for (const n of order) x = R.receiveResponse(x, n, ["", "A", "B", "C"][n], `값${["", "A", "B", "C"][n]}`, n);
      const dd = R.displayOf(x);
      if (!(dd.data === "값C" && dd.shownKey === "C" && dd.status === "ready")) bad.push(order.join(""));
    }
    check("A→B→C로 빠르게 전환해도 응답이 어떤 순서로 와도 마지막 선택(C)의 값만 보인다", bad.length === 0, bad.join(","));
    let late: S = R.beginRequest(R.initialRequestState<string>(), "A", 1);
    late = R.beginRequest(late, "B", 2);
    late = R.receiveResponse(late, 1, "A", "값A", 1);
    check("더 새 요청이 시작된 뒤 도착한 이전 응답은 화면에 쓰지 않는다(값이 비어 있음)", R.displayOf(late).data === null && R.statusOf(late) === "loading");
    // 같은 키라도 요청 번호가 다르면(취소된 이전 요청) 무시
    let seqMis: S = R.beginRequest(R.initialRequestState<string>(), "A", 5);
    seqMis = R.receiveResponse(seqMis, 4, "A", "옛값", 1);
    check("같은 키여도 이전 요청 번호의 응답은 무시", R.displayOf(seqMis).data === null);

    let err: S = R.receiveResponse(R.beginRequest(R.initialRequestState<string>(), "A", 1), 1, "A", "값A", 1);
    err = R.beginRequest(err, "B", 2);
    err = R.failRequest(err, 2, "B", "네트워크 오류");
    const de = R.displayOf(err);
    check("새 요청이 실패하면 error이며 남은 이전 값은 현재 값이 아님을 표시", de.status === "error" && !de.isCurrent && de.shownKey === "A" && de.errorMessage === "네트워크 오류");
    let staleErr: S = R.beginRequest(R.initialRequestState<string>(), "A", 1);
    staleErr = R.beginRequest(staleErr, "B", 2);
    staleErr = R.failRequest(staleErr, 1, "A", "옛 실패");
    check("이전 요청의 늦은 실패는 새 요청의 상태를 오염시키지 않는다", R.displayOf(staleErr).status === "loading" && R.displayOf(staleErr).errorMessage === null);
  }

  // ── ContextBar 모델 ───────────────────────────────────────
  {
    const base = { scopeLabel: "ENA", targetLabel: "수도권 2049", periodLabel: "2026-10-04", compareLabel: null, latestDate: "2026-10-04", today: "2026-10-05", finality: "provisional" as const, isCurrent: true };
    const ready = W.buildContextBar({ ...base, status: "ready" });
    check("ready: 칩 6개(채널·타깃·분석 기간·비교 기간·최신 수신일·상태), 배너 없음, 보고서 가능", ready.chips.map((c) => c.id).join() === "channel,target,period,compare,latest,finality" && ready.banner === null && ready.reportReady);
    const stale = W.buildContextBar({ ...base, status: "stale", isCurrent: false, requestedPeriodLabel: "최근 7일 vs 직전 7일" });
    check("stale: 칩은 값이 속한 이전 기간을 그대로 보이고, 배너가 새 선택을 불러오는 중임과 이전 선택의 값임을 알린다", stale.chips.find((c) => c.id === "period")!.value === "2026-10-04" && stale.banner?.tone === "warn" && stale.banner.text.includes("최근 7일 vs 직전 7일") && stale.banner.text.includes("이전 선택") && !stale.reportReady);
    const er = W.buildContextBar({ ...base, status: "error", isCurrent: false, errorMessage: "서버 오류" });
    check("error: 이전 값이 새 선택과 다르다고 알린다", er.banner?.tone === "error" && er.banner.text.includes("서버 오류") && er.banner.text.includes("새 선택과 다릅니다") && !er.reportReady);
    const noData = W.buildContextBar({ ...base, periodLabel: null, status: "error", isCurrent: false, errorMessage: "반영된 데이터가 없습니다." });
    check("error + 보이는 값이 없으면 '이전 선택의 값'이라고 말하지 않는다", noData.banner?.text === "반영된 데이터가 없습니다." && !noData.reportReady);
    check("loading: 안내 배너", W.buildContextBar({ ...base, status: "loading" }).banner?.text === "불러오는 중입니다.");
    check("최신 수신일 표시(오늘 대비 일수)", W.describeLag("2026-10-04", "2026-10-06").text === "10/4(일) (2일 전)" && W.describeLag("2026-10-06", "2026-10-06").tone === "normal");
    check("수신이 오래 끊기면(4일 이상) 지연 가능 경고, 이력이 없으면 경고", W.describeLag("2026-10-01", "2026-10-06").tone === "warn" && W.describeLag(null, "2026-10-06").tone === "warn");
    check("공식 주간 값은 '확정', 일간 수신값은 '잠정'으로 표시", W.FINALITY_LABEL.official.startsWith("확정") && W.FINALITY_LABEL.provisional.startsWith("잠정"));
  }

  // ── 보고서 생성 가드 ──────────────────────────────────────
  {
    const ok = { status: "ready" as const, isCurrent: true, requestedTo: "2026-10-04", latestAvailableDate: "2026-10-04", linkCutoff: "2026-10-04", reportCutoff: "2026-10-04" };
    check("현재 문맥의 값이 준비됐고 시점이 같으면 허용", W.evaluateReportGuard(ok).mode === "ok");
    check("로딩·stale·error 상태에서는 보고서 생성을 막는다", (["loading", "stale", "error"] as const).every((st) => W.evaluateReportGuard({ ...ok, status: st }).code === "CONTEXT_NOT_READY"));
    check("값이 현재 선택의 것이 아니면(isCurrent=false) 막는다", W.evaluateReportGuard({ ...ok, isCurrent: false }).mode === "blocked");
    check("최신 수신일 이후 날짜가 포함되면 막는다", W.evaluateReportGuard({ ...ok, requestedTo: "2026-10-06" }).code === "PERIOD_AFTER_LATEST");
    const older = W.evaluateReportGuard({ ...ok, reportCutoff: "2026-10-03" });
    check("보고서 시점이 화면보다 이전이면 이전 snapshot임을 고지(막지는 않음)", older.mode === "notice" && older.code === "OLDER_SNAPSHOT" && older.message!.includes("2026-10-03") && older.message!.includes("이전 snapshot"));
    check("화면을 본 뒤 새 자료가 들어오면 고지", W.evaluateReportGuard({ ...ok, reportCutoff: "2026-10-05" }).code === "NEWER_DATA");
    check("링크에 시점이 없으면(옛 링크) 시점 비교를 하지 않는다", W.evaluateReportGuard({ ...ok, linkCutoff: null }).mode === "ok");
    check("cut 쿼리는 날짜 형식만 인정", W.cutoffFromQuery(get("cut=2026-10-04")) === "2026-10-04" && W.cutoffFromQuery(get("cut=abc")) === null && W.cutoffFromQuery(get("")) === null);
  }

  // ── KPI 표 ────────────────────────────────────────────────
  {
    const detail = (asOf: string, ratings: number[]) => ratings.map((r, i) => ({ date: W.addDays(asOf, -(ratings.length - 1 - i)), rating: r, rank: null }));
    const mk = (over: Partial<import("../src/lib/workspace").KpiChannelInput> & { code: string }): import("../src/lib/workspace").KpiChannelInput => ({
      name: over.code, primaryTarget: "수도권 개인2049", currentRating: 0.12, currentRank: 7, priorDayRank: 8, rankChangeDod: 1, dodChangePct: null, wowChangePct: null,
      targetRating: 0.1, targetRank: "6", achievementPct: 120, gap: 0.02, recentRatingsDetail: detail("2026-10-04", [0.1, 0.12]), ...over,
    });

    const tr = W.parseTargetRank;
    check("목표 순위 해석: 숫자만 = 시장(가정 표시), '경쟁채널 중 2위' = 경쟁군, 빈 값 = 미설정", tr("6").scope === "market" && tr("6").scopeAssumed && tr("경쟁채널 중 2위").scope === "peer" && tr("경쟁채널 중 2위").value === 2 && tr("").scope === "unknown" && tr(null).value === null);

    const sky = W.buildKpiRow(mk({ code: "SKYUHD", primaryTarget: "National 유료방송가입가구", currentRating: 0.0017, currentRank: 188, targetRank: "경쟁채널 중 2위", targetRating: 0.002, gap: -0.0003, recentRatingsDetail: detail("2026-10-04", [0.0016, 0.0017]) }), { asOfDate: "2026-10-04" });
    check("skyUHD: 시장 188위와 경쟁군 목표 2위를 '(188/2)'로 묶지 않는다", sky.rank.text === "시장 188위" && sky.targetRank.text === "경쟁군 목표 2위" && !JSON.stringify(sky).includes("188/2") && !JSON.stringify(sky).includes("(188"));
    check("skyUHD: 기준이 다른 순위의 격차는 계산하지 않고 이유를 알린다", sky.rankGap.value === null && sky.rankGap.text === "기준이 달라 격차 미계산" && sky.notes.some((n) => n.includes("기준이 달라")));
    check("skyUHD 시청률은 4자리로 표시", sky.ratingText === "0.0017%");

    const ena = W.buildKpiRow(mk({ code: "ENA" }), { asOfDate: "2026-10-04" });
    check("ENA: 시장 7위·시장 목표 6위는 같은 기준이라 격차 1위(목표보다 1위 낮음)를 계산, 목표 숫자는 가정 표시", ena.rankGap.value === 1 && ena.rankGap.text === "목표보다 1위 낮음" && ena.notes.some((n) => n.includes("시장 순위 목표로 해석")));
    check("순위는 정수 문자열로만 표기(소수점 없음)", Number.isInteger(ena.rank.value) && /^시장 \d+위$/.test(ena.rank.text));
    check("순위가 소수(비정상 입력)면 순위 없음으로 처리하고 지어내지 않는다", W.buildKpiRow(mk({ code: "ENA", currentRank: 7.5 }), { asOfDate: "2026-10-04" }).rank.value === null);

    check("전일 변화를 %p와 %로 따로 표시(0.100→0.120 = +0.020%p, +20.0%)", ena.dod.ppText === "+0.020%p" && ena.dod.pctText === "+20.0%" && !ena.dod.pctFromServer, `${ena.dod.ppText} ${ena.dod.pctText}`);
    const noPrior = W.buildKpiRow(mk({ code: "ENA", recentRatingsDetail: [], dodChangePct: 20 }), { asOfDate: "2026-10-04" });
    check("비교 시청률을 모르면 %p는 만들지 않고(—) 서버 계산 %는 출처를 표시해 보여 준다", noPrior.dod.ppText === "—" && noPrior.dod.pctFromServer && noPrior.dod.pctText === "+20.0%");
    const zeroPrior = W.buildKpiRow(mk({ code: "ENA", recentRatingsDetail: detail("2026-10-04", [0, 0.12]) }), { asOfDate: "2026-10-04" });
    check("전일 값이 0이면 무한 증가율 대신 '신규(기준 0)'와 %p만", zeroPrior.dod.pctText === "신규(기준 0)" && zeroPrior.dod.ppText === "+0.120%p" && zeroPrior.dod.relativePct === null);
    const none = W.buildKpiRow(mk({ code: "ENA", currentRating: null, currentRank: null, recentRatingsDetail: [], achievementPct: null, gap: null, targetRating: null }), { asOfDate: "2026-10-04" });
    check("시청률 결측은 0이 아니라 '—'(미수신)이고 격차·변화도 만들지 않는다", none.ratingText === "—" && none.rank.text === "순위 없음" && none.goal.gapText === "목표 격차 없음" && none.dod.pctText === "비교 불가");
    const wow = W.buildKpiRow(mk({ code: "ENA" }), { asOfDate: "2026-10-04", signal: { channelCode: "ENA", priorWeekRating: 0.15 } });
    check("전주 동요일 대비는 전주 시청률로 계산(0.150→0.120 = −0.030%p, −20.0%)", wow.wow.ppText === "−0.030%p" && wow.wow.pctText === "−20.0%", `${wow.wow.ppText} ${wow.wow.pctText}`);
    check("목표 격차는 %p로 표기(0.120−0.100=+0.020%p)", ena.goal.gapPp !== null && Math.abs(ena.goal.gapPp - 0.02) < 1e-9 && ena.goal.gapText === "+0.020%p");

    const chans = [
      mk({ code: "SKYUHD", primaryTarget: "National 유료방송가입가구", currentRating: 0.0017, currentRank: 188, targetRank: "경쟁채널 중 2위" }),
      mk({ code: "ONCE", primaryTarget: "National 유료방송가입가구", currentRating: 0.9, currentRank: 3 }),
      mk({ code: "ENA_PLAY", currentRating: 0.05, currentRank: 40 }),
      mk({ code: "ENA", currentRating: 0.3, currentRank: 7 }),
      mk({ code: "OLIFE", primaryTarget: "National 유료방송가입가구", currentRating: 0.2, currentRank: 20 }),
    ];
    const groups = W.buildKpiGroups(chans, { asOfDate: "2026-10-04" });
    check("타깃이 다른 채널은 서로 다른 그룹으로 묶는다(2049 / 유료방송가구)", groups.length === 2 && groups[0].groupKey === "수도권 개인2049" && groups[1].groupKey === "National 유료방송가입가구" && groups[0].title === "수도권 2049 기준" && groups[1].title === "전국 유료방송가입가구 기준" && groups[0].rows.map((r) => r.code).join() === "ENA,ENA_PLAY");
    check("그룹 안 채널 순서는 고정(시청률·순위로 정렬하지 않는다)", groups[1].rows.map((r) => r.code).join() === "OLIFE,ONCE,SKYUHD");
    const reversed = W.buildKpiGroups([...chans].reverse().map((c) => ({ ...c, currentRating: 1 - (c.currentRating ?? 0) })), { asOfDate: "2026-10-04" });
    check("시청률 값을 뒤집어도 표 순서가 같다 — 값으로 줄 세우지 않는다", reversed.map((g) => g.rows.map((r) => r.code).join()).join("|") === groups.map((g) => g.rows.map((r) => r.code).join()).join("|"));
    check("행에 '전체 순위'처럼 서로 다른 타깃을 한 줄로 세우는 필드가 없다", !groups.flatMap((g) => g.rows).some((r) => "overallRank" in r || "orderByRating" in r));
  }

  // ── 홈 데이터 상태·결정 카드 ───────────────────────────────
  {
    const ds = (over: Partial<Parameters<typeof W.buildDataStatus>[0]> = {}) =>
      W.buildDataStatus({ view: "daily", asOfDate: "2026-10-04", latestAvailableDate: "2026-10-04", requestedDateNoData: false, today: "2026-10-05", missingChannelNames: [], hasWeeklyReview: false, hasMonthlyReview: false, ...over });
    const okS = ds();
    check("정상 상태: level ok, 일간은 잠정 안내를 포함", okS.level === "ok" && okS.finality === "provisional" && okS.lines.some((l) => l.text.includes("잠정")));
    check("요청 날짜에 데이터가 없으면 경고하고 최신일 값임을 알린다", ds({ requestedDateNoData: true }).level === "warn");
    const miss = ds({ missingChannelNames: ["ENA Story"] });
    check("미수신 채널이 있으면 경고하고 빈 값이 0이 아님을 밝힌다", miss.level === "warn" && miss.lines.some((l) => l.text.includes("ENA Story") && l.text.includes("0이 아니라")));
    check("수신이 4일 이상 지연되면 경고", ds({ latestAvailableDate: "2026-10-01", today: "2026-10-06" }).level === "warn");
    check("보기별 확정 상태: 주간은 공식 주간 리뷰가 있어야 확정, 월간은 공식 월간이 있어야 확정", W.finalityFor("weekly", { hasWeeklyReview: true, hasMonthlyReview: false }) === "official" && W.finalityFor("weekly", { hasWeeklyReview: false, hasMonthlyReview: false }) === "provisional" && W.finalityFor("monthly", { hasWeeklyReview: true, hasMonthlyReview: false }) === "unknown");

    const sig = (code: string, over: Partial<import("../src/lib/workspace").DecisionSignal> = {}): import("../src/lib/workspace").DecisionSignal => ({
      channelCode: code, top_program_name: null, top_program_rating: null, top_program_start_time: null, top_program_baseline_avg: null, top_program_baseline_days: null,
      decline_program_name: null, decline_program_rating: null, decline_program_start_time: null, decline_program_baseline_avg: null, decline_program_baseline_days: null, decline_program_delta_pct: null, ...over,
    });
    const names = { ENA: "ENA", ENA_PLAY: "ENA Play", ENA_DRAMA: "ENA Drama", OLIFE: "OLIFE", ONCE: "ONCE" };
    const baseIn = {
      ctx: { ...W.EMPTY_CONTEXT }, asOfDate: "2026-10-04", latestAvailableDate: "2026-10-04", today: "2026-10-05", channelNames: names, anomaly: null, dataStatus: okS, reviews: [] as import("../src/lib/workspace").ReviewEvent[], snapshotId: "ms-test",
    };
    const decline = (code: string, name: string, pct: number, hour = "14:10:00") => sig(code, { decline_program_name: name, decline_program_rating: 0.05, decline_program_start_time: hour, decline_program_baseline_avg: 0.1, decline_program_baseline_days: 8, decline_program_delta_pct: pct });
    const signals = [decline("ENA_PLAY", "신병4", -40), decline("ENA_DRAMA", "드라마A", -60), decline("OLIFE", "다큐B", -35), sig("ENA", { top_program_name: "예능C", top_program_rating: 0.5, top_program_start_time: "21:00:00", top_program_baseline_avg: 0.3, top_program_baseline_days: 8 })];
    const r1 = W.buildTodayDecisions({ ...baseIn, signals });
    check("결정 카드는 최대 3건", r1.cards.length === 3 && r1.candidates === 4);
    check("하락이 큰 것부터(상승 카드는 하락보다 뒤)", r1.cards[0].channelCode === "ENA_DRAMA" && r1.cards.every((c) => c.kind === "program_decline"));
    const c0 = r1.cards[0];
    check("카드마다 근거 2개·대안·확인 조건·검토일이 있다", c0.evidence.length === 2 && c0.evidence.every((e) => e.length > 5) && c0.alternatives.length >= 1 && c0.confirm.length > 3 && c0.reviewBy === "2026-10-18");
    check("1회 급락만으로 교체·이동을 권하지 않는다 — 제목은 '추적 점검', 대안에 추가 관찰이 있다", c0.title.includes("추적 점검") && !/교체|이동/.test(c0.title) && c0.alternatives.some((a) => a.includes("추가 관찰")));
    check("카드 문구가 원인을 단정하지 않는다('때문에' 없음, 가설은 관측 아님으로 표시)", r1.cards.every((c) => !JSON.stringify([c.title, c.evidence, c.alternatives, c.confirm]).includes("때문에")) && c0.notes[0].includes("관측 아님"));
    check("모든 프로그램 카드는 미확인 Avail과 미입력 운영정책을 숨기지 않고 보여 준다", r1.cards.every((c) => c.notes.some((n) => n.includes("Avail(권리) 미확인")) && c.notes.some((n) => n.includes("정책 미입력 항목"))));
    const again = W.buildTodayDecisions({ ...baseIn, signals });
    check("같은 입력이면 같은 action_id(홈·상세·보고서가 같은 판단 공유)", again.cards.map((c) => c.id).join() === r1.cards.map((c) => c.id).join() && c0.id.startsWith("act-"));
    check("링크가 액션·채널·기준일·데이터 시점을 이어 준다", c0.links.evidence!.includes(`from=${c0.id}`) && c0.links.evidence!.startsWith("/channel/ENA_DRAMA") && c0.links.evidence!.includes("sj=ENA_DRAMA%7C%EB%93%9C%EB%9D%BC%EB%A7%88A%7C14") && c0.links.slot!.includes("channel=ENA_DRAMA") && c0.links.slot!.includes("date=2026-10-04") && c0.links.slot!.includes("hour=14") && c0.links.slot!.includes("cut=2026-10-04") && c0.links.compare!.startsWith("/ideal-schedule?channel=ENA_DRAMA") && c0.links.compare!.includes(`from=${c0.id}`));
    const past = W.buildTodayDecisions({ ...baseIn, asOfDate: "2026-10-03", signals });
    check("과거 기준일은 채널 화면을 그 하루(직접 선택)로 연다", past.cards[0].links.evidence!.includes("preset=custom") && past.cards[0].links.evidence!.includes("dateFrom=2026-10-03") && past.cards[0].links.evidence!.includes("dateTo=2026-10-03"));
    const riseOnly = W.buildTodayDecisions({ ...baseIn, signals: [signals[3]] });
    check("상승 신호는 강화 검토 카드(같은 슬롯 평균 대비 +67%)", riseOnly.cards.length === 1 && riseOnly.cards[0].kind === "program_rise" && riseOnly.cards[0].evidence[0].includes("▲67%"));
    const small = W.buildTodayDecisions({ ...baseIn, signals: [sig("ENA", { top_program_name: "예능C", top_program_rating: 0.33, top_program_start_time: "21:00:00", top_program_baseline_avg: 0.3, top_program_baseline_days: 8 })] });
    check("기준 미만의 작은 변화(+10%)는 카드로 올리지 않는다", small.cards.length === 0);
    const fewSample = W.buildTodayDecisions({ ...baseIn, signals: [sig("ENA", { top_program_name: "예능C", top_program_rating: 0.5, top_program_start_time: "21:00:00", top_program_baseline_avg: 0.3, top_program_baseline_days: 2 })] });
    check("기준 표본이 3회 미만이면 상승 카드를 만들지 않는다", fewSample.cards.length === 0);

    const anomaly = { triggered: true, thresholdPct: 20, minChannelCount: 3, movedChannels: [{ channelCode: "ENA", channelName: "ENA", ratingDeltaPct: -25 }, { channelCode: "ENA_PLAY", channelName: "ENA Play", ratingDeltaPct: -30 }, { channelCode: "OLIFE", channelName: "OLIFE", ratingDeltaPct: -22 }] };
    const withData = W.buildTodayDecisions({ ...baseIn, signals, anomaly, dataStatus: miss });
    check("우선순위: 다수 채널 동시 변동 > 프로그램 하락. 데이터 경고는 별도 섹션이 보여 주므로 결정 카드 슬롯을 쓰지 않는다", withData.cards.map((c) => c.kind).join() === "anomaly,program_decline,program_decline" && withData.cards.length === 3 && !withData.cards.some((c) => c.kind === "data"));
    check("다수 채널 변동 카드는 개별 편성 판단을 보류하고 공통 요인을 먼저 확인하도록 안내(원인 단정 없음)", withData.cards[0].alternatives[0].includes("보류") && withData.cards[0].notes[0].includes("관측"));
    check("동시 변동 카드는 자기 자신으로 돌아가는 링크를 만들지 않는다", withData.cards[0].links.evidence === null && withData.cards[0].links.slot === null && withData.cards[0].links.compare === null);

    // F06: Fit Score 태그가 관측 방향과 어긋나는 경우
    const tagged = (code: string, over: object) => ({ ...decline(code, "작품T", -40), ...over });
    const up = { ...signals[3], top_program_tag: "MOVE" as const };
    const upCard = W.buildTodayDecisions({ ...baseIn, signals: [up] }).cards[0];
    check("상승 관측에 MOVE 태그가 붙어도 카드 제목이 '이동 검토'가 되지 않고(방향 모순 제거) 태그 제외 사실을 노트로 남긴다", !upCard.title.includes("이동") && upCard.title.includes("강화") && upCard.notes.some((n) => n.includes("Fit Score 태그(MOVE)") && n.includes("제외")) && upCard.alternatives.some((a) => a.includes("현재 슬롯 유지")));
    const downStrengthen = W.buildTodayDecisions({ ...baseIn, signals: [tagged("ENA_PLAY", { decline_program_tag: "STRENGTHEN" })] }).cards[0];
    check("하락 관측에 STRENGTHEN 태그가 붙어도 강화 검토로 쓰지 않는다", !downStrengthen.title.includes("강화") && downStrengthen.title.includes("추적 점검") && downStrengthen.notes.some((n) => n.includes("STRENGTHEN") && n.includes("제외")));
    const downReplace = W.buildTodayDecisions({ ...baseIn, signals: [tagged("ENA_PLAY", { decline_program_tag: "REPLACE" })] }).cards[0];
    check("1회 급락에 REPLACE 태그가 붙어도 반복 확인 전에는 제목이 '교체 검토'가 되지 않는다(단계 04 규칙)", !/^.* — 교체 검토/.test(downReplace.title) && downReplace.title.includes("추적 점검") && downReplace.title.includes("반복 확인 후"));

    const ev = (status: import("../src/lib/workspace").ReviewStatus, createdAt: string, subject: string, reviewBy: string | null): import("../src/lib/workspace").ReviewEvent => ({
      id: `e-${status}`, actionId: `old-${status}`, title: "t", status, reason: status === "reviewing" ? null : "이유", reviewBy, createdAt, actorRole: "pd", actorId: "p1", actorName: "PD", context: { subject },
    });
    const subj = (code: string, program: string, hour: number) => `${code}|${program}|${hour}`;
    const only = [decline("ENA_DRAMA", "드라마A", -60)];
    const sup = (e: import("../src/lib/workspace").ReviewEvent) => W.buildTodayDecisions({ ...baseIn, signals: only, reviews: [e] });
    check("채택 후 평가일 전에는 같은 주제를 다시 올리지 않는다", sup(ev("adopted", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), "2026-10-17")).cards.length === 0);
    check("채택 후 평가일이 지나면 다시 올라온다", sup(ev("adopted", "2026-09-01T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), "2026-09-15")).cards.length === 1);
    check("기각 후 14일 안에는 숨기고 14일이 지나면 다시 올린다", sup(ev("dismissed", "2026-10-01T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), null)).cards.length === 0 && sup(ev("dismissed", "2026-09-10T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), null)).cards.length === 1);
    check("보류는 재검토일 전에는 숨기고 도래하거나 기한이 없으면 올린다", sup(ev("hold", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), "2026-10-10")).cards.length === 0 && sup(ev("hold", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), "2026-10-05")).cards.length === 1 && sup(ev("hold", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), null)).cards.length === 1);
    const rv = sup(ev("reviewing", "2026-10-04T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), null));
    check("검토 중인 주제는 숨기지 않고 검토 상태를 카드에 붙인다", rv.cards.length === 1 && rv.cards[0].review?.status === "reviewing");
    check("다른 프로그램의 검토 기록은 영향을 주지 않는다", W.buildTodayDecisions({ ...baseIn, signals: only, reviews: [ev("adopted", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "다른작품", 14), "2026-10-17")] }).cards.length === 1);
    check("억제된 건수를 알려 준다(조용히 사라지지 않음)", W.buildTodayDecisions({ ...baseIn, signals: only, reviews: [ev("adopted", "2026-10-03T01:00:00Z", subj("ENA_DRAMA", "드라마A", 14), "2026-10-17")] }).suppressed === 1);
  }

  // ── 액션 검토 기록·후속 ────────────────────────────────────
  {
    const base = { actionId: "act-1", title: "ENA Play '신병4' 14시 — 추적 점검", status: "hold" as const, reason: "다음 2회 확인", reviewBy: "2026-10-12" };
    check("보류·채택·기각은 이유가 필요하고 검토 중은 이유 없이 시작 가능", W.validateReviewInput({ ...base, reason: "" }).length === 1 && W.validateReviewInput({ ...base, status: "reviewing", reason: "" }).length === 0 && W.validateReviewInput({ ...base, status: "adopted", reason: "  " }).length === 1);
    check("잘못된 입력은 이유를 모아 돌려준다(액션 ID·제목·날짜 형식·길이)", W.validateReviewInput({ ...base, actionId: "", title: "", reviewBy: "10/12", reason: "x".repeat(501) }).length === 4);
    const ev = (id: string, actionId: string, status: import("../src/lib/workspace").ReviewStatus, createdAt: string, reviewBy: string | null = null): import("../src/lib/workspace").ReviewEvent => ({
      id, actionId, title: `제목-${actionId}`, status, reason: status === "reviewing" ? null : "이유", reviewBy, createdAt, actorRole: "pd", actorId: "p1", actorName: "PD", channelCode: "ENA_PLAY",
    });
    const events = [ev("1", "a", "reviewing", "2026-10-01T00:00:00Z"), ev("2", "a", "hold", "2026-10-02T00:00:00Z", "2026-10-12"), ev("3", "b", "reviewing", "2026-10-03T00:00:00Z"), ev("4", "c", "adopted", "2026-09-01T00:00:00Z", "2026-09-15"), ev("5", "d", "dismissed", "2026-10-01T00:00:00Z"), ev("6", "e", "hold", "2026-10-01T00:00:00Z", null)];
    check("현재 상태는 같은 액션의 가장 최근 이벤트", W.latestByAction(events).get("a")?.status === "hold" && W.currentStatus(events, "a")?.id === "2");
    const f = W.pendingFollowups(events, { today: "2026-10-05" });
    // 날짜가 달라 action_id가 바뀌어도 같은 주제(subject)의 최신 기록만 본다
    const subj = (id: string, actionId: string, status: import("../src/lib/workspace").ReviewStatus, createdAt: string): import("../src/lib/workspace").ReviewEvent => ({ ...ev(id, actionId, status, createdAt), context: { subject: "ENA_PLAY|신병4|14" } });
    const sameTopic = [subj("s1", "act-mon", "reviewing", "2026-10-05T00:00:00Z"), subj("s2", "act-tue", "dismissed", "2026-10-06T00:00:00Z")];
    check("월요일 검토 중이던 같은 프로그램·슬롯을 화요일에 기각하면 월요일 후속이 남지 않는다(주제 기준)", W.pendingFollowups(sameTopic, { today: "2026-10-07" }).length === 0 && W.latestBySubject(sameTopic).size === 1);
    check("다음 브리핑 후속: 검토 중·기한 없는 보류·평가일이 지난 채택만(기한 전 보류·기각은 제외)", f.map((x) => x.actionId).join() === "b,e,c", f.map((x) => `${x.actionId}:${x.status}`).join());
    check("후속마다 왜 지금 필요한지 한 줄 이유가 있다", f.every((x) => x.why.length > 4 && x.due));
    check("보류 재검토일이 도래하면 후속에 올라온다", W.pendingFollowups(events, { today: "2026-10-12" }).some((x) => x.actionId === "a" && x.why.includes("도래")));
    check("다른 채널의 후속은 채널 필터로 제외", W.pendingFollowups(events, { today: "2026-10-05", channelCode: "ENA" }).length === 0);
    check("기록은 추가 전용: 입력 배열을 변형하지 않는다", events.length === 6 && events[0].status === "reviewing");
  }

  // ── 홈 보기 구성 ───────────────────────────────────────────
  {
    const H = W.HOME_SECTIONS;
    check("일간·주간·월간 보기 모두 데이터 상태와 후속 액션을 둔다", (Object.keys(H) as (keyof typeof H)[]).every((v) => H[v][0].id === "data_status" && H[v].some((s) => s.id === "followups")));
    check("섹션 제목만 바꾼 같은 내용의 복제가 없다(공유 섹션 제외, contentKey 중복 없음)", W.findDuplicatedContent().length === 0, W.findDuplicatedContent().join(" | "));
    const ids = (v: keyof typeof H) => H[v].map((s) => s.id).filter((id) => !["data_status", "followups"].includes(id));
    check("보기마다 고유 섹션이 있고 서로 겹치지 않는다", ids("daily").every((id) => !ids("weekly").includes(id) && !ids("monthly").includes(id)) && ids("weekly").every((id) => !ids("monthly").includes(id)));
    check("일간 섹션 순서: 데이터 상태→결정→KPI→변화 근거→오리지널→후속→보조(07단계 지시)", H.daily.map((s) => s.id).join() === "data_status,decisions,kpi,change,original,followups,aux");
    check("주간은 기여 분해·다음 주 대안, 월간은 역할·라인업·권리 소진·차월 전략을 다룬다", H.weekly.some((s) => s.id === "week_review" && s.title.includes("기여 분해")) && H.weekly.some((s) => s.id === "next_week") && ["roles", "rights", "strategy"].every((id) => H.monthly.some((s) => s.id === id)));
    check("모든 섹션에 답할 질문이 있다", Object.values(H).flat().every((s) => s.question.length > 5));
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
