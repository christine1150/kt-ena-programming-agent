// 페이지·API 체감 속도 계측 순수 함수 테스트(고도화 계획 E1) — DB·네트워크 없음.
// 실행: npm run test:page-timing
import { MAX_ENTRIES_PER_BEACON, normalizeApiPath, normalizeTimingPath, percentile, sanitizeBeacon } from "../src/lib/pageTiming";

let pass = 0;
let fail = 0;
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`✗ ${name}\n   기대 ${e}\n   실제 ${a}`);
  }
}

// ── 경로 정규화 ──
eq("홈", normalizeTimingPath("/"), "/");
eq("쿼리·해시 제거", normalizeTimingPath("/ideal-schedule?channel=ENA#x"), "/ideal-schedule");
eq("끝 슬래시 제거", normalizeTimingPath("/ratings/"), "/ratings");
eq("채널 코드 → [code]", normalizeTimingPath("/channel/ENA_PLAY"), "/channel/[code]");
eq("채널 코드 소문자도", normalizeTimingPath("/channel/once"), "/channel/[code]");
eq("시청자 보고서 채널", normalizeTimingPath("/audience-report/ENA"), "/audience-report/[channel]");
eq("시청자 보고서 포트폴리오는 그대로", normalizeTimingPath("/audience-report/portfolio"), "/audience-report/portfolio");
eq("스냅샷 id", normalizeTimingPath("/audience-report/view/8f14e45f-ceea-467a-9575-1b5a9d7b9c10"), "/audience-report/view/[id]");
eq("uuid → [id]", normalizeTimingPath("/x/8f14e45f-ceea-467a-9575-1b5a9d7b9c10"), "/x/[id]");
eq("긴 숫자 → [id]", normalizeTimingPath("/run/123456"), "/run/[id]");
eq("슬래시로 시작하지 않으면 null", normalizeTimingPath("ratings"), null);
eq("빈 문자열 null", normalizeTimingPath(""), null);
eq("숫자 아님 null", normalizeTimingPath(42), null);
eq("너무 긴 경로 null", normalizeTimingPath("/" + "a".repeat(250)), null);
eq("API 경로", normalizeApiPath("/api/dashboard/channel?code=ENA"), "/api/dashboard/channel");
eq("API가 아니면 null", normalizeApiPath("/ratings"), null);

// ── 비콘 검증 ──
const good = sanitizeBeacon({ path: "/channel/ENA", viewport: "mobile", entries: [{ metric: "lcp", durationMs: 1234.6 }, { metric: "api", apiPath: "/api/dashboard/channel?x=1", durationMs: 800 }] });
eq("정상 비콘", good, { path: "/channel/[code]", viewport: "mobile", entries: [{ metric: "lcp", apiPath: null, durationMs: 1235 }, { metric: "api", apiPath: "/api/dashboard/channel", durationMs: 800 }] });
eq("뷰포트 기본 desktop", sanitizeBeacon({ path: "/", entries: [{ metric: "load", durationMs: 10 }] })?.viewport, "desktop");
eq("알 수 없는 지표 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "foo", durationMs: 10 }] }), null);
eq("음수 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "lcp", durationMs: -1 }] }), null);
eq("범위 초과 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "lcp", durationMs: 130000 }] }), null);
eq("NaN 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "lcp", durationMs: Number.NaN }] }), null);
eq("api인데 apiPath 없으면 그 항목만 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "api", durationMs: 5 }, { metric: "lcp", durationMs: 7 }] })?.entries.length, 1);
eq("api 경로가 api가 아니면 버림", sanitizeBeacon({ path: "/", entries: [{ metric: "api", apiPath: "/ratings", durationMs: 5 }] }), null);
eq("화면 경로가 /api면 거부", sanitizeBeacon({ path: "/api/x", entries: [{ metric: "lcp", durationMs: 5 }] }), null);
eq("entries 없음", sanitizeBeacon({ path: "/" }), null);
eq("본문이 객체가 아님", sanitizeBeacon("x"), null);
eq("null 본문", sanitizeBeacon(null), null);
const many = sanitizeBeacon({ path: "/", entries: Array.from({ length: MAX_ENTRIES_PER_BEACON + 50 }, () => ({ metric: "lcp", durationMs: 1 })) });
eq("항목 상한", many?.entries.length, MAX_ENTRIES_PER_BEACON);
eq("항목이 객체가 아니면 건너뜀", sanitizeBeacon({ path: "/", entries: [null, 3, { metric: "lcp", durationMs: 9 }] })?.entries.length, 1);

// ── 백분위(percentile_cont와 같은 선형 보간) ──
eq("빈 배열", percentile([], 0.5), null);
eq("한 개", percentile([7], 0.95), 7);
eq("중앙값 홀수", percentile([3, 1, 2], 0.5), 2);
eq("중앙값 짝수", percentile([1, 2, 3, 4], 0.5), 2.5);
eq("p95 보간", percentile([100, 200, 300, 400, 500], 0.95), 480);
eq("범위 밖 p는 0~1로 자름", percentile([1, 2, 3], 5), 3);

console.log(`\n${pass}건 통과${fail ? `, ${fail}건 실패` : ""}`);
if (fail) process.exit(1);
