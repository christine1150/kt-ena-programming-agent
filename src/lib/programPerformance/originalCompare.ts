// 프로그램 성과 — 오리지널 비교(2026-10-23, 사용자 요청: 기존 오리지널·직전 동시간대 라인업과 견준 종합평가 멘트).
// 정의: docs/ena-features/F1_OUTCOME_REDESIGN_PLAN.md §7-1. 계산은 순수 함수(originalCompareOf), DB 읽기는 loadOriginalCompare(주입).
// 새 판정·합격선 없이 순위·상대 차이·중간값만 낸다. 범위는 조회 기간과 무관하게 '방영 시작 이후 본방', 방송 채널 KPI 타깃.
import { resolveProgramLevelTargetLabel } from "@/lib/targetResolution";
import { formatRatingValue } from "@/lib/ui/metricFormat";
import { dedupeAirings, indexText, ratioOf, relText, type WorkAiring } from "./metrics";
import type { OriginalCompare, RatioValue, WorkClass } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** 비교 단위 하나 — 방영 순서대로 정렬된 본방 시청률 */
export interface OriginalSeries {
  name: string;
  start: string;
  /** 편성 슬롯 이름(예: "월화 22:00") — 직전 동시간대 판정과 문구에 쓴다 */
  slot: string;
  ratings: number[];
}

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** 첫 2회 평균 대비 k번째까지의 마지막 2회 평균 변화(%) — k ≥ 4 */
const momentumOf = (r: number[], k: number) => {
  const a = meanOf(r.slice(0, 2));
  const b = meanOf(r.slice(k - 2, k));
  return a !== null && a > 0 && b !== null ? (b / a - 1) * 100 : null;
};

/**
 * 오리지널 비교 — self는 이 작품, peers는 같은 채널·분류의 다른 오리지널(자료 첫날 이후 시작·본방 1회 이상만 넘겨받는다), predecessor는 직전 동시간대 작품.
 * 문구는 서버 고정(최대 3줄). 비교 대상이 없으면 해당 줄을 만들지 않는다.
 */
export function originalCompareOf(i: { classLabel: string; targetLabel: string; dataFrom: string; code: string; self: OriginalSeries; peers: OriginalSeries[]; predecessor: OriginalSeries | null }): OriginalCompare | null {
  const k = i.self.ratings.length;
  if (k === 0) return null;
  const pct = (v: number | null) => formatRatingValue(v, i.code, { unit: true });
  const firstK = (s: OriginalSeries, n = k) => meanOf(s.ratings.slice(0, n));
  const selfAvg = firstK(i.self);
  const lines: string[] = [];
  const year = i.dataFrom.slice(0, 4);
  // 분류·'본방'은 제목(오리지널 드라마 비교 · 방영 시작 이후 본방)에 있어 줄에서는 뺀다(사용자 지시 2026-10-23)
  const kLabel = k === 1 ? "1회" : `첫 ${k}회 평균`;

  // ① 같은 회차 순위 — 본방이 k회 이상인 작품끼리(자기 포함), 동률은 같은 순위
  const eligible = i.peers.filter((p) => p.ratings.length >= k);
  const peerAvgs = eligible.map((p) => firstK(p) as number);
  const rank = selfAvg === null ? null : 1 + peerAvgs.filter((v) => v > selfAvg).length;
  if (rank !== null && eligible.length > 0) lines.push(`${kLabel} ${pct(selfAvg)} · ${year}년 이후 ${eligible.length + 1}편 중 ${rank}위(같은 회차 기준)`);

  // ② 직전 동시간대 — 직전 작품의 첫 k회(본방이 그보다 적으면 그만큼)
  let predecessor: OriginalCompare["predecessor"] = null;
  if (i.predecessor && i.predecessor.ratings.length > 0) {
    const kp = Math.min(k, i.predecessor.ratings.length);
    const pAvg = firstK(i.predecessor, kp);
    const vs: RatioValue = ratioOf(kp === k ? selfAvg : firstK(i.self, kp), pAvg);
    predecessor = { name: i.predecessor.name, slot: i.predecessor.slot, k: kp, avg: pAvg, vs };
    lines.push(`직전 ${i.predecessor.slot} ‘${i.predecessor.name}’ ${kp === 1 ? "1회" : `첫 ${kp}회 평균`} ${pct(pAvg)}의 ${indexText(vs.ratio)}`);
  }

  // ③ 흐름 — k ≥ 4일 때만, 같은 시점까지 본방이 있는 작품들의 중간값과 나란히
  let momentum: OriginalCompare["momentum"] = null;
  if (k >= 4) {
    const self = momentumOf(i.self.ratings, k);
    const others = eligible.map((p) => momentumOf(p.ratings, k)).filter((v): v is number => v !== null);
    const med = median(others);
    if (self !== null) {
      momentum = { self, peerMedian: med, peers: others.length };
      lines.push(`첫 2회 대비 ${k - 1}~${k}회 ${relText(self)}${med !== null ? ` · 같은 시점 다른 작품 중간값 ${relText(med)}` : ""}`);
    }
  }

  if (lines.length === 0) return null;
  return {
    classLabel: i.classLabel,
    targetLabel: i.targetLabel,
    dataFrom: i.dataFrom,
    k,
    selfAvg,
    rank,
    peers: eligible.length + 1,
    peerMean: meanOf(peerAvgs),
    predecessor,
    momentum,
    lines,
  };
}

const CLASS_CATEGORY: Partial<Record<WorkClass, { key: string; label: string }>> = {
  ORIGINAL_DRAMA: { key: "오리지널드라마", label: "오리지널 드라마" },
  ORIGINAL_VARIETY: { key: "오리지널예능", label: "오리지널 예능" },
  ORIGINAL_CULTURE: { key: "오리지널교양", label: "오리지널 교양" },
};
const DOW_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

interface FcRow {
  program_id: string;
  category: string | null;
  display_name: string | null;
  broadcast_day_of_week: string[] | null;
  broadcast_time: string | null;
  broadcast_start_date: string | null;
  programs: { canonical_name: string; channel_id: string } | { canonical_name: string; channel_id: string }[];
}

/**
 * 오리지널 비교 로더(읽기 전용) — featured_content에서 이 작품의 오리지널 행(방송 채널·편성 시각·시작일)과 같은 채널·분류의 다른 오리지널을 찾고,
 * 방송 채널 KPI 타깃의 닐슨 <본> 방영을 한 번에 읽는다. 같은 방영의 중복 행은 한 번만(dedupeAirings).
 */
export async function loadOriginalCompare(db: Db, i: { cls: WorkClass; workIds: string[]; dataFrom: string | null; channels: { id: string; code: string; primary_target: string | null }[] }): Promise<(OriginalCompare & { channelCode: string }) | null> {
  const cat = CLASS_CATEGORY[i.cls];
  if (!cat || !i.dataFrom || i.workIds.length === 0) return null;
  const { data, error } = await db.from("featured_content").select("program_id, category, display_name, broadcast_day_of_week, broadcast_time, broadcast_start_date, programs!inner(canonical_name, channel_id)");
  if (error) throw new Error(`오리지널 목록 조회 실패: ${error.message}`);
  const norm = (c: string | null) => (c ?? "").replace(/\s+/g, "");
  const rows = ((data ?? []) as FcRow[]).filter((r) => norm(r.category) === cat.key);
  const prog = (r: FcRow) => (Array.isArray(r.programs) ? r.programs[0] : r.programs);
  const mine = rows.filter((r) => i.workIds.includes(r.program_id) && r.broadcast_start_date);
  if (mine.length === 0) return null;
  // 방송 채널 = 이 작품 오리지널 행의 채널(여럿이면 가장 이른 시작)
  const self = [...mine].sort((a, b) => String(a.broadcast_start_date).localeCompare(String(b.broadcast_start_date)))[0];
  const channelId = prog(self).channel_id;
  const ch = i.channels.find((c) => c.id === channelId);
  if (!ch?.primary_target || !self.broadcast_start_date || self.broadcast_start_date < i.dataFrom) return null;
  const targetLabel = resolveProgramLevelTargetLabel(ch.primary_target);
  const { data: t } = await db.from("targets").select("id").eq("label", targetLabel).maybeSingle();
  if (!t?.id) return null;

  const selfIds = new Set(mine.filter((r) => prog(r).channel_id === channelId).map((r) => r.program_id));
  // 같은 작품이 별도 program_id로 여러 번 등록된 경우는 비교군에서 뺀다(자기 자신과 비교하지 않게)
  const others = rows.filter((r) => prog(r).channel_id === channelId && !selfIds.has(r.program_id) && !i.workIds.includes(r.program_id) && r.broadcast_start_date && r.broadcast_start_date >= i.dataFrom!);
  const ids = [...selfIds, ...others.map((r) => r.program_id)];
  const raw: Record<string, unknown>[] = [];
  for (let off = 0; ; off += 1000) {
    const { data: got, error: e2 } = await db
      .from("ratings")
      .select("program_id, broadcast_date, start_time, rating, created_at")
      .in("program_id", ids)
      .eq("target_id", t.id)
      .eq("source_type", "nielsen_daily")
      .eq("is_first_run", true)
      .order("broadcast_date", { ascending: true })
      .order("id", { ascending: true })
      .range(off, off + 999);
    if (e2) throw new Error(`오리지널 본방 조회 실패: ${e2.message}`);
    raw.push(...((got ?? []) as Record<string, unknown>[]));
    if ((got ?? []).length < 1000) break;
  }
  const airs = dedupeAirings(
    raw.map((r): WorkAiring => ({ programId: r.program_id as string, date: r.broadcast_date as string, startTime: (r.start_time as string | null) ?? null, endTime: null, rating: r.rating === null || r.rating === undefined ? null : Number(r.rating), firstRun: true, episode: null, createdAt: (r.created_at as string | null) ?? null }))
  );
  const ratingsOf = (pids: Set<string>) => airs.filter((a) => pids.has(a.programId) && a.rating !== null && Number.isFinite(a.rating)).map((a) => a.rating as number);
  const days = (r: FcRow) => [...(r.broadcast_day_of_week ?? [])].sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b));
  const slotOf = (r: FcRow) => `${days(r).join("")} ${String(r.broadcast_time ?? "").slice(0, 5)}`.trim();
  const series = (r: FcRow, pids: Set<string>): OriginalSeries => ({ name: r.display_name || prog(r).canonical_name, start: r.broadcast_start_date as string, slot: slotOf(r), ratings: ratingsOf(pids) });
  const peers = others.map((r) => series(r, new Set([r.program_id]))).filter((s) => s.ratings.length > 0);
  // 직전 동시간대 — 같은 편성 시각(시:분)·요일이 겹치고 이 작품보다 먼저 시작한 작품 중 가장 늦게 시작한 것(본방 기록 있는 것만)
  const selfDays = new Set(days(self));
  const hm = (x: string | null) => String(x ?? "").slice(0, 5);
  const prev = others
    .filter((r) => hm(r.broadcast_time) === hm(self.broadcast_time) && hm(self.broadcast_time) !== "" && days(r).some((d) => selfDays.has(d)) && (r.broadcast_start_date as string) < (self.broadcast_start_date as string))
    .sort((a, b) => String(b.broadcast_start_date).localeCompare(String(a.broadcast_start_date)))
    .map((r) => series(r, new Set([r.program_id])))
    .find((s) => s.ratings.length > 0) ?? null;
  const out = originalCompareOf({ classLabel: cat.label, targetLabel, dataFrom: i.dataFrom, code: ch.code, self: series(self, selfIds), peers, predecessor: prev });
  return out ? { ...out, channelCode: ch.code } : null;
}
