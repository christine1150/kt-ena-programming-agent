// 하루치 방영의 본방 여부·회차를 본방 편성 패턴으로 보완(홈 일간 세부 내역 등) — DB 주입, supabase를 직접 import하지 않는다.
// 하루치는 방영이 적어 실제 시각을 학습하지 않고 패턴 시각 ±20분을 슬롯으로 본다(inferRuns learn=false).
// 읽기 실패·테이블 없음은 빈 결과(보완 없음)로 조용히 넘어간다.
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import { inferRuns, type RunInference } from "./inferRuns";
import { loadRunPatterns } from "./load";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface DayAiring {
  programId: string | null;
  name: string;
  startTime: string;
}

/** rows와 같은 순서로 판정 결과를 돌려준다(패턴이 없거나 읽기에 실패하면 모두 null 판정). */
export async function patternRunsForDay(db: Db, args: { channelId: string; channelCode: string; date: string; rows: DayAiring[] }): Promise<RunInference[]> {
  const none: RunInference[] = args.rows.map(() => ({ firstRun: null, episode: null, source: null }));
  if (args.rows.length === 0) return none;
  try {
    const { data: ch } = await db.from("channels").select("id, code");
    const channelCodeById = new Map<string, string>(((ch ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
    channelCodeById.set(args.channelId, args.channelCode);
    const workPrograms = args.rows.flatMap((r) => (r.programId ? [{ id: r.programId, channel_id: args.channelId, canonical_name: r.name }] : []));
    const { patterns } = await loadRunPatterns(db, { memberKeys: [...new Set(args.rows.map((r) => normalizeProgramKey(r.name)).filter(Boolean))], workPrograms, channelCodeById });
    if (patterns.length === 0) return none;
    // 이름 키로 그 프로그램의 패턴만 판정한다(다른 프로그램 패턴이 섞이지 않게 프로그램별로 따로 돌린다)
    const out = [...none];
    const byKey = new Map<string, number[]>();
    args.rows.forEach((r, i) => byKey.set(normalizeProgramKey(r.name), [...(byKey.get(normalizeProgramKey(r.name)) ?? []), i]));
    for (const [key, idxs] of byKey) {
      const mine = patterns.filter((p) => p.programKey === key);
      if (mine.length === 0) continue;
      const res = inferRuns(
        idxs.map((i) => ({ channelCode: args.channelCode, date: args.date, startTime: args.rows[i].startTime })),
        mine,
        { learn: false }
      );
      idxs.forEach((i, j) => (out[i] = res.results[j]));
    }
    return out;
  } catch {
    return none;
  }
}
