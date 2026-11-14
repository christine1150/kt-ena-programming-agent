// 페이지·API 체감 속도 요약(고도화 계획 E1) — page_timing_log를 읽어 화면 경로·지표별 p50/p95와 속도 목표 대비를 낸다(읽기 전용).
// 사용법: npx tsx --env-file=.env scripts/page-timing-report.ts [일수=14]
// 마이그레이션(20261114010000)이 적용돼 있어야 한다. 표본이 적은 항목(n<20)은 "참고"로 표시한다.
import { createClient } from "@supabase/supabase-js";
import { TIMING_TARGET_MS } from "../src/lib/pageTiming";

const days = Math.max(1, Math.min(90, Number(process.argv[2]) || 14));
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data, error } = await sb.rpc("page_timing_summary", { p_days: days });
if (error) {
  console.error(`page_timing_summary 호출 실패: ${error.message}\n(마이그레이션 20261114010000 적용 여부를 확인하세요)`);
  process.exit(1);
}
type Row = { path: string; metric: string; api_path: string | null; n: number; p50_ms: number; p95_ms: number; max_ms: number };
const rows = (data ?? []) as Row[];
if (rows.length === 0) {
  console.log(`최근 ${days}일 기록이 없습니다. 배포 후 화면을 사용하면 쌓입니다.`);
  process.exit(0);
}

const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`);
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - [...s].length));

console.log(`\n== 화면 지표(최근 ${days}일) ==`);
console.log(pad("화면", 34) + pad("지표", 6) + pad("n", 6) + pad("p50", 9) + pad("p95", 9) + "목표(lcp)");
for (const r of rows.filter((x) => x.metric !== "api")) {
  const tgt = r.metric === "lcp" ? TIMING_TARGET_MS[r.path] : undefined;
  const verdict = tgt ? (r.p95_ms <= tgt ? `✓ p95 ≤ ${fmt(tgt)}` : `✗ p95 > ${fmt(tgt)}`) : "";
  console.log(pad(r.path, 34) + pad(r.metric, 6) + pad(String(r.n), 6) + pad(fmt(r.p50_ms), 9) + pad(fmt(r.p95_ms), 9) + verdict + (r.n < 20 ? " (참고: 표본 적음)" : ""));
}

console.log(`\n== 느린 API 상위 15(p95 기준, n≥5) ==`);
const api = rows.filter((x) => x.metric === "api" && x.n >= 5).sort((a, b) => b.p95_ms - a.p95_ms).slice(0, 15);
console.log(pad("화면", 30) + pad("API", 44) + pad("n", 6) + pad("p50", 9) + "p95");
for (const r of api) console.log(pad(r.path, 30) + pad(r.api_path ?? "", 44) + pad(String(r.n), 6) + pad(fmt(r.p50_ms), 9) + fmt(r.p95_ms));
