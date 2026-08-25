// 사용자 지시(2026-08-25): "ENA는 매주 오리지널 드라마·예능·독점 콘텐츠 성과가 채널에서 매우
// 중요하므로 그것이 채널 인사이트/오늘의 브리핑 첫 문장으로" — Page 1(Dashboard.tsx 채널별
// 인사이트)과 Page 2(ChannelDeepDive.tsx 오늘의 브리핑)가 공유하는 문장 조립 함수. 이미
// 계산돼 있는 값(matched_rating/matched_household_rating/retention_pct/self_rerun_rating)만
// 그대로 인용한다(새 계산 없음, CLAUDE.md 원칙).
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
    // "ENA Play/ENA Drama의 동시방영·직재방·24~36시간 내 재방송 효율"도 항상 짚는다 — 타 채널
    // 직후재방(retention_pct)이 있으면 그것을, 없으면 본채널 당일 자체 재방 유지율을 대신
    // 보여준다(둘 다 없으면 재방 관련 절 생략).
    const rerunNote =
      d.retention_pct !== null && d.rerun_channel_code
        ? ` — ${CHANNEL_NAME_BY_CODE[d.rerun_channel_code] ?? d.rerun_channel_code} 재방 유지율 ${d.retention_pct.toFixed(1)}%`
        : d.self_rerun_rating !== null && d.matched_rating !== null && d.matched_rating > 0
          ? ` — 자체 재방 유지율 ${((d.self_rerun_rating / d.matched_rating) * 100).toFixed(1)}%`
          : "";
    return `'${d.featured_display_name ?? d.matched_program_name}' 수2049 ${formatRating(d.matched_rating)}${hh}${rerunNote}`;
  });
  return `오늘 오리지널·독점 콘텐츠 성과: ${parts.join(", ")}.`;
}
