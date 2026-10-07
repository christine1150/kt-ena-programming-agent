// 칸의 대체 후보 목록 + 후보별 권리 판정(OPT06, 서버 전용) — 조회만 한다(권리 예약·편성 저장 없음).
// 후보를 고르기 전에 "이 자리에 편성할 수 있는 권리인가"를 같은 판정(rightsServer)으로 보여 주고, 교체 때 거부·검토안 안내와 같은 문구를 쓴다.
import { supabase } from "@/lib/supabase";
import { ClientError } from "./errors";
import { loadRightsLookup } from "./rightsServer";
import { loadCandidates } from "./runStore";
import { swapRightsVerdict } from "./slotRights";

export async function loadCandidatesWithRights(runId: string, blockId: string) {
  const [cands, runRes, blockRes, lookup] = await Promise.all([
    loadCandidates(runId, blockId),
    supabase.from("ideal_schedule_runs").select("week_start, channels(code)").eq("id", runId).maybeSingle(),
    supabase.from("ideal_schedule_blocks").select("weekday, start_min, end_min").eq("id", blockId).eq("run_id", runId).maybeSingle(),
    loadRightsLookup(),
  ]);
  if (runRes.error) throw new Error(runRes.error.message);
  if (!runRes.data || !blockRes.data) throw new ClientError("블록을 찾을 수 없습니다.");
  const ch = Array.isArray(runRes.data.channels) ? runRes.data.channels[0] : runRes.data.channels;
  const weekStart = runRes.data.week_start as string;
  const b = blockRes.data as { weekday: number; start_min: number | string; end_min: number | string };
  const candidates = cands.map((c) => {
    const cj = c.candidate as { contentType: string; programId: string | null; programName: string; genre?: string | null };
    const rights = lookup.check(cj, weekStart, (ch as { code: string }).code, Number(b.weekday), Number(b.start_min), Number(b.end_min));
    return { ...c, rights, swapVerdict: swapRightsVerdict(rights) };
  });
  return { candidates, rights: { status: lookup.status, message: lookup.message, inventoryVersion: lookup.inventoryVersion } };
}
