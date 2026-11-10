// IPTV 교차 확인 점검: 채널별 현재(최근 14일) 교체·이동 판정에 IPTV 교차 확인이 어떻게 붙는지·이름 대응률(읽기 전용)
// 사용법: npx tsx --env-file=.env --env-file=.env.local scripts/iptv-research/xcheck-probe.mts
import { createClient } from "@supabase/supabase-js";
import { loadContentFitWith } from "../../src/lib/contentFit/sourceCore";
import { loadIptvCrossCheck } from "../../src/lib/contentFit/iptvCrossCheck";
import { addDaysStr } from "../../src/lib/contentFit/engine";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
for (const code of ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE"]) {
  const l = await loadContentFitWith(db, code, null);
  if (!l) continue;
  const live = l.result.items.filter((it) => it.lastAiredDate >= addDaysStr(l.result.asOf, -13));
  const names = new Map(live.map((it) => [it.programId, l.programs.get(it.programId)?.canonicalName ?? ""]));
  const x = await loadIptvCrossCheck(db, { channelCode: code, kpiTargetLabel: l.kpiTargetLabel, asOf: l.result.asOf, programNames: names });
  const all = live.map((it) => x.byProgramId.get(it.programId)?.status ?? "-");
  const dn = live.filter((it) => it.tag === "REPLACE" || it.tag === "MOVE");
  console.log(code, l.kpiTargetLabel, l.result.asOf, JSON.stringify(x.meta));
  console.log("  전체 live", live.length, "NO_MATCH", all.filter((s) => s === "NO_MATCH").length);
  for (const it of dn) console.log("   ", it.tag, names.get(it.programId), "→", JSON.stringify(x.byProgramId.get(it.programId)));
  for (const it of live) { const c = x.byProgramId.get(it.programId); if (c?.iptvProgramKey && c.iptvProgramKey !== names.get(it.programId)) console.log("    (대응)", names.get(it.programId), "⇒", c.iptvProgramKey); }
  for (const it of live) if (x.byProgramId.get(it.programId)?.status === "NO_MATCH") console.log("    (미대응)", names.get(it.programId));
}
