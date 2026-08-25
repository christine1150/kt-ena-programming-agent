// 사용자 지시(2026-08-25): "ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널에서 매우
// 중요하므로 그것이 채널 인사이트/오늘의 브리핑 첫 문장으로" — Page 1(Dashboard.tsx 채널별
// 인사이트)과 Page 2(ChannelDeepDive.tsx 오늘의 브리핑)가 공유하는 문장 조립 함수. 이미
// 계산돼 있는 값(matched_rating/matched_household_rating/retention_pct/self_rerun_rating)만
// 그대로 인용한다(새 계산 없음, CLAUDE.md 원칙).
// 사용자 재지시(2026-08-26): "채널별 인사이트 작성 시 '오늘 오리지널·독점 콘텐츠 성과: ' 같은
// 말은 필요 없음. 빼고 시작" — 프로그램명 인용부터 바로 시작하도록 라벨 접두사 제거.
const CHANNEL_NAME_BY_CODE: Record<string, string> = {
  ENA: "ENA",
  ENA_DRAMA: "ENA Drama",
  ENA_PLAY: "ENA Play",
  ENA_STORY: "ENA Story",
  OLIFE: "OLIFE",
  ONCE: "ONCE",
  SKYUHD: "skyUHD",
};

export interface EnaOriginalHighlightItem {
  matched_program_name: string;
  // 사용자 지시(2026-08-26): "신병4사보타주는 '신병4: 사보타주'로 표현되게" — 있으면 이 값을
  // 우선 인용(featured_content에 등록된 사람이 읽기 좋은 원문 제목).
  featured_display_name?: string | null;
  matched_rating: number | null;
  matched_household_rating: number | null;
  // 동시방송(다른 채널이 같은 시간대에 함께 방영) — 직후재방과는 별개 개념. 사용자 지시
  // (2026-08-26, 왕자와거지 사례로 확인): "동시방송을 할 경우에는 동시 방송 성적을 가장 먼저
  // 올려주시고, 이후 직후재방이 있을 경우에만 직후재방을 언급해주세요." ENA Play가 ENA 본방과
  // 거의 같은 시각에 함께 트는 경우가 여기 해당(직후재방처럼 본방 종료 후가 아니라 본방과
  // 겹치는 시간대에 시작).
  simulcast_channel_code?: string | null;
  simulcast_rating?: number | null;
  retention_pct: number | null;
  rerun_channel_code: string | null;
  self_rerun_rating: number | null;
}

export function buildEnaOriginalHighlightSentence(
  enaDaily: EnaOriginalHighlightItem[],
  formatRating: (v: number | null) => string
): string | null {
  const withRating = enaDaily.filter((d) => d.matched_rating !== null);
  if (withRating.length === 0) return null;
  const parts = withRating.map((d) => {
    const hh = d.matched_household_rating !== null ? `(가구 ${formatRating(d.matched_household_rating)})` : "";
    // 동시방송 → 직후재방 → (둘 다 없을 때만) 자체 재방, 이 우선순위로 최대 필요한 것만 짚는다.
    const notes: string[] = [];
    if (d.simulcast_channel_code && d.simulcast_rating !== null && d.simulcast_rating !== undefined) {
      notes.push(`${CHANNEL_NAME_BY_CODE[d.simulcast_channel_code] ?? d.simulcast_channel_code} 동시방송 ${formatRating(d.simulcast_rating)}%`);
    }
    if (d.retention_pct !== null && d.rerun_channel_code) {
      notes.push(`${CHANNEL_NAME_BY_CODE[d.rerun_channel_code] ?? d.rerun_channel_code} 재방 유지율 ${d.retention_pct.toFixed(1)}%`);
    } else if (notes.length === 0 && d.self_rerun_rating !== null && d.matched_rating !== null && d.matched_rating > 0) {
      notes.push(`자체 재방 유지율 ${((d.self_rerun_rating / d.matched_rating) * 100).toFixed(1)}%`);
    }
    const rerunNote = notes.length > 0 ? ` — ${notes.join(", ")}` : "";
    return `'${d.featured_display_name ?? d.matched_program_name}' 수2049 ${formatRating(d.matched_rating)}${hh}${rerunNote}`;
  });
  return `${parts.join(", ")}.`;
}
