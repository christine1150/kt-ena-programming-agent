// 2026-11-09 사용자 지시: KGMA 주요 콘텐츠 리뷰에 냉정한 종합 평가를 적는다. 화면의 PD 수동 리포트 자리(program_manual_reports.headline_bullets)에 저장한다.
// "1) 요약:" 은 카드 요약 문장, "[라벨]" 줄은 인사이트 전문의 항목이 된다. 11/7 카드는 그날까지 나온 Day 1 값만, 11/8 카드는 4개 부 전체를 쓴다.
// 같은 날짜·프로그램은 다시 실행하면 덮어쓴다(멱등).
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/apply-kgma-review-1109.mts [--apply]
import { createClient } from "@supabase/supabase-js";
import { normalizeProgramCanonicalName } from "../src/lib/programNameMatch";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ENA_ID = "3bc8fc2c-bd4c-44a3-9347-2b68f99c9027";

const reports = [
  {
    date: "2026-11-07",
    program: "2026KGMAKOREAGRANDMUSICAWARDSDAY1-1부",
    bullets: [
      "1) 요약: Day 1은 2049를 1부 한 번만 지켰고 가구는 무너졌다. 1-1부 2049 0.192는 같은 시간대 직전 3주 평균(0.154)보다 높지만 가구 0.170은 평균(0.605)의 28%이고, 1-2부는 2049 0.188·가구 0.215로 지구마불 본방(2049 0.54~0.97, 가구 1.10~1.61)의 27%·16%에 그쳤다. 채널 하루 2049는 직전 4주 토요일 평균(0.147)보다 낮았다.",
      "[핵심 타깃 유입] 1-1부 2049는 성공이다(+25%). 그러나 수도권 여성 20대(0.535·0.587)에 사실상 전부 의존했고 남성 20·30대는 0.003~0.021로 없다. 1-2부에서 2049 점유율이 2.93%에서 1.97%로 떨어졌고 지구마불 본방 자리(토 19시대)의 5~10%에는 한참 못 미친다.",
      "[가구] 1-1부 0.170, 1-2부 0.215로 같은 시간대 평균의 28%·16%다. 가구층 유입은 실패했다.",
      "[지속] 2049 시청시간이 1-1부 18분 31초에서 1-2부 15분 30초로 줄었다. 낮 지구마불 재방(14:43)의 2049 0.198이 KGMA 1-1부 0.192로 이어진 것이 전부이고, 새로 끌어온 시청자는 확인되지 않는다.",
    ],
  },
  {
    date: "2026-11-08",
    program: "2026KGMAKOREAGRANDMUSICAWARDSDAY2-1부",
    bullets: [
      "1) 요약: KGMA는 시청률 기준으로 채널에 도움이 되지 못한 편성이다. 4개 부 평균이 2049 0.126·가구 0.171이고, 같은 시간대 직전 3~4주 평균 대비 가구는 4개 부 모두 −72~−85%, 2049도 Day 1-1부를 뺀 세 부가 −67~−74%다. 채널 하루 2049는 토 −15%·일 −24%, 가구는 −30%·−28%로 오히려 채널 지표를 끌어내렸다.",
      "[핵심 타깃 유입] Day 1-1부 한 번만 성공했다(2049 0.192, 평균 0.154 대비 +25%). 그마저도 수도권 여성 20대(0.535) 의존이고 남성 20·30대는 거의 0이다. Day 2는 여성 20대가 0.000~0.009로 사라져 2049가 0.052·0.071이 됐고, 같은 시간대 일요일 평균(0.200·0.217)의 26%·33%다. 핵심 타깃 유입은 실패했다.",
      "[가구] 4개 부가 0.132~0.215로, 같은 시간대 평균(0.605~1.309)의 15~28%다. 가구층은 처음부터 끌어오지 못했다.",
      "[지속] 2049 점유율이 2.93% → 1.97% → 0.63% → 0.69%로 내려갔고, 시청시간은 Day 1-1부 18분 31초에서 Day 2-2부 5분 44초로 줄었다. 이틀 동안 시청이 갈수록 얕아졌다. Day 2는 점유율이 1% 미만으로, 일요일 같은 시간대(1.5~3.9%)의 절반에도 못 미친다.",
      "[방영 효과] 앞 편성 유입도 없다. 일요일 닥터X(15:31) 2049 0.346이 KGMA 2-1부에서 0.052로 85% 빠졌고 가구도 0.818에서 0.132로 84% 빠졌다. 채널 하루 2049 점유율은 토 2.74%(직전 4주 3.30%)·일 2.21%(3.01%)로 낮았다.",
      "[지구마불 대비] 토 19시대 Day 1-2부는 지구마불 본방(2049 0.54~0.97, 가구 1.10~1.61)의 27%·16%다. 지구마불 본방이 방영되던 시간대에서 2049·가구 모두 크게 낮았다.",
      "[판단] 시청률로 보면 실패한 콘텐츠다. 핵심 타깃은 Day 1 첫 부에서만 들어왔고 가구는 유입되지 않았으며, Day 2는 2049마저 이탈했다. 화제성·광고·IP 사업 가치는 이 시청률 지표로 평가하지 않는다.",
    ],
  },
];

for (const r of reports) {
  const norm = normalizeProgramCanonicalName(r.program);
  console.log(`${r.date} ${norm} (${r.bullets.length}줄)`);
  if (!APPLY) continue;
  const { error } = await sb.from("program_manual_reports").upsert(
    { channel_id: ENA_ID, canonical_name_normalized: norm, broadcast_date: r.date, episode_number: null, headline_bullets: r.bullets, minute_ratings: null, competitor_rank_snapshot: null, competitor_programs: null, source_file_name: "KGMA 종합 평가(2026-11-09, 닐슨 실측 비교)" },
    { onConflict: "channel_id,canonical_name_normalized,broadcast_date" }
  );
  if (error) throw error;
}
console.log(APPLY ? "적용 완료" : "점검만 했습니다(--apply 로 적용)");
