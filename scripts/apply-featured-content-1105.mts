// 2026-11-05 사용자 지시: 주요 콘텐츠 관리 오타 수정 + 신규 편성 추가 + 월화드라마 라인업 추가.
// 관리자 화면의 POST /api/admin/featured-content 와 같은 규칙(정규화 매칭으로 programs 찾기 → featured_content upsert,
// 끝 방송일자 자동 계산, 첫 방송일자로 회차 seed 1회)을 서비스 키로 직접 수행한다. 여러 번 실행해도 같은 결과(멱등).
//
// 사용법(기본은 점검만): npx tsx --env-file=.env --env-file=.env.local scripts/apply-featured-content-1105.mts [--apply]
import { createClient } from "@supabase/supabase-js";
import { computeExpectedEndDate } from "../src/lib/featuredContentSchedule";
import { findOrCreateProgramByNormalizedName, normalizeProgramCanonicalName } from "../src/lib/programNameMatch";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ENA_ID = "3bc8fc2c-bd4c-44a3-9347-2b68f99c9027";

interface NewItem {
  title: string;
  displayName?: string;
  category: string;
  days: string[];
  time: string; // HH:MM:SS
  start: string;
  episodes: number;
  scheduleText: string;
}

// 월화드라마 라인업: 12부작 × 매주 월·화 22:00, 앞 작품이 끝난 다음 월요일에 다음 작품이 시작한다(사용자 진술의 순서 기준 추정 일정).
const dramaLineup = ["조련의 여왕", "그녀는 취급주의", "그린라이트", "나의 트로이카", "사짜 변호사", "찐한고백: 183hz"];

const items: NewItem[] = [
  {
    title: "카드 한 장에 우정이 흔들리는 줄 몰랐습니다만?",
    displayName: "카우몰",
    category: "오리지널 예능",
    days: ["금"],
    time: "20:30:00",
    start: "2026-12-18",
    episodes: 12,
    scheduleText: "2026.12.18. ~ 매주 (금) 오후 8:30, 12부작 · 줄임말 카우몰",
  },
  {
    title: "KGMA",
    category: "사업형",
    days: ["토", "일"],
    time: "17:00:00",
    start: "2026-11-07",
    episodes: 2,
    scheduleText: "2026.11.07.(토) ~ 11.08.(일) 오후 5시~9시 생방송",
  },
  {
    title: "26 보야지 페스티벌",
    category: "사업형",
    days: ["일"],
    time: "19:50:00",
    start: "2026-11-15",
    episodes: 1,
    scheduleText: "2026.11.15.(일) 오후 7:50 · 2026 Voyage Festival",
  },
];

// 라인업 시작일 계산: 혹하는 로맨스(2027-01-25~03-02)·이혼 조사관 홍말금(03-08~04-13)은 이미 등록돼 있어 그 다음(04-19)부터 이어 붙인다.
let cursor = new Date("2027-04-19T00:00:00");
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
for (const title of dramaLineup) {
  const start = fmt(cursor);
  const end = computeExpectedEndDate(start, ["월", "화"], 12)!;
  items.push({
    title,
    category: "오리지널 드라마",
    days: ["월", "화"],
    time: "22:00:00",
    start,
    episodes: 12,
    scheduleText: `${start.replaceAll("-", ".")}. ~ ${end.replaceAll("-", ".")}. 매주 (월, 화) 오후 10:00, 12부작 · 라인업 순서 기준 추정 일정`,
  });
  // 다음 작품은 종영일(화) 다음 주 월요일
  cursor = new Date(`${end}T00:00:00`);
  cursor.setDate(cursor.getDate() + 6);
}

async function main() {
  console.log(APPLY ? "== 적용 ==" : "== 점검만(--apply 로 적용) ==");

  // 1) 미스틱 표시명 오타: 조작하다 → 조각하다 (programs.canonical_name 은 닐슨 매칭 키라 건드리지 않는다)
  const { data: mystic } = await sb
    .from("featured_content")
    .select("id, display_name, programs!inner(canonical_name, channel_id)")
    .eq("programs.canonical_name", "미스틱")
    .eq("programs.channel_id", ENA_ID);
  if (!mystic || mystic.length !== 1) throw new Error(`미스틱 행을 하나로 특정하지 못했습니다: ${mystic?.length}`);
  console.log(`미스틱 표시명: "${mystic[0].display_name}" → "미스틱: 내일의 스타를 조각하다"`);
  if (APPLY) {
    const { error } = await sb.from("featured_content").update({ display_name: "미스틱: 내일의 스타를 조각하다" }).eq("id", mystic[0].id);
    if (error) throw error;
  }

  // 2) 니돈내산 시즌 2: 같은 프로그램(program_id 하나당 한 행)이라 기존 행을 시즌 2 일정으로 바꾸고 회차 seed 도 시즌 2 첫 방송(1회)으로 옮긴다.
  const { data: nidon } = await sb
    .from("featured_content")
    .select("id, broadcast_start_date, broadcast_end_date, programs!inner(canonical_name, channel_id)")
    .eq("programs.canonical_name", "니돈내산")
    .eq("programs.channel_id", ENA_ID);
  if (!nidon || nidon.length !== 1) throw new Error(`니돈내산 행을 하나로 특정하지 못했습니다: ${nidon?.length}`);
  const nidonEnd = computeExpectedEndDate("2026-12-20", ["일"], 12)!;
  console.log(`니돈내산: ${nidon[0].broadcast_start_date}~${nidon[0].broadcast_end_date} (시즌 1) → 2026-12-20~${nidonEnd} 일 20:00 12편 (시즌 2), 회차 seed 2026-12-20=1회`);
  if (APPLY) {
    const { error } = await sb
      .from("featured_content")
      .update({
        broadcast_day_of_week: ["일"],
        broadcast_time: "20:00:00",
        broadcast_start_date: "2026-12-20",
        broadcast_end_date: nidonEnd,
        expected_episode_count: 12,
        broadcast_schedule_text: "시즌 2 · 2026.12.20. ~ 매주 (일) 오후 8:00, 12부작 · 시즌 1은 2026.09.27.~10.18. (일) 오후 8:30, 4회",
      })
      .eq("id", nidon[0].id);
    if (error) throw error;
    const { error: seedErr } = await sb
      .from("program_episode_counters")
      .upsert({ canonical_name: "니돈내산", seed_episode_number: 1, seed_broadcast_date: "2026-12-20" }, { onConflict: "canonical_name" });
    if (seedErr) throw seedErr;
  }

  // 3) 신규 편성 + 라인업
  for (const it of items) {
    const end = computeExpectedEndDate(it.start, it.days, it.episodes);
    console.log(`추가: [${it.category}] ${it.title}${it.displayName ? ` (표시명 ${it.displayName})` : ""} ${it.days.join("")} ${it.time.slice(0, 5)} ${it.start} ~ ${end} (${it.episodes}회)`);
    if (!APPLY) continue;
    const program = await findOrCreateProgramByNormalizedName(sb, ENA_ID, it.title, { episodeNumber: null });
    if (!program) throw new Error(`프로그램 저장 실패: ${it.title}`);
    if (normalizeProgramCanonicalName(program.canonicalName) !== normalizeProgramCanonicalName(it.title)) {
      console.warn(`  ⚠ 기존 프로그램과 합쳐졌습니다: "${it.title}" → "${program.canonicalName}"`);
    }
    const { error } = await sb.from("featured_content").upsert(
      {
        program_id: program.id,
        category: it.category,
        broadcast_schedule_text: it.scheduleText,
        broadcast_day_of_week: it.days,
        broadcast_time: it.time,
        broadcast_start_date: it.start,
        broadcast_end_date: end,
        expected_episode_count: it.episodes,
        simulcast_channel_id: null,
        rerun_channel_id: null,
        simulcast_competitor_name: null,
        display_name: it.displayName ?? null,
      },
      { onConflict: "program_id" }
    );
    if (error) throw error;
    // 첫 방송일자로 회차 seed(이미 있으면 덮어쓰지 않음) — 채널 마스터 업로드와 같은 규칙
    const { error: seedErr } = await sb
      .from("program_episode_counters")
      .upsert(
        { canonical_name: normalizeProgramCanonicalName(it.title), seed_episode_number: 1, seed_broadcast_date: it.start },
        { onConflict: "canonical_name", ignoreDuplicates: true }
      );
    if (seedErr) throw seedErr;
  }
  console.log("완료");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
