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
  // 사용자 지시(2026-08-26): "채널별 인사이트에서 ENA 채널 설명에 ENA Drama 재방 부분은
  // 넣지 말고, ENA Drama 채널 섹션에서 신병4사보타주 직재방에 대한 성적 및 내용을 다룰 것" —
  // 재방 성적 자체 서술(buildRerunHighlightSentence)에 필요.
  rerun_program_name?: string | null;
  rerun_rating?: number | null;
  // 사용자 지시(2026-09-07) 용어 정정: "직재방"(사이에 다른 프로그램 없이 곧바로) vs
  // "당일재방"(사이에 다른 프로그램이 끼어 있음) — SQL(get_original_content_daily)이 실제
  // 방영 데이터로 판정해 내려준다.
  rerun_type?: "직재방" | "당일재방" | null;
  self_rerun_rating: number | null;
  // 사용자 지시(2026-09-30) 후속: "본방 대비 유지율 10.1%로 4주 평균 대비 하락세를 보임"처럼
  // "4주 평균 대비"가 임의 임계값이 아니라 실제 수치이길 요구 — 같은 채널·같은 요일·비슷한
  // 시각(직재방 슬롯)의 최근 4주 평균(get_program_slot_recent_avg, route.ts에서 조회)을 그대로
  // 실어, 이 파일에서는 비교 계산만 한다(새 SQL 집계 없음).
  rerun_slot_recent_avg?: { avg_rating: number | null; sample_count: number } | null;
}

export function buildEnaOriginalHighlightSentence(
  enaDaily: EnaOriginalHighlightItem[],
  formatRating: (v: number | null) => string
): string | null {
  const withRating = enaDaily.filter((d) => d.matched_rating !== null);
  if (withRating.length === 0) return null;
  const parts = withRating.map((d) => {
    const hh = d.matched_household_rating !== null ? `(가구 ${formatRating(d.matched_household_rating)})` : "";
    // 동시방송 → (없을 때만) 자체 재방. 다른 채널로의 직후재방은 여기서 언급하지 않는다(사용자
    // 지시 2026-08-26) — 그 채널 자신의 인사이트에서 buildRerunHighlightSentence로 다룬다.
    const notes: string[] = [];
    if (d.simulcast_channel_code && d.simulcast_rating !== null && d.simulcast_rating !== undefined) {
      notes.push(`${CHANNEL_NAME_BY_CODE[d.simulcast_channel_code] ?? d.simulcast_channel_code} 동시방송 ${formatRating(d.simulcast_rating)}%`);
    } else if (d.self_rerun_rating !== null && d.matched_rating !== null && d.matched_rating > 0) {
      notes.push(`자체 재방 유지율 ${((d.self_rerun_rating / d.matched_rating) * 100).toFixed(1)}%`);
    }
    const rerunNote = notes.length > 0 ? ` — ${notes.join(", ")}` : "";
    return `'${d.featured_display_name ?? d.matched_program_name}' 수2049 ${formatRating(d.matched_rating)}${hh}${rerunNote}`;
  });
  return `${parts.join(", ")}.`;
}

// 사용자 지시(2026-09-30): "직재방 성과에 대한 분석 문구가 이상해. 본방 대비 10%밖에 되지
// 않는데... 'ENA Drama 직재방 성과 미흡. 본방 대비 유지율 10.1%로...'와 같이 정확하게
// 이야기 하기." — 기존 문장은 유지율 숫자만 괄호로 덧붙이고 그 숫자가 좋은지 나쁜지에 대한
// 판정이 전혀 없어, 10%든 90%든 같은 어조로 읽혔다. retention_pct 구간별로 성과 판정 문구를
// 앞에 붙인다(새 지표를 만들지 않고 이미 있는 retention_pct만 구간화).
// 기준값: 명확한 근거 문헌은 없으나 "직후재방 유지율은 본방 대비 절반 이상이면 양호"가 편성팀
// 통념적 기준이라 50%/80%로 3단 구분한다 — 향후 실측 데이터가 쌓이면 조정 가능.
function rerunVerdict(retentionPct: number | null): { label: string; tone: "bad" | "warn" | "good" } | null {
  if (retentionPct === null) return null;
  if (retentionPct < 50) return { label: "성과 미흡", tone: "bad" };
  if (retentionPct < 80) return { label: "성과 보통", tone: "warn" };
  return { label: "성과 양호", tone: "good" };
}

// 사용자 지시(2026-08-26): 위에서 뺀 "다른 채널로의 직후재방" 성적을, 실제로 그 재방을 트는
// 채널(예: ENA Drama) 자신의 채널별 인사이트 첫 문장으로 옮겨 보여준다.
export function buildRerunHighlightSentence(
  enaDaily: EnaOriginalHighlightItem[],
  rerunChannelCode: string,
  formatRating: (v: number | null) => string
): string | null {
  const items = enaDaily.filter(
    (d) => d.rerun_channel_code === rerunChannelCode && d.rerun_rating !== null && d.rerun_rating !== undefined
  );
  if (items.length === 0) return null;
  const parts = items.map((d) => {
    const label = d.rerun_type ?? "직재방";
    const verdict = rerunVerdict(d.retention_pct);
    // 사용자 예시 형태: "ENA Drama 직재방 성과 미흡. 본방 대비 유지율 10.1%로 4주 평균 대비
    // 하락세를 보임." — 이전 버전은 "하락세를 보임/견조함"이 retention_pct 임계값(성과 판정)
    // 에서 나온 고정 문구라 "4주 평균"이라는 말과 달리 실제 4주 평균값을 전혀 보지 않았다.
    // 같은 슬롯의 실측 4주 평균(rerun_slot_recent_avg, get_program_slot_recent_avg 조회 결과)이
    // 있으면 오늘 재방 시청률과의 등락률을 그대로 계산해 붙인다 — Dashboard.tsx의
    // computeRecentComparison과 같은 단순 등락률 계산(새 지표 아님), 표본이 없으면(신규 슬롯 등)
    // 문구 자체를 생략한다(report-omit-unavailable-sections 규칙).
    const verdictPrefix = verdict ? `${CHANNEL_NAME_BY_CODE[rerunChannelCode] ?? rerunChannelCode} ${label} ${verdict.label}. ` : "";
    const pct = d.retention_pct !== null ? `본방 대비 유지율 ${d.retention_pct.toFixed(1)}%` : "유지율 정보 없음";
    const slotAvg = d.rerun_slot_recent_avg;
    let trendClause = "";
    if (
      slotAvg?.avg_rating !== null &&
      slotAvg?.avg_rating !== undefined &&
      slotAvg.avg_rating > 0 &&
      slotAvg.sample_count > 0 &&
      d.rerun_rating !== null &&
      d.rerun_rating !== undefined
    ) {
      const deltaPct = ((d.rerun_rating - slotAvg.avg_rating) / slotAvg.avg_rating) * 100;
      const arrow = deltaPct >= 0 ? "▲" : "▼";
      trendClause = `, 4주 평균(${formatRating(slotAvg.avg_rating)}%) 대비 ${arrow}${Math.abs(deltaPct).toFixed(1)}%`;
    }
    return `${verdictPrefix}'${d.featured_display_name ?? d.rerun_program_name ?? d.matched_program_name}' ${label} 수2049 ${formatRating(d.rerun_rating ?? null)}% (${pct}${trendClause})`;
  });
  return `${parts.join(", ")}.`;
}

// 사용자 지시(2026-09-30): "원인 및 인사이트 영역 수정안... '편성 효율 및 시청자 흡수율이
// 떨어진 것으로 분석됨.'처럼 정확하게. 본방 직후 타깃 유입 한계가 확인됨 → 직재방 편성
// 시간대 재검토 및 타깃 유입 강화를 위한 전략적 편성 변화를 적어줘." — retention_pct 구간에
// 맞춰 원인·전략 문장을 함께 만든다. buildRerunHighlightSentence와 같은 판정 기준을 쓴다.
export function buildRerunCauseAndStrategy(
  enaDaily: EnaOriginalHighlightItem[],
  rerunChannelCode: string
): { cause: string; strategy: string } | null {
  const items = enaDaily.filter(
    (d) => d.rerun_channel_code === rerunChannelCode && d.retention_pct !== null && d.retention_pct !== undefined
  );
  if (items.length === 0) return null;
  // 여러 건이면 가장 낮은 유지율(가장 심각한 사례) 기준으로 원인·전략을 제시한다.
  const worst = items.reduce((a, b) => ((b.retention_pct ?? 100) < (a.retention_pct ?? 100) ? b : a));
  const verdict = rerunVerdict(worst.retention_pct);
  if (verdict?.tone === "bad") {
    return {
      cause: "편성 효율 및 시청자 흡수율이 떨어진 것으로 분석됨.",
      strategy: "본방 직후 타깃 유입 한계가 확인됨 → 직재방 편성 시간대 재검토 및 타깃 유입 강화를 위한 전략적 편성 변화가 필요함.",
    };
  }
  if (verdict?.tone === "warn") {
    return {
      cause: "본방 대비 시청자 흡수율은 유지되나 개선 여지가 있는 것으로 분석됨.",
      strategy: "직재방 편성 시간대·프로모션 노출을 점검해 유지율을 끌어올릴 여지가 있음.",
    };
  }
  return {
    cause: "본방 시청자가 직재방까지 안정적으로 이어진 것으로 분석됨.",
    strategy: "현재 직재방 편성 시간대·구조를 유지하는 것이 바람직함.",
  };
}
