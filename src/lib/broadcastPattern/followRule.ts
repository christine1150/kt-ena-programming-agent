// 후행 채널 본방 규칙(사용자 지시 2026-10-27: "ENA Drama 지구마불 4는 ENA가 방송한 다음 2일 이내에 시작한 것이 본방").
// 원 방송 채널(ENA)의 본방(`<본>`) 방송일로부터 N일 이내에 후행 채널이 시작한 방영은 그 채널의 본방이고, 그 밖의 방영은 재방이다.
// 닐슨 표시(<본>·<재>)가 없는 방영에만 적용한다(표시가 있으면 표시가 우선). 원 방송 채널의 본방 기록이 없으면 판정하지 않는다(모름).
// 날짜는 방송일(캘린더) 기준이고, 같은 날이면 원 방송 시작 시각보다 늦게 시작한 방영만 본방이다.
// 순수 함수 + DB 주입 로더 — supabase를 직접 import하지 않는다.
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import { addDays } from "@/lib/idealSchedule/time";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

export interface FollowRule {
  /** normalizeProgramKey 기준 작품 키(회차·시즌 숫자 포함) */
  programKeys: string[];
  /** 규칙을 적용하는 채널 코드 */
  followerChannel: string;
  /** 원 방송 채널 코드 — 이 채널의 본방(is_first_run=true) 방송을 기준으로 삼는다 */
  sourceChannel: string;
  /** 원 방송일로부터 이 일수 이내(방송일 차이)에 시작하면 본방 */
  withinDays: number;
  /** 화면 안내 문구용 */
  label: string;
  /** "first" — 원 방송 본방마다 그 뒤 withinDays일 이내 첫 방영 한 건만 본방(나머지는 재방). 없으면 기간 안 모든 방영이 본방 */
  mode?: "first";
}

export const FOLLOW_RULES: FollowRule[] = [
  { programKeys: [normalizeProgramKey("지구마불 세계여행 4")], followerChannel: "ENA_DRAMA", sourceChannel: "ENA", withinDays: 2, label: "ENA Drama '지구마불 세계여행 4'" },
  // 사용자 지시(2026-11-02): ENA Drama는 ENA 본방 뒤 처음 방송되는 방영이 본방. 자료상 간격이 하루를 넘어(ENA 금 22:50 → ENA Drama 3일 뒤) 기간은 넉넉히 두고 '첫 방영'만 본방으로 센다.
  { programKeys: [normalizeProgramKey("결이 다른 전쟁사")], followerChannel: "ENA_DRAMA", sourceChannel: "ENA", withinDays: 5, label: "ENA Drama '결이 다른 전쟁사'", mode: "first" },
  // 사용자 지시(2026-11-14): ENA Play 니돈내산은 ENA 일요일 본방 직후 심야(24~25시대)에 처음 방송되는 한 건이 본방, 그 밖은 재방(10/04 24:25 = 2회 본방이 '미확인'으로 나오던 문제)
  { programKeys: [normalizeProgramKey("니돈내산")], followerChannel: "ENA_PLAY", sourceChannel: "ENA", withinDays: 1, label: "ENA Play '니돈내산'", mode: "first" },
];

/** 이 채널·작품에 적용되는 규칙(없으면 null). memberKeys는 작품 묶음의 정규화 키들. */
export function followRuleFor(channelCode: string, memberKeys: Iterable<string>): FollowRule | null {
  const keys = new Set(memberKeys);
  return FOLLOW_RULES.find((r) => r.followerChannel === channelCode && r.programKeys.some((k) => keys.has(k))) ?? null;
}

export interface SourceAir {
  date: string;
  startTime: string | null;
}

const minutesOf = (t: string | null): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * 후행 채널 방영의 본방 여부. 원 방송 본방 기록(sources)이 없거나 그 첫 방송일보다 앞선 방영은 판정할 수 없어 null.
 */
export function followRunOf(date: string, startTime: string | null, sources: SourceAir[], withinDays: number): boolean | null {
  if (sources.length === 0) return null;
  const day = dayNumber(date);
  const m = minutesOf(startTime);
  let earliest = Infinity;
  for (const s of sources) {
    const sd = dayNumber(s.date);
    earliest = Math.min(earliest, sd);
    const diff = day - sd;
    if (diff < 0 || diff > withinDays) continue;
    if (diff > 0) return true;
    const sm = minutesOf(s.startTime);
    if (m !== null && sm !== null && m > sm) return true;
  }
  return day < earliest ? null : false;
}

/**
 * 규칙에 따른 후행 채널 방영들의 본방 여부(rows와 같은 순서). mode가 "first"가 아니면 followRunOf와 같다.
 * "first" — 원 방송 본방 시각 이후 withinDays일 이내 방영 중 가장 이른 한 건만 본방, 같은 구간의 나머지는 재방.
 * 어느 원 방송 본방보다도 앞선 방영은 판정할 수 없어 null.
 */
export function followRunsOf(rows: { date: string; startTime: string | null }[], sources: SourceAir[], rule: Pick<FollowRule, "withinDays" | "mode">): (boolean | null)[] {
  if (rule.mode !== "first") return rows.map((r) => followRunOf(r.date, r.startTime, sources, rule.withinDays));
  if (sources.length === 0) return rows.map(() => null);
  // 00~01시 시작은 방송일(편성일)의 다음 날 새벽이라 하루(1440분)를 더한다 — 닐슨 방송일은 02시 기준 편성일이다
  const at = (date: string, t: string | null) => {
    const m = minutesOf(t) ?? 0;
    return dayNumber(date) * 1440 + m + (m < 120 ? 1440 : 0);
  };
  const srcAt = sources.map((s) => at(s.date, s.startTime)).sort((a, b) => a - b);
  const out: (boolean | null)[] = rows.map(() => null);
  // 원 방송 본방마다 그 뒤 첫 방영 — 가장 가까운 앞선 본방에 묶는다
  const firstOf = new Map<number, { idx: number; t: number }>();
  rows.forEach((r, i) => {
    const t = at(r.date, r.startTime);
    let src = -1;
    for (const s of srcAt) if (s < t) src = s;
    if (src < 0) return; // 첫 원 방송보다 앞 — 판정 불가
    if (t - src > rule.withinDays * 1440) { out[i] = false; return; }
    out[i] = false;
    const cur = firstOf.get(src);
    if (!cur || t < cur.t) firstOf.set(src, { idx: i, t });
  });
  for (const { idx } of firstOf.values()) out[idx] = true;
  return out;
}

/** 원 방송 채널 프로그램(programIds)의 본방(is_first_run=true) 방송일·시각 — from의 withinDays일 전부터 to까지 */
export async function loadFollowSources(db: Db, programIds: string[], from: string, to: string, withinDays: number): Promise<SourceAir[]> {
  if (programIds.length === 0) return [];
  const seen = new Set<string>();
  const out: SourceAir[] = [];
  try {
    for (let a = 0; ; a += 1000) {
      const { data, error } = await db
        .from("ratings")
        .select("broadcast_date, start_time")
        .in("program_id", programIds)
        .eq("source_type", "nielsen_daily")
        .eq("is_first_run", true)
        .gte("broadcast_date", addDays(from, -withinDays))
        .lte("broadcast_date", to)
        .order("broadcast_date", { ascending: true })
        .order("id", { ascending: true })
        .range(a, a + 999);
      if (error) return [];
      for (const r of (data ?? []) as { broadcast_date: string; start_time: string | null }[]) {
        const k = `${r.broadcast_date}|${r.start_time}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ date: r.broadcast_date, startTime: r.start_time });
      }
      if ((data ?? []).length < 1000) break;
    }
  } catch {
    return [];
  }
  return out;
}

/** 작품 이름(닐슨 표기)으로 원 방송 채널 프로그램 id를 찾아 본방 방송을 읽는다 — 프로그램 단위가 아닌 호출(약해진 자리 등)용 */
export async function loadFollowSourcesByName(db: Db, rule: FollowRule, from: string, to: string): Promise<SourceAir[]> {
  try {
    const { data: ch } = await db.from("channels").select("id").eq("code", rule.sourceChannel).maybeSingle();
    if (!ch?.id) return [];
    const { data: progs, error } = await db.from("programs").select("id, canonical_name").eq("channel_id", ch.id).in("norm_canonical_name", rule.programKeys);
    if (error) return [];
    const ids = ((progs ?? []) as { id: string; canonical_name: string | null }[]).filter((p) => rule.programKeys.includes(normalizeProgramKey(p.canonical_name ?? ""))).map((p) => p.id);
    return loadFollowSources(db, ids, from, to, rule.withinDays);
  } catch {
    return [];
  }
}
