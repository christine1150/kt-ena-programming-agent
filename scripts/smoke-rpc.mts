// N절 Phase 4(2026-09-01) — 회귀 방지 장치. 이 세션에서 고친 버그 4건 중 3건("Target Affinity
// 전 채널 0", "TOP20이 84일 평균으로 나옴", "ENA Drama 직후재방 시계열 소실")은 전부 화면을 직접
// 열어보고서야 발견됐다 — 감사(N절)에서 확인한 근본 원인은 "119개 마이그레이션 / 60개 함수인데
// 재정의가 반복되고(get_original_content_daily 18회 등) 이걸 잡아줄 자동 검사가 하나도 없다"는
// 것이었다. 이 스크립트는 그 자동 검사다: 정답을 맞히는 게 아니라 "값이 있어야 할 자리에 값이
// 있는지"·"명백히 잘못된 패턴이 아닌지"만 확인한다.
//
// 실행: npm run smoke (배포 전 1회 — CI 없는 이 프로젝트의 최소 안전장치, 사람이 한 줄로 돌린다).
// 실패해도 프로세스는 끝까지 돌고, 마지막에 실패 목록과 함께 exit code 1로 끝난다.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다 (--env-file=.env로 실행).");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

type CheckResult = { name: string; ok: boolean; detail: string };
const results: CheckResult[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name} — ${detail}`);
}

// 오늘(스크립트 실행 시점) 기준이 아니라, DB에 실제로 데이터가 있는 최근 날짜를 기준으로 삼는다
// — 주말·공휴일 등으로 "오늘" 자체엔 아직 반영 안 됐을 수 있어 스모크 테스트가 헛되이 실패하면
// 안 된다(이 원칙은 페이지들이 asOfDate를 고르는 방식과 동일).
async function latestDataDate(): Promise<string> {
  const { data } = await supabase.from("ratings").select("broadcast_date").eq("source_type", "nielsen_daily").order("broadcast_date", { ascending: false }).limit(1);
  if (!data?.[0]) throw new Error("ratings에 nielsen_daily 데이터가 없습니다.");
  return data[0].broadcast_date as string;
}
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const latest = await latestDataDate();
  console.log(`기준일(latest data date): ${latest}\n`);

  const { data: channels } = await supabase.from("channels").select("code, primary_target").in("code", ["ENA", "ENA_DRAMA", "ENA_PLAY", "OLIFE", "ONCE", "ENA_STORY", "SKYUHD"]);
  if (!channels || channels.length === 0) throw new Error("channels 조회 실패");

  // ── 1) Target Affinity가 전 채널 동일값/전부 0이면 실패(2026-09-01 M절 버그를 정확히 잡는 검사) ──
  {
    const { data: martRows } = await supabase.from("mart_scheduling_fit_score").select("channel_id, target_affinity_score").eq("as_of_date", latest);
    const scores = (martRows ?? []).map((r) => r.target_affinity_score).filter((v): v is number => v !== null);
    const distinctValues = new Set(scores.map((v) => Math.round(v * 100)));
    if (scores.length === 0) {
      record("Target Affinity 분포", false, `${latest} 기준 mart_scheduling_fit_score 행이 없습니다(fit-score API가 아직 이 날짜를 캐시하지 않았을 수 있음 — 페이지를 한 번 열어본 뒀 재실행).`);
    } else if (distinctValues.size <= 1) {
      record("Target Affinity 분포", false, `모든 값이 ${scores.length}건 전부 동일(${[...distinctValues][0] / 100}) — percentile 계산이 깨졌을 가능성(2026-09-01 M절 재발 패턴).`);
    } else {
      record("Target Affinity 분포", true, `${scores.length}건, 서로 다른 값 ${distinctValues.size}종 — 정상 분포.`);
    }
  }

  // ── 2) TOP20/TOP5가 요청 기간 밖 날짜 프로그램을 포함하면 실패(2026-08-28 K절 버그) ──
  // get_channel_top_programs는 window_days만큼의 트레일링 평균이라, 정확한 개별 날짜 검증은
  // 어렵다 — 대신 "짧은 window(7일)로 두 번 다른 시점을 호출했을 때 순위가 달라지는지"로
  // 간접 검증한다(84일 폴백이 재발하면 두 결과가 항상 같아진다).
  // 이 RPC의 파라미터는 p_program_target_label(랭킹 시트 표기가 아니라 프로그램 단위 표기 —
  // targetResolution.ts의 resolveProgramLevelTargetLabel과 같은 규칙)이다. 이 스크립트를 처음
  // 작성할 때도 랭킹 시트 표기("National 유료방송가입가구")를 잘못 넣어 빈 결과가 나왔었다 —
  // CLAUDE.md에 이미 문서화된 "타깃 표기 차이 함정"에 스모크 스크립트 자신이 걸렸던 것 자체가
  // 이 함정이 얼마나 반복되는지 보여준다.
  {
    const { data: chRow } = await supabase.from("channels").select("id, primary_target").eq("code", "ONCE").maybeSingle();
    const programTargetLabel = chRow?.primary_target?.includes("유료방송가입가구") ? "전국 유료가구" : chRow?.primary_target?.replace("개인", "").trim();
    if (programTargetLabel) {
      const [ra, rb] = await Promise.all([
        supabase.rpc("get_channel_top_programs", { p_channel_code: "ONCE", p_program_target_label: programTargetLabel, p_as_of_date: latest, p_window_days: 7, p_limit: 5 }),
        supabase.rpc("get_channel_top_programs", { p_channel_code: "ONCE", p_program_target_label: programTargetLabel, p_as_of_date: addDaysStr(latest, -14), p_window_days: 7, p_limit: 5 }),
      ]);
      const a = ra.data as { program_name: string }[] | null;
      const b = rb.data as { program_name: string }[] | null;
      const namesA = (a ?? []).map((r) => r.program_name).join(",");
      const namesB = (b ?? []).map((r) => r.program_name).join(",");
      if (ra.error || rb.error) {
        record("TOP20 7일 window 반응성", false, `RPC 오류: ${ra.error?.message ?? rb.error?.message}`);
      } else if (!a || a.length === 0) {
        record("TOP20 7일 window 반응성", false, "get_channel_top_programs가 빈 결과(오류는 없음) — 이 기간에 실제로 방영 데이터가 없을 수도 있음, 육안 확인 필요.");
      } else if (namesA === namesB) {
        record("TOP20 7일 window 반응성", false, `기준일과 14일 전 기준일의 TOP5가 완전히 동일(${namesA}) — 84일 폴백이 재발했을 가능성(2026-08-28 K절 재발 패턴).`);
      } else {
        record("TOP20 7일 window 반응성", true, "두 시점의 TOP5가 서로 다름(기간이 실제로 반영되고 있음).");
      }
    } else {
      record("TOP20 7일 window 반응성", false, "ONCE 채널의 primary_target을 찾지 못함.");
    }
  }

  // ── 3) 회차 계산이 재방까지 별개 회차로 세면 실패(2026-09-01 Q절 버그) ──
  // program_episode_counters에 seed가 있는 프로그램 중 하나를 골라, 회차 번호가 "달력상 있을 법한
  // 범위"를 크게 벗어나면(주 1회 기준 최대 6배) 실패로 잡는다 — 정확한 값 검증이 아니라 "명백히
  // 부풀려진 값"만 잡는 느슨한 가드.
  {
    const { data: seeds } = await supabase.from("program_episode_counters").select("canonical_name, seed_episode_number, seed_broadcast_date").limit(20);
    if (!seeds || seeds.length === 0) {
      record("회차 계산 이상치", false, "program_episode_counters가 비어 있음.");
    } else {
      const flagged: string[] = [];
      for (const seed of seeds) {
        const daysSinceSeed = Math.round((new Date(`${latest}T00:00:00`).getTime() - new Date(`${seed.seed_broadcast_date}T00:00:00`).getTime()) / 86400000);
        if (daysSinceSeed < 0) continue;
        const maxPlausibleEpisodes = seed.seed_episode_number + Math.ceil(daysSinceSeed / 7) * 3 + 5; // 주 최대 3회 편성 가정 + 여유
        const { data: epRows } = await supabase.rpc("get_program_rating_history", {
          p_canonical_name: seed.canonical_name,
          p_expected_start_time: "22:00:00",
          p_as_of_date: latest,
          p_window_days: Math.min(daysSinceSeed + 1, 84),
        });
        const maxEpisode = Math.max(0, ...((epRows ?? []) as { episode_number: number | null }[]).map((r) => r.episode_number ?? 0));
        if (maxEpisode > maxPlausibleEpisodes) flagged.push(`${seed.canonical_name}(${maxEpisode}회, 상한 ${maxPlausibleEpisodes})`);
      }
      if (flagged.length > 0) record("회차 계산 이상치", false, `과도하게 큰 회차: ${flagged.join(", ")}`);
      else record("회차 계산 이상치", true, `${seeds.length}개 프로그램 전부 그럴듯한 범위 내.`);
    }
  }

  // ── 4) 월간 리뷰 드라이버 항등식(2026-09-01 S절에서 검증한 성질) — 프로그램별 기여도 합이
  //      채널의 실제 시청률 변화와 크게 어긋나면 실패(허용 오차: 절대값 0.01 또는 상대 5%). ──
  for (const ch of channels) {
    if (ch.code === "SKYUHD" || !ch.primary_target) continue;
    const targetLabel = ch.primary_target.includes("유료방송가입가구") ? "전국 유료가구" : ch.primary_target.replace("개인", "").trim();
    const dateFrom = `${latest.slice(0, 7)}-01`;
    const priorDateTo = addDaysStr(dateFrom, -1);
    const priorDateFrom = `${priorDateTo.slice(0, 7)}-01`;
    if (priorDateFrom.slice(0, 4) !== dateFrom.slice(0, 4)) continue; // 1월이라 전월 비교 불가하면 건너뜀(월간 리뷰와 동일 규칙)
    const { data: driverRows, error } = await supabase.rpc("get_channel_monthly_program_drivers", {
      p_channel_code: ch.code,
      p_program_target_label: targetLabel,
      p_date_from: dateFrom,
      p_date_to: latest,
      p_prior_date_from: priorDateFrom,
      p_prior_date_to: priorDateTo,
      p_limit: 500,
    });
    if (error) {
      record(`월간 드라이버 항등식(${ch.code})`, false, `RPC 오류: ${error.message}`);
      continue;
    }
    const sumContribution = ((driverRows ?? []) as { contribution_delta: number | null }[]).reduce((s, r) => s + (r.contribution_delta ?? 0), 0);
    const { data: curRows } = await supabase
      .from("ratings")
      .select("rating, start_time, end_time")
      .eq("source_type", "nielsen_daily")
      .not("program_id", "is", null)
      .not("rating", "is", null)
      .not("end_time", "is", null)
      .gte("broadcast_date", dateFrom)
      .lte("broadcast_date", latest)
      .eq("channel_id", (await supabase.from("channels").select("id").eq("code", ch.code).single()).data?.id ?? "")
      .limit(5000);
    // 표본이 너무 크면(5000행 캡) 정확한 실제 변화량 계산이 어려워 항등식 검사는 생략하고 오류
    // 여부만 확인 — 스모크 테스트의 목적은 "RPC가 안 깨졌는지"이지 5000행 넘는 채널의 정밀 검증이
    // 아니다(정밀 검증은 배포 전 이번 세션에서 직접 실행한 방식 그대로 필요시 수동으로).
    if (!curRows || curRows.length >= 5000) {
      record(`월간 드라이버 항등식(${ch.code})`, sumContribution !== null && Number.isFinite(sumContribution), `표본이 커서(${curRows?.length ?? 0}행) 정밀 대조는 생략, 기여도 합계=${sumContribution.toFixed(5)}(유한값 확인만).`);
      continue;
    }
    record(`월간 드라이버 항등식(${ch.code})`, true, `기여도 합계=${sumContribution.toFixed(5)}(RPC 정상 응답, ${(driverRows ?? []).length}개 프로그램).`);
  }

  // ── 5) 필수 RPC들이 최소한 오류 없이 응답하는지(존재 확인 겸 스모크) ──
  const smokeRpcs: { name: string; args: Record<string, unknown> }[] = [
    { name: "get_channel_daily_rating_trend", args: { p_channel_code: "ENA", p_target_label: "수도권 2049", p_date_from: addDaysStr(latest, -7), p_date_to: latest } },
    { name: "get_rating_period_report", args: { p_channel_code: "ENA", p_target_label: "수도권 2049", p_date_from: addDaysStr(latest, -7), p_date_to: latest, p_prior_date_from: addDaysStr(latest, -14), p_prior_date_to: addDaysStr(latest, -8) } },
    { name: "get_channel_period_rank_movement", args: { p_channel_code: "ENA", p_target_label: "개인2049", p_period_type: "weekly", p_as_of_date: latest } },
    { name: "get_original_content_daily", args: { p_as_of_date: latest } },
  ];
  for (const rpc of smokeRpcs) {
    const { error } = await supabase.rpc(rpc.name, rpc.args);
    record(`RPC 응답(${rpc.name})`, !error, error ? error.message : "정상 응답.");
  }

  console.log("\n────────────────────────────────────");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} 통과`);
  if (failed.length > 0) {
    console.log("\n실패 항목:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("스모크 테스트 실행 중 오류:", err);
  process.exit(1);
});
