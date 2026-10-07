// 단계 15 — 워딩·디자인 토큰·접근성·지표 표기 테스트. 테스트 프레임워크 없이 tsx로 실행하며 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:ui-polish
//
// 이 테스트가 보증하는 것: 공통 용어·표기 규칙, 디자인 토큰의 WCAG 대비 계산, 토큰과 CSS 변수의 일치, 본문 랜드마크,
// 사용자 문구 inventory에서 금지 표기(컨텐츠·도달율·환경 변수·DB 테이블 이름) 0건.
// 보증하지 못하는 것(브라우저에서 실제로 보이는 대비·확대·키보드 흐름)은 PROGRESS.md의 측정 기록에 둔다.
import fs from "node:fs";
import path from "node:path";
import { collectInventory, type TextItem } from "./lib/uiTextInventory";
import { findWordingIssues, usualWithoutBasis, misleadingActionLabel, TERM_RULES, ACTION_EFFECTS } from "../src/lib/ui/glossary";
import { formatInt, formatDecimal, formatSigned, formatPct, formatRatingValue, formatRank, formatIndex, formatMetric, formatDurationKo, formatDurationClock, MINUS, MISSING, METRIC_META } from "../src/lib/ui/metricFormat";
import { contrastRatio, requiredTextContrast, isLargeText, ensureTextContrast, brandText, WCAG_NORMAL_TEXT, WCAG_UI_COMPONENT } from "../src/lib/ui/contrast";
import { FakeDb } from "./lib/fakeSupabase";
import { cachedLlmTextWith, llmCacheKey, type CacheDb } from "../src/lib/llmTextCacheCore";
import { createStageTimer } from "../src/lib/perf/serverTiming";
import { nextFocusIndex } from "../src/lib/ui/focusTrap";
import { PAGE_TITLE, VENDING, SERVICE_NAME } from "../src/lib/ui/pageTitles";
import { NAV_ITEMS } from "../src/lib/workspace/nav";
import { SURFACES, TEXT, BORDER, FOCUS, PERFORMANCE, STATUS, CHART, TYPE, SPACE, TARGET } from "../src/lib/ui/tokens";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
/** 주석을 뺀 코드 — 주석에 함수 이름이 나오는 것은 호출이 아니다 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── 1. 용어 사전 ─────────────────────────────────────────────
check("컨텐츠는 콘텐츠로", findWordingIssues("주요 컨텐츠 리뷰").some((i) => i.rule === "contents"));
check("도달율은 도달률로", findWordingIssues("도달율 5.1%").some((i) => i.rule === "reach-rate"));
check("바른 표기는 통과", findWordingIssues("주요 콘텐츠 리뷰 · 도달률 5.1%").length === 0);
check("원본 용어 출처 줄은 용어 규칙에서 제외", findWordingIssues("원본 용어: 도달율(닐슨 시트 컬럼명)").length === 0);
check("환경 변수 이름 노출 검출", findWordingIssues("OPENAI_API_KEY가 없습니다").some((i) => i.rule === "env-name"));
check(".env 파일 이름 노출 검출", findWordingIssues(".env에 값이 없습니다").some((i) => i.rule === "env-file"));
check("내부 분류 코드 노출 검출", findWordingIssues("ZAPPING_RISK 유형").some((i) => i.rule === "enum-code"));
check("DB 테이블 이름 노출 검출", findWordingIssues("featured_content 조회 실패", { tableNames: new Set(["featured_content"]) }).some((i) => i.rule === "table-name"));
check("테이블 이름이 더 긴 낱말의 일부면 오탐하지 않는다", findWordingIssues("my_featured_content_x", { tableNames: new Set(["featured_content"]) }).length === 0);
check("단독 '평소' 라벨은 모호", findWordingIssues("평소").some((i) => i.rule === "ambiguous-usual"));
check("'평소'에 기준이 붙으면 통과", !usualWithoutBasis("평소(최근 4주 평균) 대비") && usualWithoutBasis("평소보다 높음"));
check("파일을 받는 동작에 '엑셀 저장'은 오해 소지", misleadingActionLabel("엑셀 저장") !== null && misleadingActionLabel("엑셀 내려받기") === null && misleadingActionLabel("이 채널 설정 저장") === null);
check("저장·검토·확정·내보내기 효과 정의", Object.keys(ACTION_EFFECTS).length === 4 && ACTION_EFFECTS.confirm.effect.includes("방송사 편성 시스템에는 반영하지 않는다"));
check("용어 규칙이 표준 표기를 갖는다", TERM_RULES.every((r) => r.preferred.length > 0 && r.note.length > 0));

// ── 2. 지표 표기 ─────────────────────────────────────────────
check("28분 60초가 생기지 않는다", formatDurationKo(1679.6) === "28분" && formatDurationKo(1739.5) === "29분" && formatDurationKo(1679.4) === "27분 59초");
check("시간: 초 0이면 분만, 결측은 —", formatDurationKo(120) === "2분" && formatDurationKo(null) === MISSING && formatDurationKo(Number.NaN) === MISSING);
check("시간 M:SS 표기도 같은 반올림", formatDurationClock(119.6) === "2:00" && formatDurationClock(65) === "1:05");
check("천 단위 쉼표와 음수 기호", formatInt(1234567) === "1,234,567" && formatInt(-1234) === `${MINUS}1,234` && formatInt(null) === MISSING);
check("소수 자릿수 고정과 천 단위", formatDecimal(1234.5, 1) === "1,234.5" && formatDecimal(0.8, 3) === "0.800");
check("반올림하면 0이 되는 음수는 −0.0이 아니다", formatDecimal(-0.004, 1) === "0.0" && formatSigned(-0.004, 1) === "0.0");
check("부호 표기", formatSigned(1.234, 1) === "+1.2" && formatSigned(-1.26, 1) === `${MINUS}1.3` && formatSigned(0, 1) === "0.0");
check("퍼센트 값", formatPct(12.345) === "12.35%" && formatPct(null) === MISSING && formatPct(0) === "0.00%");
check("시청률 3자리·skyUHD 5자리", formatRatingValue(0.8321, "ENA") === "0.832" && formatRatingValue(0.123456, "SKYUHD") === "0.12346");
check("시청률 단위 붙이기", formatRatingValue(0.8321, "ENA", { unit: true }) === "0.832%");
check("시청률 0은 0, 극소값은 <0.001, 결측은 —", formatRatingValue(0, "ENA") === "0" && formatRatingValue(0.0004, "ENA") === "<0.001" && formatRatingValue(0.000004, "SKYUHD") === "<0.00001" && formatRatingValue(null, "ENA") === MISSING);
check("순위·지수", formatRank(7) === "7위" && formatRank(7.34, 1) === "7.3위" && formatIndex(153.84) === "153.8");
check("지표 이름·단위 사전은 표준 용어", METRIC_META.reach.label === "도달률" && METRIC_META.timeSpentRatio.label === "시청시간 비율" && METRIC_META.index.unit === "");
check("formatMetric 분기", formatMetric("reach", 5.151) === "5.15%" && formatMetric("share", 1.394, { unit: false }) === "1.39" && formatMetric("airings", 1234) === "1,234회" && formatMetric("timeSpent", 1680) === "28분");

// ── 3. 디자인 토큰과 WCAG 대비 ─────────────────────────────
const surfaces = Object.entries(SURFACES);
for (const [tn, tv] of Object.entries(TEXT)) {
  const worst = Math.min(...surfaces.map(([, sv]) => contrastRatio(tv, sv)));
  check(`글자색 ${tn}은 모든 면에서 4.5:1 이상`, worst >= WCAG_NORMAL_TEXT, worst.toFixed(2));
}
check("컨트롤 테두리는 흰 면 위 비텍스트 3:1 이상", contrastRatio(BORDER.control, SURFACES.page) >= WCAG_UI_COMPONENT, contrastRatio(BORDER.control, SURFACES.page).toFixed(2));
check("포커스 링은 모든 면에서 3:1 이상", Math.min(...surfaces.map(([, sv]) => contrastRatio(FOCUS.ring, sv))) >= WCAG_UI_COMPONENT);
for (const [k, v] of Object.entries(PERFORMANCE)) {
  check(`성과색 ${k}: 흰 면·자기 배경색 위 4.5:1 이상 + 기호·이름`, contrastRatio(v.text, SURFACES.page) >= WCAG_NORMAL_TEXT && contrastRatio(v.text, v.tint) >= WCAG_NORMAL_TEXT && v.glyph.length > 0 && v.label.length > 0,
    `${contrastRatio(v.text, SURFACES.page).toFixed(2)}/${contrastRatio(v.text, v.tint).toFixed(2)}`);
}
for (const [k, v] of Object.entries(STATUS)) {
  check(`상태색 ${k}: 흰 면·자기 배경색 위 4.5:1 이상 + 아이콘 글자·상태 이름`, contrastRatio(v.text, SURFACES.page) >= WCAG_NORMAL_TEXT && contrastRatio(v.text, v.tint) >= WCAG_NORMAL_TEXT && v.glyph.length > 0 && v.label.length > 0,
    `${contrastRatio(v.text, SURFACES.page).toFixed(2)}/${contrastRatio(v.text, v.tint).toFixed(2)}`);
}
check("성과색(증감)과 상태색(권리·오류)은 서로 다른 값", !Object.values(PERFORMANCE).some((p) => Object.values(STATUS).some((s) => s.text.toLowerCase() === p.text.toLowerCase())));
check("증감 기호와 상태 기호가 겹치지 않는다", !Object.values(PERFORMANCE).some((p) => Object.values(STATUS).some((s) => (s.glyph as string) === (p.glyph as string))));
check("차트 계열색 6개는 서로 다르고 흰 면 위 3:1 이상", new Set(CHART.series).size === CHART.series.length && CHART.series.every((c) => contrastRatio(c, SURFACES.page) >= WCAG_UI_COMPONENT));
check("차트 축 글자는 4.5:1", contrastRatio(CHART.axisText, SURFACES.page) >= WCAG_NORMAL_TEXT);
check("큰 글자 판정", isLargeText(24) && isLargeText(19, 700) && !isLargeText(18, 400) && requiredTextContrast(14) === 4.5 && requiredTextContrast(24) === 3);
check("글자 크기 설계안: 본문 14~16, 표 12~14, 보조 12 이상", TYPE.body >= 14 && TYPE.body <= 16 && TYPE.table >= 12 && TYPE.table <= 14 && TYPE.caption >= 12 && TYPE.bodyMin === 14 && TYPE.tableMin === 12);
check("클릭 영역 최소 24 CSS px(WCAG 2.2)", TARGET.min === 24 && TARGET.comfortable >= 32);
check("간격 스케일은 증가", Object.values(SPACE).every((v, i, a) => i === 0 || v > a[i - 1]));

// CSS 변수와 토큰의 일치
const css = read("src/app/globals.css");
const cssVar = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6}|[0-9.]+px|[0-9.]+)\\s*;`))?.[1]?.toLowerCase();
const expectVars: [string, string | number][] = [
  ["surface-page", SURFACES.page], ["surface-subtle", SURFACES.subtle], ["surface-muted", SURFACES.muted],
  ["text-primary", TEXT.primary], ["text-secondary", TEXT.secondary], ["text-tertiary", TEXT.tertiary], ["text-muted", TEXT.muted],
  ["border-subtle", BORDER.subtle], ["border-control", BORDER.control], ["focus-ring", FOCUS.ring],
  ["perf-up", PERFORMANCE.up.text], ["perf-up-tint", PERFORMANCE.up.tint], ["perf-down", PERFORMANCE.down.text], ["perf-down-tint", PERFORMANCE.down.tint], ["perf-flat", PERFORMANCE.flat.text],
  ["status-confirmed", STATUS.confirmed.text], ["status-confirmed-tint", STATUS.confirmed.tint], ["status-conditional", STATUS.conditional.text], ["status-conditional-tint", STATUS.conditional.tint],
  ["status-unconfirmed", STATUS.unconfirmed.text], ["status-unconfirmed-tint", STATUS.unconfirmed.tint], ["status-blocked", STATUS.blocked.text], ["status-blocked-tint", STATUS.blocked.tint],
  ["chart-1", CHART.series[0]], ["chart-2", CHART.series[1]], ["chart-3", CHART.series[2]], ["chart-4", CHART.series[3]], ["chart-5", CHART.series[4]], ["chart-6", CHART.series[5]],
  ["chart-grid", CHART.grid], ["chart-axis-text", CHART.axisText], ["chart-reference", CHART.reference],
  ["type-body", `${TYPE.body}px`], ["type-table", `${TYPE.table}px`], ["type-caption", `${TYPE.caption}px`], ["line-body", String(TYPE.lineBody)], ["line-table", String(TYPE.lineTable)],
  ["space-xs", `${SPACE.xs}px`], ["space-sm", `${SPACE.sm}px`], ["space-md", `${SPACE.md}px`], ["space-lg", `${SPACE.lg}px`], ["space-xl", `${SPACE.xl}px`], ["space-xxl", `${SPACE.xxl}px`],
  ["target-min", `${TARGET.min}px`], ["target-comfortable", `${TARGET.comfortable}px`],
];
const mismatch = expectVars.filter(([n, v]) => cssVar(n) !== String(v).toLowerCase()).map(([n, v]) => `${n}: css=${cssVar(n)} ts=${v}`);
check(`CSS 변수 ${expectVars.length}개가 토큰과 같다`, mismatch.length === 0, mismatch.join("; "));
check("CSS: 키보드 포커스 링 규칙", /:focus-visible/.test(css) && css.includes("var(--focus-ring)"));
check("CSS: 모션 줄이기 설정 존중", css.includes("prefers-reduced-motion: reduce"));
check("CSS: 회색 보조 글자 보정색이 토큰 muted와 같다", /\.text-zinc-400[^{]*\{\s*color:\s*var\(--text-muted\)/.test(css));

// ── 4. 본문 랜드마크 ─────────────────────────────────────────
const layout = read("src/app/layout.tsx");
check("layout: lang=ko와 본문 landmark", layout.includes('lang="ko"') && /<main id="main-content"/.test(layout));
const allTsx: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) walk(r); else if (e.name.endsWith(".tsx")) allTsx.push(r); } };
walk("src");
const nestedMain = allTsx.filter((f) => f !== "src/app/layout.tsx" && /<main[\s>]/.test(read(f)));
check("페이지·컴포넌트에 중복 <main>이 없다", nestedMain.length === 0, nestedMain.join(", "));

// ── 5. 사용자 문구 inventory ────────────────────────────────
const inventory: TextItem[] = collectInventory(ROOT);
check("inventory가 소스를 읽는다(문자열 5천 개 이상)", inventory.length > 5000, String(inventory.length));
/** 용어 규칙에서 제외: 공급자 파일의 원본 시트 용어를 그대로 다루는 파서·픽스처, LLM 라우터가 읽는 별칭 */
const SOURCE_TERM_FILES = new Set(["src/lib/olifeReferenceParse.ts", "src/lib/originalContentInsight.ts", "src/lib/intent/intentRegistry.ts", "src/lib/ui/glossary.ts"]);
/** LLM에 주는 지시문·내부 라우팅 설명은 사용자 화면 문구가 아니다 */
const isPromptFile = (f: string) => f.startsWith("src/lib/intent/") || /Llm\.ts$/.test(f) || f === "src/lib/smartProgrammingTips.ts" || f.startsWith("src/lib/ui/");
const termHits = inventory.filter((i) => !SOURCE_TERM_FILES.has(i.file) && findWordingIssues(i.text, { internal: false }).some((x) => x.rule !== "ambiguous-usual"));
check("사용자 문구에 '컨텐츠'·'도달율' 등 금지 표기 0건", termHits.length === 0, termHits.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 40)}`).join(" | "));

const uiVisible = inventory.filter((i) => (i.kind === "jsx" || i.kind === "attr") && !i.file.startsWith("src/app/api/") && !i.file.startsWith("src/lib/ui/"));
const envHits = inventory.filter((i) => i.file.startsWith("src/app/") && !i.file.startsWith("src/app/api/") && !isPromptFile(i.file) && findWordingIssues(i.text, { internal: true }).some((x) => x.rule === "env-name" || x.rule === "env-file"));
check("화면(app 경로) 문구에 환경 변수·.env 이름 0건", envHits.length === 0, envHits.slice(0, 4).map((h) => `${h.file}:${h.line}`).join(" | "));

// DB 테이블 이름: 마이그레이션에서 읽는다
const tableNames = new Set<string>();
for (const f of fs.readdirSync(path.join(ROOT, "supabase/migrations"))) {
  const sql = read(`supabase/migrations/${f}`);
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) tableNames.add(m[1]);
}
check("마이그레이션에서 테이블 이름을 읽었다", tableNames.size > 30, String(tableNames.size));
// 'channel' 같은 일반 낱말 테이블 이름은 제외하고 스네이크 케이스(밑줄 포함) 이름만 본다
const snakeTables = new Set([...tableNames].filter((n) => n.includes("_")));
const tableHits = uiVisible.filter((i) => findWordingIssues(i.text, { tableNames: snakeTables }).some((x) => x.rule === "table-name"));
check("화면 글자(JSX·속성)에 DB 테이블 이름 0건", tableHits.length === 0, tableHits.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 50)}`).join(" | "));
// /api/health는 배포 점검용 운영 엔드포인트라 설정 누락을 이름으로 알려주는 것이 목적이다(사용자 화면 아님)
const apiTableHits = inventory.filter((i) => i.file.startsWith("src/app/api/") && i.file !== "src/app/api/health/route.ts" && !isPromptFile(i.file) && i.kind !== "template" && findWordingIssues(i.text, { tableNames: snakeTables, internal: true }).some((x) => x.rule === "table-name" || x.rule === "env-name"));
check("API가 사용자에게 돌려주는 문구에 DB 테이블·환경 변수 이름 0건", apiTableHits.length === 0, apiTableHits.slice(0, 5).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 50)}`).join(" | "));

// 모호한 '평소': 비교 기준 없이 쓰는 곳
const PLAIN_USUAL_OK = [/로그인 비밀번호/, /평소 편성/, /평소 잘/];
const usualHits = inventory.filter((i) => !isPromptFile(i.file) && !i.file.startsWith("src/lib/ui/") && usualWithoutBasis(i.text) && !PLAIN_USUAL_OK.some((re) => re.test(i.text)));
check("비교 기준 없이 쓰인 '평소'(허용 목록 제외) 0건", usualHits.length === 0, `${usualHits.length}건: ${usualHits.slice(0, 6).map((h) => `${h.file.replace("src/", "")}:${h.line} ${h.text.slice(0, 30)}`).join(" | ")}`);

// 화면 문구에 개발 이력(사용자 지시·단계 번호·마이그레이션 번호)이 남지 않는다 — 제품 질문에 개발 설명을 길게 늘어놓지 않는다
const devHistory = uiVisible.filter((i) => /사용자 지시|사용자 요청|사용자 피드백|단계 ?\d{2}|마이그레이션/.test(i.text));
check("화면 글자(JSX·속성)에 개발 이력('사용자 지시'·단계 번호·마이그레이션) 0건", devHistory.length === 0, devHistory.slice(0, 4).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 40)}`).join(" | "));

// 버튼·링크 글자의 효과 구분
const actionLabelHits = uiVisible.filter((i) => misleadingActionLabel(i.text) !== null);
check("파일 내려받기 버튼이 '저장'으로 표기되지 않는다", actionLabelHits.length === 0, actionLabelHits.map((h) => `${h.file}:${h.line} ${h.text}`).join(" | "));
check("기본 템플릿 제목 'Create Next App' 없음", !inventory.some((i) => /Create Next App/.test(i.text)) && !/Create Next App["']/.test(layout.replace(/\/\/.*$/gm, "")));

// ── 6. 화면 제목·제품 이름 병기 ──────────────────────────────
const navLabel = (id: string) => NAV_ITEMS.find((n) => n.id === id)?.label;
check("화면 제목은 전역 메뉴 이름과 같은 말을 쓴다", PAGE_TITLE.home === navLabel("briefing") && PAGE_TITLE.channel === navLabel("channel") && PAGE_TITLE.compare === navLabel("compare") && PAGE_TITLE.report === navLabel("reports") && PAGE_TITLE.admin === navLabel("admin") && PAGE_TITLE.ai.startsWith(navLabel("ai") as string));
check("제품 이름 '시청률 자판기'는 유지하고 행동 중심 이름을 병기", VENDING.productName === "시청률 자판기" && VENDING.descriptor === "AI 편성 시뮬레이터" && VENDING.actionDescriptor === "편성안 생성" && VENDING.linkLabel.includes(VENDING.productName) && VENDING.linkLabel.includes(VENDING.actionDescriptor));
check("루트 layout: 제목 템플릿", layout.includes("template: `%s · ${SERVICE_NAME}`") && SERVICE_NAME.length > 0);
const titledRoutes: [string, string][] = [
  ["src/app/page.tsx", "home"], ["src/app/channel/layout.tsx", "channel"], ["src/app/audience-report/layout.tsx", "report"], ["src/app/audience-report/portfolio/layout.tsx", "portfolio"],
  ["src/app/audience-report/view/[id]/layout.tsx", "reportView"], ["src/app/ideal-schedule/layout.tsx", "ai"], ["src/app/ideal-schedule/purchase/layout.tsx", "purchase"],
  ["src/app/schedule-grid/layout.tsx", "compare"], ["src/app/admin/layout.tsx", "admin"], ["src/app/admin/login/layout.tsx", "adminLogin"], ["src/app/pd/login/layout.tsx", "pdLogin"], ["src/app/access-denied/layout.tsx", "denied"],
];
const untitled = titledRoutes.filter(([f, k]) => !read(f).includes(`title: PAGE_TITLE.${k}`));
check("모든 화면 경로에 업무별 제목이 있다", untitled.length === 0, untitled.map((x) => x[0]).join(", "));
const ideal = read("src/app/ideal-schedule/page.tsx");
check("AI 편성 화면: 버튼에 효과 설명과 비활성 이유(title)", ideal.includes("title={busy ?") && ideal.includes("VENDING.actionDescriptor") && ideal.includes("VENDING.descriptor"));

// ── 5-2. 브랜드색 글자·증감색·글자 크기 바닥 ─────────────────
for (const brand of ["#f02830", "#00c8d0", "#b8d800", "#f2a100", "#2e97d8", "#e5156e", "#c8a878"]) {
  const t = ensureTextContrast(brand);
  check(`브랜드색 글자 ${brand} → ${t}: 회색 면(#f4f4f5)에서도 4.5:1`, contrastRatio(t, SURFACES.muted) >= WCAG_NORMAL_TEXT && contrastRatio(t, SURFACES.page) >= WCAG_NORMAL_TEXT);
}
check("이미 충분한 색은 그대로, 색 형식이 아니면 그대로", ensureTextContrast("#18181b") === "#18181b" && ensureTextContrast("red") === "red" && brandText(null) === undefined);
const sizeRule = (sel: string) => Number(css.match(new RegExp(`\\.page1-readable \\.text-\\\\\\[${sel}px\\\\\\] \\{ font-size: ([0-9.]+)px; \\}`))?.[1]);
check("홈 보조 글자 규칙: 8·9·10px 계열도 12px 이상", sizeRule("8") >= 12 && sizeRule("9") >= 12 && sizeRule("10") >= 12, `${sizeRule("8")}/${sizeRule("9")}/${sizeRule("10")}`);
check("전역 글자 크기 바닥(9~11.5px → 12px)과 시간 비례 격자 예외", css.includes(":not(.dense-grid *)") && css.includes("font-size: var(--type-caption)") && read("src/app/ideal-schedule/IdealWeekGrid.tsx").includes("dense-grid"));
const cddSrc = read("src/app/channel/ChannelDeepDive.tsx");
check("채널 화면의 증감 글자색은 홈과 같은 토큰색(상승·하락)", !/highlightNarrativeText\([^)]*"#059669"/.test(cddSrc) && cddSrc.includes("NARRATIVE_UP_COLOR"));
check("증감 글자색 상수가 토큰과 같다", read("src/lib/highlightNarrative.tsx").includes(`NARRATIVE_UP_COLOR = "${PERFORMANCE.up.text}"`) && read("src/lib/highlightNarrative.tsx").includes(`NARRATIVE_DOWN_COLOR = "${PERFORMANCE.down.text}"`));
check("채널 건강도 사유에 영문 태그 코드가 없다", !/reason: `[^`]*(MOVE|REPLACE|STRENGTHEN|KEEP)/.test(read("src/lib/channelHealthScore.ts")));
check("채널 화면 본문 칸이 내용 때문에 페이지를 가로로 밀지 않는다(min-w-0)", read("src/app/channel/layout.tsx").includes("min-w-0 flex-1"));

// ── 6-2. 키보드·대화상자·낭독기 ─────────────────────────────
check("Tab 순환: 끝에서 처음으로, 처음에서 Shift+Tab이면 끝으로", nextFocusIndex(3, 2, false) === 0 && nextFocusIndex(3, 0, true) === 2 && nextFocusIndex(3, 1, false) === 2 && nextFocusIndex(3, 1, true) === 0);
check("Tab 순환: 목록 밖에서 들어오면 방향에 맞게, 요소가 없으면 null", nextFocusIndex(3, -1, false) === 0 && nextFocusIndex(3, -1, true) === 2 && nextFocusIndex(0, -1, false) === null);
const modal = read("src/components/ui/Modal.tsx");
check("Modal: role=dialog·aria-modal·이름 연결·Esc 닫기·포커스 복귀·Tab 순환", modal.includes('role="dialog"') && modal.includes('aria-modal="true"') && modal.includes("aria-labelledby") && modal.includes('"Escape"') && modal.includes("opener?.focus") && modal.includes("nextFocusIndex"));
const cdd = read("src/app/channel/ChannelDeepDive.tsx");
check("채널 화면의 편성표 대화상자는 공용 Modal을 쓴다", cdd.includes("<Modal open") && !/fixed inset-0 z-50 flex items-center justify-center bg-black\/40 p-4" onClick/.test(cdd));
const roleStatus = allTsx.reduce((n, f) => n + (read(f).match(/role="status"/g)?.length ?? 0), 0);
const roleAlert = allTsx.reduce((n, f) => n + (read(f).match(/role="alert"/g)?.length ?? 0), 0);
check("불러오는 중 안내는 낭독기에 알려진다(role=status 34곳 이상), 오류는 role=alert 34곳 이상", roleStatus >= 34 && roleAlert >= 34, `status=${roleStatus} alert=${roleAlert}`);
const unlabeledSvg = allTsx.flatMap((f) => read(f).split("\n").map((l, i) => ({ f, i: i + 1, l }))).filter(({ l }) => /<svg\b/.test(l) && !/aria-hidden|role="img"|aria-label/.test(l)).filter(({ f, i }) => !/(aria-hidden|role="img"|aria-label)/.test(read(f).split("\n").slice(i - 1, i + 12).join("\n")));
check("차트·그림 svg에는 role=img+이름 또는 aria-hidden이 있다(장식 아이콘 포함)", unlabeledSvg.length === 0, unlabeledSvg.slice(0, 5).map((x) => `${x.f}:${x.i}`).join(" | "));
check("가로 스크롤 영역은 키보드로 닿는다(tabIndex·역할·이름)", allTsx.every((f) => !/<div className="[^"{}`]*\boverflow-x-auto\b[^"{}`]*">/.test(read(f))));

// ── 7. 성능·요청 규칙 ───────────────────────────────────────
{
  let t = 0;
  const timer = createStageTimer(() => t);
  t = 10; timer.mark("a");
  t = 25; timer.mark("b");
  t = 25; timer.mark("a"); // 같은 이름은 번호를 붙인다
  const h = timer.header();
  check("Server-Timing: 단계별 ms와 total", h === "a;dur=10, b;dur=15, a_2;dur=0, total;dur=25", h);
  const t2 = createStageTimer(() => t);
  t2.mark('x y;z=1,"q"');
  check("Server-Timing: 이름에 위험 문자가 들어가지 않는다", /^[A-Za-z0-9_-]+$/.test(t2.entries()[0].name), t2.entries()[0].name);
}
const ctxHook = read("src/lib/workspace/useContextData.ts");
check("요청 훅: 이전 요청 취소 + 시간 초과 중단 + 다시 시도(reload)", ctxHook.includes("ctrlRef.current?.abort()") && ctxHook.includes("timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS") && /setTimeout\(\(\) => \{\s*timedOut = true;\s*ctrl\.abort\(\);/.test(ctxHook) && ctxHook.includes("clearTimeout(timer)") && ctxHook.includes("reload"));
const synth = code("src/app/api/llm-synthesize/route.ts");
check("AI 설명 API: 같은 입력은 저장된 문장을 쓴다(버전·입력 지문 포함 키)", synth.includes("cachedLlmText") && synth.includes("llm_synth:${LLM_SYNTH_CACHE_VERSION}") && !/export const LLM_SYNTH/.test(synth));
const p1 = code("src/app/api/dashboard/page1/route.ts"), chn = code("src/app/api/dashboard/channel/route.ts");
check("page1·channel API가 단계별 시간을 헤더로 낸다", p1.includes("createStageTimer") && p1.includes("\"Server-Timing\": timer.header()") && chn.includes("createStageTimer") && chn.includes("\"Server-Timing\": timer.header()"));

// ── 8. AI 설명 캐시(메모리 DB 대역으로 실제 동작 확인) ───────────
async function cacheChecks() {
  const db = new FakeDb();
  const cdb = db as unknown as CacheDb;
  let gen = 0;
  const make = (txt: string | null) => async () => {
    gen++;
    return txt;
  };
  const input = { channelName: "ENA", rows: [{ a: 1, p: "최근 4주" }] };
  const kind = "llm_synth:v1:why";
  const a = await cachedLlmTextWith(cdb, kind, null, input, make("첫 문장"));
  const b = await cachedLlmTextWith(cdb, kind, null, input, make("다른 문장"));
  check("같은 입력은 저장된 문장을 다시 쓴다(생성 1회)", a === "첫 문장" && b === "첫 문장" && gen === 1, `gen=${gen}`);
  const c = await cachedLlmTextWith(cdb, kind, null, { ...input, rows: [{ a: 2, p: "최근 4주" }] }, make("새 입력 문장"));
  check("입력(수치·기간)이 바뀌면 새로 만든다", c === "새 입력 문장" && gen === 2);
  const d = await cachedLlmTextWith(cdb, "llm_synth:v2:why", null, input, make("버전 2 문장"));
  check("버전 문자열이 바뀌면 캐시를 쓰지 않는다", d === "버전 2 문장" && gen === 3);
  const n1 = await cachedLlmTextWith(cdb, kind, null, { x: "실패 입력" }, make(null));
  const n2 = await cachedLlmTextWith(cdb, kind, null, { x: "실패 입력" }, make("두 번째엔 성공"));
  check("생성 실패(null)는 저장하지 않아 다음 요청이 다시 시도한다", n1 === null && n2 === "두 번째엔 성공" && gen === 5);
  check("저장 행은 4개(첫 문장·새 입력·버전2·두 번째 성공), 키는 서로 다르다", db.rows("mart_llm_text_cache").length === 4 && new Set(db.rows("mart_llm_text_cache").map((r) => r.cache_key)).size === 4);
  const k1 = llmCacheKey(kind, input), k2 = llmCacheKey(kind, { ...input });
  check("같은 입력의 키는 같다", k1 !== null && k1 === k2);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  check("직렬화할 수 없는 입력은 캐시 없이 그냥 생성", (await cachedLlmTextWith(cdb, kind, null, circular, make("순환 입력"))) === "순환 입력");
}

cacheChecks().then(() => {
  console.log(`\n${passed}개 통과, ${failures.length}개 실패`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
});
