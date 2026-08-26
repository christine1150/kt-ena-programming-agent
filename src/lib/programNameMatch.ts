// 사용자 제보(2026-08-26): "신병4사보타주 1~2회 방영 시 직전 라인업(그대에게 드림) 평균
// 비교가 안 나온다" — 조사 결과, 주요 콘텐츠 관리 화면·엑셀 업로드가 programs 테이블에
// (channel_id, canonical_name) "정확 문자열"로 upsert하는데, 관리자가 입력/기입한 표기
// ("그대에게 드림", "신병4: 사보타주" — 공백·콜론 포함)가 실제 Nielsen ingest로 생기는
// canonical_name("그대에게드림", "신병4사보타주" — 공백·문장부호 없음, CLAUDE.md 프로그램명
// 매칭 원칙)과 문자열이 달라 매칭에 실패, ratings가 0건인 새 programs 행이 별도로 생겼다
// (get_previous_drama_baseline 등 canonical_name 기준 조인이 전부 깨짐). 이 파일은 그
// 재발을 막는 공용 정규화·매칭 헬퍼 — channel-master 엑셀 업로드와 featured-content 수동
// 등록 API 양쪽에서 같이 쓴다.
import type { SupabaseClient } from "@supabase/supabase-js";

/** 한글·영문·숫자만 남기고 공백·쉼표·콜론 등 문장부호와 회차 태그(<본>/<재>)를 전부 제거한다
 * (CLAUDE.md 프로그램명 매칭 원칙, channel-master/route.ts에서 먼저 검증된 정규화 방식과 동일). */
export function normalizeProgramCanonicalName(name: string): string {
  return name.replace(/<본>|<재>/g, "").replace(/[^가-힣a-zA-Z0-9]/g, "");
}

/**
 * 관리자가 입력한 title이 같은 채널에 이미 등록된(주로 Nielsen ingest로 생긴) programs 행과
 * 정규화 기준으로 같은 프로그램인지 먼저 찾는다 — 찾으면 그 id를 재사용하고 canonical_name은
 * 절대 덮어쓰지 않는다(Nielsen 원본 표기를 유지해야 ratings.program_id 조인이 계속 맞음).
 * 없을 때만 새 행을 만든다.
 */
export async function findOrCreateProgramByNormalizedName(
  supabase: SupabaseClient,
  channelId: string,
  title: string,
  extra: { rawName?: string; episodeNumber?: number | null } = {}
): Promise<{ id: string } | null> {
  const target = normalizeProgramCanonicalName(title);
  const { data: existing } = await supabase.from("programs").select("id, canonical_name").eq("channel_id", channelId);
  const matched = (existing ?? []).find((p) => normalizeProgramCanonicalName(p.canonical_name) === target);

  if (matched) {
    await supabase
      .from("programs")
      .update({ raw_name: extra.rawName ?? title, episode_number: extra.episodeNumber ?? null })
      .eq("id", matched.id);
    return { id: matched.id };
  }

  const { data: created, error } = await supabase
    .from("programs")
    .upsert(
      { channel_id: channelId, canonical_name: title, raw_name: extra.rawName ?? title, episode_number: extra.episodeNumber ?? null },
      { onConflict: "channel_id,canonical_name" }
    )
    .select("id")
    .single();
  if (error || !created) return null;
  return created;
}
