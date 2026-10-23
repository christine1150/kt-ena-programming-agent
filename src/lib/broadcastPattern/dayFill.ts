// 한 채널 방영 목록의 본방 여부·회차를 본방 편성 패턴으로 보완(홈 일간 세부 내역·약해진 자리 판정 등) — DB 주입, supabase를 직접 import하지 않는다.
// 하루치는 방영이 적어 실제 시각을 학습하지 않고 패턴 시각 ±20분을 슬롯으로 본다(inferRuns learn=false). 여러 주 방영은 닐슨 실제 시각을 학습한다.
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

export interface ChannelAiring extends DayAiring {
  /** 방송일 YYYY-MM-DD */
  date: string;
}

/** rows와 같은 순서로 판정 결과를 돌려준다(패턴이 없거나 읽기에 실패하면 모두 null 판정). */
export async function patternRunsForAirings(db: Db, args: { channelId: string; channelCode: string; rows: ChannelAiring[]; learn: boolean }): Promise<RunInference[]> {
  const none: RunInference[] = args.rows.map(() => ({ firstRun: null, episode: null, source: null }));
  if (args.rows.length === 0) return none;
  try {
    const { data: ch } = await db.from("channels").select("id, code");
    const channelCodeById = new Map<string, string>(((ch ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]));
    channelCodeById.set(args.channelId, args.channelCode);
    const programs = new Map<string, { id: string; channel_id: string; canonical_name: string }>();
    for (const r of args.rows) if (r.programId && !programs.has(r.programId)) programs.set(r.programId, { id: r.programId, channel_id: args.channelId, canonical_name: r.name });
    const keys = args.rows.map((r) => normalizeProgramKey(r.name));
    const { patterns } = await loadRunPatterns(db, { memberKeys: [...new Set(keys.filter(Boolean))], workPrograms: [...programs.values()], channelCodeById });
    if (patterns.length === 0) return none;
    // 이름 키로 그 프로그램의 패턴만 판정한다(다른 프로그램 패턴이 섞이지 않게 프로그램별로 따로 돌린다)
    const out = [...none];
    const byKey = new Map<string, number[]>();
    keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), i]));
    for (const [key, idxs] of byKey) {
      const mine = patterns.filter((p) => p.programKey === key);
      if (mine.length === 0) continue;
      const res = inferRuns(
        idxs.map((i) => ({ channelCode: args.channelCode, date: args.rows[i].date, startTime: args.rows[i].startTime })),
        mine,
        { learn: args.learn }
      );
      idxs.forEach((i, j) => (out[i] = res.results[j]));
    }
    return out;
  } catch {
    return none;
  }
}

/** 하루치 방영 — rows와 같은 순서로 판정 결과를 돌려준다. */
export async function patternRunsForDay(db: Db, args: { channelId: string; channelCode: string; date: string; rows: DayAiring[] }): Promise<RunInference[]> {
  return patternRunsForAirings(db, { channelId: args.channelId, channelCode: args.channelCode, rows: args.rows.map((r) => ({ ...r, date: args.date })), learn: false });
}
