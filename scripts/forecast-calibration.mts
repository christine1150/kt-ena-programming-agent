// 편성표 예측 보정(calib-v1) 관리 — 상태 보기·지금 대조·승인·복귀.
// 사용: npx tsx --env-file=.env scripts/forecast-calibration.mts <status|review|approve <model_version>|revert> [--actor <이름>]
//  - status  : 최근 후보·검증 결과·현재 승인 상태(읽기 전용)
//  - review  : 끝난 주 예측 대조 + 후보 학습을 지금 실행(크론과 같은 동작)
//  - approve : 사용자 승인을 받은 후보만 승인 기록 → 다음 새 사전 예측 저장부터 배율 적용
//  - revert  : 승인 해제(보정 없이 엔진 원값으로 저장)
import { supabase } from "../src/lib/supabase";
import { latestDataDate } from "../src/lib/scheduleForecast/record";
import { loadApprovedCalibration, refreshCalibrationCandidate, reviewEndedForecasts } from "../src/lib/scheduleForecast/review";

const [cmd, arg] = process.argv.slice(2);
const actorIdx = process.argv.indexOf("--actor");
const actor = actorIdx > 0 ? process.argv[actorIdx + 1] : "admin:cli";
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`);

async function printCandidate(modelVersion: string, evidence: any) {
  console.log(`후보 ${modelVersion} · 관측 ${evidence.obs}칸 · 학습 주 ${evidence.calibration.weeks.join(", ")}`);
  for (const [ch, f] of Object.entries<any>(evidence.calibration.channels)) {
    const gs = Object.entries<any>(evidence.calibration.groups).filter(([k]) => k.startsWith(`${ch}|`)).map(([k, g]) => `${k.split("|")[1]} ×${g.factor} (관측 ${g.observedRatio}, ${g.slots}칸)`).join(" · ");
    console.log(`  ${ch}: ×${f.factor} (관측 실제÷예상 ${f.observedRatio}, ${f.slots}칸 ${f.weeks}주) — ${gs}`);
  }
  const v = evidence.validation;
  console.log(`  검증: ${v.status} · 검증 ${v.testedWeeks}주 · 칸 오차 ${v.slotMaeRaw?.toFixed(4) ?? "—"} → ${v.slotMaeCal?.toFixed(4) ?? "—"} · 주 평균 오차 ${pct(v.weekErrRaw)} → ${pct(v.weekErrCal)}`);
  for (const w of v.weeks ?? []) console.log(`    ${w.weekStart}: ${w.slots}칸 칸 오차 ${w.slotMaeRaw.toFixed(4)} → ${w.slotMaeCal.toFixed(4)} · 주 평균 오차 ${pct(w.weekErrRaw)} → ${pct(w.weekErrCal)}`);
  console.log(`  ${v.note}`);
}

if (cmd === "status" || !cmd) {
  const { data: c } = await supabase.from("forecast_model_events").select("model_version, evidence, created_at").eq("event", "CANDIDATE").like("model_version", "calib-v1:%").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (c) await printCandidate(c.model_version, c.evidence);
  else console.log("보정 후보 없음(대조된 주가 아직 없음)");
  const ap = await loadApprovedCalibration();
  console.log(ap ? `현재 적용: ${ap.modelVersion}` : "현재 적용: 없음(엔진 원값)");
} else if (cmd === "review") {
  const cutoff = await latestDataDate();
  if (!cutoff) throw new Error("닐슨 자료 없음");
  const rv = await reviewEndedForecasts(cutoff);
  console.log(`자료 마감 ${cutoff} · 대조 ${rv.reviewed.length}건`, rv.reviewed.map((r) => `${r.channelCode} ${r.weekStart} ${r.matched}/${r.slots}칸`).join(" · "));
  for (const f of rv.failed) console.log("  실패", f.forecastId, f.reason);
  const cand = await refreshCalibrationCandidate();
  console.log(`후보: ${cand.status}`);
  if (cand.candidate) await printCandidate(cand.candidate.modelVersion, { obs: cand.candidate.obs, calibration: cand.candidate.calibration, validation: cand.candidate.validation });
} else if (cmd === "approve") {
  if (!arg?.startsWith("calib-v1:")) throw new Error("승인할 model_version(calib-v1:…)을 지정하세요.");
  const { data: c } = await supabase.from("forecast_model_events").select("evidence").eq("event", "CANDIDATE").eq("model_version", arg).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!c) throw new Error("그 후보가 없습니다.");
  const { error } = await supabase.from("forecast_model_events").insert({ model_version: arg, event: "APPROVED", evidence: { calibration: (c.evidence as any).calibration, validation: (c.evidence as any).validation }, actor_role: "admin", actor_id: actor });
  if (error) throw new Error(error.message);
  console.log(`승인 기록 완료: ${arg} — 다음 새 사전 예측 저장부터 적용`);
} else if (cmd === "revert") {
  const ap = await loadApprovedCalibration();
  if (!ap) { console.log("적용 중인 보정이 없습니다."); process.exit(0); }
  const { error } = await supabase.from("forecast_model_events").insert({ model_version: ap.modelVersion, event: "REVERTED", evidence: {}, actor_role: "admin", actor_id: actor });
  if (error) throw new Error(error.message);
  console.log(`복귀 기록 완료: ${ap.modelVersion} 해제`);
} else {
  console.log("사용: status | review | approve <model_version> | revert");
}
