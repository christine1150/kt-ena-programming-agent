// 2026-11-11 사용자 지시: 미스틱 첫 방송은 11/17(화) 23:20인데 11/10으로 등록돼 있어, 11/10 밤 23:28 나솔사계 재방이 미스틱으로 잡혀 홈 리뷰에 나왔다.
// 시작일을 11/17로 바로잡고(끝 방송일은 6편 기준 재계산), 회차 seed 도 11/17=1회로 옮긴다. 여러 번 실행해도 결과는 같다(멱등).
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/fix-mystic-start-1111.mts [--apply]
import { createClient } from "@supabase/supabase-js";
import { computeExpectedEndDate } from "../src/lib/featuredContentSchedule";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ENA_ID = "3bc8fc2c-bd4c-44a3-9347-2b68f99c9027";
const START = "2026-11-17";
const EPISODES = 6;

const { data: rows } = await sb
  .from("featured_content")
  .select("id, broadcast_start_date, broadcast_end_date, programs!inner(canonical_name, channel_id)")
  .eq("programs.canonical_name", "미스틱")
  .eq("programs.channel_id", ENA_ID);
if (!rows || rows.length !== 1) throw new Error(`미스틱 행을 하나로 특정하지 못했습니다: ${rows?.length}`);
const end = computeExpectedEndDate(START, ["화"], EPISODES)!;
console.log(`미스틱: ${rows[0].broadcast_start_date}~${rows[0].broadcast_end_date} → ${START}~${end} (화 23:20, ${EPISODES}편), 회차 seed ${START}=1회`);
if (APPLY) {
  const { error } = await sb
    .from("featured_content")
    .update({
      broadcast_start_date: START,
      broadcast_end_date: end,
      broadcast_schedule_text: `${START.replaceAll("-", ".")}. ~ ${end.replaceAll("-", ".")}. 매주 (화) 밤 11:20, ${EPISODES}개 에피소드`,
    })
    .eq("id", rows[0].id);
  if (error) throw error;
  const { error: seedErr } = await sb
    .from("program_episode_counters")
    .upsert({ canonical_name: "미스틱", seed_episode_number: 1, seed_broadcast_date: START }, { onConflict: "canonical_name" });
  if (seedErr) throw seedErr;
  console.log("적용 완료");
}
