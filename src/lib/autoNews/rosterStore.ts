// 출연자 명단 읽기 — DB 표(news_cast_roster, 관리자 화면에서 고침)가 우선, 비었거나 못 읽으면 코드 명단(roster.ts).
import { supabase } from "@/lib/supabase";
import type { CastEntry, CastScope } from "./cast";
import { CAST_ROSTER } from "./roster";

export async function loadCastRoster(): Promise<{ roster: CastEntry[]; source: "db" | "code" }> {
  const { data, error } = await supabase.from("news_cast_roster").select("program, name, scope").order("display_order");
  if (error || !data || data.length === 0) return { roster: CAST_ROSTER, source: "code" };
  return { roster: data.map((r) => ({ program: r.program as string, name: (r.name as string) ?? "", scope: r.scope as CastScope })), source: "db" };
}
