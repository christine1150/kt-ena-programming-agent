import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data: ch } = await supabase.from("channels").select("id, primary_target").eq("code", "OLIFE").maybeSingle();
  console.log("channel:", ch);
  const { data: t } = await supabase.from("targets").select("id, label").eq("label", "전국 유료가구").maybeSingle();
  console.log("target(전국 유료가구):", t);
  if (t) {
    const { data } = await supabase.from("ratings").select("start_time, rating, share, time_spent_seconds, time_spent_share, programs(canonical_name)")
      .eq("channel_id", ch!.id).eq("target_id", t.id).in("source_type", ["nielsen_daily","skyuhd"]).eq("broadcast_date","2026-09-02").not("program_id","is",null).limit(5);
    console.log(data);
  }
}
main();
