// 편성 변경 이벤트 적재용 방영 읽기(고도화 B1) — 출처별(자사 닐슨·경쟁 닐슨·IPTV)로 같은 모양(HistAiring)으로 읽는다. 읽기 전용(select만).
// 읽지 못하면 null(호출부가 기존 이벤트를 지우지 않고 건너뛴다), 빈 목록은 "자료가 없음"이다.
import { supabase } from "@/lib/supabase";
import { isoDow } from "@/lib/idealSchedule/time";
import type { HistAiring } from "@/lib/dashboard/changeHistory";
import { keyOf, loadChannelAirings } from "@/lib/reportSnapshot/evidenceLoaders";
import type { EventChannel } from "./channels";

const NOT_PROG = /^(정파|방송\s*종료|휴지|화면조정)/;
const COMP_LABEL = { p2049: "개인2049", household: "유료방송가구" } as const;
const broadcastMin = (t: string) => {
  const [h, m] = t.split(":").map((v) => Number.parseInt(v, 10));
  return (h < 2 ? h + 24 : h) * 60 + (m || 0);
};

async function pagedAll<T>(build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build(off, off + 999);
    if (error) return null;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/** 채널의 [from, to] 방영(프로그램 키·시작 분·시청률). 읽지 못하면 null. */
export async function loadEventAirings(ch: EventChannel, from: string, to: string): Promise<HistAiring[] | null> {
  if (ch.source === "own") {
    const rows = await loadChannelAirings(ch.key, from, to);
    return rows ? rows.map((r) => ({ date: r.date, dow: isoDow(r.date), startMin: r.startMin, key: keyOf(r.name), rating: r.rating })) : null;
  }
  if (ch.source === "comp") {
    const rows = await pagedAll<{ broadcast_date: string; start_time: string; program_name: string; rating: number | string }>((a, b) =>
      supabase
        .from("competitor_program_target_ratings")
        .select("broadcast_date, start_time, program_name, rating")
        .eq("competitor_name", ch.key)
        .eq("target_label", COMP_LABEL[ch.tk])
        .gte("broadcast_date", from)
        .lte("broadcast_date", to)
        .not("rating", "is", null)
        .order("broadcast_date")
        .order("start_time")
        .range(a, b)
    );
    return rows
      ? rows.flatMap((r) => (NOT_PROG.test(r.program_name) || !r.start_time ? [] : [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: broadcastMin(r.start_time), key: keyOf(r.program_name.replace(/<[^>]*>/g, "")), rating: Number(r.rating) }]))
      : null;
  }
  const rows = await pagedAll<{ broadcast_date: string; start_minute: number; program_key: string; rating: number | string }>((a, b) =>
    supabase
      .from("iptv_tvindex_airings")
      .select("broadcast_date, start_minute, program_key, rating")
      .eq("channel_name", ch.key)
      .eq("target_kind", ch.tk)
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .not("rating", "is", null)
      .order("broadcast_date")
      .order("start_minute")
      .range(a, b)
  );
  return rows ? rows.flatMap((r) => (NOT_PROG.test(r.program_key) ? [] : [{ date: r.broadcast_date, dow: isoDow(r.broadcast_date), startMin: Number(r.start_minute), key: r.program_key, rating: Number(r.rating) }])) : null;
}
