// 한 채널 여러 주치 닐슨 방영의 본방 여부를 프로그램 성과와 같은 우선순위로 정한다(2026-10-23, 약해진 자리 판정·보고서 심층 06 공용) — DB 주입.
// 우선순위: 닐슨 `<본>`·`<재>`(is_first_run) > 업로드 편성표 [본]·[초]·[재] > 관리자 등록 본방 요일·시각 > 네이버 방송 정보(닐슨 실제 시각 학습).
// 화면마다 본방 건수가 달라지지 않도록 판정 규칙은 이 한 곳만 쓴다(프로그램 성과 sourceCore도 같은 순서·같은 inferRuns).
// 용어(사용자 정의 2026-10-23): 본방 = 각 채널에서의 첫 방송, 초방 = 본방 중에서도 원 방송사의 첫 방송.
// 초방은 편성표 [초] 표시나 본방 편성 패턴(원 방송사 채널의 본방 슬롯)으로만 안다 — 닐슨 `<본>`·편성표 [본]만으로는 초방인지 모른다.
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
  /** 초방(원 방송사 첫 방송) — 본방일 때만 true, 재방이면 false, 모르면 null */
  premiere: boolean | null;
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

/** rows와 같은 순서로 본방 여부·초방 여부와 그 근거를 돌려준다. */
export async function fillChannelRuns(db: Db, args: { channelId: string; channelCode: string; rows: FillInput[] }): Promise<FillResult[]> {
  const out: FillResult[] = args.rows.map((r) => ({ firstRun: r.firstRun, source: r.firstRun === null ? null : "nielsen", premiere: r.firstRun === false ? false : null }));
  // 본방 여부를 아직 모르거나, 본방인데 초방인지 모르는 방영
  const open = () => out.flatMap((x, i) => (x.firstRun === null || (x.firstRun === true && x.premiere === null) ? [i] : []));
  if (open().length === 0) return out;

  // ① 업로드 편성표 — [초]면 초방, [본]이면 본방(초방인지는 모름), [재]면 재방
  const dates = args.rows.map((r) => r.date).sort();
  const plan = await loadPlan(db, args.channelId, dates[0], dates[dates.length - 1]);
  if (plan.length > 0) {
    const byDate = new Map<string, PlanRow[]>();
    for (const p of plan) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
    for (const i of open()) {
      const r = args.rows[i];
      const hit = matchPlanRow(byDate.get(r.date) ?? [], { programId: r.programId, name: r.name, startTime: r.startTime });
      if (!hit) continue;
      const cur = out[i];
      if (cur.firstRun === null) {
        const run = hit.isNew ? true : hit.isRerun ? false : null;
        if (run !== null) out[i] = { firstRun: run, source: "plan", premiere: run === false ? false : hit.isPremiere ? true : null };
      } else if (cur.firstRun === true && hit.isPremiere) out[i] = { ...cur, premiere: true };
    }
  }

  // ② 본방 편성 패턴(관리자 등록 > 네이버) — 본방 여부가 정해진 방영에는 초방 여부만 더한다
  const rest = open();
  if (rest.length === 0) return out;
  const runs = await patternRunsForAirings(db, { channelId: args.channelId, channelCode: args.channelCode, rows: rest.map((i) => args.rows[i]), learn: true });
  rest.forEach((i, j) => {
    const x = runs[j];
    const cur = out[i];
    if (cur.firstRun === null) {
      if (x.firstRun !== null) out[i] = { firstRun: x.firstRun, source: x.source, premiere: x.premiere };
    } else if (x.premiere === true) out[i] = { ...cur, premiere: true };
  });
  return out;
}
