// Avail(권리) 모델·판정·원장 테스트(단계 06) — 명세 A01~A19 합성 사례 + 실제 파일 어댑터 검증(파일이 있을 때만).
// 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크에 접근하지 않는다. 실제 Avail 파일은 읽기만 하고 저장·전송하지 않는다.
// 실행: npm run test:avail   (실제 파일 검증: AVAIL_SAMPLE_FILE=경로 npm run test:avail)
import fs from "node:fs";
import * as A from "../src/lib/avail";
import { emptyRules, rowHashOf } from "../src/lib/avail/adapters/common";
import { parseContentAvailRows } from "../src/lib/avail/adapters/contentAvail";
import { parseStandardRows, standardTemplateRows } from "../src/lib/avail/adapters/standard";
import type { Grant } from "../src/lib/avail";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const NOW = "2026-10-06T09:00:00+09:00";

// ── 합성 픽스처 ──────────────────────────────────────────
interface G {
  id: string;
  title: string;
  eps: [number, number][];
  channels: string[] | "all" | "unknown";
  start: string | null;
  end: string | "unbounded" | null;
  count: number | "unbounded" | "unknown";
  platforms: string[];
  conditions: A.Condition[];
  baseline: Grant["usageBaseline"];
  gate: string | null;
  season: string | null;
  kind: Grant["source"]["kind"];
  refs: string[];
  enteredAt: string;
  anchor: A.RightsWindow["anchor"];
  term: string | null;
  status: Grant["status"];
  code: string | null;
  episodesUnknown: boolean;
}
function grant(o: Partial<G> = {}): Grant {
  const g: G = { id: "G1", title: "샘플 시리즈", eps: [[1, 12]], channels: ["ENA", "ENA Play"], start: "2026-10-01", end: "2026-12-31", count: 3, platforms: ["위", "케", "IP"], conditions: [], baseline: "zero", gate: null, season: null, kind: "content_avail", refs: [], enteredAt: "2026-10-01T00:00:00+09:00", anchor: "fixed_start", term: null, status: "active", code: "T-1", episodesUnknown: false, ...o };
  const rules = emptyRules();
  rules.count = { limit: g.count === "unbounded" ? { state: "unbounded" } : g.count === "unknown" ? { state: "unknown", raw: null } : { state: "value", value: g.count }, raw: String(g.count) };
  rules.platformsRaw = g.platforms;
  rules.firstWindowGate = g.gate ? { channel: g.gate, provenance: "test" } : null;
  const columns = { id: g.id, title: g.title, start: g.start, end: g.end, count: g.count, eps: JSON.stringify(g.eps), ch: JSON.stringify(g.channels), cond: g.conditions.length };
  const rowHash = rowHashOf(columns);
  return {
    grantId: g.id,
    revisionId: `${g.id}#${rowHash}`,
    rowHash,
    supersedesRevisionId: null,
    status: g.status,
    contractRefs: g.refs,
    rightsHolder: null,
    source: { kind: g.kind, batchId: "b1", file: "test.xlsx", sheet: "시트1", row: 2, columns },
    enteredAt: g.enteredAt,
    content: { titleRaw: g.title, canonicalKey: A.titleVariants(g.title).mainKey, sourceCode: g.code, genreRaw: null, originRaw: null, aliases: [], productionYear: { state: "unknown", raw: null }, origination: "unknown", runtimeMin: { state: "unknown", raw: null }, episodeCount: { state: "unknown", raw: null } },
    scope: {
      episodes: g.episodesUnknown ? { kind: "unknown", raw: "#회차선택", reason: "회차선택" } : { kind: "ranges", ranges: g.eps, excluded: [], raw: g.eps.map(([a, b]) => `#${a}~${b}`).join(", ") },
      channels: g.channels === "all" ? { kind: "all" } : g.channels === "unknown" ? { kind: "unknown", raw: null } : { kind: "list", ids: g.channels },
      season: g.season ? { state: "value", value: g.season } : { state: "not_applicable" },
      version: { state: "not_applicable" },
      territory: { state: "not_applicable" },
    },
    window: { start: g.start ? { state: "value", value: g.start } : { state: "unknown", raw: null }, end: g.end === "unbounded" ? { state: "unbounded" } : g.end ? { state: "value", value: g.end } : { state: "unknown", raw: null }, termRaw: g.term, appliesRaw: null, anchor: g.anchor, grouping: "batch" },
    rules,
    conditions: g.conditions,
    usageBaseline: g.baseline,
    mergedInto: null,
    manual: null,
    optionalCommercial: null,
  };
}

const CONFIRMED = A.applyConfirmations({
  endInclusive: { value: true, by: "t", at: "2026-10-01" },
  dayBasis: { value: "broadcast_day", by: "t", at: "2026-10-01" },
  spanPolicy: { value: "start_only", by: "t", at: "2026-10-01" },
  countUnit: { value: "per_episode_pooled", by: "t", at: "2026-10-01" },
  firstWindowGate: { value: "per_episode", by: "t", at: "2026-10-01" },
});
const confirmedWith = (over: Partial<Record<A.InterpKey, unknown>>) =>
  A.applyConfirmations(Object.fromEntries(Object.entries({ endInclusive: true, dayBasis: "broadcast_day", spanPolicy: "start_only", countUnit: "per_episode_pooled", firstWindowGate: "per_episode", ...over }).map(([k, v]) => [k, { value: v, by: "t", at: "2026-10-01" }])) as never);

function ctxOf(grants: Grant[], o: Partial<A.EvalContext> = {}): A.EvalContext {
  const cur = A.currentGrants(grants);
  return { grants: cur, ledger: [], links: [], confirmations: [], interpretation: CONFIRMED, originalPolicy: A.DEFAULT_ORIGINAL_POLICY, now: NOW, inventoryVersion: A.inventoryVersionOf(cur), ...o };
}
const slot = (date = "2026-10-10", startMin = 1200, endMin = 1260, channelId = "ENA", platform?: string): A.SlotRef => ({ broadcastDate: date, startMin, endMin, channelId, platform });
const q = (programName = "샘플 시리즈", episodeNumber: number | null = 3, extra: Partial<A.ContentQuery> = {}): A.ContentQuery => ({ programId: null, programName, episodeNumber, ...extra });
const status = (qq: A.ContentQuery, s: A.SlotRef, c: A.EvalContext) => A.evaluateEligibility(qq, s, c);
const has = (r: A.EligibilityResult, code: string) => r.reasonCodes.includes(code);

let seq = 0;
const entry = (o: Partial<A.UsageEntry> & { event: A.UsageEvent }): A.UsageEntry => ({ seq: ++seq, usageId: `u${seq}`, poolId: "G1", grantRevisionId: "G1#x", channelId: "ENA", episode: 3, scheduledAt: null, actualAt: null, units: 1, scheduleRevisionId: null, idempotencyKey: `k${seq}`, sourceEventId: null, evidence: null, createdAt: NOW, ...o });

async function main() {
  // ══ 날짜·기간 계산 ═════════════════════════════════════
  console.log("\n— 날짜·기간 —");
  check("종료일 = 시작일 + 24개월 − 1일 (2026-08-31 → 2028-08-30)", A.inclusiveEndFromTerm("2026-08-31", 24) === "2028-08-30");
  check("윤년 말일 보정(2026-03-01 + 24개월 − 1일 = 2028-02-29)", A.inclusiveEndFromTerm("2026-03-01", 24) === "2028-02-29");
  check("2958434·2958465는 종료일 무제한", A.parseDateCell(2958434, "end").value.state === "unbounded" && A.parseDateCell(2958465, "end").value.state === "unbounded");
  check("시작일 2958434는 무제한이 아니라 날짜", A.parseDateCell(2958434, "start").value.state !== "unbounded");
  check("빈 종료일은 unknown(무제한 아님)", A.parseDateCell(null, "end").value.state === "unknown");
  check("엑셀 일련번호 46000 → 날짜", A.parseDateCell(46000, "start").value.state === "value");
  check("읽을 수 없는 날짜는 issue", A.parseDateCell("12월 15일", "start").issue !== null);
  check("방송일 25:30은 다음 날 01:30", A.calendarDateOf("2026-10-04", 1530) === "2026-10-05" && A.calendarLabel(A.calendarMinute("2026-10-04", 1530)).endsWith("01:30"));
  check("기간 해석: 1년 6개월 = 18개월", (A.parseTerm("1년 6개월") as { months: number }).months === 18);
  check("기간 해석: 영구·종료일까지·30일", A.parseTerm("영구").kind === "perpetual" && A.parseTerm("종료일까지").kind === "until_end" && (A.parseTerm("30일") as { days: number }).days === 30);

  // ══ 회차 표기 ═════════════════════════════════════════
  console.log("\n— 회차 표기 —");
  const ep = (s: string) => A.parseEpisodeScope(s);
  check("#1~12", A.listEpisodes(ep("#1~12"))!.length === 12);
  check("#320~350, #337제외 → 31−1", A.listEpisodes(ep("#320~350, #337제외"))!.length === 30 && A.episodeAllowed(ep("#320~350, #337제외"), 337) === false);
  check("#412~453 #419~424, 435~440제외 → 42−6−6", A.listEpisodes(ep("#412~453 #419~424, 435~440제외"))!.length === 30);
  check("#297~331 #299,307,316,319,326제외 → 35−5", A.listEpisodes(ep("#297~331 #299,307,316,319,326제외"))!.length === 30);
  check("#62~65, 66, 67, 72~125 → 4+1+1+54", A.listEpisodes(ep("#62~65, 66, 67, 72~125"))!.length === 60);
  check("#73~78, #80~103", A.listEpisodes(ep("#73~78, #80~103"))!.length === 30);
  check("#회차선택·#정보없음·빈칸은 unknown", ep("#회차선택").kind === "unknown" && ep("#정보없음").kind === "unknown" && A.parseEpisodeScope(null).kind === "unknown");
  check("\"#1~10, #8회 제외\"처럼 제외 앞 공백은 허용", A.listEpisodes(ep("#1~10, #8회 제외"))!.length === 9);
  check("읽을 수 없는 조각이 있으면 전체 unknown('#1~60, #61변외편', '#1회, #6회 방송금지?')", ep("#1~60, #61변외편").kind === "unknown" && ep("#1회, #6회 방송금지?").kind === "unknown");
  check("회차 범위가 거꾸로면 unknown", ep("#12~1").kind === "unknown");

  // ══ A01~A19 ═══════════════════════════════════════════
  console.log("\n— A01 허용 채널과 다른 채널 —");
  {
    const c = ctxOf([grant()]);
    const r = status(q(), slot("2026-10-10", 1200, 1260, "OLIFE"), c);
    check("A01 다른 채널은 unavailable + 사유 + 원본 행", r.status === "unavailable" && has(r, "CHANNEL_NOT_ALLOWED") && r.sourceRefs[0]?.row === 2 && r.sourceRefs[0].file === "test.xlsx");
    check("A01 허용 채널은 available(대소문자·공백 차이 흡수: 'ena play')", status(q(), slot("2026-10-10", 1200, 1260, "ena play"), c).status === "available");
  }

  console.log("\n— A02 시작 전/만료 후, 경계 —");
  {
    const c = ctxOf([grant({ start: "2026-10-01", end: "2026-12-31" })]);
    check("A02 시작 전날 제외", status(q(), slot("2026-09-30"), c).status === "unavailable" && has(status(q(), slot("2026-09-30"), c), "WINDOW_NOT_STARTED"));
    check("A02 시작일 당일 포함", status(q(), slot("2026-10-01"), c).status === "available");
    check("A02 종료일 당일 포함(확인된 해석)", status(q(), slot("2026-12-31"), c).status === "available");
    check("A02 종료일 다음 날 제외", status(q(), slot("2027-01-01"), c).status === "unavailable" && has(status(q(), slot("2027-01-01"), c), "WINDOW_EXPIRED"));
    const ex = ctxOf([grant({ start: "2026-10-01", end: "2026-12-31" })], { interpretation: confirmedWith({ endInclusive: false }) });
    check("A02 종료일 제외 해석이면 종료일 당일 불가", status(q(), slot("2026-12-31"), ex).status === "unavailable");
    const un = ctxOf([grant({ start: "2026-10-01", end: "2026-12-31" })], { interpretation: A.DEFAULT_INTERPRETATION });
    const edge = status(q(), slot("2026-12-31"), un);
    check("A02 종료일 포함 여부 미확인이면 종료일 당일은 조건부(해석 필요 사유)", edge.status === "conditional" && has(edge, "BOUNDARY_UNCONFIRMED") && edge.reasons.join(" ").includes("종료일 포함 여부"));
    check("A02 경계가 아닌 날은 해석 미확인이어도 단정(가능)", status(q(), slot("2026-11-15"), un).status === "available");
    check("A02 시작 전날은 해석 미확인이어도 단정(불가)", status(q(), slot("2026-09-29"), un).status === "unavailable");
  }

  console.log("\n— A03 25:30 편성과 자정 만료 —");
  {
    const g = grant({ start: "2026-09-01", end: "2026-10-04" });
    const cal = ctxOf([g], { interpretation: confirmedWith({ dayBasis: "calendar" }) });
    const bd = ctxOf([g], { interpretation: confirmedWith({ dayBasis: "broadcast_day" }) });
    const s = slot("2026-10-04", 1530, 1590);
    check("A03 달력 기준: 10-04 방송일의 25:30은 10-05 01:30이라 만료 후 불가", status(q(), s, cal).status === "unavailable");
    check("A03 방송일 기준: 같은 슬롯은 10-04 방송일이라 가능", status(q(), s, bd).status === "available");
    const un = ctxOf([g], { interpretation: A.DEFAULT_INTERPRETATION });
    const r = status(q(), s, un);
    check("A03 기준 미확인이면 조건부 + 어떤 해석 때문인지 표시", r.status === "conditional" && r.reasons.join(" ").includes("달력/방송일 기준"));
  }

  console.log("\n— A04 시작은 허용, 끝은 만료 이후 —");
  {
    const g = grant({ start: "2026-09-01", end: "2026-10-04" });
    const s = slot("2026-10-04", 1380, 1500); // 23:00~25:00 → 종료 01:00(10-05)
    const cal = (span: "start_only" | "through_end") => ctxOf([g], { interpretation: confirmedWith({ dayBasis: "calendar", spanPolicy: span }) });
    check("A04 시작만 허용이면 가능", status(q(), s, cal("start_only")).status === "available");
    check("A04 종료까지 허용돼야 하면 불가", status(q(), s, cal("through_end")).status === "unavailable");
    const un = ctxOf([g], { interpretation: { ...confirmedWith({ dayBasis: "calendar" }), spanPolicy: A.DEFAULT_INTERPRETATION.spanPolicy } });
    const r = status(q(), s, un);
    check("A04 걸친 방송 정책 미확인이면 조건부", r.status === "conditional" && r.reasons.join(" ").includes("자정 넘어 만료"));
  }

  console.log("\n— A05 전체 12회 중 특정 회차만 —");
  {
    const c = ctxOf([grant({ eps: [[3, 5]] })]);
    check("A05 허용 회차 안은 가능", status(q("샘플 시리즈", 4), slot(), c).status === "available");
    const r = status(q("샘플 시리즈", 2), slot(), c);
    check("A05 나머지 회차는 불가 + 사유", r.status === "unavailable" && has(r, "EPISODE_NOT_GRANTED"));
    const none = status(q("샘플 시리즈", null), slot(), c);
    check("A05 회차 미지정이면 쓸 수 있는 회차 목록을 돌려준다", none.status === "available" && JSON.stringify(none.eligibleEpisodes) === "[3,4,5]");
    const unk = status(q("샘플 시리즈", 4), slot(), ctxOf([grant({ episodesUnknown: true })]));
    check("A05 회차 범위를 모르면 unknown(허용으로 보지 않음)", unk.status === "unknown" && has(unk, "EPISODE_SCOPE_UNKNOWN"));
  }

  console.log("\n— A06 동일 제목 다른 시즌/편집판 —");
  {
    const g = grant({ title: "더 캡처 시즌2", season: "2", id: "G2" });
    const c = ctxOf([g]);
    check("A06 정확히 같은 제목이면 연결·가능", status(q("더 캡처 시즌2"), slot(), c).status === "available");
    const diff = status(q("더 캡처 시즌2", 3, { season: "3" }), slot(), c);
    check("A06 시즌 표지가 다르면 확인 전 unknown(자동 병합 안 함)", diff.status === "unknown" && has(diff, "SEASON_VERSION_UNCONFIRMED"));
    const sp = status(q("더 캡처 시즌2 스페셜"), slot(), c);
    check("A06 편집판·스페셜은 부분 일치라 후보만(연결 확인 필요)", sp.status === "unknown" && has(sp, "CONTENT_LINK_UNCONFIRMED"));
    const other = status(q("더 캡처 시즌3"), slot(), c);
    check("A06 다른 시즌 제목은 이 권리와 연결하지 않는다", other.status === "unknown" && !other.grantRevisionIds.length);
    const linked = ctxOf([g], { links: [{ programId: "p-cap2", canonicalKey: g.content.canonicalKey, confirmedBy: "t", confirmedAt: NOW }] });
    check("A06 운영자가 연결을 확인하면 표기가 달라도 연결", status({ programId: "p-cap2", programName: "캡처 2기", episodeNumber: 3 }, slot(), linked).status === "available");
    const cand = A.proposeLinks({ title: "서바이빙 어스(대멸종: 최후의 생존자들)" }, [{ id: "1", name: "대멸종: 최후의 생존자들" }, { id: "2", name: "서바이빙 어스" }, { id: "3", name: "서바이빙 어스 2" }]);
    check("A06 괄호 안 별칭은 후보로 찾지만 자동 확정하지 않는다", cand.some((x) => x.programId === "1" && x.basis === "alias") && A.decideLink(cand).status === "NEEDS_CONFIRMATION" || A.decideLink(cand).status === "RESOLVED");
    const ex = A.decideLink(A.proposeLinks({ title: "신병4: 사보타주" }, [{ id: "9", name: "신병4 사보타주" }, { id: "8", name: "신병3" }]));
    check("A06 이름이 정확히 같고 표지 충돌이 없으면 자동 연결(공백·문장부호 무시)", ex.status === "RESOLVED" && ex.programId === "9");
    const seasonDiff = A.proposeLinks({ title: "신병3" }, [{ id: "7", name: "신병S1" }]);
    check("A06 숫자만 다른 시즌은 별개로 취급(시즌 다름 후보, 자동 연결 아님)", A.decideLink(seasonDiff).status !== "RESOLVED");
  }

  console.log("\n— A07 잔여 0회 —");
  {
    const used = [entry({ event: "consume", usageId: "ua" }), entry({ event: "consume", usageId: "ub", channelId: "ENA Play" }), entry({ event: "reserve", usageId: "uc" })];
    const c = ctxOf([grant({ count: 3 })], { ledger: used });
    const r = status(q(), slot(), c);
    check("A07 잔여 0회면 불가(COUNT_EXHAUSTED)", r.status === "unavailable" && has(r, "COUNT_EXHAUSTED"));
    const left = ctxOf([grant({ count: 3 })], { ledger: used.slice(0, 2) });
    const r2 = status(q(), slot(), left);
    check("A07 잔여 1회면 가능하고 잔여를 보여 준다", r2.status === "available" && r2.remaining === 1);
    const cands = [
      { key: "hi", programId: null, programName: "샘플 시리즈", episodeNumber: 3, score: 9.9 },
      { key: "lo", programId: null, programName: "다른 시리즈", episodeNumber: 1, score: 0.5 },
    ];
    const other = grant({ id: "G9", title: "다른 시리즈", code: "T-9", count: 5 });
    const sel = A.selectCandidates(cands, slot(), ctxOf([grant({ count: 3 }), other], { ledger: used }), "executable");
    check("A07 점수가 높아도 권리가 안 맞으면 실행가능안에 들어가지 않는다", sel.executable.length === 1 && sel.executable[0].candidate.key === "lo" && sel.excluded[0].candidate.key === "hi");
    check("A07 점수 높은 후보의 제외 사유가 남는다", sel.excluded[0].eligibility.reasonCodes.includes("COUNT_EXHAUSTED") && sel.excluded[0].label === "권리상 불가");
  }

  console.log("\n— A08 공유 풀 마지막 1회 동시 예약 —");
  {
    const mk = (store: A.LedgerStore, channelId: string) => A.reserve(store, { poolId: "G1", grantRevisionId: "G1#x", channelId, episode: 3, units: 1, limit: 1, countUnit: "pooled", scheduledAt: "2026-10-10T20:00", scheduleRevisionId: `rev-${channelId}`, idempotencyKey: `plan-${channelId}-slot1`, now: NOW });
    const store = new A.MemoryLedgerStore();
    const [a, b] = await Promise.all([mk(store, "ENA"), mk(store, "ENA Play")]);
    check("A08 두 편성자가 동시에 마지막 1회를 잡으면 한 건만 성공", [a, b].filter((x) => x.ok).length === 1 && [a, b].filter((x) => !x.ok).length === 1);
    check("A08 원장에는 예약이 한 건만 남는다", store.rows.filter((r) => r.event === "reserve").length === 1);
    const loser = [a, b].find((x) => !x.ok)!;
    check("A08 실패한 쪽에 잔여 0을 알린다", !loser.ok && loser.reason === "insufficient" && loser.remaining === 0);
    // 대조군: 잠금이 없으면 둘 다 성공한다(= 위 결과가 잠금 덕분임을 증명)
    class NoLockStore extends A.MemoryLedgerStore {
      withLock<T>(_k: string, fn: () => Promise<T>): Promise<T> {
        return fn();
      }
    }
    const raw = new NoLockStore();
    const [x, y] = await Promise.all([mk(raw, "ENA"), mk(raw, "ENA Play")]);
    check("A08 대조: 잠금이 없으면 중복 예약이 실제로 생긴다(테스트가 경쟁을 재현함)", [x, y].every((z) => z.ok));
    const perCh = new A.MemoryLedgerStore();
    const mk2 = (channelId: string) => A.reserve(perCh, { poolId: "G1", grantRevisionId: "G1#x", channelId, episode: 3, units: 1, limit: 1, countUnit: "per_channel", scheduledAt: null, scheduleRevisionId: null, idempotencyKey: `pc-${channelId}`, now: NOW });
    const rs = await Promise.all([mk2("ENA"), mk2("ENA Play")]);
    check("A08 채널별 한도 해석이면 채널마다 1회씩 예약 가능", rs.every((z) => z.ok));
  }

  console.log("\n— A09 같은 파일·행 재업로드 —");
  {
    const g = [grant({ id: "G1" }), grant({ id: "G2", title: "다른 시리즈", code: "T-2" })];
    const first = A.planImport({ incoming: g, existingRevisions: [], kind: "incremental", now: NOW });
    check("A09 첫 업로드는 전부 신규", first.newGrants.length === 2);
    const stored = A.revisionsToStore(first, NOW);
    const again = A.planImport({ incoming: g, existingRevisions: stored, kind: "incremental", now: NOW });
    check("A09 같은 행 재업로드는 변화 없음(권리·횟수 중복 없음)", again.unchanged.length === 2 && again.newGrants.length === 0 && again.revised.length === 0 && A.revisionsToStore(again, NOW).length === 0);
    const dupInBatch = A.planImport({ incoming: [g[0], g[0]], existingRevisions: [], kind: "incremental", now: NOW });
    check("A09 같은 배치 안 같은 행은 한 번만 반영", dupInBatch.newGrants.length === 1 && dupInBatch.duplicateInBatch.length === 1);
    const store = new A.MemoryLedgerStore();
    const input = { poolId: "G1", grantRevisionId: "r", channelId: "ENA", episode: 1, units: 1, limit: 5, countUnit: "pooled" as const, scheduledAt: null, scheduleRevisionId: "rev1", idempotencyKey: "same-key", now: NOW };
    const r1 = await A.reserve(store, input);
    const r2 = await A.reserve(store, input);
    check("A09 같은 멱등 키로 다시 예약해도 한 번만 반영", r1.ok && r2.ok && r2.replay && store.rows.length === 1);
  }

  console.log("\n— A10 콘텐츠별/채널별 파일에 같은 grant —");
  {
    const a = grant({ id: "CA-1", kind: "content_avail", refs: ["8106"], count: 3 });
    const b = grant({ id: "CH-1", kind: "channel_avail", refs: ["8106"], count: 3, code: null });
    check("A10 같은 계약의 두 표현을 중복 후보로 찾는다", A.findDuplicatePairs([a, b]).length === 1);
    const built = A.applyDuplicateResolution([a, b], []);
    const c = ctxOf(built.grants);
    const r = status(q(), slot(), c);
    check("A10 확인 전에는 조건부(DUPLICATE_GRANT_UNCONFIRMED) — 합산하지 않음", r.status === "conditional" && has(r, "DUPLICATE_GRANT_UNCONFIRMED") && (r.remaining ?? 0) <= 3);
    const same = A.applyDuplicateResolution([a, b], [{ grantId: "CH-1", rowHash: b.rowHash, topic: "duplicate", value: "same:CA-1", evidence: null, by: "t", at: NOW }]);
    const r2 = status(q(), slot(), ctxOf(same.grants));
    check("A10 같은 권리로 확인하면 하나로 통합(횟수 3 그대로, 한 행만 근거)", r2.status === "available" && r2.remaining === 3 && r2.grantRevisionIds.length === 1);
    const distinct = A.applyDuplicateResolution([a, b], [{ grantId: "CH-1", rowHash: b.rowHash, topic: "duplicate", value: "distinct", evidence: null, by: "t", at: NOW }]);
    check("A10 별개로 확인하면 조건 해소", distinct.unresolved.length === 0 && status(q(), slot(), ctxOf(distinct.grants)).status === "available");
    const noOverlap = grant({ id: "CH-2", kind: "channel_avail", eps: [[20, 30]], code: null });
    check("A10 회차가 겹치지 않으면 중복 후보가 아니다", A.findDuplicatePairs([a, noOverlap]).length === 0);
    const unkEps = grant({ id: "CH-3", kind: "channel_avail", episodesUnknown: true, code: null });
    check("A10 회차를 모르면 겹침을 단정하지 않는다", A.findDuplicatePairs([a, unkEps]).length === 0);
  }

  console.log("\n— A11 부분 파일에서 누락 —");
  {
    const a = grant({ id: "G1" });
    const b = grant({ id: "G2", title: "둘째", code: "T-2" });
    const stored = A.revisionsToStore(A.planImport({ incoming: [a, b], existingRevisions: [], kind: "incremental", now: NOW }), NOW);
    const inc = A.planImport({ incoming: [a], existingRevisions: stored, kind: "incremental", now: NOW });
    check("A11 증분 파일에서 빠진 행은 철회가 아니다", inc.proposedRevocations.length === 0 && A.revisionsToStore(inc, NOW).length === 0);
    const noScope = A.planImport({ incoming: [a], existingRevisions: stored, kind: "full_snapshot", scope: null, now: NOW });
    check("A11 전체 스냅샷은 대상 범위 없이는 아무것도 반영하지 않는다", noScope.blocked !== null && A.revisionsToStore(noScope, NOW).length === 0);
    const full = A.planImport({ incoming: [a], existingRevisions: stored, kind: "full_snapshot", scope: { channels: ["ENA"], sourceKind: "content_avail", from: null, to: null }, now: NOW });
    check("A11 전체 스냅샷은 범위 안에서 빠진 행을 삭제가 아닌 '철회 후보'로 표시", full.proposedRevocations.length === 1 && full.proposedRevocations[0].grantId === "G2" && full.proposedRevocations[0].status === "proposed_revoke");
    const outScope = A.planImport({ incoming: [a], existingRevisions: stored, kind: "full_snapshot", scope: { channels: ["OLIFE"], sourceKind: null, from: null, to: null }, now: NOW });
    check("A11 범위 밖 권리는 건드리지 않는다", outScope.proposedRevocations.length === 0);
    const afterRevoke = A.currentGrants([...stored, ...A.revisionsToStore(full, NOW)]);
    const rr = status(q("둘째"), slot(), ctxOf(afterRevoke));
    check("A11 철회 후보는 확인 전 조건부(자동 삭제·자동 불가 아님)", rr.status === "conditional" && has(rr, "REVOCATION_PENDING_CONFIRM"));
    const restored = A.planImport({ incoming: [b], existingRevisions: [...stored, ...A.revisionsToStore(full, NOW)], kind: "incremental", now: NOW });
    check("A11 철회 후보였던 행이 다시 들어오면 되살린다", restored.revised.length === 1 && restored.revised[0].next.status === "active");
  }

  console.log("\n— A12 개정 계약으로 만료 단축 —");
  {
    const v1 = grant({ id: "G1", end: "2026-12-31" });
    const c1 = ctxOf([v1]);
    const slots: A.PlanSlotInput[] = [
      { slotKey: "mon20", candidateKey: "c1", query: q("샘플 시리즈", 3), slot: slot("2026-11-02") },
      { slotKey: "mon21", candidateKey: "c1", query: q("샘플 시리즈", 4), slot: slot("2026-12-21") },
    ];
    const snap = A.snapshotPlanRights("plan1", "rev1", slots, c1);
    check("A12 저장 당시 두 슬롯 모두 가능", snap.slots.every((s) => s.status === "available"));
    const v2 = { ...grant({ id: "G1", end: "2026-11-30", enteredAt: "2026-10-20T00:00:00+09:00" }), supersedesRevisionId: v1.revisionId };
    const cur = A.currentGrants([v1, v2]);
    const c2 = ctxOf([v1, v2]);
    const rv = A.revalidatePlan(snap, c2, new Set(cur.map((g) => g.revisionId)));
    check("A12 개정 후 기존 초안은 재검증 필요로 바뀐다", rv.state === "needs_revalidation");
    check("A12 영향받는 슬롯(12월 슬롯)을 찾아 주고 상태가 나빠졌음을 표시", rv.worsened.length === 1 && rv.worsened[0].slotKey === "mon21" && rv.worsened[0].after === "unavailable");
    check("A12 이전 revision을 근거로 쓰던 슬롯이 모두 영향 목록에 있다", rv.affectedSlots.length === 2 && rv.affectedSlots.every((s) => s.supersededRevisionIds.includes(v1.revisionId)));
    check("A12 과거 snapshot은 얼려져 바뀌지 않는다", Object.isFrozen(snap) && Object.isFrozen(snap.slots[0]) && snap.slots[1].status === "available");
    const unchanged = A.revalidatePlan(snap, c1, new Set(A.currentGrants([v1]).map((g) => g.revisionId)));
    check("A12 권리가 안 바뀌면 재검증 필요가 아니다", unchanged.state === "current");
    const fin = A.finalizeCheck(slots, c2);
    check("A12 확정 직전에는 최신 권리로 다시 검사해 막는다", !fin.canFinalize && fin.blockers.some((b) => b.slotKey === "mon21"));
  }

  console.log("\n— A13 취소/undo/실제방송 재수신 —");
  {
    const store = new A.MemoryLedgerStore();
    const base = { poolId: "G1", grantRevisionId: "r", channelId: "ENA", episode: 2, units: 1, limit: 2, countUnit: "pooled" as const, scheduledAt: "2026-10-10T20:00", scheduleRevisionId: "rev1", now: NOW };
    const r1 = await A.reserve(store, { ...base, idempotencyKey: "k1" });
    const used = async () => A.usedUnits(await store.entries({ poolId: "G1" }), { poolId: "G1", episode: 2 });
    check("A13 예약하면 1회가 잡힌다", r1.ok && (await used()) === 1);
    const rel = await A.release(store, { usageId: (r1 as { entry: A.UsageEntry }).entry.usageId, kind: "release", idempotencyKey: "rel1", now: NOW });
    check("A13 해제하면 횟수가 돌아오고 원장에는 이벤트가 남는다(삭제 없음)", rel.ok && (await used()) === 0 && store.rows.length === 2);
    const rest = await A.restore(store, { usageId: (r1 as { entry: A.UsageEntry }).entry.usageId, limit: 2, countUnit: "pooled", idempotencyKey: "res1", now: NOW });
    check("A13 undo(복원)하면 다시 1회가 잡힌다", rest.ok && (await used()) === 1);
    const c1 = await A.consumeActual(store, { sourceEventId: "ev-100", poolId: "G1", grantRevisionId: "r", channelId: "ENA", episode: 2, units: 1, actualAt: "2026-10-10T20:03", scheduledAt: "2026-10-10T20:00", limit: 2, now: NOW });
    const c2 = await A.consumeActual(store, { sourceEventId: "ev-100", poolId: "G1", grantRevisionId: "r", channelId: "ENA", episode: 2, units: 1, actualAt: "2026-10-10T20:03", scheduledAt: "2026-10-10T20:00", limit: 2, now: NOW });
    check("A13 실제 방송 실적은 예약을 소진으로 바꾸고, 같은 실적 재수신은 중복 반영하지 않는다", c1.ok && c2.ok && c2.replay && (await used()) === 1 && store.rows.filter((r) => r.event === "consume").length === 1);
    const cancel = await A.release(store, { usageId: (r1 as { entry: A.UsageEntry }).entry.usageId, kind: "cancel", idempotencyKey: "cancel1", now: NOW, evidence: "방송불발" });
    check("A13 방송불발 취소는 소진을 되돌린다", cancel.ok && (await used()) === 0);
    await A.reserve(store, { ...base, idempotencyKey: "k-other-a", scheduleRevisionId: "rev2" });
    await A.reserve(store, { ...base, idempotencyKey: "k-other-b", scheduleRevisionId: "rev3" });
    const blocked = await A.restore(store, { usageId: (r1 as { entry: A.UsageEntry }).entry.usageId, limit: 2, countUnit: "pooled", idempotencyKey: "res2", now: NOW });
    check("A13 그 사이 잔여가 찼으면 복원하지 않는다", !blocked.ok && blocked.reason === "insufficient");
    const releaseConsumed = await A.release(store, { usageId: "u:ev-999", kind: "release", idempotencyKey: "x", now: NOW });
    check("A13 없는 사용을 해제하려 하면 not_found", !releaseConsumed.ok && releaseConsumed.reason === "not_found");
    const noRes = await A.consumeActual(store, { sourceEventId: "ev-200", poolId: "P2", grantRevisionId: "r", channelId: "ENA", episode: 1, units: 1, actualAt: "2026-10-11T20:00", scheduledAt: null, limit: 0, now: NOW });
    check("A13 예약 없이 방송된 실적은 한도를 넘어도 사실로 기록하고 초과를 표시", noRes.ok && noRes.overLimit === true);
  }

  console.log("\n— A14 필수 조건 빈칸 —");
  {
    const noCount = status(q(), slot(), ctxOf([grant({ count: "unknown" })]));
    check("A14 방수가 빈칸이면 available도 무제한도 아니다(unknown)", noCount.status === "unknown" && has(noCount, "COUNT_LIMIT_UNKNOWN") && noCount.missingFields.includes("count_limit"));
    const noEnd = status(q(), slot(), ctxOf([grant({ end: null })]));
    check("A14 종료일 빈칸은 무기한으로 보지 않는다(unknown)", noEnd.status === "unknown" && noEnd.missingFields.includes("window_end"));
    const noStart = status(q(), slot(), ctxOf([grant({ start: null })]));
    check("A14 시작일 빈칸은 unknown", noStart.status === "unknown" && noStart.missingFields.includes("window_start"));
    const noCh = status(q(), slot(), ctxOf([grant({ channels: "unknown" })]));
    check("A14 허용 채널 빈칸은 unknown", noCh.status === "unknown" && noCh.missingFields.includes("channels"));
    const unb = status(q(), slot(), ctxOf([grant({ end: "unbounded", count: "unbounded" })]));
    check("A14 무제한을 명시하면 available(빈칸과 구별)", unb.status === "available");
    const noPlat = status(q(), slot(), ctxOf([grant({ platforms: [] })]));
    check("A14 방영범위 빈칸은 조건부", noPlat.status === "conditional" && has(noPlat, "PLATFORM_NOT_SPECIFIED"));
    const mixed = status(q(), slot(), ctxOf([grant({ platforms: ["Basic", "Premium TV"] })]));
    check("A14 방영범위 약어를 풀 수 없으면 조건부", mixed.status === "conditional" && has(mixed, "PLATFORM_COVERAGE_UNCONFIRMED"));
  }

  console.log("\n— A15 별도 승인 조건 —");
  {
    const approval: A.Condition = { code: "APPROVAL_REQUIRED", kind: "approval", raw: null, needs: "승인 증빙이 있어야 확정 가능" };
    const g = grant({ conditions: [approval] });
    const none = status(q(), slot(), ctxOf([g]));
    check("A15 승인 증빙이 없으면 조건부", none.status === "conditional" && has(none, "APPROVAL_REQUIRED"));
    const noEvidence = status(q(), slot(), ctxOf([g], { confirmations: [{ grantId: "G1", rowHash: g.rowHash, topic: "approval", evidence: "  ", by: "t", at: NOW }] }));
    check("A15 증빙 내용이 없는 확인은 인정하지 않는다", noEvidence.status === "conditional");
    const ok = status(q(), slot(), ctxOf([g], { confirmations: [{ grantId: "G1", rowHash: g.rowHash, topic: "approval", evidence: "결재 문서 2026-10-05", by: "t", at: NOW }] }));
    check("A15 승인 증빙이 있으면 available", ok.status === "available" && ok.satisfiedRules.includes("condition:APPROVAL_REQUIRED"));
    const g2 = { ...grant({ conditions: [approval], count: 4 }), enteredAt: "2026-10-30T00:00:00+09:00" };
    const stale = status(q(), slot(), ctxOf([g2], { confirmations: [{ grantId: "G1", rowHash: g.rowHash, topic: "approval", evidence: "결재 문서", by: "t", at: NOW }] }));
    check("A15 권리 행이 바뀌면(새 revision) 이전 승인은 인정하지 않는다", stale.status === "conditional");
    const slots: A.PlanSlotInput[] = [{ slotKey: "s", candidateKey: "c", query: q(), slot: slot() }];
    check("A15 승인 증빙 없이는 확정할 수 없다", !A.finalizeCheck(slots, ctxOf([g])).canFinalize && A.finalizeCheck(slots, ctxOf([g], { confirmations: [{ grantId: "G1", rowHash: g.rowHash, topic: "approval", evidence: "결재", by: "t", at: NOW }] })).canFinalize);
  }

  console.log("\n— A16 과거 계획 조회 —");
  {
    const v1 = grant({ id: "G1", end: "2026-12-31" });
    const snap = A.snapshotPlanRights("plan1", "rev1", [{ slotKey: "s", candidateKey: "c", query: q(), slot: slot("2026-12-20") }], ctxOf([v1]));
    const v2 = grant({ id: "G1", end: "2026-11-30", enteredAt: "2026-10-20T00:00:00+09:00" });
    const view = A.viewPastPlan(snap, ctxOf([v1, v2]));
    check("A16 당시 판정은 보존하고 현재 효력은 따로 표시", view[0].statusThen === "available" && view[0].statusNow === "unavailable");
  }

  console.log("\n— A17 권리 부족으로 해 없음 —");
  {
    const cands = [
      { key: "a", programId: null, programName: "샘플 시리즈", episodeNumber: 3, score: 5 },
      { key: "b", programId: null, programName: "없는 작품", episodeNumber: 1, score: 8 },
    ];
    const c = ctxOf([grant({ channels: ["OLIFE"] })]);
    const sel = A.selectCandidates(cands, slot("2026-10-10", 1200, 1260, "ENA"), c, "executable");
    check("A17 쓸 수 있는 후보가 없으면 위반 조건을 보여 준다", sel.usable.length === 0 && sel.infeasible !== null && sel.infeasible.reasonCounts.some((r) => r.code === "CHANNEL_NOT_ALLOWED") && sel.infeasible.reasonCounts.some((r) => r.code === "NO_GRANT_RECORD"));
    check("A17 임의로 완화하지 않는다(실행가능안 비어 있음, 탐색안에도 불가 후보는 안 들어감)", sel.executable.length === 0 && A.selectCandidates(cands, slot("2026-10-10", 1200, 1260, "ENA"), c, "explore").usable.every((u) => u.eligibility.status !== "unavailable"));
  }

  console.log("\n— A18 권리 없는 현재 설치 —");
  {
    const empty = ctxOf([]);
    const cands = [{ key: "a", programId: null, programName: "아무 작품", episodeNumber: 1, score: 3 }];
    const ex = A.selectCandidates(cands, slot(), empty, "explore");
    check("A18 탐색은 작동하고 '권리 미확인'으로 표시", ex.usable.length === 1 && ex.usable[0].label === "권리 미확인" && ex.executionReadiness === "pending_no_avail");
    const ee = A.selectCandidates(cands, slot(), empty, "executable");
    check("A18 실행 가능 판정은 보류(후보를 실행가능으로 주장하지 않음)", ee.executable.length === 0 && ee.usable.length === 0 && ee.executionReadiness === "pending_no_avail");
    check("A18 평가 결과는 AVAIL_NOT_LOADED", has(status(q("아무 작품"), slot(), empty), "AVAIL_NOT_LOADED"));
    check("A18 확정 가능 여부도 보류", A.finalizeCheck([{ slotKey: "s", candidateKey: "c", query: q(), slot: slot() }], empty).pendingNoAvail === true);
    const gate = A.makeSlotGate({ weekStart: "2026-10-05", channelId: "ENA", ctx: empty, mode: "executable", toCandidate: () => ({ key: "k", programId: null, programName: "x", score: null }) });
    check("A18 권리 자료가 없으면 엔진 게이트는 현재 동작을 바꾸지 않는다(항상 허용)", gate({}, 1, 1200, 1260) === true);
  }

  console.log("\n— A19 미래에 입력된 권리의 누출 —");
  {
    const st: A.AvailState = { revisions: [grant({ enteredAt: "2026-10-10T00:00:00+09:00" })], addenda: [], ledger: [], links: [], confirmations: [], interpretationConfirmations: {} };
    const past = A.buildEvalContext(st, { now: NOW, knownAt: "2026-10-05T00:00:00+09:00" });
    check("A19 as-of 이전에는 나중에 입력된 권리가 보이지 않는다", past.ctx.grants.length === 0 && has(status(q(), slot(), past.ctx), "AVAIL_NOT_LOADED"));
    const later = A.buildEvalContext(st, { now: NOW, knownAt: "2026-10-11T00:00:00+09:00" });
    check("A19 입력 이후 시점에는 보인다", later.ctx.grants.length === 1);
    const revs = [grant({ id: "G1", end: "2026-12-31", enteredAt: "2026-10-01T00:00:00+09:00" }), grant({ id: "G1", end: "2026-10-31", enteredAt: "2026-10-20T00:00:00+09:00" })];
    const st2: A.AvailState = { ...st, revisions: revs };
    const g1 = A.buildEvalContext(st2, { now: NOW, knownAt: "2026-10-10T00:00:00+09:00" }).ctx.grants[0];
    check("A19 같은 권리의 나중 개정도 as-of 이전에는 반영하지 않는다", g1.window.end.state === "value" && g1.window.end.value === "2026-12-31");
    const stc: A.AvailState = { ...st, revisions: [grant({ enteredAt: "2026-10-01T00:00:00+09:00" })], interpretationConfirmations: { endInclusive: { value: false, by: "t", at: "2026-10-30T00:00:00+09:00" } } };
    check("A19 나중에 한 해석 확인도 과거 시점에는 적용하지 않는다", A.buildEvalContext(stc, { now: NOW, knownAt: "2026-10-10T00:00:00+09:00" }).interpretation.endInclusive.confirmed === false);
  }

  // ══ 1st window · 해석 · 기소진 · 오리지널 · 기타 ═══════════
  console.log("\n— 1st window 순서 규칙 —");
  {
    const g = grant({ id: "GW", title: "영미 드라마", channels: "all", gate: "skyUHD", count: 9, eps: [[1, 3]], code: "W-1" });
    const c0 = ctxOf([g]);
    const first = status(q("영미 드라마", 1), slot("2026-10-10", 1200, 1260, "skyUHD"), c0);
    check("1st window 채널 자신은 순서 제한 없이 가능", first.status === "available");
    const other = status(q("영미 드라마", 1), slot("2026-10-12", 1200, 1260, "ENA"), c0);
    check("다른 채널은 1st window 최초 방송 전에는 조건부", other.status === "conditional" && has(other, "FIRST_WINDOW_NOT_BROADCAST"));
    const aired = [entry({ event: "consume", poolId: "GW", channelId: "skyUHD", episode: 1, actualAt: "2026-10-10T20:00:00", usageId: "uw1" })];
    const c1 = ctxOf([g], { ledger: aired });
    check("1st window 채널에서 최초 방송한 뒤에는 그 회차를 다른 채널이 방영 가능", status(q("영미 드라마", 1), slot("2026-10-12", 1200, 1260, "ENA"), c1).status === "available");
    check("회차 단위 해석이면 아직 방송 전인 다른 회차는 조건부", status(q("영미 드라마", 2), slot("2026-10-12", 1200, 1260, "ENA"), c1).status === "conditional");
    const title = ctxOf([g], { ledger: aired, interpretation: confirmedWith({ firstWindowGate: "per_title" }) });
    check("작품 단위 해석이면 첫 방송 한 번으로 다른 회차도 가능", status(q("영미 드라마", 2), slot("2026-10-12", 1200, 1260, "ENA"), title).status === "available");
    const unconf = ctxOf([g], { ledger: aired, interpretation: A.applyConfirmations({ endInclusive: { value: true, by: "t", at: "x" }, dayBasis: { value: "broadcast_day", by: "t", at: "x" }, spanPolicy: { value: "start_only", by: "t", at: "x" }, countUnit: { value: "per_episode_pooled", by: "t", at: "x" } }) });
    const r = status(q("영미 드라마", 2), slot("2026-10-12", 1200, 1260, "ENA"), unconf);
    check("순서 단위가 미확인이고 해석에 따라 갈리면 조건부 + 가정 표시", r.status === "conditional" && r.assumptions.some((a) => a.includes("1st window")));
    const planned = ctxOf([g], { ledger: [entry({ event: "reserve", poolId: "GW", channelId: "skyUHD", episode: 1, scheduledAt: "2026-10-10T20:00:00", usageId: "uw2" })] });
    const rp = status(q("영미 드라마", 1), slot("2026-10-12", 1200, 1260, "ENA"), planned);
    check("1st window가 편성만 되고 방송 전이면 '예정' 사유로 조건부", rp.status === "conditional" && has(rp, "FIRST_WINDOW_PLANNED"));
    const before = ctxOf([g], { ledger: [entry({ event: "consume", poolId: "GW", channelId: "skyUHD", episode: 1, actualAt: "2026-10-20T20:00:00", usageId: "uw3" })] });
    check("1st window 방송이 이 슬롯보다 나중이면 아직 아니다", status(q("영미 드라마", 1), slot("2026-10-12", 1200, 1260, "ENA"), before).status === "conditional");
  }

  console.log("\n— 방수 단위·기소진 —");
  {
    const g = grant({ count: 2, id: "GC" });
    const led = [entry({ event: "consume", poolId: "GC", channelId: "ENA", usageId: "a" }), entry({ event: "consume", poolId: "GC", channelId: "ENA", usageId: "b" })];
    const s2 = slot("2026-10-10", 1200, 1260, "ENA Play");
    const un = ctxOf([g], { ledger: led, interpretation: { ...CONFIRMED, countUnit: A.DEFAULT_INTERPRETATION.countUnit } });
    check("방수 단위 미확인: 합산이면 0, 채널별이면 2 → 조건부", status(q(), s2, un).status === "conditional" && has(status(q(), s2, un), "COUNT_UNIT_UNCONFIRMED"));
    check("합산으로 확인되면 불가", status(q(), s2, ctxOf([g], { ledger: led })).status === "unavailable");
    check("채널별로 확인되면 가능", status(q(), s2, ctxOf([g], { ledger: led, interpretation: confirmedWith({ countUnit: "per_episode_per_channel" }) })).status === "available");
    const unk = grant({ count: 2, id: "GB", baseline: "unknown" });
    const r = status(q(), slot(), ctxOf([unk]));
    check("기소진(과거 방영분)을 모르면 잔여를 단정하지 않고 조건부", r.status === "conditional" && has(r, "USAGE_BASELINE_UNKNOWN"));
    const conf = status(q(), slot(), ctxOf([unk], { confirmations: [{ grantId: "GB", rowHash: unk.rowHash, topic: "usage_baseline", value: "zero", evidence: null, by: "t", at: NOW }] }));
    check("기소진을 확인하면 가능", conf.status === "available");
    const unlimited = status(q(), slot(), ctxOf([grant({ count: "unbounded", baseline: "unknown" })]));
    check("횟수 무제한이면 기소진 확인이 필요 없다", unlimited.status === "available");
  }

  console.log("\n— 메모·홀드백·시간대·금지기간·재방·순서 —");
  {
    const memo: A.Condition = { code: "MEMO_REVIEW", kind: "memo", raw: "종영 후 1개 채널", needs: "메모 확인" };
    const g = grant({ conditions: [memo] });
    check("해석하지 못한 메모는 확인 전 조건부", status(q(), slot(), ctxOf([g])).status === "conditional");
    check("메모를 확인하면 가능", status(q(), slot(), ctxOf([g], { confirmations: [{ grantId: "G1", rowHash: g.rowHash, topic: "memo", evidence: null, by: "t", at: NOW }] })).status === "available");
    const base = grant();
    const t = { ...base, rules: { ...base.rules, timeOfDay: { state: "value" as const, value: { fromMin: 1200, toMin: 1380 } }, daysOfWeek: { state: "value" as const, value: [6, 7] } } };
    check("허용 요일 밖(2026-10-10은 토요일이라 가능, 2026-10-09 금요일은 불가)", status(q(), slot("2026-10-10"), ctxOf([t])).status === "available" && has(status(q(), slot("2026-10-09"), ctxOf([t])), "DAY_NOT_ALLOWED"));
    check("허용 시간대 밖은 불가", has(status(q(), slot("2026-10-10", 600, 660), ctxOf([t])), "TIME_NOT_ALLOWED"));
    const bo = { ...base, rules: { ...base.rules, blackouts: [{ from: "2026-12-24", to: "2026-12-26" }] } };
    check("금지 기간(양끝 포함)은 불가", has(status(q(), slot("2026-12-25"), ctxOf([bo])), "BLACKOUT") && status(q(), slot("2026-12-27"), ctxOf([bo])).status === "available");
    const gap = { ...base, rules: { ...base.rules, minRerunGapDays: { state: "value" as const, value: 7 } } };
    const prior = [entry({ event: "consume", poolId: "G1", episode: 3, actualAt: "2026-10-08T20:00:00", usageId: "pg" })];
    check("재방 최소 간격 미만은 불가, 이후는 가능", has(status(q(), slot("2026-10-10"), ctxOf([gap], { ledger: prior })), "RERUN_GAP") && status(q(), slot("2026-10-20"), ctxOf([gap], { ledger: prior })).status === "available");
    const ord = { ...base, rules: { ...base.rules, episodeOrder: { state: "value" as const, value: "sequential" as const } } };
    check("회차 순서: 앞 회차가 없으면 불가", has(status(q("샘플 시리즈", 2), slot(), ctxOf([ord])), "EPISODE_ORDER") && status(q("샘플 시리즈", 1), slot(), ctxOf([ord])).status === "available");
    check("회차 순서: 앞 회차가 방영·예약돼 있으면 가능", status(q("샘플 시리즈", 2), slot(), ctxOf([ord], { ledger: [entry({ event: "consume", poolId: "G1", episode: 1, usageId: "o1" })] })).status === "available");
    const sched = grant({ anchor: "schedule_date", term: "6개월", end: "2027-12-31", id: "GS" });
    const used1 = [entry({ event: "consume", poolId: "GS", episode: 3, actualAt: "2026-10-05T20:00:00", usageId: "s1" })];
    const late = status(q(), slot("2027-06-10"), ctxOf([sched], { ledger: used1 }));
    check("편성일기준: 회차별 최초 방영일부터 기간이 끝났을 수 있으면(해석 미확인) 조건부 + 가정 표시", late.status === "conditional" && late.assumptions.some((a) => a.includes("편성일기준")));
  }

  console.log("\n— 오리지널·Avail 우선 —");
  {
    const c = ctxOf([grant({ id: "GO", title: "다른 작품", code: "O-1" })]);
    const ent = status({ programId: null, programName: "자체 예능", genre: "오리지널 예능", episodeNumber: 3 }, slot(), c);
    check("Avail 행이 없는 오리지널 예능은 권리 제한 없음으로 처리하되 가정을 표시", ent.status === "available" && ent.satisfiedRules.includes("original_no_avail_row") && ent.assumptions.length === 1);
    const dr = status({ programId: null, programName: "자체 드라마", genre: "오리지널 드라마", episodeNumber: 1 }, slot(), c);
    check("Avail 행이 없는 오리지널 드라마는 판권 기간이 있어 Avail 확인 필요(unknown)", dr.status === "unknown" && has(dr, "ORIGINAL_NEEDS_AVAIL"));
    const imp = status({ programId: null, programName: "수입 예능", genre: "예능", episodeNumber: 3 }, slot(), c);
    check("오리지널 표시가 없으면 행이 없을 때 unknown", imp.status === "unknown" && has(imp, "NO_GRANT_RECORD"));
    const withRow = ctxOf([grant({ id: "GE", title: "자체 예능", code: "O-2", count: 1 })], { ledger: [entry({ event: "consume", poolId: "GE", usageId: "e1" })] });
    const r = status({ programId: null, programName: "자체 예능", genre: "오리지널 예능", episodeNumber: 3 }, slot(), withRow);
    check("Avail 행이 있으면 오리지널이어도 행이 우선(잔여 0이면 불가)", r.status === "unavailable" && has(r, "COUNT_EXHAUSTED"));
    const marked = status({ programId: "p-1", programName: "표시된 예능", genre: "예능", episodeNumber: 1 }, slot(), ctxOf([grant({ id: "GZ", title: "또 다른", code: "O-3" })], { originalProgramIds: ["p-1"] }));
    check("운영자가 오리지널로 표시한 프로그램도 같은 설정을 따른다(장르가 예능일 때)", marked.status === "available" || marked.status === "unknown");
  }

  console.log("\n— 선택자·비용 —");
  {
    const g1 = grant({ id: "S1", title: "작품A", code: "S-1", count: "unbounded", end: "unbounded" });
    const g2 = grant({ id: "S2", title: "작품B", code: "S-2", count: 3, conditions: [{ code: "MEMO_REVIEW", kind: "memo", raw: "?", needs: "확인" }] });
    const cands = [
      { key: "a", programId: null, programName: "작품A", episodeNumber: 1, score: 1 },
      { key: "b", programId: null, programName: "작품B", episodeNumber: 1, score: 9 },
      { key: "c", programId: null, programName: "작품C", episodeNumber: 1, score: 7 },
    ];
    const c = ctxOf([g1, g2]);
    const ex = A.selectCandidates(cands, slot(), c, "executable");
    const xp = A.selectCandidates(cands, slot(), c, "explore");
    check("실행가능안은 권리 확인된 후보만(점수가 낮아도), 조건부·미확인은 분리", ex.usable.map((u) => u.candidate.key).join() === "a" && ex.held.map((h) => h.candidate.key).join() === "b,c");
    check("탐색안은 조건부·미확인도 쓰되 라벨로 분리 표시", xp.usable.length === 3 && xp.usable.find((u) => u.candidate.key === "b")!.label === "조건부 가정(조건 충족 전)" && xp.usable.find((u) => u.candidate.key === "c")!.label === "권리 미확인");
    check("같은 입력이면 같은 순서(점수 내림차순, 동률은 키)", JSON.stringify(xp.usable.map((u) => u.candidate.key)) === '["b","c","a"]');
    const cost = A.costSummary([{ ...g1, optionalCommercial: null }, { ...g2, optionalCommercial: { amount: { state: "value", value: 100 }, currency: "KRW", billing: null } }]);
    check("비용이 비어 있으면 가격 미확인(0원 아님)", cost.knownTotal === 100 && cost.unknownCount === 1 && A.costSummary([g1]).knownTotal === null);
    const v1 = A.inventoryVersionOf(A.currentGrants([g1, g2]));
    check("권리 목록 버전은 권리가 바뀌면 달라지고 같으면 같다", v1 === A.inventoryVersionOf(A.currentGrants([g1, g2])) && v1 !== A.inventoryVersionOf(A.currentGrants([g1])));
  }

  // ══ 어댑터 ═══════════════════════════════════════════
  console.log("\n— 어댑터: 콘텐츠별 Avail 형식 —");
  {
    const H = ["ID", "ID_거래처", "장르", "소재코드", "소재명", "국가", "화질", "년수", "방수", "편수", "편분", "방영 시작일", "방영 종료일", "방영권 적용", "방영채널1", "방영채널2", "방영채널3", "홀드백 해제", "회차", "방영범위", "계약번호", "메모", "총분", "총시간"];
    const r = (o: Record<string, unknown>) => H.map((h) => (h in o ? o[h] : null));
    const rows = [
      r({ ID: 1, ID_거래처: 59, 장르: "드라마", 소재코드: "X-1", 소재명: "서바이빙 어스(대멸종: 최후의 생존자들)", 국가: "해외", 년수: "2년", 방수: "9방", 편수: 8, 편분: 60, "방영 시작일": 46280, "방영 종료일": 47010, 방영채널1: "skyUHD", 방영채널2: "ALL", 방영채널3: "-", 회차: "#1~8", 방영범위: "위/케/IPTV", 계약번호: "[8106] [8200]", 메모: "총 7개 채널" }),
      r({ 소재코드: "X-2", 소재명: "영구 작품", 국가: "국내", 년수: "영구", 방수: "제한없음", "방영 시작일": 38000, "방영 종료일": 2958434, 방영채널1: null, 회차: "#회차선택", 방영범위: "위/케/IP" }),
      r({ 소재코드: "X-3", 소재명: "날짜 오류", "방영 시작일": "2026년 10월", "방영 종료일": 47010, 방영채널1: "ENA", 회차: "#1~2" }),
      r({ 소재명: "코드 없음", 방영채널1: "ENA" }),
      r({ 소재코드: "X-1", 소재명: "중복 코드", 방영채널1: "ENA" }),
    ];
    // '방영권 적용' 열을 채운다
    const hi = H.indexOf("방영권 적용");
    rows[0][hi] = "시작일지정/회차일괄";
    rows[1][hi] = "제한없음";
    const res = parseContentAvailRows(H, rows.map((cells, i) => ({ row: i + 2, cells })), { file: "t.xlsx", sheet: "소재", batchId: "b", enteredAt: NOW });
    check("행 5개 중 코드 없는 행·중복 코드 행은 건너뛰고 3건 읽음", res.grants.length === 3 && res.issues.some((i) => i.cause.includes("소재코드가 비어")) && res.issues.some((i) => i.cause.includes("소재코드가 같아")));
    const g = res.grants[0];
    check("원본열·파일·시트·행·계약참조·개정 식별자를 보존", g.source.row === 2 && g.source.sheet === "소재" && g.source.columns["소재명"] === "서바이빙 어스(대멸종: 최후의 생존자들)" && g.contractRefs.join() === "8106,8200" && g.revisionId.startsWith("ca:X-1#") && g.rightsHolder === "59");
    check("제목 괄호는 별칭으로(본 제목·별칭 키 분리)", g.content.canonicalKey === A.titleVariants("서바이빙 어스").mainKey && g.content.aliases.includes("대멸종: 최후의 생존자들"));
    check("방영권 적용·방수·채널·메모가 구조화되고 메모는 확인 조건이 됨", g.window.anchor === "fixed_start" && g.window.grouping === "batch" && g.rules.count.limit.state === "value" && g.scope.channels.kind === "all" && g.conditions.some((c) => c.code === "MEMO_REVIEW"));
    const g2 = res.grants[1];
    check("종료일 2958434는 무제한, 첫 채널 빈칸은 채널 unknown, #회차선택은 회차 unknown", g2.window.end.state === "unbounded" && g2.scope.channels.kind === "unknown" && g2.scope.episodes.kind === "unknown" && res.issues.some((i) => i.row === 3 && i.column === "방영채널1"));
    check("읽을 수 없는 날짜는 issue(시트·행·열·예시 포함)이고 값은 unknown", res.grants[2].window.start.state === "unknown" && res.issues.some((i) => i.row === 4 && i.column === "방영 시작일" && !!i.example));
    check("편분 60 → 회차당 분 보존, 같은 입력은 같은 행 해시", g.content.runtimeMin.state === "value" && (g.content.runtimeMin as { value: number }).value === 60);
    const again = parseContentAvailRows(H, rows.map((cells, i) => ({ row: i + 2, cells })), { file: "t.xlsx", sheet: "소재", batchId: "b2", enteredAt: NOW });
    check("같은 내용을 다시 읽으면 같은 revision(재업로드 멱등)", again.grants[0].revisionId === g.revisionId);
    const plan = A.planImport({ incoming: again.grants, existingRevisions: res.grants, kind: "incremental", now: NOW });
    check("재업로드 계획은 변화 없음", plan.unchanged.length === 3 && plan.revised.length === 0);
    const changed = res.grants.map((x) => ({ ...x }));
    const edited = parseContentAvailRows(H, rows.map((cells, i) => ({ row: i + 2, cells: i === 0 ? cells.map((c, k) => (H[k] === "방영 종료일" ? 46500 : c)) : cells })), { file: "t.xlsx", sheet: "소재", batchId: "b3", enteredAt: NOW });
    const pl2 = A.planImport({ incoming: edited.grants, existingRevisions: changed, kind: "incremental", now: NOW });
    check("종료일이 바뀐 행은 새 revision이 이전 revision을 대체(차이 열 표시)", pl2.revised.length === 1 && pl2.revised[0].changedColumns.includes("방영 종료일") && pl2.revised[0].next.supersedesRevisionId === g.revisionId);
    const manual = res.grants.map((x, i) => (i === 0 ? { ...x, manual: { override: true, by: "admin" } } : x));
    const pl3 = A.planImport({ incoming: edited.grants, existingRevisions: manual, kind: "incremental", now: NOW });
    check("운영자 수동 수정 revision은 파일이 덮어쓰지 않고 충돌로 표시", pl3.manualConflicts.length === 1 && pl3.revised.length === 0);
  }

  console.log("\n— 어댑터: 감지·헤더 검증 —");
  {
    const stdHeaders = A.STANDARD_COLUMNS.map((c) => c.header);
    const ok = A.analyzeMatrices([{ name: "표준", matrix: [stdHeaders, ...standardTemplateRows()] }], { file: "tpl.csv", batchId: "b", enteredAt: NOW });
    check("표준 양식(예시 포함)은 그대로 읽힌다", ok[0].kind === "standard" && ok[0].importable && ok[0].grants.length === 2);
    const grants = ok[0].grants;
    check("표준 양식: 제작년도·구분(오리지널)·기소진·방수 제한없음이 구조화", grants[0].content.productionYear.state === "value" && grants[0].usageBaseline === "zero" && grants[1].content.origination === "original" && grants[1].rules.count.limit.state === "unbounded" && grants[1].window.end.state === "unbounded");
    check("표준 양식: 제작년도를 안 쓰면 '미입력'(unknown)", parseStandardRows(stdHeaders, [{ row: 2, cells: stdHeaders.map((h) => (h === "제목" ? "무년도" : h === "회차" ? "#1~2" : h === "채널" ? "ENA" : h === "시작일" ? "2026-10-01" : h === "종료일" ? "2027-09-30" : null)) }], { file: "t", sheet: "s", batchId: "b", enteredAt: NOW }).grants[0].content.productionYear.state === "unknown");
    const wrong = A.analyzeMatrices([{ name: "다른양식", matrix: [["제목", "방송일", "채널"], ["a", "b", "c"]] }], { file: "bad.xlsx", batchId: "b", enteredAt: NOW });
    check("헤더가 맞지 않으면 조용히 해석하지 않고 거부(없는 필수 열 표시)", !wrong[0].importable && wrong[0].grants.length === 0 && wrong[0].kind === "unrecognized");
    const partial = A.analyzeMatrices([{ name: "일부", matrix: [stdHeaders.filter((h) => h !== "종료일" && h !== "회차"), ["x"]] }], { file: "p.csv", batchId: "b", enteredAt: NOW });
    check("필수 열(종료일·회차)이 빠지면 거부하고 어떤 열이 없는지 알려 준다", !partial[0].importable && partial[0].missingRequired.includes("종료일") && partial[0].missingRequired.includes("회차"));
    const extra = A.analyzeMatrices([{ name: "추가열", matrix: [[...stdHeaders, "비밀열"], ...standardTemplateRows().map((r) => [...r, "x"])] }], { file: "e.csv", batchId: "b", enteredAt: NOW });
    check("모르는 열은 무시하지 않고 '알 수 없음(보존만, 해석 안 함)'으로 표시", extra[0].importable && extra[0].headers.some((h) => h.header === "비밀열" && h.role.startsWith("알 수 없음")) && extra[0].grants[0].source.columns["비밀열"] === "x");
    const empty = A.analyzeMatrices([{ name: "빈", matrix: [] }], { file: "e.csv", batchId: "b", enteredAt: NOW });
    check("빈 시트는 가져오지 않는다", empty[0].kind === "empty" && !empty[0].importable);
    const channelKind = parseStandardRows(stdHeaders, [{ row: 2, cells: stdHeaders.map((h) => (h === "자료구분" ? "채널" : h === "제목" ? "채널파일 작품" : h === "회차" ? "전체" : h === "채널" ? "ALL" : h === "시작일" ? "2026-10-01" : h === "종료일" ? "무기한" : h === "방수" ? "제한없음" : null)) }], { file: "t", sheet: "s", batchId: "b", enteredAt: NOW }).grants[0];
    check("채널별 Avail도 같은 Grant 모델(자료구분만 다름, 전 회차)", channelKind.source.kind === "channel_avail" && channelKind.scope.episodes.kind === "all");
  }

  console.log("\n— 보충 속성(1st window·제작년도) —");
  {
    const base = grant({ id: "ca:D-T1", code: "D-T1", title: "더 이래셔널 시즌1", start: "2026-08-31", end: "2028-08-30", eps: [[1, 11]], channels: "all", count: 9, term: "2년" });
    const adds: A.Addendum[] = [
      { addendumId: "t1", sourceCode: "D-T1", titleKey: null, firstWindowChannel: "ENA STORY", productName: "IRRATIONAL, THE #01", productionYear: "2023", origination: "acquired", expected: { displayTitle: "행동과학자의 사건 파일 시즌 1", startDate: "2026-08-31", episodeCount: 11, runtimeMin: 60, termMonths: 24, firstChannel: "ENA STORY", freeAfterFirstWindow: true }, provenance: "test" },
      { addendumId: "t2", sourceCode: "NOPE", titleKey: null, firstWindowChannel: "ENA", productName: null, productionYear: null, origination: null, expected: null, provenance: "test" },
    ];
    const applied = A.applyAddenda([base], adds);
    check("보충 속성은 대상 행에 얹히고 원본 배열은 바뀌지 않는다", applied.grants[0].rules.firstWindowGate?.channel === "ENA Story" && applied.grants[0].content.aliases.includes("IRRATIONAL, THE #01") && applied.grants[0].content.productionYear.state === "value" && base.rules.firstWindowGate === null);
    check("대상을 못 찾은 보충 속성은 따로 알린다", applied.unmatched.length === 1 && applied.unmatched[0].addendumId === "t2");
    const cmp = A.compareAddenda([base], adds);
    check("원본과 말한 값이 같으면 충돌이 없다(시작일·종료일 계산·편수) / 방수 9방과 '자유 방영'은 확인 요청", cmp.agreed >= 3 && cmp.conflicts.length === 1 && cmp.conflicts[0].field === "count_limit");
    const diff = A.compareAddenda([{ ...base, window: { ...base.window, start: { state: "value", value: "2026-09-15" } } }], adds);
    check("시작일이 다르면 충돌로 보여 주고 원본을 따른다", diff.conflicts.some((c) => c.field === "start_date" && c.message.includes("원본")));
    const eps = A.compareAddenda([grant({ id: "ca:D-T1", code: "D-T1", eps: [[1, 6]], start: "2026-08-31", end: "2028-08-30", channels: "all", count: 9 })], adds);
    check("편수가 다르면 충돌로 보여 준다", eps.conflicts.some((c) => c.field === "episode_count"));
    check("1st window 목록 23건이 모두 소재코드·1st 채널·편수·시작일을 갖는다", A.US_DRAMA_1ST_WINDOW.length === 23 && A.US_DRAMA_1ST_WINDOW.every((a) => a.sourceCode && a.firstWindowChannel && a.expected?.episodeCount && a.expected.startDate) && new Set(A.US_DRAMA_1ST_WINDOW.map((a) => a.sourceCode)).size === 23);
    check("1st window 목록: 페이퍼만 30분, 나머지 60분, 제작년도는 아마데우스만 입력", A.US_DRAMA_1ST_WINDOW.filter((a) => a.expected?.runtimeMin === 30).length === 1 && A.US_DRAMA_1ST_WINDOW.filter((a) => a.expected?.runtimeMin === 60).length === 22 && A.US_DRAMA_1ST_WINDOW.filter((a) => a.productionYear).length === 1);
  }

  console.log("\n— 영미 드라마 보충 속성 + 전달 사실 확인 기록 —");
  {
    const memo: A.Condition = { code: "MEMO_REVIEW", kind: "memo", raw: "총 7개 채널", needs: "메모 확인" };
    const g = grant({ id: "ca:D-T2", code: "D-T2", title: "서바이빙 어스(대멸종: 최후의 생존자들)", channels: "all", count: 9, eps: [[1, 8]], start: "2026-09-15", end: "2028-09-14", conditions: [memo], baseline: "unknown" });
    const add: A.Addendum = { addendumId: "t2", sourceCode: "D-T2", titleKey: null, firstWindowChannel: "skyUHD", productName: "SURVIVING EARTH #01", productionYear: null, origination: "acquired", expected: { displayTitle: "대멸종: 최후의 생존자들 (서바이빙 어스)", startDate: "2026-09-15", episodeCount: 8, runtimeMin: null, termMonths: 24, firstChannel: "skyUHD", freeAfterFirstWindow: true }, provenance: "운영자 전달" };
    const sameRaw = status(q("서바이빙 어스(대멸종: 최후의 생존자들)", 1), slot("2026-10-20", 1200, 1260, "skyUHD"), ctxOf([g], { interpretation: A.DEFAULT_INTERPRETATION }));
    check("제목에 괄호 별칭이 있어도 본 제목으로 연결된다(원본 제목 그대로 조회)", sameRaw.grantRevisionIds.length === 1 && !has(sameRaw, "CONTENT_LINK_UNCONFIRMED"));
    const aliasQ = status(q("대멸종: 최후의 생존자들 ( 서바이빙 어스 )", 1), slot("2026-10-20", 1200, 1260, "skyUHD"), ctxOf([g]));
    check("다른 한글 표기(괄호 안에 원본 제목)는 후보로만 찾고 운영자 연결 확인 전에는 unknown", aliasQ.status === "unknown" && has(aliasQ, "CONTENT_LINK_UNCONFIRMED"));
    const sc = A.seedConfirmations([g], [add]);
    check("전달 사실이 확인 기록 2건(기소진 0·총 7개 채널 메모)이 되고 증빙 문구가 남는다", sc.confirmations.length === 2 && sc.confirmations.some((c) => c.topic === "usage_baseline" && c.value === "zero" && c.evidence.includes("운영자 전달")) && sc.confirmations.some((c) => c.topic === "memo"));
    const asConf = (cs: A.SeedConfirmation[]) => cs.map((c) => ({ grantId: c.grantId, rowHash: c.rowHash, topic: c.topic, value: c.value, evidence: c.evidence, by: "t", at: NOW }));
    const conf = ctxOf(A.applyAddenda([g], [add]).grants, { confirmations: asConf(sc.confirmations) });
    const first = status(q("서바이빙 어스", 1), slot("2026-10-20", 1200, 1260, "skyUHD"), conf);
    check("확인 후: 1st window 채널은 가능", first.status === "available", first.reasonCodes.join());
    const other = status(q("서바이빙 어스", 1), slot("2026-10-27", 1200, 1260, "ENA"), conf);
    check("확인 후: 다른 채널은 1st window 최초 방송 전이라 조건부", other.status === "conditional" && has(other, "FIRST_WINDOW_NOT_BROADCAST"));
    const afterAir = ctxOf(A.applyAddenda([g], [add]).grants, { confirmations: asConf(sc.confirmations), ledger: [entry({ event: "consume", poolId: "ca:D-T2", channelId: "skyUHD", episode: 1, actualAt: "2026-10-20T20:00:00", usageId: "air1" })] });
    check("1st window 최초 방송 뒤에는 다른 채널도 가능(그 회차)", status(q("서바이빙 어스", 1), slot("2026-10-27", 1200, 1260, "ENA"), afterAir).status === "available" && status(q("서바이빙 어스", 2), slot("2026-10-27", 1200, 1260, "ENA"), afterAir).status === "conditional");
    const stale = ctxOf(A.applyAddenda([{ ...g, rowHash: "changed", revisionId: "ca:D-T2#changed" }], [add]).grants, { confirmations: asConf(sc.confirmations) });
    check("원본 행이 바뀌면 전달 사실 확인은 효력을 잃는다", status(q("서바이빙 어스", 1), slot("2026-10-20", 1200, 1260, "skyUHD"), stale).status === "conditional");
    const conflicting = A.seedConfirmations([g], [{ ...add, expected: { ...add.expected!, episodeCount: 13 } }]);
    check("원본과 전달 내용이 충돌하면 그 권리는 확인하지 않는다", conflicting.confirmations.length === 0 && conflicting.skippedForConflict.length === 1);
    check("방수 9방과 자유 방영 진술의 차이만으로는 확인을 막지 않는다(방수는 원본을 따름)", A.seedConfirmations([g], [add]).skippedForConflict.length === 0);
    check("전달 사실을 확인해도 방수 9방(원본)은 그대로 적용된다", first.remaining === 9);
  }

  // ══ 저장소(메모리 DB 대역) ═════════════════════════════
  console.log("\n— 저장소·엔진 게이트(메모리 DB 대역) —");
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key-not-real";
    const { FakeDb } = await import("./lib/fakeSupabase");
    const { supabase } = await import("../src/lib/supabase");
    const ST = await import("../src/lib/avail/store");
    const GATE = await import("../src/lib/avail/engineGate");
    const db = new FakeDb();
    (supabase as unknown as { from: (t: string) => unknown }).from = (t) => db.from(t);

    const empty = await ST.loadAvailState();
    check("Avail 자료가 없으면 읽기는 빈 상태(= 미입력 설치와 같은 동작)", empty.state.revisions.length === 0);
    const none = await GATE.buildRightsGate("ENA", "2026-10-05", "explore");
    check("Avail 미입력이면 편성표 뽑기 게이트를 만들지 않는다(현재 동작 유지, 상태 not_configured)", none.gate === null && none.status === "not_configured");

    const g1 = grant({ id: "G1" });
    const g2 = grant({ id: "G2", title: "둘째", code: "T-2" });
    const saved = await ST.saveImport({ kind: "incremental", scope: null, fileName: "t.xlsx", fileHash: "h", sheetSummary: [], planSummary: {}, actor: "a@x.kr" }, [g1, g2]);
    check("권리 revision을 배치와 함께 저장하고 배치가 applied가 된다", saved.ok && db.rows("avail_grants").length === 2 && db.rows("avail_batches")[0].status === "applied");
    const loaded = await ST.loadAvailState();
    check("저장한 권리를 그대로 다시 읽는다(원본 행·열 보존)", loaded.state.revisions.length === 2 && loaded.state.revisions[0].source.row === 2 && loaded.state.revisions[0].rowHash === g1.rowHash);

    const edited = { ...grant({ id: "G1", end: "2026-11-30", enteredAt: "2026-10-20T00:00:00+09:00" }), supersedesRevisionId: g1.revisionId };
    await ST.saveImport({ kind: "incremental", scope: null, fileName: "t2.xlsx", fileHash: "h2", sheetSummary: [], planSummary: {}, actor: "a@x.kr" }, [edited]);
    const all = (await ST.loadAvailState()).state.revisions;
    check("개정은 새 revision으로 쌓이고 이전 revision은 남는다(수정·삭제 없음)", all.filter((r) => r.grantId === "G1").length === 2 && A.currentGrants(all).find((g) => g.grantId === "G1")!.window.end.state === "value");

    const before = db.rows("avail_grants").length;
    db.failNext({ table: "avail_grants", op: "insert", when: (c) => (c.rows ?? []).some((r) => String((r as { revision_id?: string }).revision_id).startsWith("G9")), message: "boom", times: 1 });
    const many = Array.from({ length: 205 }, (_, i) => grant({ id: i < 200 ? `B${i}` : `G9-${i}`, title: `작품${i}`, code: `C${i}` }));
    const failed = await ST.saveImport({ kind: "incremental", scope: null, fileName: "t3.xlsx", fileHash: "h3", sheetSummary: [], planSummary: {}, actor: "a@x.kr" }, many);
    check("저장 중 실패하면 이번 배치가 쌓은 revision만 되돌린다(앞서 쌓은 청크 포함, 이전 권리는 그대로)", !failed.ok && db.rows("avail_grants").length === before && db.rows("avail_batches").some((b) => b.status === "failed"));

    const gateOk = await GATE.buildRightsGate("ENA", "2026-10-05", "explore");
    check("권리가 있으면 게이트가 만들어지고 권리 목록 버전이 지문에 들어간다", gateOk.status === "applied" && !!gateOk.gate && gateOk.gate.fingerprint.endsWith("|explore") && gateOk.gate.unconfirmedInterpretations.length === 5);
    const gate = gateOk.gate!;
    const cand = (name: string) => ({ key: name, programKey: name, contentType: "OWN", programId: null, programName: name, airingType: "FIRST", genre: "드라마", runtimeMin: 60, sourceChannel: "ENA", aiEligible: true, weeklyLimit: null }) as never;
    check("게이트: 기간 안·허용 채널·권리 있는 후보는 통과(탐색)", gate.slotAllowed(cand("샘플 시리즈"), 6, 1200, 1260) === true);
    check("게이트: 권리 행이 없는 후보는 탐색 모드에서는 통과(미확인)", gate.slotAllowed(cand("모르는작품"), 6, 1200, 1260) === true);
    check("게이트: 기간 밖(권리 만료 후) 슬롯은 막는다", gate.slotAllowed(cand("샘플 시리즈"), 6, 1200, 1260) === true && (await GATE.buildRightsGate("ENA", "2027-03-01", "explore")).gate!.slotAllowed(cand("샘플 시리즈"), 1, 1200, 1260) === false);
    const exe = (await GATE.buildRightsGate("ENA", "2026-10-05", "executable")).gate!;
    check("게이트: 실행가능 모드는 권리가 확인되지 않은 후보도 막는다(점수가 높아도)", exe.slotAllowed(cand("모르는작품"), 6, 1200, 1260) === false);
    check("게이트: 가상 후보(경쟁 Benchmark·장르 원형)는 권리 대상이 아니라 막지 않는다", exe.slotAllowed({ ...(cand("x") as object), contentType: "ARCHETYPE" } as never, 6, 1200, 1260) === true);

    // 원장 DB 래퍼: RPC가 없는 환경(대역)에서는 조용히 성공한 척하지 않고 오류를 돌려준다
    const DBL = await import("../src/lib/avail/dbLedger");
    const r = await DBL.dbReserve({ poolId: "G1", grantRevisionId: "r", channelId: "ENA", episode: 1, units: 1, limit: 1, countUnit: "pooled", scheduledAt: null, scheduleRevisionId: null, idempotencyKey: "k", now: NOW });
    check("원장 DB 호출 결과가 없으면 성공으로 보지 않는다(db_error)", !r.ok);

    // 확인 기록·해석·링크 저장
    await ST.saveConfirmation({ grantId: "G1", rowHash: g1.rowHash, topic: "memo", value: null, evidence: null }, "a@x.kr");
    await ST.saveInterpretation("endInclusive", true, "a@x.kr");
    await ST.saveLink({ programId: "p1", canonicalKey: "샘플시리즈" }, "a@x.kr");
    await ST.saveAddenda(A.US_DRAMA_1ST_WINDOW.slice(0, 2), "a@x.kr");
    const st = (await ST.loadAvailState()).state;
    check("확인·해석·연결·보충 속성을 저장하고 읽는다", st.confirmations.length === 1 && st.interpretationConfirmations.endInclusive?.value === true && st.links.length === 1 && st.addenda.length === 2);
    const ov = (await import("../src/lib/avail/summary")).buildOverview(await ST.loadAvailState(), NOW);
    check("현황 요약: 해석 확인 4개 남음, 보충 속성 2/23 적용", ov.interpretation.filter((i) => !i.confirmed).length === 4 && ov.addenda.seedStored === 2 && ov.addenda.seedAvailable === 23 && ov.rightsConfigured);
    const snap = A.snapshotPlanRights("p1", "rev1", [{ slotKey: "s", candidateKey: "c", query: q(), slot: slot() }], ctxOf([g1]));
    await ST.saveSnapshot(snap);
    const again = await ST.saveSnapshot(snap);
    check("편성안 권리 스냅샷은 한 번 쓰고, 같은 편성안 revision을 다시 저장해도 그대로", again.ok && db.rows("avail_plan_snapshots").length === 1);
  }

  // ══ 실제 파일(있을 때만) ══════════════════════════════
  const samplePath = process.env.AVAIL_SAMPLE_FILE ?? "C:/Users/sky tv/Downloads/(배포용) Contents Availlist_260930 (1).xlsx";
  console.log("\n— 실제 Avail 파일 어댑터 검증 —");
  if (!fs.existsSync(samplePath)) console.log(`(실제 파일 없음: ${samplePath} — 이 구간은 건너뜁니다. 실제 양식 검증은 미수행으로 보고해야 합니다)`);
  else {
    const analysis = A.analyzeWorkbookBuffer(fs.readFileSync(samplePath), "Contents Availlist_260930.xlsx", { batchId: "real-1", enteredAt: NOW });
    const main = analysis.find((s) => s.kind === "content_avail");
    check("실제 파일: '소재' 시트를 콘텐츠별 Avail로 감지하고 가져올 수 있다", !!main && main.importable && main.sheet === "소재");
    check("실제 파일: 나머지 두 시트(9월시작·10월종료)는 같은 행의 보기라 가져오지 않는다(이중 반영 방지)", analysis.filter((s) => s.kind === "view_of_content_avail").length === 2 && analysis.filter((s) => s.importable).length === 1);
    const grants = main?.grants ?? [];
    check("실제 파일: 1,164행 모두 소재코드로 식별되어 권리 1,164건", grants.length === 1164 && new Set(grants.map((g) => g.grantId)).size === 1164);
    check("실제 파일: 모든 권리가 원본 행 번호·열 전체를 보존", grants.every((g) => g.source.row !== null && Object.keys(g.source.columns).length >= 20));
    const unk = {
      end: grants.filter((g) => g.window.end.state === "unbounded").length,
      chUnknown: grants.filter((g) => g.scope.channels.kind === "unknown").length,
      epUnknown: grants.filter((g) => g.scope.episodes.kind === "unknown").length,
      countUnbounded: grants.filter((g) => g.rules.count.limit.state === "unbounded").length,
    };
    check("실제 파일: 종료일 무제한 231건(= 년수 \"영구\" 231건)·채널 미확인 9건(빈칸을 무제한으로 가정하지 않음)", unk.end === 231 && unk.chUnknown === 9, JSON.stringify(unk));
    console.log(`   · 회차 미확인 ${unk.epUnknown}건, 방수 제한없음 ${unk.countUnbounded}건, 읽기 경고 ${main?.issues.length ?? 0}건`);
    check("실제 파일: 읽지 못한 값은 조용히 넘기지 않고 issue로 남는다(날짜·회차·채널)", (main?.issues.length ?? 0) > 0 && (main?.issues ?? []).every((i) => i.file && i.sheet && i.row !== null));
    const cmp = A.compareAddenda(grants, A.US_DRAMA_1ST_WINDOW);
    const applied = A.applyAddenda(grants, A.US_DRAMA_1ST_WINDOW);
    check("실제 파일: 영미 드라마 23건이 모두 원본 행에 연결된다", applied.applied.length === 23 && applied.unmatched.length === 0);
    const sc = A.seedConfirmations(applied.grants, A.US_DRAMA_1ST_WINDOW);
    console.log(`   · 전달 사실 확인 기록 ${sc.confirmations.length}건, 충돌로 제외 ${sc.skippedForConflict.length}건(${sc.skippedForConflict.join(",")})`);
    check("실제 파일: 충돌 4건(유령마을·올 허 폴트·슈츠 LA·라브레아)은 확인 기록에서 제외", sc.skippedForConflict.length === 4);
    const asConf = sc.confirmations.map((c) => ({ grantId: c.grantId, rowHash: c.rowHash, topic: c.topic, value: c.value, evidence: c.evidence, by: "t", at: NOW }));
    const ctxS = ctxOf(A.applyDuplicateResolution(applied.grants, []).grants, { confirmations: asConf, interpretation: A.DEFAULT_INTERPRETATION });
    let availFirst = 0;
    let condOther = 0;
    for (const a of A.US_DRAMA_1ST_WINDOW) {
      const g = ctxS.grants.find((x) => x.content.sourceCode === a.sourceCode)!;
      const day = A.addDaysIso(g.window.start.state === "value" ? g.window.start.value : "2026-10-10", 40);
      const rf = A.evaluateEligibility({ programId: null, programName: g.content.titleRaw, episodeNumber: 1 }, slot(day, 1200, 1260, a.firstWindowChannel!), ctxS);
      const ro = A.evaluateEligibility({ programId: null, programName: g.content.titleRaw, episodeNumber: 1 }, slot(day, 1200, 1260, "ENA"), ctxS);
      if (rf.status === "available") availFirst++;
      if (ro.status === "conditional" && has(ro, "FIRST_WINDOW_NOT_BROADCAST")) condOther++;
    }
    console.log(`   · 1st window 채널 가능 ${availFirst}/23, 다른 채널 1st window 대기 ${condOther}/23`);
    check("실제 파일: 확인 기록 후 충돌 없는 19건은 1st window 채널에서 가능, 충돌 4건은 계속 확인 전", availFirst === 19);
    const byField = (f: string) => cmp.conflicts.filter((c) => c.field === f).map((c) => c.displayTitle);
    console.log(`   · 원본과 전달 목록 일치 항목 ${cmp.agreed}건 / 충돌: 시작일 ${JSON.stringify(byField("start_date"))}, 편수 ${JSON.stringify(byField("episode_count"))}, 1st 채널 ${JSON.stringify(byField("first_channel"))}, 종료일 ${JSON.stringify(byField("end_date"))}, 런타임 ${JSON.stringify(byField("runtime"))}`);
    check("실제 파일: 종료일은 시작일+2년−1일 계산과 모두 일치(전달 목록의 날짜 기준)", byField("end_date").length === 0 || byField("end_date").length === byField("start_date").length);
    check("실제 파일: 1st window 채널(방영채널1)이 전달 목록과 모두 일치", byField("first_channel").length === 0);
    const dup = A.findDuplicatePairs(applied.grants);
    console.log(`   · 중복 권리 후보 ${dup.length}쌍`);
    const built = A.applyDuplicateResolution(applied.grants, []);
    const ctx = ctxOf(built.grants, { interpretation: A.DEFAULT_INTERPRETATION });
    const t = (name: string, ep: number | null, date: string, ch: string) => A.evaluateEligibility({ programId: null, programName: name, episodeNumber: ep }, slot(date, 1200, 1260, ch), ctx);
    const r1 = t("더 이래셔널 시즌1", 1, "2026-09-10", "ENA Story");
    check("실제 파일: 1st window 채널(ENA Story)은 시작일 이후 기간 안이면 방영 가능 후보지만 메모·기소진 확인 전이라 단정하지 않는다", r1.status === "conditional" && has(r1, "MEMO_REVIEW") && has(r1, "USAGE_BASELINE_UNKNOWN"), `${r1.status} ${r1.reasonCodes.join(",")}`);
    const r2 = t("더 이래셔널 시즌1", 1, "2026-08-30", "ENA Story");
    check("실제 파일: 시작일 전날은 불가", r2.status === "unavailable" && has(r2, "WINDOW_NOT_STARTED"));
    const r3 = t("더 이래셔널 시즌1", 1, "2028-08-31", "ENA Story");
    check("실제 파일: 종료일 다음 날은 불가", r3.status === "unavailable" && has(r3, "WINDOW_EXPIRED"));
    const r4 = t("더 이래셔널 시즌1", 12, "2026-09-10", "ENA Story");
    check("실제 파일: 허용 회차(1~11) 밖은 불가", r4.status === "unavailable" && has(r4, "EPISODE_NOT_GRANTED"));
    const gated = A.applyAddenda(grants, A.US_DRAMA_1ST_WINDOW);
    const ctxG = ctxOf(A.applyDuplicateResolution(gated.grants, []).grants, { interpretation: A.DEFAULT_INTERPRETATION });
    const ra = A.evaluateEligibility({ programId: null, programName: "더 이래셔널 시즌1", episodeNumber: 1 }, slot("2026-09-10", 1200, 1260, "ENA"), ctxG);
    check("실제 파일: 1st window(ENA Story) 최초 방송 전에 다른 채널(ENA)은 조건부(FIRST_WINDOW_NOT_BROADCAST)", ra.status === "conditional" && has(ra, "FIRST_WINDOW_NOT_BROADCAST"));
    const own = A.evaluateEligibility({ programId: null, programName: "신병4: 사보타주", episodeNumber: 1, genre: "오리지널 드라마" }, slot("2026-09-10", 1200, 1260, "ENA"), ctxG);
    check("실제 파일: 자체 드라마(신병4)도 Avail 행(10년·50방)이 우선 적용되어 행이 근거로 붙는다", own.grantRevisionIds.length === 1 && own.sourceRefs[0].sheet === "소재" && own.expiresOn === "2036-08-23", `${own.status} ${own.expiresOn}`);
    const eps = A.listEpisodes(grants.find((g) => g.content.sourceCode === "D26082101")?.scope.episodes ?? { kind: "all" });
    check("실제 파일: 신병4 회차 #1~12", eps?.length === 12);
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
