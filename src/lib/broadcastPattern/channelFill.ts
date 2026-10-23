// 한 채널 여러 주치 닐슨 방영의 본방 여부를 프로그램 성과와 같은 우선순위로 정한다(2026-10-23, 약해진 자리 판정·보고서 심층 06 공용) — DB 주입.
// 우선순위: 닐슨 `<본>`·`<재>`(is_first_run) > 업로드 편성표 [본]·[초]·[재] > 관리자 등록 본방 요일·시각 > 네이버 방송 정보(닐슨 실제 시각 학습).
// 화면마다 본방 건수가 달라지지 않도록 판정 규칙은 이 한 곳만 쓴다(프로그램 성과 sourceCore도 같은 순서·같은 inferRuns).
// 읽기 실패·테이블 없음은 그 단계만 건너뛴다(본방 여부는 그대로 '모름').
import { addDays } from "@/lib/idealSchedule/time";
import { matchPlanRow, normalizePlanRows, type PlanRow, type PlanRowRaw } from "@/lib/idealSchedule/planEpisodes";
import { patternRunsForAirings } from "./dayFill";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export type RunSource = "nielsen" | "plan" | "registered" | "naver";

export interface FillInput {
  programId: string | null;
  name: string;
  /** 방송일 YYYY-MM-DD */
  date: string;
  startTime: string;
  /** 닐슨 표시(is_first_run) */
  firstRun: boolean | null;
}

export interface FillResult {
  firstRun: boolean | null;
  source: RunSource | null;
}

async function loadPlan(db: Db, channelId: string, from: string, to: string): Promise<PlanRow[]> {
  try {
    const raw: PlanRowRaw[] = [];
    for (let a = 0; ; a += 1000) {
      const { data, error } = await db
        .from("program_schedule_grid")
        .select("week_start, broadcast_date, start_time, end_time, program_name_raw, episode_number, episode_subtitle, matched_program_id, tags")
        .eq("channel_id", channelId)
        .gte("broadcast_date", addDays(from, -1))
        .lte("broadcast_date", addDays(to, 1))
        .order("broadcast_date", { ascending: true })
        .order("start_time", { ascending: true })
        .range(a, a + 999);
      if (error) return [];
      raw.push(...((data ?? []) as PlanRowRaw[]));
      if ((data ?? []).length < 1000) break;
    }
    return normalizePlanRows(raw).filter((p) => p.date >= from && p.date <= to);
  } catch {
    return [];
  }
}

/** rows와 같은 순서로 본방 여부와 그 근거를 돌려준다. */
export async function fillChannelRuns(db: Db, args: { channelId: string; channelCode: string; rows: FillInput[] }): Promise<FillResult[]> {
  const out: FillResult[] = args.rows.map((r) => ({ firstRun: r.firstRun, source: r.firstRun === null ? null : "nielsen" }));
  const open = () => out.flatMap((x, i) => (x.firstRun === null ? [i] : []));
  if (open().length === 0) return out;

  // ① 업로드 편성표
  const dates = args.rows.map((r) => r.date).sort();
  const plan = await loadPlan(db, args.channelId, dates[0], dates[dates.length - 1]);
  if (plan.length > 0) {
    const byDate = new Map<string, PlanRow[]>();
    for (const p of plan) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
    for (const i of open()) {
      const r = args.rows[i];
      const hit = matchPlanRow(byDate.get(r.date) ?? [], { programId: r.programId, name: r.name, startTime: r.startTime });
      const run = hit ? (hit.isNew ? true : hit.isRerun ? false : null) : null;
      if (run !== null) out[i] = { firstRun: run, source: "plan" };
    }
  }

  // ② 본방 편성 패턴(관리자 등록 > 네이버)
  const rest = open();
  if (rest.length === 0) return out;
  const runs = await patternRunsForAirings(db, { channelId: args.channelId, channelCode: args.channelCode, rows: rest.map((i) => args.rows[i]), learn: true });
  rest.forEach((i, j) => {
    if (runs[j].firstRun !== null) out[i] = { firstRun: runs[j].firstRun, source: runs[j].source };
  });
  return out;
}
