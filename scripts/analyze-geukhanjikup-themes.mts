// Task 2(사용자 지시 2026-08-22): <극한직업> 테마별 시청률 상관관계 분석.
// olife_episode_catalog(테마 태그) ↔ ratings.episode_subtitle(EPG 매칭으로 이미 채워진 부제)를
// 텍스트 정규화로 매칭해, 테마별 평균 시청률을 전체 평균과 비교한다.
// 실행: npx tsx --env-file=.env scripts/analyze-geukhanjikup-themes.mts
import { createClient } from "@supabase/supabase-js";
import { normalizeSubtitle } from "../src/lib/olifeEpisodeParsing";
import { resolveProgramLevelTargetLabel } from "../src/lib/targetResolution";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const { data: channel } = await supabase.from("channels").select("id, primary_target").eq("code", "OLIFE").maybeSingle();
if (!channel) throw new Error("OLIFE 채널을 찾을 수 없습니다.");
// 실측 확인(2026-08-22): 타깃 필터 없이 조회하면 한 방영분에 타깃별 행이 여러 개 잡혀(대부분
// 표본 작은 세부 타깃이라 0에 가까움) 평균이 크게 왜곡된다 — 채널 KPI 타깃(program-level 라벨)
// 하나로 좁혀서 "방영분당 행 1개"가 되도록 한다(다른 리포트가 이미 쓰는 패턴과 동일).
const programTargetLabel = resolveProgramLevelTargetLabel(channel.primary_target);
const { data: targetRow } = await supabase.from("targets").select("id").eq("label", programTargetLabel).maybeSingle();
if (!targetRow) throw new Error(`타깃 "${programTargetLabel}"을 찾을 수 없습니다.`);
console.log(`OLIFE KPI 타깃: ${programTargetLabel}`);

const { data: catalogRows } = await supabase
  .from("olife_episode_catalog")
  .select("subtitle_norm, subtitle_raw, themes, series_lead, detail_tail, country_guess")
  .eq("series_name", "극한직업");
console.log("극한직업 카탈로그:", catalogRows?.length, "건");

const { data: ratingRows } = await supabase
  .from("ratings")
  .select("rating, broadcast_date, episode_subtitle, programs(canonical_name)")
  .eq("channel_id", channel.id)
  .eq("target_id", targetRow.id)
  .eq("source_type", "nielsen_daily")
  .not("program_id", "is", null)
  .not("rating", "is", null)
  .not("episode_subtitle", "is", null);

const geukhanjikupRows = (ratingRows ?? []).filter((r) => {
  const name = Array.isArray(r.programs) ? r.programs[0]?.canonical_name : (r.programs as { canonical_name: string } | null)?.canonical_name;
  return name === "극한직업";
});
console.log("극한직업 시청률 행(부제 있음):", geukhanjikupRows.length, "건");

const catalogByNorm = new Map((catalogRows ?? []).map((c) => [c.subtitle_norm, c]));

type ThemeStat = { ratings: number[]; dates: Set<string>; episodes: Set<string> };
const byTheme = new Map<string, ThemeStat>();
let matchedCount = 0;
const overallRatings: number[] = [];
const matchedSamples: { date: string; subtitle: string; rating: number; themes: string[] }[] = [];

for (const r of geukhanjikupRows) {
  overallRatings.push(r.rating);
  const norm = normalizeSubtitle(r.episode_subtitle);
  const cat = catalogByNorm.get(norm);
  if (!cat) continue;
  matchedCount++;
  if (matchedSamples.length < 15) matchedSamples.push({ date: r.broadcast_date, subtitle: r.episode_subtitle, rating: r.rating, themes: cat.themes });
  const themes = cat.themes && cat.themes.length > 0 ? cat.themes : ["(미분류)"];
  for (const t of themes) {
    if (!byTheme.has(t)) byTheme.set(t, { ratings: [], dates: new Set(), episodes: new Set() });
    const s = byTheme.get(t)!;
    s.ratings.push(r.rating);
    s.dates.add(r.broadcast_date);
    s.episodes.add(norm);
  }
}

const overallAvg = overallRatings.reduce((a, b) => a + b, 0) / (overallRatings.length || 1);
const matchedAvg =
  matchedSamples.length > 0
    ? [...byTheme.values()].flatMap((s) => s.ratings).reduce((a, b) => a + b, 0) / [...byTheme.values()].flatMap((s) => s.ratings).length
    : null;

console.log(`\n카탈로그 매칭 성공: ${matchedCount}/${geukhanjikupRows.length}건 (${((matchedCount / (geukhanjikupRows.length || 1)) * 100).toFixed(1)}%)`);
console.log(`극한직업 전체 평균 시청률(부제 있는 전체): ${overallAvg.toFixed(4)}`);

console.log("\n=== 테마별 평균 시청률(매칭된 방영분 기준) ===");
const MIN_EPISODES = 3;
const results = [...byTheme.entries()]
  .map(([theme, s]) => ({
    theme,
    avgRating: s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length,
    episodeCount: s.episodes.size,
    airCount: s.ratings.length,
    dateCount: s.dates.size,
  }))
  .sort((a, b) => b.avgRating - a.avgRating);

for (const r of results) {
  const vsOverallPct = ((r.avgRating - overallAvg) / overallAvg) * 100;
  const confidence = r.episodeCount >= MIN_EPISODES ? "충분" : "표본 부족(참고용)";
  console.log(
    `${r.theme.padEnd(12, " ")} 평균 ${r.avgRating.toFixed(4)} (전체 평균 대비 ${vsOverallPct >= 0 ? "+" : ""}${vsOverallPct.toFixed(1)}%) — 회차 ${r.episodeCount}개/방영 ${r.airCount}회/일수 ${r.dateCount}일 [${confidence}]`
  );
}

console.log("\n=== 매칭 샘플(최대 15건) ===");
matchedSamples.forEach((s) => console.log(JSON.stringify(s)));
